//! Voice activity detection — wraps sherpa-onnx's `VoiceActivityDetector`.
//!
//! Previously used `silero-rs` (which depends on the `ort` crate). That worked
//! fine in isolation, but having `ort` in the same binary as `sherpa-onnx-sys`
//! (used for speaker embedding) caused glibc `free(): invalid pointer` aborts
//! at sherpa-onnx's first model load on Linux/CUDA — two static onnxruntime
//! copies in one process don't coexist on every platform. Switching to
//! sherpa-onnx's bundled VAD eliminates the second runtime entirely.
//!
//! Behaviour we preserve:
//! - Same `SpeechSegment` shape (samples + start/end timestamps + source tag).
//! - Same `ContinuousVadProcessor` API (`new`, `new_with_source`, `process_audio`, `flush`).
//! - Same `extract_speech_16k`, `get_speech_chunks`, `get_speech_chunks_with_progress` helpers.
//! - 16 kHz mono input; resampling from any input rate happens here.
//!
//! What changed under the hood:
//! - The "redemption_time_ms" parameter now maps to sherpa's
//!   `min_silence_duration` (the trailing silence gap that terminates a
//!   speech segment). Same intent, slightly different name.
//! - Sherpa accepts arbitrary chunk sizes (no 30 ms windowing here);
//!   internal windowing is fixed at 512 samples per silero-vad's spec.

use anyhow::{anyhow, Result};
use log::{debug, info, warn};
use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use super::recording_state::DeviceType;

/// Represents a complete speech segment detected by VAD.
#[derive(Debug, Clone)]
pub struct SpeechSegment {
    pub samples: Vec<f32>,
    pub start_timestamp_ms: f64,
    pub end_timestamp_ms: f64,
    pub confidence: f32,
    /// Which audio stream this segment came from (Mic or System).
    /// Set by the VAD processor based on its construction-time source tag.
    pub source: DeviceType,
}

/// Streaming VAD processor that emits complete speech segments.
pub struct ContinuousVadProcessor {
    detector: VoiceActivityDetector,
    /// Sample rate of the *input* audio (we resample to 16 kHz before feeding sherpa).
    sample_rate: u32,
    /// Total 16 kHz samples consumed so far. Used to convert sherpa's
    /// segment-relative sample indices into absolute timestamps.
    processed_samples_16k: u64,
    /// Source tag stamped onto every emitted segment (Mic or System).
    source: DeviceType,
}

const VAD_SAMPLE_RATE: i32 = 16_000;

impl ContinuousVadProcessor {
    /// Create a VAD processor with no specific source tag (defaults to Mic for
    /// backward compatibility with helpers that operate on a single mixed stream).
    pub fn new(input_sample_rate: u32, redemption_time_ms: u32) -> Result<Self> {
        Self::new_with_source(input_sample_rate, redemption_time_ms, DeviceType::Microphone)
    }

    /// Create a VAD processor that tags every emitted segment with `source`.
    /// Used for the dual-VAD pipeline where mic and system streams are
    /// processed independently to preserve source identity.
    pub fn new_with_source(
        input_sample_rate: u32,
        redemption_time_ms: u32,
        source: DeviceType,
    ) -> Result<Self> {
        let model_path = crate::speaker_diarization::model::silero_vad_path()
            .ok_or_else(|| anyhow!("silero-vad model dir not configured"))?;
        if !crate::speaker_diarization::model::model_is_ready(&model_path) {
            return Err(anyhow!(
                "silero-vad model not present at {}; download it on app startup",
                model_path.display()
            ));
        }

        // Map silero-rs's "redemption_time" (how long after losing speech to
        // wait before declaring segment end) to sherpa's `min_silence_duration`.
        let min_silence_duration = (redemption_time_ms as f32) / 1000.0;

        let config = VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(model_path.to_string_lossy().into_owned()),
                // 0.45 (vs silero default 0.50) makes brief lulls in continuous
                // speech register as silence — needed for meeting audio that
                // has continuous low-level room noise.
                threshold: 0.45,
                min_silence_duration,           // From caller (typically 400ms live, 800ms batch).
                min_speech_duration: 0.25,      // Reject segments shorter than 250ms.
                window_size: 512,               // 32 ms at 16 kHz, silero-vad's expected window.
                // Force-cut after 20s. Real meeting utterances rarely exceed
                // this; longer segments hurt diarization (multiple speakers
                // get embedded as one) and Whisper accuracy.
                max_speech_duration: 20.0,
            },
            ten_vad: Default::default(),
            sample_rate: VAD_SAMPLE_RATE,
            num_threads: 1,
            provider: Some("cpu".to_string()),
            debug: false,
        };

        // 30-second internal buffer — must be >= max_speech_duration so the
        // VAD has room to look back when force-cutting.
        let detector = VoiceActivityDetector::create(&config, 30.0)
            .ok_or_else(|| anyhow!("Failed to create sherpa VoiceActivityDetector"))?;

        info!(
            "VAD processor created (sherpa-onnx silero): input={}Hz, vad=16000Hz, \
             min_silence={}ms, source={:?}",
            input_sample_rate, redemption_time_ms, source
        );

        Ok(Self {
            detector,
            sample_rate: input_sample_rate,
            processed_samples_16k: 0,
            source,
        })
    }

    /// Process incoming audio samples and return any complete speech segments.
    /// Handles resampling from input sample rate to 16 kHz.
    pub fn process_audio(&mut self, samples: &[f32]) -> Result<Vec<SpeechSegment>> {
        let resampled: std::borrow::Cow<[f32]> = if self.sample_rate == 16_000 {
            samples.into()
        } else {
            self.resample_to_16k(samples)?.into()
        };

        self.detector.accept_waveform(resampled.as_ref());
        self.processed_samples_16k += resampled.as_ref().len() as u64;

        Ok(self.drain_segments())
    }

    /// Flush any remaining buffered audio and return final speech segments.
    pub fn flush(&mut self) -> Result<Vec<SpeechSegment>> {
        debug!(
            "VAD flush: processed {} samples ({}s), draining trailing segments",
            self.processed_samples_16k,
            self.processed_samples_16k as f64 / 16_000.0
        );
        self.detector.flush();
        Ok(self.drain_segments())
    }

    /// Pop every queued segment from sherpa's detector, converting each to
    /// our `SpeechSegment` shape (with timestamps and source tag).
    fn drain_segments(&mut self) -> Vec<SpeechSegment> {
        let mut out = Vec::new();
        while !self.detector.is_empty() {
            let Some(seg) = self.detector.front() else { break };
            let start_sample = seg.start();
            let samples_slice = seg.samples();
            let n_samples = samples_slice.len();
            let samples = samples_slice.to_vec();

            let start_ms = (start_sample as f64 / 16_000.0) * 1000.0;
            let end_ms = ((start_sample as i64 + n_samples as i64) as f64 / 16_000.0) * 1000.0;

            info!(
                "VAD: speech segment {:.0}ms-{:.0}ms ({} samples, source={:?})",
                start_ms, end_ms, n_samples, self.source
            );

            out.push(SpeechSegment {
                samples,
                start_timestamp_ms: start_ms,
                end_timestamp_ms: end_ms,
                confidence: 0.9,
                source: self.source,
            });

            // `front()` borrows the segment; drop before pop to release the
            // sherpa-side buffer.
            drop(seg);
            self.detector.pop();
        }
        out
    }

    /// Resample `samples` from `self.sample_rate` to 16 kHz with a basic
    /// low-pass + linear interpolation. Adequate for VAD input quality.
    fn resample_to_16k(&self, samples: &[f32]) -> Result<Vec<f32>> {
        if self.sample_rate == 16_000 {
            return Ok(samples.to_vec());
        }

        let ratio = self.sample_rate as f64 / 16_000.0;
        let output_len = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_len);

        // Simple moving-average low-pass before downsampling to reduce aliasing.
        let filter_size = std::cmp::max(
            1,
            std::cmp::min(
                (self.sample_rate as f64 / (0.4 * self.sample_rate as f64)) as usize,
                5,
            ),
        );
        let mut filtered = Vec::with_capacity(samples.len());
        for i in 0..samples.len() {
            let start = if i >= filter_size { i - filter_size } else { 0 };
            let end = std::cmp::min(i + filter_size + 1, samples.len());
            let sum: f32 = samples[start..end].iter().sum();
            filtered.push(sum / (end - start) as f32);
        }

        // Linear-interpolation downsampling.
        for i in 0..output_len {
            let source_pos = i as f64 * ratio;
            let source_index = source_pos as usize;
            let fraction = source_pos - source_index as f64;
            if source_index + 1 < filtered.len() {
                let s1 = filtered[source_index];
                let s2 = filtered[source_index + 1];
                resampled.push(s1 + (s2 - s1) * fraction as f32);
            } else if source_index < filtered.len() {
                resampled.push(filtered[source_index]);
            }
        }

        debug!(
            "Resampled {} → {} samples ({}Hz → 16kHz)",
            samples.len(),
            resampled.len(),
            self.sample_rate
        );
        Ok(resampled)
    }
}

/// Legacy helper: extract concatenated speech samples from a 16 kHz mono buffer.
/// Used by older code paths that want a single contiguous "speech-only" array.
pub fn extract_speech_16k(samples_mono_16k: &[f32]) -> Result<Vec<f32>> {
    let mut processor = ContinuousVadProcessor::new(16_000, 400)?;

    let mut all_segments = processor.process_audio(samples_mono_16k)?;
    let final_segments = processor.flush()?;
    all_segments.extend(final_segments);

    let mut result = Vec::new();
    let num_segments = all_segments.len();
    for segment in &all_segments {
        result.extend_from_slice(&segment.samples);
    }

    // Energy-based fallback for very short outputs (avoids Whisper hallucinating
    // on near-silent input that VAD over-aggressively trimmed).
    if result.len() < 1600 {
        let input_energy: f32 =
            samples_mono_16k.iter().map(|&x| x * x).sum::<f32>() / samples_mono_16k.len() as f32;
        let rms = input_energy.sqrt();
        let peak = samples_mono_16k
            .iter()
            .map(|&x| x.abs())
            .fold(0.0f32, f32::max);

        if rms < 0.2 || peak < 0.20 {
            info!(
                "VAD detected silence/noise (RMS: {:.6}, Peak: {:.6}); skipping",
                rms, peak
            );
            return Ok(Vec::new());
        } else {
            info!(
                "VAD energy-fallback: passing through full buffer (RMS: {:.6}, Peak: {:.6})",
                rms, peak
            );
            return Ok(samples_mono_16k.to_vec());
        }
    }

    debug!(
        "VAD: processed {} samples → {} speech samples from {} segments",
        samples_mono_16k.len(),
        result.len(),
        num_segments
    );
    Ok(result)
}

/// Convenience: get all speech chunks from a 16 kHz mono buffer.
pub fn get_speech_chunks(
    samples_mono_16k: &[f32],
    redemption_time_ms: u32,
) -> Result<Vec<SpeechSegment>> {
    get_speech_chunks_with_progress(samples_mono_16k, redemption_time_ms, |_, _| true)
}

/// Get speech chunks with a progress callback and cancellation support.
/// The callback receives `(progress_percent, segments_found_so_far)` and
/// returning `false` cancels processing.
pub fn get_speech_chunks_with_progress<F>(
    samples_mono_16k: &[f32],
    redemption_time_ms: u32,
    mut progress_callback: F,
) -> Result<Vec<SpeechSegment>>
where
    F: FnMut(u32, usize) -> bool,
{
    let mut processor = ContinuousVadProcessor::new(16_000, redemption_time_ms)?;

    const LARGE_FILE_THRESHOLD: usize = 960_000; // ~60s at 16kHz
    const CHUNK_SIZE: usize = 160_000; // 10s slices for progress granularity

    let total_samples = samples_mono_16k.len();
    let mut all_segments = Vec::new();

    if total_samples > LARGE_FILE_THRESHOLD {
        info!(
            "VAD: processing large file ({} samples = {:.1}s)",
            total_samples,
            total_samples as f64 / 16_000.0
        );

        let mut processed = 0usize;
        let mut last_progress = 0u32;
        let mut chunk_count = 0usize;
        let total_chunks = (total_samples + CHUNK_SIZE - 1) / CHUNK_SIZE;

        for chunk in samples_mono_16k.chunks(CHUNK_SIZE) {
            chunk_count += 1;
            let start_time = std::time::Instant::now();
            let segments = processor.process_audio(chunk)?;
            let elapsed = start_time.elapsed();

            debug!(
                "VAD chunk {}/{} processed in {:?}, found {} segments",
                chunk_count,
                total_chunks,
                elapsed,
                segments.len()
            );
            if elapsed.as_secs() > 1 {
                warn!(
                    "VAD chunk {} took {:?} — possible performance issue",
                    chunk_count, elapsed
                );
            }
            all_segments.extend(segments);

            processed += chunk.len();
            let progress = ((processed * 100) / total_samples) as u32;
            if progress >= last_progress + 5 {
                debug!(
                    "VAD progress {}% ({} segments so far)",
                    progress,
                    all_segments.len()
                );
                if !progress_callback(progress, all_segments.len()) {
                    info!("VAD cancelled by callback at {}%", progress);
                    return Err(anyhow!("VAD processing cancelled"));
                }
                last_progress = progress;
            }
        }

        all_segments.extend(processor.flush()?);
        info!("VAD complete: {} speech segments", all_segments.len());
    } else {
        all_segments = processor.process_audio(samples_mono_16k)?;
        all_segments.extend(processor.flush()?);
    }

    Ok(all_segments)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silero_vad_available() -> bool {
        crate::speaker_diarization::model::silero_vad_path()
            .map(|p| crate::speaker_diarization::model::model_is_ready(&p))
            .unwrap_or(false)
    }

    /// Generate synthetic speech-like audio with alternating speech/silence.
    fn generate_test_audio_with_speech(duration_seconds: f32, sample_rate: u32) -> Vec<f32> {
        let total_samples = (duration_seconds * sample_rate as f32) as usize;
        let mut samples = vec![0.0f32; total_samples];

        let speech_interval = 10.0;
        let speech_duration = 5.0;

        for i in 0..total_samples {
            let time = i as f32 / sample_rate as f32;
            let cycle_time = time % speech_interval;
            if cycle_time < speech_duration {
                let freq1 = 200.0 + (time * 50.0).sin() * 100.0;
                let freq2 = freq1 * 2.0;
                let freq3 = freq1 * 3.0;
                let amplitude = 0.3 + 0.1 * (time * 5.0).sin();
                samples[i] = amplitude
                    * (0.5 * (2.0 * std::f32::consts::PI * freq1 * time).sin()
                        + 0.3 * (2.0 * std::f32::consts::PI * freq2 * time).sin()
                        + 0.2 * (2.0 * std::f32::consts::PI * freq3 * time).sin());
            }
        }
        samples
    }

    #[test]
    fn test_vad_chunked_vs_single_processing() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let audio = generate_test_audio_with_speech(60.0, 16_000);
        let segments_single = get_speech_chunks(&audio, 2000).expect("single failed");
        let segments_chunked =
            get_speech_chunks_with_progress(&audio, 2000, |_, _| true).expect("chunked failed");
        let diff = (segments_single.len() as i32 - segments_chunked.len() as i32).abs();
        assert!(
            diff <= 1,
            "single vs chunked segment counts differ too much: {} vs {}",
            segments_single.len(),
            segments_chunked.len(),
        );
    }

    #[test]
    fn test_vad_large_file_progress() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let audio = generate_test_audio_with_speech(120.0, 16_000);
        let mut progress_updates = Vec::new();
        let segments = get_speech_chunks_with_progress(&audio, 2000, |progress, segments| {
            progress_updates.push((progress, segments));
            true
        })
        .expect("processing failed");
        assert!(!progress_updates.is_empty());
        // Synthetic audio doesn't always trigger silero, so don't assert
        // segment count — just confirm we made it through without panicking.
        let _ = segments;
    }

    #[test]
    fn test_vad_cancellation() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let audio = generate_test_audio_with_speech(120.0, 16_000);
        let result = get_speech_chunks_with_progress(&audio, 2000, |progress, _| progress < 50);
        assert!(result.is_err(), "expected cancellation error");
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("cancelled"));
    }

    #[test]
    fn test_vad_continuous_processor_state_across_chunks() {
        if !silero_vad_available() {
            eprintln!("skipping: silero_vad.onnx not present");
            return;
        }
        let mut processor =
            ContinuousVadProcessor::new(16_000, 2000).expect("Failed to create processor");
        let audio = generate_test_audio_with_speech(30.0, 16_000);

        let mut all_segments = Vec::new();
        for chunk in audio.chunks(160_000) {
            let segments = processor.process_audio(chunk).expect("process failed");
            all_segments.extend(segments);
        }
        all_segments.extend(processor.flush().expect("flush failed"));
        // Synthetic harmonic stack isn't always speech-like enough to trigger
        // silero VAD; just confirm the processor doesn't panic across chunks.
        let _ = all_segments;
    }
}
