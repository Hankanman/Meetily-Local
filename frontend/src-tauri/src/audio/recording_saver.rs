use anyhow::Result;
use log::{error, info, warn};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;
use tokio::sync::Mutex as AsyncMutex;

use super::audio_processing::create_meeting_folder;
use super::common::{
    write_metadata as common_write_metadata, write_transcripts_json as common_write_transcripts_json,
    DeviceInfo, MeetingMetadata,
};
use super::incremental_saver::IncrementalAudioSaver;
use super::recording_state::AudioChunk;

/// Canonical transcript segment type — re-exported here for compatibility
/// with the many call sites that already `use
/// crate::audio::recording_saver::TranscriptSegment` (the live-recording
/// path's historical name for it). See `audio::common::TranscriptSegment`
/// for the type itself.
pub use super::common::TranscriptSegment;

/// New recording saver using incremental saving strategy
pub struct RecordingSaver {
    incremental_saver: Option<Arc<AsyncMutex<IncrementalAudioSaver>>>,
    meeting_folder: Option<PathBuf>,
    meeting_name: Option<String>,
    metadata: Option<MeetingMetadata>,
    transcript_segments: Arc<Mutex<Vec<TranscriptSegment>>>,
    chunk_receiver: Option<mpsc::UnboundedReceiver<AudioChunk>>,
    is_saving: Arc<Mutex<bool>>,
    // Handle to the accumulation task spawned in `start_accumulation`, so
    // `stop_and_save` can wait for it to fully drain the channel (and write
    // every already-queued chunk) instead of racing it with a fixed sleep.
    accumulation_task: Option<tokio::task::JoinHandle<()>>,
}

impl RecordingSaver {
    pub fn new() -> Self {
        Self {
            incremental_saver: None,
            meeting_folder: None,
            meeting_name: None,
            metadata: None,
            transcript_segments: Arc::new(Mutex::new(Vec::new())),
            chunk_receiver: None,
            is_saving: Arc::new(Mutex::new(false)),
            accumulation_task: None,
        }
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.meeting_name = name;
    }

    /// Set device information in metadata
    pub fn set_device_info(&mut self, mic_name: Option<String>, sys_name: Option<String>) {
        if let Some(ref mut metadata) = self.metadata {
            metadata.devices = Some(DeviceInfo {
                microphone: mic_name,
                system_audio: sys_name,
            });

            // Write updated metadata to disk if folder exists
            if let Some(folder) = &self.meeting_folder {
                let metadata_clone = metadata.clone();
                if let Err(e) = self.write_metadata(folder, &metadata_clone) {
                    warn!("Failed to update metadata with device info: {}", e);
                }
            }
        }
    }

    /// Add or update a structured transcript segment (upserts based on sequence_id)
    /// Also saves incrementally to disk
    pub fn add_transcript_segment(&self, segment: TranscriptSegment) {
        if let Ok(mut segments) = self.transcript_segments.lock() {
            // Check if segment with same sequence_id exists (update it)
            if let Some(existing) = segments
                .iter_mut()
                .find(|s| s.sequence_id == segment.sequence_id)
            {
                *existing = segment.clone();
                info!(
                    "Updated transcript segment {} (seq: {:?}) - total segments: {}",
                    segment.id,
                    segment.sequence_id,
                    segments.len()
                );
            } else {
                // New segment, add it
                segments.push(segment.clone());
                info!(
                    "Added new transcript segment {} (seq: {:?}) - total segments: {}",
                    segment.id,
                    segment.sequence_id,
                    segments.len()
                );
            }
        } else {
            error!(
                "Failed to lock transcript segments for adding segment {}",
                segment.id
            );
        }

        // NEW: Save incrementally to disk
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                warn!("Failed to write incremental transcript update: {}", e);
            }
        }
    }

    /// Legacy method for backward compatibility - converts text to basic segment
    pub fn add_transcript_chunk(&self, text: String) {
        let segment = TranscriptSegment {
            id: format!("seg_{}", chrono::Utc::now().timestamp_millis()),
            text,
            timestamp: None,
            audio_start_time: Some(0.0),
            audio_end_time: Some(0.0),
            duration: Some(0.0),
            display_time: Some("[00:00]".to_string()),
            confidence: Some(1.0),
            sequence_id: Some(0),
            speaker: None,
            voice_profile_id: None,
            source: None,
        };
        self.add_transcript_segment(segment);
    }

    /// Start accumulation with optional incremental saving
    ///
    /// # Arguments
    /// * `auto_save` - If true, creates checkpoints and enables saving. If false, audio chunks are discarded.
    pub fn start_accumulation(&mut self, auto_save: bool) -> mpsc::UnboundedSender<AudioChunk> {
        if auto_save {
            info!("Initializing incremental audio saver for recording (auto-save ENABLED)");
        } else {
            info!(
                "Starting recording without audio saving (auto-save DISABLED - transcripts only)"
            );
        }

        // Create channel for receiving audio chunks
        let (sender, receiver) = mpsc::unbounded_channel::<AudioChunk>();
        self.chunk_receiver = Some(receiver);

        // Initialize meeting folder and incremental saver ONLY if auto_save is enabled
        if auto_save {
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, true) {
                    Ok(()) => info!("Successfully initialized meeting folder with checkpoints"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                        // Continue anyway - will use fallback flat structure
                    }
                }
            }
        } else {
            // When auto_save is false, still create meeting folder for transcripts/metadata
            // but skip .checkpoints directory
            if let Some(name) = self.meeting_name.clone() {
                match self.initialize_meeting_folder(&name, false) {
                    Ok(()) => info!("Successfully initialized meeting folder (transcripts only)"),
                    Err(e) => {
                        error!("Failed to initialize meeting folder: {}", e);
                    }
                }
            }
        }

        // Start accumulation task
        let incremental_saver_arc = self.incremental_saver.clone();
        let save_audio = auto_save;

        if let Some(mut receiver) = self.chunk_receiver.take() {
            let handle = tokio::spawn(async move {
                info!(
                    "Recording saver accumulation task started (save_audio: {})",
                    save_audio
                );

                // Run until the channel closes and drains, not until some external
                // "stop" flag flips. This guarantees every chunk already queued by
                // the pipeline (including trailing chunks sent right before the
                // pipeline shuts down) gets written before the task ends - the
                // sender side is dropped only once the pipeline itself is fully
                // stopped, so recv() naturally returns None only after that.
                while let Some(chunk) = receiver.recv().await {
                    // Only process audio chunks if auto_save is enabled
                    if save_audio {
                        // Add chunk to incremental saver
                        if let Some(saver_arc) = &incremental_saver_arc {
                            let mut saver_guard = saver_arc.lock().await;
                            if let Err(e) = saver_guard.add_chunk(chunk) {
                                error!("Failed to add chunk to incremental saver: {}", e);
                            }
                        } else {
                            error!("Incremental saver not available while accumulating");
                        }
                    } else {
                        // auto_save is false: discard audio chunk (no-op)
                        // Transcription already happened in the pipeline before this point
                    }
                }

                info!("Recording saver accumulation task ended");
            });
            self.accumulation_task = Some(handle);
        }

        // Set saving flag
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = true;
        }

        sender
    }

    /// Initialize meeting folder structure and metadata
    ///
    /// # Arguments
    /// * `meeting_name` - Name of the meeting
    /// * `create_checkpoints` - Whether to create .checkpoints/ directory and IncrementalAudioSaver
    fn initialize_meeting_folder(
        &mut self,
        meeting_name: &str,
        create_checkpoints: bool,
    ) -> Result<()> {
        // Load preferences to get base recordings folder
        let base_folder = super::recording_preferences::get_default_recordings_folder();

        // Create meeting folder structure (with or without .checkpoints/ subdirectory)
        let meeting_folder = create_meeting_folder(&base_folder, meeting_name, create_checkpoints)?;

        // Only initialize incremental saver if checkpoints are needed (auto_save is true)
        if create_checkpoints {
            // Stereo: mic on the left channel, system on the right (the
            // pipeline interleaves them). Keeps the two sources separable for
            // source-aware playback instead of pre-mixing to mono.
            let incremental_saver =
                IncrementalAudioSaver::new(meeting_folder.clone(), 48000, 2)?;
            self.incremental_saver = Some(Arc::new(AsyncMutex::new(incremental_saver)));
            info!(
                "✅ Incremental audio saver initialized for meeting: {}",
                meeting_name
            );
        } else {
            info!("⚠️  Skipped incremental audio saver (auto-save disabled)");
        }

        // Create initial metadata
        let metadata = MeetingMetadata {
            version: Some("1.0".to_string()),
            meeting_id: None, // Will be set by backend
            meeting_name: Some(meeting_name.to_string()),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            completed_at: None,
            retranscribed_at: None,
            duration_seconds: None,
            devices: Some(DeviceInfo {
                microphone: None, // Could be enhanced to store actual device names
                system_audio: None,
            }),
            audio_file: Some(
                if create_checkpoints {
                    "audio.mp4".to_string()
                } else {
                    "".to_string()
                },
            ),
            transcript_file: Some("transcripts.json".to_string()),
            sample_rate: Some(48000),
            status: Some("recording".to_string()),
            origin: Some("recording".to_string()),
            auto_refined_at: None,
        };

        // Write initial metadata.json
        self.write_metadata(&meeting_folder, &metadata)?;

        self.meeting_folder = Some(meeting_folder);
        self.metadata = Some(metadata);

        Ok(())
    }

    /// Write metadata.json to disk (atomic write with temp file, merging
    /// with whatever's already there — see `common::write_metadata`).
    fn write_metadata(&self, folder: &PathBuf, metadata: &MeetingMetadata) -> Result<()> {
        common_write_metadata(folder, metadata, || metadata.clone())
    }

    /// Write transcripts.json to disk (atomic write with temp file).
    fn write_transcripts_json(&self, folder: &PathBuf) -> Result<()> {
        // Clone segments to avoid holding lock during I/O
        let mut segments_clone = if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            error!("Failed to lock transcript segments for writing");
            return Err(anyhow::anyhow!("Failed to lock transcript segments"));
        };

        // Segments arrive in completion order, not chronological order: with
        // dual-VAD (mic + system) sources, a segment that started earlier can
        // finish later (e.g. a long system-audio segment force-cut well after
        // a short mic segment that started after it). Re-order chronologically
        // by audio start time before persisting, with sequence_id as a
        // tie-breaker for segments that share (or lack) a start time.
        Self::sort_segments_chronologically(&mut segments_clone);

        info!(
            "Writing {} transcript segments to JSON",
            segments_clone.len()
        );

        common_write_transcripts_json(folder, &segments_clone)?;

        info!(
            "✅ Successfully wrote transcripts.json with {} segments",
            segments_clone.len()
        );
        Ok(())
    }

    /// Wait for the accumulation task spawned by `start_accumulation` to
    /// finish draining its channel, without finalizing anything (no
    /// `audio.mp4` merge, no metadata/transcript writes). Used when aborting
    /// a recording start that failed before real capture began (issue #45),
    /// so `discard_empty_session` can safely inspect (and remove) the
    /// meeting folder once the task is no longer writing to it.
    ///
    /// The caller is responsible for dropping/closing whatever sender the
    /// accumulation task's receiver is reading from (directly, or by
    /// stopping the pipeline that owns it) — otherwise this waits out its
    /// full timeout with nothing to show for it.
    pub async fn abort_accumulation(&mut self) {
        if let Some(task) = self.accumulation_task.take() {
            match tokio::time::timeout(tokio::time::Duration::from_secs(5), task).await {
                Ok(Ok(())) => info!("Recording saver accumulation task drained cleanly (abort)"),
                Ok(Err(e)) => warn!("Recording saver accumulation task panicked (abort): {}", e),
                Err(_) => warn!(
                    "Timed out waiting for recording saver accumulation task to drain (abort)"
                ),
            }
        }
    }

    /// Discard the current session's meeting folder if it was created but
    /// never actually captured anything (issue #45).
    ///
    /// `start_accumulation` creates the meeting folder (plus `.checkpoints/`,
    /// `format.json` and `metadata.json` with status "recording") before the
    /// caller has actually managed to start audio capture. If capture then
    /// fails to start (pipeline or stream startup error), that folder is
    /// left behind on disk with no audio and no transcript, and the crash
    /// recovery dialog can later offer it as a recoverable meeting even
    /// though nothing was ever recorded.
    ///
    /// This removes the folder ONLY when it is safe to do so — no
    /// checkpoint audio chunks were written and no transcript segments were
    /// persisted — and resets this saver's session-scoped fields so it is
    /// ready to start a fresh session. If the folder holds real data (or no
    /// folder was created at all, e.g. auto_save-disabled + no meeting
    /// name), nothing is deleted.
    ///
    /// Returns `true` if the folder was discarded.
    pub fn discard_empty_session(&mut self) -> bool {
        let Some(folder) = self.meeting_folder.clone() else {
            return false;
        };

        if !Self::session_is_empty(&folder) {
            info!(
                "Not discarding meeting folder (contains audio or transcript data): {}",
                folder.display()
            );
            return false;
        }

        match std::fs::remove_dir_all(&folder) {
            Ok(()) => {
                info!(
                    "Discarded empty meeting folder from failed recording start: {}",
                    folder.display()
                );
            }
            Err(e) => {
                warn!(
                    "Failed to discard empty meeting folder {}: {}",
                    folder.display(),
                    e
                );
                // Fall through and reset our fields regardless — the caller
                // is aborting the session either way.
            }
        }

        self.meeting_folder = None;
        self.metadata = None;
        self.incremental_saver = None;
        if let Ok(mut segments) = self.transcript_segments.lock() {
            segments.clear();
        }
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        true
    }

    /// The actual discard decision (issue #45): a meeting folder is "empty"
    /// — safe to silently delete rather than leaving it for crash recovery
    /// to offer — only when `.checkpoints/` holds no `audio_chunk_*` files
    /// (covers both the current `.f32` checkpoints and the legacy `.mp4`
    /// ones) and `transcripts.json` is either absent or contains no
    /// segments.
    fn session_is_empty(meeting_folder: &std::path::Path) -> bool {
        let checkpoints_dir = meeting_folder.join(".checkpoints");
        let has_checkpoint_audio = match std::fs::read_dir(&checkpoints_dir) {
            Ok(entries) => entries.filter_map(|e| e.ok()).any(|entry| {
                entry
                    .path()
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(|stem| stem.starts_with("audio_chunk_"))
                    .unwrap_or(false)
            }),
            Err(_) => false,
        };
        if has_checkpoint_audio {
            return false;
        }

        let transcripts_path = meeting_folder.join("transcripts.json");
        let has_transcript_segments = match std::fs::read_to_string(&transcripts_path) {
            Ok(contents) => match serde_json::from_str::<serde_json::Value>(&contents) {
                Ok(serde_json::Value::Array(segments)) => !segments.is_empty(),
                // Any other shape (or an object wrapper) — treat non-empty
                // content as "has data" rather than risk deleting real
                // transcripts on a format we don't recognize.
                Ok(other) => !other.is_null(),
                Err(_) => true,
            },
            Err(_) => false,
        };

        !has_transcript_segments
    }

    // in frontend/src-tauri/src/audio/recording_saver.rs
    pub fn get_stats(&self) -> (usize, u32) {
        if let Some(ref saver) = self.incremental_saver {
            if let Ok(guard) = saver.try_lock() {
                (guard.get_checkpoint_count() as usize, 48000)
            } else {
                (0, 48000)
            }
        } else {
            (0, 48000)
        }
    }

    /// Stop and save using incremental saving approach
    ///
    /// # Arguments
    /// * `app` - Tauri app handle for emitting events
    /// * `recording_duration` - Actual recording duration in seconds (from RecordingState)
    pub async fn stop_and_save<R: Runtime>(
        &mut self,
        app: &AppHandle<R>,
        recording_duration: Option<f64>,
    ) -> Result<Option<String>, String> {
        info!("Stopping recording saver");

        // Mark accumulation as stopping (informational only - the accumulation
        // task itself only terminates once its channel closes and drains, so
        // no chunk already queued at this point is lost).
        if let Ok(mut is_saving) = self.is_saving.lock() {
            *is_saving = false;
        }

        // Wait for the accumulation task to fully drain and write every chunk
        // the pipeline already queued before finalizing. The pipeline's sender
        // is dropped before stop_and_save is called, so recv() returns None -
        // and this resolves - once the queue is empty. Bounded so a leaked
        // sender elsewhere can't hang shutdown forever.
        if let Some(task) = self.accumulation_task.take() {
            match tokio::time::timeout(tokio::time::Duration::from_secs(5), task).await {
                Ok(Ok(())) => info!("Recording saver accumulation task drained cleanly"),
                Ok(Err(e)) => warn!("Recording saver accumulation task panicked: {}", e),
                Err(_) => {
                    warn!("Timed out waiting for recording saver accumulation task to drain")
                }
            }
        }

        // Check if incremental saver exists (indicates auto_save was enabled)
        let should_save_audio = self.incremental_saver.is_some();

        if !should_save_audio {
            info!("⚠️  No audio saver initialized (auto-save was disabled) - skipping audio finalization");
            info!("✅ Transcripts and metadata already saved incrementally");
            return Ok(None);
        }

        // Finalize incremental saver (merge checkpoints into final audio.mp4)
        let final_audio_path = if let Some(saver_arc) = &self.incremental_saver {
            let mut saver = saver_arc.lock().await;
            match saver.finalize().await {
                Ok(path) => {
                    info!("✅ Successfully finalized audio: {}", path.display());
                    path
                }
                Err(e) => {
                    error!("❌ Failed to finalize incremental saver: {}", e);
                    return Err(format!("Failed to finalize audio: {}", e));
                }
            }
        } else {
            error!("No incremental saver initialized - cannot save recording");
            return Err("No incremental saver initialized".to_string());
        };

        // Save final transcripts.json with validation
        if let Some(folder) = &self.meeting_folder {
            if let Err(e) = self.write_transcripts_json(folder) {
                error!("❌ Failed to write final transcripts: {}", e);
                return Err(format!("Failed to save transcripts: {}", e));
            }

            // Verify transcripts were written correctly
            let transcript_path = folder.join("transcripts.json");
            if !transcript_path.exists() {
                error!(
                    "❌ Transcript file was not created at: {}",
                    transcript_path.display()
                );
                return Err("Transcript file verification failed".to_string());
            }
            info!(
                "✅ Transcripts saved and verified at: {}",
                transcript_path.display()
            );
        }

        // Update metadata to completed status with actual recording duration
        if let (Some(folder), Some(mut metadata)) = (&self.meeting_folder, self.metadata.clone()) {
            metadata.status = Some("completed".to_string());
            metadata.completed_at = Some(chrono::Utc::now().to_rfc3339());

            // Use actual recording duration from RecordingState (more accurate than transcript segments)
            // Falls back to last transcript segment if duration not provided
            metadata.duration_seconds = recording_duration.or_else(|| {
                if let Ok(segments) = self.transcript_segments.lock() {
                    segments.last().and_then(|seg| seg.audio_end_time)
                } else {
                    None
                }
            });

            if let Err(e) = self.write_metadata(folder, &metadata) {
                error!("❌ Failed to update metadata to completed: {}", e);
                return Err(format!("Failed to update metadata: {}", e));
            }

            info!(
                "✅ Metadata updated with duration: {:?}s",
                metadata.duration_seconds
            );
        }

        // Emit save event with audio and transcript paths
        let save_event = serde_json::json!({
            "audio_file": final_audio_path.to_string_lossy(),
            "transcript_file": self.meeting_folder.as_ref()
                .map(|f| f.join("transcripts.json").to_string_lossy().to_string()),
            "meeting_name": self.meeting_name,
            "meeting_folder": self.meeting_folder.as_ref()
                .map(|f| f.to_string_lossy().to_string())
        });

        if let Err(e) = app.emit("recording-saved", &save_event) {
            warn!("Failed to emit recording-saved event: {}", e);
        }

        // Clean up transcript segments
        if let Ok(mut segments) = self.transcript_segments.lock() {
            segments.clear();
        }

        Ok(Some(final_audio_path.to_string_lossy().to_string()))
    }

    /// Get the meeting folder path (for passing to backend)
    pub fn get_meeting_folder(&self) -> Option<&PathBuf> {
        self.meeting_folder.as_ref()
    }

    /// Get accumulated transcript segments (for reload sync)
    pub fn get_transcript_segments(&self) -> Vec<TranscriptSegment> {
        if let Ok(segments) = self.transcript_segments.lock() {
            segments.clone()
        } else {
            Vec::new()
        }
    }

    /// Get meeting name (for reload sync)
    pub fn get_meeting_name(&self) -> Option<String> {
        self.meeting_name.clone()
    }

    /// Sort transcript segments chronologically by `audio_start_time`, using
    /// `sequence_id` as a tie-breaker when the start time is equal or absent.
    /// See `write_transcripts_json` for why this ordering matters.
    fn sort_segments_chronologically(segments: &mut [TranscriptSegment]) {
        segments.sort_by(|a, b| {
            let a_time = a.audio_start_time.unwrap_or(f64::MAX);
            let b_time = b.audio_start_time.unwrap_or(f64::MAX);
            a_time
                .partial_cmp(&b_time)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    a.sequence_id
                        .unwrap_or(u64::MAX)
                        .cmp(&b.sequence_id.unwrap_or(u64::MAX))
                })
        });
    }
}

impl Default for RecordingSaver {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(id: &str, audio_start_time: Option<f64>, sequence_id: Option<u64>) -> TranscriptSegment {
        TranscriptSegment {
            id: id.to_string(),
            text: id.to_string(),
            timestamp: None,
            audio_start_time,
            audio_end_time: None,
            duration: None,
            display_time: None,
            confidence: None,
            sequence_id,
            speaker: None,
            voice_profile_id: None,
            source: None,
        }
    }

    #[test]
    fn sorts_out_of_arrival_order_segments_by_audio_start_time() {
        // Mirrors issue #37: a system-audio segment starting at t=10s but
        // finishing (and thus being appended) at t=22s must still land before
        // a mic segment spanning 15-16s in the persisted transcript.
        let mut segments = vec![
            segment("mic-15-16", Some(15.0), Some(2)),
            segment("system-10-22", Some(10.0), Some(1)),
        ];

        RecordingSaver::sort_segments_chronologically(&mut segments);

        assert_eq!(
            segments.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["system-10-22", "mic-15-16"]
        );
    }

    #[test]
    fn falls_back_to_sequence_id_when_start_times_tie_or_are_missing() {
        let mut segments = vec![
            segment("no-time-seq-3", None, Some(3)),
            segment("t5-seq-1", Some(5.0), Some(1)),
            segment("no-time-seq-2", None, Some(2)),
            segment("t5-seq-0", Some(5.0), Some(0)),
        ];

        RecordingSaver::sort_segments_chronologically(&mut segments);

        assert_eq!(
            segments.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["t5-seq-0", "t5-seq-1", "no-time-seq-2", "no-time-seq-3"]
        );
    }

    // ---- discard_empty_session / session_is_empty (issue #45) ------------

    #[test]
    fn session_is_empty_for_a_freshly_created_folder() {
        // Mirrors what start_accumulation() creates before capture has
        // produced anything: a bare meeting folder with an empty
        // .checkpoints/ directory and no transcripts.json yet.
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting_2026-01-01_00-00-00");
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        assert!(RecordingSaver::session_is_empty(&meeting_folder));
    }

    #[test]
    fn session_is_not_empty_with_a_checkpoint_audio_chunk() {
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        let checkpoints_dir = meeting_folder.join(".checkpoints");
        std::fs::create_dir_all(&checkpoints_dir).unwrap();
        std::fs::write(checkpoints_dir.join("audio_chunk_000.f32"), [0u8; 4]).unwrap();

        assert!(!RecordingSaver::session_is_empty(&meeting_folder));
    }

    #[test]
    fn session_is_not_empty_with_a_legacy_mp4_checkpoint_chunk() {
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        let checkpoints_dir = meeting_folder.join(".checkpoints");
        std::fs::create_dir_all(&checkpoints_dir).unwrap();
        std::fs::write(checkpoints_dir.join("audio_chunk_000.mp4"), [0u8; 4]).unwrap();

        assert!(!RecordingSaver::session_is_empty(&meeting_folder));
    }

    #[test]
    fn session_is_not_empty_with_non_empty_transcripts_json() {
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();
        std::fs::write(
            meeting_folder.join("transcripts.json"),
            r#"[{"id":"seg-1","text":"hello"}]"#,
        )
        .unwrap();

        assert!(!RecordingSaver::session_is_empty(&meeting_folder));
    }

    #[test]
    fn session_is_empty_with_an_empty_transcripts_json_array() {
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();
        std::fs::write(meeting_folder.join("transcripts.json"), "[]").unwrap();

        assert!(RecordingSaver::session_is_empty(&meeting_folder));
    }

    #[test]
    fn session_is_empty_when_checkpoints_dir_is_missing_entirely() {
        // auto_save disabled: initialize_meeting_folder(..., false) never
        // creates .checkpoints/ at all.
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        std::fs::create_dir_all(&meeting_folder).unwrap();

        assert!(RecordingSaver::session_is_empty(&meeting_folder));
    }

    #[test]
    fn discard_empty_session_removes_the_folder_and_resets_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = RecordingSaver::new();
        saver.meeting_folder = Some(meeting_folder.clone());
        saver.metadata = Some(MeetingMetadata {
            version: Some("1.0".to_string()),
            meeting_id: None,
            meeting_name: Some("Meeting".to_string()),
            created_at: None,
            completed_at: None,
            retranscribed_at: None,
            duration_seconds: None,
            devices: None,
            audio_file: None,
            transcript_file: None,
            sample_rate: None,
            status: Some("recording".to_string()),
            origin: None,
            auto_refined_at: None,
        });
        *saver.is_saving.lock().unwrap() = true;

        assert!(saver.discard_empty_session());

        assert!(!meeting_folder.exists());
        assert!(saver.meeting_folder.is_none());
        assert!(saver.metadata.is_none());
        assert!(!*saver.is_saving.lock().unwrap());
    }

    #[test]
    fn discard_empty_session_leaves_a_non_empty_folder_in_place() {
        let tmp = tempfile::tempdir().unwrap();
        let meeting_folder = tmp.path().join("Meeting");
        let checkpoints_dir = meeting_folder.join(".checkpoints");
        std::fs::create_dir_all(&checkpoints_dir).unwrap();
        std::fs::write(checkpoints_dir.join("audio_chunk_000.f32"), [0u8; 4]).unwrap();

        let mut saver = RecordingSaver::new();
        saver.meeting_folder = Some(meeting_folder.clone());

        assert!(!saver.discard_empty_session());
        assert!(meeting_folder.exists());
        assert!(saver.meeting_folder.is_some());
    }

    #[test]
    fn discard_empty_session_is_a_no_op_with_no_meeting_folder() {
        let mut saver = RecordingSaver::new();
        assert!(!saver.discard_empty_session());
    }
}
