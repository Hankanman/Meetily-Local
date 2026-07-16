use anyhow::{anyhow, Result};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use uuid::Uuid;

use crate::speaker_diarization::Diarizer;
use crate::whisper_engine::WhisperEngine;

/// Unload the Whisper model after a batch job (import or retranscription).
/// Skips unloading if a live recording is currently in progress, since recording
/// uses the same global engine instance.
pub(crate) async fn unload_engine_after_batch() {
    if crate::audio::recording_commands::is_recording().await {
        log::info!("Skipping model unload after batch: recording in progress");
        return;
    }

    use crate::whisper_engine::commands::WHISPER_ENGINE;
    let engine = {
        let guard = WHISPER_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
        guard.as_ref().cloned()
    };
    if let Some(e) = engine {
        e.unload_model().await;
    }
}

/// One transcribed segment from a batch (import / retranscription) job.
/// `speaker`/`voice_profile_id` are populated when a [`Diarizer`] is
/// available for the batch; otherwise they're `None`.
///
/// [`Diarizer`]: crate::speaker_diarization::Diarizer
#[derive(Debug, Clone)]
pub(crate) struct BatchTranscript {
    pub text: String,
    pub start_ms: f64,
    pub end_ms: f64,
    pub speaker: Option<String>,
    pub voice_profile_id: Option<String>,
}

/// Canonical transcript segment type, shared by the live-recording path, the
/// batch import/retranscription paths, and DB persistence (`api_save_transcript`,
/// `TranscriptsRepository::save_transcript`).
///
/// This unifies what used to be two separate types:
/// - the batch/API shape (`timestamp` an RFC3339 string, no `display_time`/
///   `confidence`/`sequence_id`)
/// - the live-recording shape (`display_time`/`confidence`/`sequence_id`
///   always set, no `timestamp`)
///
/// All the fields one side doesn't set are `None` and skipped on
/// serialization, so each path's transcripts.json/DB-row shape is unchanged
/// other than a widened schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    /// RFC3339 timestamp. Set by the batch/import/retranscription path and by
    /// callers restoring a segment from the database; the live-recording path
    /// leaves this `None` (it has `display_time` instead).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    // Recording-relative timestamps for playback synchronization
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    /// Formatted wall-clock time for display (e.g. "[02:15]"). Set by the
    /// live-recording path only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_time: Option<String>,
    /// Whisper confidence score. Set by the live-recording path only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    /// Monotonic per-recording sequence number the live-recording path uses to
    /// upsert partial->final updates in place. Batch paths leave this `None`;
    /// `write_transcripts_json` falls back to array position for those.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_id: Option<u64>,
    /// Speaker label assigned at transcription time. Optional so older
    /// callers and pre-Phase-1 saves remain wire-compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaker: Option<String>,
    /// Foreign key into `voice_profiles` when matched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_profile_id: Option<String>,
    /// Audio-stream this segment came from: "mic" or "system". Set by the
    /// live-recording path (which knows the capture source); left `None` by
    /// batch/import paths that read the mixed-down audio. Drives source-aware
    /// per-segment playback (mic = left channel, system = right).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Create transcript segments from a batch transcription result.
pub(crate) fn create_transcript_segments(
    transcripts: &[BatchTranscript],
) -> Vec<TranscriptSegment> {
    transcripts
        .iter()
        .map(|t| {
            let start_seconds = t.start_ms / 1000.0;
            let end_seconds = t.end_ms / 1000.0;
            let duration = end_seconds - start_seconds;

            TranscriptSegment {
                id: format!("transcript-{}", Uuid::new_v4()),
                text: t.text.trim().to_string(),
                timestamp: Some(chrono::Utc::now().to_rfc3339()),
                audio_start_time: Some(start_seconds),
                audio_end_time: Some(end_seconds),
                duration: Some(duration),
                display_time: None,
                confidence: None,
                sequence_id: None,
                speaker: t.speaker.clone(),
                voice_profile_id: t.voice_profile_id.clone(),
                // Batch/retranscription reads the mixed-down audio, so there's
                // no meaningful per-stream source to attribute here.
                source: None,
            }
        })
        .collect()
}

/// Write transcripts.json to a meeting folder (atomic write with temp file).
///
/// Used by the live-recording path (incremental + final save) and by the
/// batch import/retranscription paths. `sequence_id` is taken from the
/// segment when the segment carries one (live-recording, meaningful for
/// upserts); otherwise it falls back to the segment's array position (batch
/// paths, which don't have a meaningful sequence_id of their own).
pub(crate) fn write_transcripts_json(folder: &Path, segments: &[TranscriptSegment]) -> Result<()> {
    let transcript_path = folder.join("transcripts.json");
    let temp_path = folder.join(".transcripts.json.tmp");

    let json = serde_json::json!({
        "version": "1.0",
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "total_segments": segments.len(),
        "segments": segments.iter().enumerate().map(|(i, s)| {
            let mut obj = serde_json::json!({
                "id": s.id,
                "text": s.text,
                "audio_start_time": s.audio_start_time,
                "audio_end_time": s.audio_end_time,
                "duration": s.duration,
                "speaker": s.speaker,
                "voice_profile_id": s.voice_profile_id,
                "sequence_id": s.sequence_id.unwrap_or(i as u64),
            });
            if let Some(obj) = obj.as_object_mut() {
                if let Some(ts) = &s.timestamp {
                    obj.insert("timestamp".to_string(), serde_json::json!(ts));
                }
                if let Some(dt) = &s.display_time {
                    obj.insert("display_time".to_string(), serde_json::json!(dt));
                }
                if let Some(conf) = s.confidence {
                    obj.insert("confidence".to_string(), serde_json::json!(conf));
                }
            }
            obj
        }).collect::<Vec<_>>()
    });

    let json_string = serde_json::to_string_pretty(&json)?;
    std::fs::write(&temp_path, &json_string)?;
    std::fs::rename(&temp_path, &transcript_path)?;

    info!(
        "Wrote transcripts.json with {} segments to {}",
        segments.len(),
        transcript_path.display()
    );
    Ok(())
}

/// Which device names were used to capture a recording, when known.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub microphone: Option<String>,
    pub system_audio: Option<String>,
}

/// Canonical metadata.json schema, shared by the live-recording path, audio
/// import, and retranscription. Every field is `Option` and skipped when
/// `None` on serialization: a caller only sets the fields it actually knows
/// about, and `write_metadata`'s merge behavior leaves any field it doesn't
/// set untouched on disk (see that function for details).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MeetingMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meeting_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retranscribed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub devices: Option<DeviceInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Which pipeline produced (or most recently touched) this meeting's
    /// transcript: `"recording"` | `"import"` | `"retranscription"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// Set when this meeting's transcript was automatically upgraded in the
    /// background after the live recording finished, using a higher-accuracy
    /// Whisper model than the one used live (see
    /// `audio::retranscription::spawn_auto_refine`). Distinct from
    /// `retranscribed_at`/`origin` so a "was this auto-refined?" check
    /// doesn't also match a user-initiated manual retranscription.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_refined_at: Option<String>,
}

/// Write (or merge into) metadata.json, atomically.
///
/// If metadata.json already exists and parses as a JSON object, every
/// non-`None` field of `updates` is merged into it — fields `updates` leaves
/// `None` keep whatever value (or absence) is already on disk. This is what
/// lets e.g. retranscription set `status`/`retranscribed_at`/`origin` without
/// clobbering `meeting_name`/`devices`/`sample_rate` a prior recording or
/// import wrote, and lets older on-disk files (missing fields this schema
/// added later) round-trip untouched.
///
/// If the file doesn't exist yet (or is unreadable), `fallback()` is used to
/// produce the full initial document instead of `updates` — callers that
/// always write a complete document (recording, import) can just pass the
/// same value to both; callers that only ever intend a partial update
/// (retranscription) can build a separate, fuller fallback document.
pub(crate) fn write_metadata(
    folder: &Path,
    updates: &MeetingMetadata,
    fallback: impl FnOnce() -> MeetingMetadata,
) -> Result<()> {
    let metadata_path = folder.join("metadata.json");
    let temp_path = folder.join(".metadata.json.tmp");

    let updates_value = serde_json::to_value(updates)?;

    let existing = if metadata_path.exists() {
        std::fs::read_to_string(&metadata_path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
        None
    };

    let json = match existing {
        Some(mut existing) => {
            if let (Some(obj), Some(updates_obj)) =
                (existing.as_object_mut(), updates_value.as_object())
            {
                for (k, v) in updates_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
            existing
        }
        None => serde_json::to_value(fallback())?,
    };

    let json_string = serde_json::to_string_pretty(&json)?;
    std::fs::write(&temp_path, &json_string)?;
    std::fs::rename(&temp_path, &metadata_path)?;

    info!("Wrote metadata.json to {}", metadata_path.display());
    Ok(())
}

/// Log VAD segment-duration diagnostics (avg/min/max + first 10 segments).
/// Identical block previously duplicated in import.rs and retranscription.rs;
/// called by each right after their own VAD invocation (VAD itself stays in
/// the caller since the two differ in progress-event shape and in what
/// happens on zero detected segments — see [`run_batch_transcription`]).
pub(crate) fn log_vad_diagnostics(speech_segments: &[crate::audio::vad::SpeechSegment]) {
    if speech_segments.is_empty() {
        return;
    }
    let durations_ms: Vec<f64> = speech_segments
        .iter()
        .map(|s| s.end_timestamp_ms - s.start_timestamp_ms)
        .collect();
    let total_speech_ms: f64 = durations_ms.iter().sum();
    let avg_duration = total_speech_ms / durations_ms.len() as f64;
    let min_duration = durations_ms.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_duration = durations_ms
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);
    info!(
        "VAD segment stats: avg={:.0}ms, min={:.0}ms, max={:.0}ms, total_speech={:.1}s",
        avg_duration,
        min_duration,
        max_duration,
        total_speech_ms / 1000.0,
    );
    for (i, seg) in speech_segments.iter().take(10).enumerate() {
        let dur = seg.end_timestamp_ms - seg.start_timestamp_ms;
        debug!(
            "  Segment {}: {:.0}ms-{:.0}ms ({:.0}ms, {} samples)",
            i, seg.start_timestamp_ms, seg.end_timestamp_ms, dur, seg.samples.len()
        );
    }
    if speech_segments.len() > 10 {
        debug!("  ... and {} more segments", speech_segments.len() - 10);
    }
}

/// Shared split-at-silence -> per-segment transcribe -> diarize pipeline used
/// by both audio import and retranscription, given VAD-detected
/// `speech_segments`. The two callers are ~90% identical from here on; they
/// differ only in the exact progress event they emit (name/payload/
/// percentage range). VAD itself (and the zero-segments decision: import
/// continues with an empty transcript + a warning event, retranscription
/// treats it as a hard error) stays in the caller, since folding VAD in here
/// would force both callers to acquire a Whisper engine + diarizer even when
/// VAD finds nothing to transcribe.
///
/// `on_segment_progress(index, total, duration_secs)` is invoked once per
/// processable segment, right before it's transcribed.
pub(crate) async fn run_batch_transcription(
    speech_segments: &[crate::audio::vad::SpeechSegment],
    language: Option<String>,
    whisper_engine: Arc<WhisperEngine>,
    diarizer: Option<Arc<Diarizer>>,
    cancel_flag: &'static AtomicBool,
    on_segment_progress: impl Fn(usize, usize, f64),
) -> Result<Vec<BatchTranscript>> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Err(anyhow!("Cancelled"));
    }

    // Split very long segments at silence boundaries for better transcription quality.
    // Hard cuts at arbitrary sample positions lose words at boundaries. Instead, scan
    // for the lowest-energy window near the target split point and cut there.
    const MAX_SEGMENT_SAMPLES: usize = 25 * 16000; // 25 seconds at 16kHz

    let mut processable_segments: Vec<crate::audio::vad::SpeechSegment> = Vec::new();
    for segment in speech_segments {
        if segment.samples.len() > MAX_SEGMENT_SAMPLES {
            debug!(
                "Splitting large segment ({:.0}ms, {} samples) at silence boundaries",
                segment.end_timestamp_ms - segment.start_timestamp_ms,
                segment.samples.len()
            );
            let sub_segments = split_segment_at_silence(segment, MAX_SEGMENT_SAMPLES);
            debug!("Split into {} sub-segments", sub_segments.len());
            processable_segments.extend(sub_segments);
        } else {
            processable_segments.push(segment.clone());
        }
    }

    let processable_count = processable_segments.len();
    info!("Processing {} segments (after splitting)", processable_count);

    let mut all_transcripts: Vec<BatchTranscript> = Vec::new();
    let mut total_confidence = 0.0f32;
    // Rolling tail of accepted text, fed as whisper's initial prompt so
    // consecutive segments share decoder context (casing, punctuation,
    // proper-noun consistency). Same mechanism as the live worker.
    let mut context_tail = String::new();

    for (i, segment) in processable_segments.iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err(anyhow!("Cancelled"));
        }

        let segment_duration_sec = (segment.end_timestamp_ms - segment.start_timestamp_ms) / 1000.0;
        on_segment_progress(i, processable_count, segment_duration_sec);

        // Skip very short segments (< 100ms of audio = 1600 samples at 16kHz)
        if segment.samples.len() < 1600 {
            debug!(
                "Skipping short segment {} with {} samples",
                i,
                segment.samples.len()
            );
            continue;
        }

        let prompt = if context_tail.is_empty() {
            None
        } else {
            Some(context_tail.clone())
        };
        let (text, conf, _) = whisper_engine
            .transcribe_audio_with_confidence(segment.samples.clone(), language.clone(), prompt)
            .await
            .map_err(|e| anyhow!("Whisper transcription failed on segment {}: {}", i, e))?;

        // Same hallucination screen as the live path.
        if crate::audio::transcription::worker::is_likely_hallucination(&text, conf) {
            debug!(
                "Segment {}/{}: dropping likely hallucination '{}' (conf={:.2})",
                i + 1,
                processable_count,
                text.trim(),
                conf
            );
            continue;
        }

        let trimmed = text.trim();
        if !trimmed.is_empty() {
            if !context_tail.is_empty() {
                context_tail.push(' ');
            }
            context_tail.push_str(trimmed);
            if context_tail.len() > 600 {
                let cut = context_tail.len() - 600;
                let boundary = context_tail
                    .char_indices()
                    .map(|(idx, _)| idx)
                    .find(|&idx| idx >= cut)
                    .unwrap_or(0);
                context_tail = context_tail.split_off(boundary);
            }
            debug!(
                "Segment {}/{}: {:.1}s, conf={:.2}, text='{}'",
                i + 1,
                processable_count,
                segment_duration_sec,
                conf,
                if trimmed.len() > 80 {
                    let mut end = 80;
                    while !trimmed.is_char_boundary(end) {
                        end -= 1;
                    }
                    &trimmed[..end]
                } else {
                    trimmed
                }
            );

            let (speaker, voice_profile_id) = match diarizer.as_ref() {
                Some(d) => match d.process(i as u64, &segment.samples) {
                    Ok(result) => (Some(result.label), result.voice_profile_id),
                    Err(e) => {
                        debug!("Diarization fallback for batch segment {}: {}", i, e);
                        (None, None)
                    }
                },
                None => (None, None),
            };

            all_transcripts.push(BatchTranscript {
                text,
                start_ms: segment.start_timestamp_ms,
                end_ms: segment.end_timestamp_ms,
                speaker,
                voice_profile_id,
            });
            total_confidence += conf;
        } else {
            debug!(
                "Segment {}/{}: {:.1}s — empty transcription",
                i + 1,
                processable_count,
                segment_duration_sec
            );
        }
    }

    let transcribed_count = all_transcripts.len();
    let avg_confidence = if transcribed_count > 0 {
        total_confidence / transcribed_count as f32
    } else {
        0.0
    };
    info!(
        "Transcription complete: {} segments transcribed out of {}, avg confidence: {:.2}",
        transcribed_count, processable_count, avg_confidence
    );

    if cancel_flag.load(Ordering::SeqCst) {
        return Err(anyhow!("Cancelled"));
    }

    Ok(all_transcripts)
}

/// Split a long speech segment at the lowest-energy (silence) point near the target size.
///
/// Scans for 100ms windows with minimal RMS energy within +/-3 seconds of each target
/// split point. If no clear silence is found, falls back to a 1-second overlap split
/// to avoid cutting words at boundaries.
pub(crate) fn split_segment_at_silence(
    segment: &crate::audio::vad::SpeechSegment,
    max_samples: usize,
) -> Vec<crate::audio::vad::SpeechSegment> {
    const SAMPLE_RATE: usize = 16000;
    // 100ms window for energy measurement (1600 samples at 16kHz)
    const ENERGY_WINDOW: usize = SAMPLE_RATE / 10;
    // Search +/-3 seconds around the target split point
    const SEARCH_RADIUS: usize = SAMPLE_RATE * 3;
    // RMS threshold below which we consider a window "silent"
    const SILENCE_RMS_THRESHOLD: f32 = 0.02;
    // Overlap to use when no silence boundary is found (1 second)
    const FALLBACK_OVERLAP: usize = SAMPLE_RATE;

    let total = segment.samples.len();
    if total <= max_samples {
        return vec![segment.clone()];
    }

    let ms_per_sample =
        (segment.end_timestamp_ms - segment.start_timestamp_ms) / segment.samples.len() as f64;
    let mut result = Vec::new();
    let mut pos = 0usize;

    while pos < total {
        let remaining = total - pos;
        if remaining <= max_samples {
            // Last chunk - take everything remaining
            let chunk_samples = segment.samples[pos..].to_vec();
            let chunk_start_ms = segment.start_timestamp_ms + (pos as f64 * ms_per_sample);
            let chunk_end_ms = segment.end_timestamp_ms;
            result.push(crate::audio::vad::SpeechSegment {
                samples: chunk_samples,
                start_timestamp_ms: chunk_start_ms,
                end_timestamp_ms: chunk_end_ms,
                confidence: segment.confidence,
                source: segment.source,
            });
            break;
        }

        // Target split point
        let target = pos + max_samples;

        // Search window: [target - SEARCH_RADIUS, target + SEARCH_RADIUS]
        let search_start = target.saturating_sub(SEARCH_RADIUS).max(pos + SAMPLE_RATE);
        let search_end = (target + SEARCH_RADIUS).min(total.saturating_sub(ENERGY_WINDOW));

        // Find the lowest-energy 100ms window in the search range
        let mut best_split = target.min(total); // fallback: exact target
        let mut best_rms = f32::MAX;

        if search_start + ENERGY_WINDOW <= search_end {
            let mut idx = search_start;
            while idx + ENERGY_WINDOW <= search_end {
                let window = &segment.samples[idx..idx + ENERGY_WINDOW];
                let rms = (window.iter().map(|s| s * s).sum::<f32>() / ENERGY_WINDOW as f32).sqrt();
                if rms < best_rms {
                    best_rms = rms;
                    best_split = idx + ENERGY_WINDOW / 2; // split at center of quiet window
                }
                // Step by 10ms (160 samples) for efficiency
                idx += SAMPLE_RATE / 100;
            }
        }

        let split_at = best_split;
        if best_rms <= SILENCE_RMS_THRESHOLD {
            debug!(
                "Splitting at silence boundary: sample {} (RMS={:.4})",
                split_at, best_rms
            );
        } else {
            debug!(
                "No silence found near target (best RMS={:.4}), splitting with overlap at sample {}",
                best_rms, split_at
            );
        }

        // Determine the actual end of this chunk (with overlap if no silence)
        let chunk_end = if best_rms > SILENCE_RMS_THRESHOLD {
            (split_at + FALLBACK_OVERLAP).min(total)
        } else {
            split_at
        };

        let chunk_samples = segment.samples[pos..chunk_end].to_vec();
        let chunk_start_ms = segment.start_timestamp_ms + (pos as f64 * ms_per_sample);
        let chunk_end_ms = segment.start_timestamp_ms + (chunk_end as f64 * ms_per_sample);

        result.push(crate::audio::vad::SpeechSegment {
            samples: chunk_samples,
            start_timestamp_ms: chunk_start_ms,
            end_timestamp_ms: chunk_end_ms,
            confidence: segment.confidence,
            source: segment.source,
        });

        // Advance position to where the current chunk actually ends
        // to avoid transcribing the overlap region twice
        pos = chunk_end;
    }

    result
}
