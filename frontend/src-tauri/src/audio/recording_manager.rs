use anyhow::Result;
use log::{debug, error, info};
use std::sync::Arc;
use tokio::sync::mpsc;

use super::devices::{AudioDevice, DeviceType};
use super::pipeline::AudioPipelineManager;
use super::recording_saver::RecordingSaver;
use super::recording_state::{AudioChunk, PartialAudioChunk, RecordingState};
use super::stream::AudioStreamManager;

/// Recording manager that coordinates all audio components
pub struct RecordingManager {
    state: Arc<RecordingState>,
    stream_manager: AudioStreamManager,
    pipeline_manager: AudioPipelineManager,
    recording_saver: RecordingSaver,
    /// Receiver for streaming-partial snapshots, produced in `start_recording`
    /// when partials are enabled and claimed once by the command layer (which
    /// owns the AppHandle needed to emit `transcript-partial` events).
    partial_receiver: Option<mpsc::UnboundedReceiver<PartialAudioChunk>>,
}

impl RecordingManager {
    /// Create a new recording manager
    pub fn new() -> Self {
        let state = RecordingState::new();
        let stream_manager = AudioStreamManager::new(state.clone());
        let pipeline_manager = AudioPipelineManager::new();

        Self {
            state,
            stream_manager,
            pipeline_manager,
            recording_saver: RecordingSaver::new(),
            partial_receiver: None,
        }
    }

    /// Claim the streaming-partial receiver (available after `start_recording`
    /// when partials are enabled). Returns None if partials are disabled or
    /// already claimed.
    pub fn take_partial_receiver(&mut self) -> Option<mpsc::UnboundedReceiver<PartialAudioChunk>> {
        self.partial_receiver.take()
    }

    // Remove app handle storage for now - will be passed directly when saving

    /// Start recording with specified devices
    ///
    /// # Arguments
    /// * `microphone_device` - Optional microphone device to use
    /// * `system_device` - Optional system audio device to use
    /// * `auto_save` - Whether to save audio checkpoints (true) or just transcripts/metadata (false)
    pub async fn start_recording(
        &mut self,
        microphone_device: Option<Arc<AudioDevice>>,
        system_device: Option<Arc<AudioDevice>>,
        auto_save: bool,
        enable_partials: bool,
    ) -> Result<mpsc::UnboundedReceiver<AudioChunk>> {
        info!(
            "Starting recording manager (auto_save: {}, partials: {})",
            auto_save, enable_partials
        );

        // Set up transcription channel
        let (transcription_sender, transcription_receiver) =
            mpsc::unbounded_channel::<AudioChunk>();

        // Streaming-partial channel (only when enabled). The command layer
        // claims the receiver via take_partial_receiver() and spawns the
        // partial-decode task with its AppHandle.
        let partial_sender = if enable_partials {
            let (tx, rx) = mpsc::unbounded_channel::<PartialAudioChunk>();
            self.partial_receiver = Some(rx);
            Some(tx)
        } else {
            self.partial_receiver = None;
            None
        };

        // CRITICAL FIX: Create recording sender for pre-mixed audio from pipeline
        // Pipeline will mix mic + system audio professionally and send to this channel
        // Pass auto_save to control whether audio checkpoints are created
        let recording_sender = self.recording_saver.start_accumulation(auto_save);

        // Start recording state first
        self.state.start_recording()?;

        // Get device information for adaptive mixing
        // The pipeline uses device kind (Bluetooth vs Wired) to apply adaptive buffering:
        // - Bluetooth: Larger buffers (80-200ms) to handle jitter
        // - Wired: Smaller buffers (20-50ms) for low latency
        let (mic_name, mic_kind) = if let Some(ref mic) = microphone_device {
            let device_kind =
                super::device_detection::InputDeviceKind::detect(&mic.name, 512, 48000);
            (mic.name.clone(), device_kind)
        } else {
            (
                "No Microphone".to_string(),
                super::device_detection::InputDeviceKind::Unknown,
            )
        };

        let (sys_name, sys_kind) = if let Some(ref sys) = system_device {
            let device_kind =
                super::device_detection::InputDeviceKind::detect(&sys.name, 512, 48000);
            (sys.name.clone(), device_kind)
        } else {
            (
                "No System Audio".to_string(),
                super::device_detection::InputDeviceKind::Unknown,
            )
        };

        // Update recording metadata with device information
        self.recording_saver.set_device_info(
            microphone_device.as_ref().map(|d| d.name.clone()),
            system_device.as_ref().map(|d| d.name.clone()),
        );

        // Start the audio processing pipeline with FFmpeg adaptive mixer
        // Pipeline will: 1) Mix mic+system audio with adaptive buffering, 2) Send mixed to recording_sender,
        // 3) Apply VAD and send speech segments to transcription
        self.pipeline_manager.start(
            self.state.clone(),
            transcription_sender,
            0,                      // Ignored - using dynamic sizing internally
            48000,                  // 48kHz sample rate
            Some(recording_sender), // CRITICAL: Pass recording sender to receive pre-mixed audio
            partial_sender,         // Streaming partials (None when disabled)
            mic_name,
            mic_kind,
            sys_name,
            sys_kind,
        )?;

        // Give the pipeline a moment to fully initialize before starting streams
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

        // Start audio streams - they send RAW unmixed chunks to pipeline for mixing
        // Pipeline handles mixing and distribution to both recording and transcription
        self.stream_manager
            .start_streams(microphone_device.clone(), system_device.clone())
            .await?;

        info!(
            "Recording manager started successfully with {} active streams",
            self.stream_manager.active_stream_count()
        );

        Ok(transcription_receiver)
    }

    /// Start recording with the system default source + sink monitor.
    ///
    /// PipeWire resolves `"default"` to the user's currently selected
    /// default source/sink and reroutes streams if the default changes
    /// mid-recording — no Bluetooth-override heuristics needed.
    pub async fn start_recording_with_defaults_and_auto_save(
        &mut self,
        auto_save: bool,
    ) -> Result<mpsc::UnboundedReceiver<AudioChunk>> {
        info!("Starting recording with default devices");

        let microphone_device = Some(Arc::new(AudioDevice::new(
            "default".to_string(),
            DeviceType::Input,
        )));
        let system_device = Some(Arc::new(AudioDevice::new(
            "default".to_string(),
            DeviceType::Output,
        )));

        self.start_recording(microphone_device, system_device, auto_save, true)
            .await
    }

    /// Stop recording streams without saving (for use when waiting for transcription)
    pub async fn stop_streams_only(&mut self) -> Result<()> {
        info!("Stopping recording streams only");

        // Stop recording state first
        self.state.stop_recording();

        // Stop audio streams
        if let Err(e) = self.stream_manager.stop_streams() {
            error!("Error stopping audio streams: {}", e);
        }

        // Stop audio pipeline
        if let Err(e) = self.pipeline_manager.stop().await {
            error!("Error stopping audio pipeline: {}", e);
        }

        debug!("Recording streams stopped successfully");
        Ok(())
    }

    /// Stop streams and force immediate pipeline flush to process all accumulated audio
    pub async fn stop_streams_and_force_flush(&mut self) -> Result<()> {
        info!("🚀 Stopping recording streams with IMMEDIATE pipeline flush");

        // Stop recording state first - this clears device references
        self.state.stop_recording();

        // Stop audio streams immediately
        if let Err(e) = self.stream_manager.stop_streams() {
            error!("Error stopping audio streams: {}", e);
        }

        // CRITICAL: Force pipeline to flush ALL accumulated audio before stopping
        debug!("💨 Forcing pipeline to flush accumulated audio immediately");
        if let Err(e) = self.pipeline_manager.force_flush_and_stop().await {
            error!("Error during force flush: {}", e);
        }

        // CRITICAL: Full cleanup to release all Arc references and resources
        // This ensures microphone is released even if Drop is delayed
        self.state.cleanup();

        info!("✅ Recording streams stopped with immediate flush completed");
        Ok(())
    }

    /// Save recording after transcription is complete
    pub async fn save_recording_only<R: tauri::Runtime>(
        &mut self,
        app: &tauri::AppHandle<R>,
    ) -> Result<()> {
        debug!("Saving recording with transcript chunks");

        // Get actual recording duration from state
        let recording_duration = self.state.get_active_recording_duration();
        info!("Recording duration from state: {:?}s", recording_duration);

        // Save the recording with actual duration
        match self
            .recording_saver
            .stop_and_save(app, recording_duration)
            .await
        {
            Ok(Some(file_path)) => {
                info!("Recording saved successfully to: {}", file_path);
            }
            Ok(None) => {
                debug!("Recording not saved (auto-save disabled or no audio data)");
            }
            Err(e) => {
                error!("Failed to save recording: {}", e);
                // Don't fail the stop operation if saving fails
            }
        }

        debug!("Recording save operation completed");
        Ok(())
    }

    /// Stop recording and save audio (legacy method)
    pub async fn stop_recording<R: tauri::Runtime>(
        &mut self,
        app: &tauri::AppHandle<R>,
    ) -> Result<()> {
        info!("Stopping recording manager");

        // Get recording duration BEFORE stopping (important!)
        let recording_duration = self.state.get_active_recording_duration();
        info!("Recording duration before stop: {:?}s", recording_duration);

        // Stop recording state first
        self.state.stop_recording();

        // Stop audio streams
        if let Err(e) = self.stream_manager.stop_streams() {
            error!("Error stopping audio streams: {}", e);
        }

        // Stop audio pipeline
        if let Err(e) = self.pipeline_manager.stop().await {
            error!("Error stopping audio pipeline: {}", e);
        }

        // Save the recording with actual duration
        match self
            .recording_saver
            .stop_and_save(app, recording_duration)
            .await
        {
            Ok(Some(file_path)) => {
                info!("Recording saved successfully to: {}", file_path);
            }
            Ok(None) => {
                info!("Recording not saved (auto-save disabled or no audio data)");
            }
            Err(e) => {
                error!("Failed to save recording: {}", e);
                // Don't fail the stop operation if saving fails
            }
        }

        info!("Recording manager stopped");
        Ok(())
    }

    /// Get recording stats from the saver
    pub fn get_recording_stats(&self) -> (usize, u32) {
        self.recording_saver.get_stats()
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.state.is_recording()
    }

    /// Pause the current recording session
    pub fn pause_recording(&self) -> Result<()> {
        info!("Pausing recording");
        self.state.pause_recording()
    }

    /// Resume the current recording session
    pub fn resume_recording(&self) -> Result<()> {
        info!("Resuming recording");
        self.state.resume_recording()
    }

    /// Check if recording is currently paused
    pub fn is_paused(&self) -> bool {
        self.state.is_paused()
    }

    /// Check if recording is active (recording and not paused)
    pub fn is_active(&self) -> bool {
        self.state.is_active()
    }

    /// Get recording statistics
    pub fn get_stats(&self) -> super::recording_state::RecordingStats {
        self.state.get_stats()
    }

    /// Get recording duration
    pub fn get_recording_duration(&self) -> Option<f64> {
        self.state.get_recording_duration()
    }

    /// Get active recording duration (excluding pauses)
    pub fn get_active_recording_duration(&self) -> Option<f64> {
        self.state.get_active_recording_duration()
    }

    /// Get total pause duration
    pub fn get_total_pause_duration(&self) -> f64 {
        self.state.get_total_pause_duration()
    }

    /// Get current pause duration if paused
    pub fn get_current_pause_duration(&self) -> Option<f64> {
        self.state.get_current_pause_duration()
    }

    /// Get error information
    pub fn get_error_info(&self) -> (u32, Option<super::recording_state::AudioError>) {
        (self.state.get_error_count(), self.state.get_last_error())
    }

    /// Get active stream count
    pub fn active_stream_count(&self) -> usize {
        self.stream_manager.active_stream_count()
    }

    /// Set error callback for handling errors
    pub fn set_error_callback<F>(&self, callback: F)
    where
        F: Fn(&super::recording_state::AudioError) + Send + Sync + 'static,
    {
        self.state.set_error_callback(callback);
    }

    /// Check if there's a fatal error
    pub fn has_fatal_error(&self) -> bool {
        self.state.has_fatal_error()
    }

    /// Set the meeting name for this recording session
    pub fn set_meeting_name(&mut self, name: Option<String>) {
        self.recording_saver.set_meeting_name(name);
    }

    /// Add a structured transcript segment to be saved later
    pub fn add_transcript_segment(&self, segment: super::recording_saver::TranscriptSegment) {
        self.recording_saver.add_transcript_segment(segment);
    }

    /// Add a transcript chunk to be saved later (legacy method)
    pub fn add_transcript_chunk(&self, text: String) {
        self.recording_saver.add_transcript_chunk(text);
    }

    /// Get accumulated transcript segments from current recording session
    /// Used for syncing frontend state after page reload during active recording
    pub fn get_transcript_segments(&self) -> Vec<super::recording_saver::TranscriptSegment> {
        self.recording_saver.get_transcript_segments()
    }

    /// Get meeting name from current recording session
    /// Used for syncing frontend state after page reload during active recording
    pub fn get_meeting_name(&self) -> Option<String> {
        self.recording_saver.get_meeting_name()
    }

    /// Cleanup all resources without saving
    pub async fn cleanup_without_save(&mut self) {
        if self.is_recording() {
            debug!("Stopping recording without saving during cleanup");

            // Stop recording state first
            self.state.stop_recording();

            // Stop audio streams
            if let Err(e) = self.stream_manager.stop_streams() {
                error!("Error stopping audio streams during cleanup: {}", e);
            }

            // Stop audio pipeline
            if let Err(e) = self.pipeline_manager.stop().await {
                error!("Error stopping audio pipeline during cleanup: {}", e);
            }
        }
        self.state.cleanup();
    }

    /// Get the meeting folder path (if available)
    /// Returns None if no meeting name was set or folder structure not initialized
    pub fn get_meeting_folder(&self) -> Option<std::path::PathBuf> {
        self.recording_saver.get_meeting_folder().map(|p| p.clone())
    }

    /// Check if currently attempting to reconnect
    pub fn is_reconnecting(&self) -> bool {
        self.state.is_reconnecting()
    }

    /// Get reference to recording state for external access
    pub fn get_state(&self) -> &Arc<RecordingState> {
        &self.state
    }
}

impl Default for RecordingManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for RecordingManager {
    fn drop(&mut self) {
        // Note: Can't call async cleanup in Drop, but streams have their own Drop implementations
        self.state.cleanup();
    }
}
