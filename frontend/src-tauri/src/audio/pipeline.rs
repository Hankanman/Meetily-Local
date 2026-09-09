use super::batch_processor::AudioMetricsBatcher;
use crate::batch_audio_metric;
use anyhow::Result;
use log::{debug, error, info, warn};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::audio_processing::{audio_to_mono, HighPassFilter, LoudnessNormalizer};
use super::devices::AudioDevice;
use super::recording_state::{AudioChunk, DeviceType, RecordingState};
use super::vad::ContinuousVadProcessor;

/// Ring buffer for synchronized audio mixing
/// Accumulates samples from mic and system streams until we have aligned windows
struct AudioMixerRingBuffer {
    mic_buffer: VecDeque<f32>,
    system_buffer: VecDeque<f32>,
    window_size_samples: usize, // Fixed mixing window (e.g., 50ms)
    max_buffer_size: usize,     // Safety limit (e.g., 100ms)
}

impl AudioMixerRingBuffer {
    fn new(sample_rate: u32) -> Self {
        // Use 50ms windows for mixing
        let window_ms = 50.0;
        let window_size_samples = (sample_rate as f32 * window_ms / 1000.0) as usize;

        // CRITICAL FIX: Size the safety buffer in absolute time, independent of
        // the mixing window, so shrinking the window (for latency) doesn't also
        // shrink our jitter tolerance. The PipeWire graph delivers mic and
        // system audio as two independently-scheduled streams, so they can
        // drift apart by tens of milliseconds under scheduling pressure
        // before arriving here via channel. Accounts for that jitter plus
        // the processing delay of the mic enhancement chain (HPF + loudness
        // normalization, run AFTER AEC — see `AudioPipeline::run`).
        let max_buffer_ms = 4800.0;
        let max_buffer_size = (sample_rate as f32 * max_buffer_ms / 1000.0) as usize;

        info!(
            "🔊 Ring buffer initialized: window={}ms ({} samples), max={}ms ({} samples)",
            window_ms, window_size_samples, max_buffer_ms, max_buffer_size
        );

        Self {
            mic_buffer: VecDeque::with_capacity(max_buffer_size),
            system_buffer: VecDeque::with_capacity(max_buffer_size),
            window_size_samples,
            max_buffer_size,
        }
    }

    fn add_samples(&mut self, device_type: DeviceType, samples: Vec<f32>) {
        // Log buffer health periodically for diagnostics
        static mut SAMPLE_COUNTER: u64 = 0;
        unsafe {
            SAMPLE_COUNTER += 1;
            if SAMPLE_COUNTER % 200 == 0 {
                debug!(
                    "📊 Ring buffer status: mic={} samples, sys={} samples (max={})",
                    self.mic_buffer.len(),
                    self.system_buffer.len(),
                    self.max_buffer_size
                );
            }
        }

        match device_type {
            DeviceType::Microphone => self.mic_buffer.extend(samples),
            DeviceType::System => self.system_buffer.extend(samples),
        }

        // CRITICAL FIX: Add warnings before dropping samples
        // This helps diagnose timing issues in production
        if self.mic_buffer.len() > self.max_buffer_size {
            warn!(
                "⚠️ Microphone buffer overflow: {} > {} samples, dropping oldest {} samples",
                self.mic_buffer.len(),
                self.max_buffer_size,
                self.mic_buffer.len() - self.max_buffer_size
            );
        }
        if self.system_buffer.len() > self.max_buffer_size {
            error!("🔴 SYSTEM AUDIO BUFFER OVERFLOW: {} > {} samples, dropping {} samples - THIS CAUSES DISTORTION!",
                  self.system_buffer.len(), self.max_buffer_size,
                  self.system_buffer.len() - self.max_buffer_size);
        }

        // Safety: prevent buffer overflow (keep only last 200ms)
        while self.mic_buffer.len() > self.max_buffer_size {
            self.mic_buffer.pop_front();
        }
        while self.system_buffer.len() > self.max_buffer_size {
            self.system_buffer.pop_front();
        }
    }

    fn can_mix(&self) -> bool {
        self.mic_buffer.len() >= self.window_size_samples
            || self.system_buffer.len() >= self.window_size_samples
    }

    fn extract_window(&mut self) -> Option<(Vec<f32>, Vec<f32>)> {
        if !self.can_mix() {
            return None;
        }

        // Extract mic window with zero-padding for incomplete buffers
        // Zero-padding (silence) is preferred over last-sample-hold to prevent artifacts

        // Extract mic window (or pad with zeros if insufficient data)
        let mic_window = if self.mic_buffer.len() >= self.window_size_samples {
            // Enough mic data - drain window
            self.mic_buffer.drain(0..self.window_size_samples).collect()
        } else if !self.mic_buffer.is_empty() {
            // Some mic data but not enough - consume all + pad with zeros
            let available: Vec<f32> = self.mic_buffer.drain(..).collect();
            let mut padded = Vec::with_capacity(self.window_size_samples);
            padded.extend_from_slice(&available);

            // Use zero-padding (silence) to prevent repetition artifacts
            // Zero-padding is inaudible at 48kHz sample rate
            padded.resize(self.window_size_samples, 0.0);

            padded
        } else {
            // No mic data - return silence
            vec![0.0; self.window_size_samples]
        };

        // Extract system window (or pad with zeros if insufficient data)
        let sys_window = if self.system_buffer.len() >= self.window_size_samples {
            // Enough system data - drain window
            self.system_buffer
                .drain(0..self.window_size_samples)
                .collect()
        } else if !self.system_buffer.is_empty() {
            // Some system data but not enough - consume all + pad with zeros
            let available: Vec<f32> = self.system_buffer.drain(..).collect();
            let mut padded = Vec::with_capacity(self.window_size_samples);
            padded.extend_from_slice(&available);

            // Use zero-padding (silence) to prevent repetition artifacts
            // Zero-padding is inaudible at 48kHz sample rate
            padded.resize(self.window_size_samples, 0.0);

            padded
        } else {
            // No system data - return silence
            vec![0.0; self.window_size_samples]
        };

        Some((mic_window, sys_window))
    }
}

/// Captures raw audio from one PipeWire stream (mic or system) and forwards
/// it to the pipeline task.
///
/// PERFORMANCE (issue #28): `process_audio_data` runs directly on PipeWire's
/// real-time data thread (`pw/mod.rs` connects with `RT_PROCESS`), so it is
/// intentionally minimal: one allocation for the mono downmix, no mutexes,
/// no DSP, and no per-call logging. Everything else the old implementation
/// did here — resampling, RNNoise, the high-pass filter, loudness
/// normalization, and the EBU/RMS diagnostic logging — has moved off this
/// thread: PipeWire always negotiates 48 kHz for this app's capture streams
/// (see `pw::CAPTURE_RATE`), so the resampler path was dead code; the mic
/// enhancement chain now runs in `AudioPipeline::run` (see issue #21, on the
/// tokio pipeline task, after AEC).
pub struct AudioCapture {
    state: Arc<RecordingState>,
    sample_rate: u32,
    channels: u16,
    device_type: DeviceType,
    /// Cloned once here, at construction time, instead of locking
    /// `RecordingState`'s sender mutex on every quantum. `RecordingManager`
    /// starts the pipeline (which installs this sender) before it creates
    /// any streams, so this is normally `Some` by the time real audio
    /// arrives; if a stream somehow starts first this is `None` and chunks
    /// are silently dropped, matching the previous "pipeline not ready"
    /// behavior.
    sender: Option<mpsc::UnboundedSender<AudioChunk>>,
    /// Samples sent so far. Used to derive each chunk's timestamp as
    /// `samples_sent / sample_rate` instead of calling
    /// `RecordingState::get_recording_duration()` (a mutex) from the RT
    /// thread.
    samples_sent: u64,
    chunk_counter: u64,
}

impl AudioCapture {
    pub fn new(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        sample_rate: u32,
        channels: u16,
        device_type: DeviceType,
    ) -> Self {
        if sample_rate != 48_000 {
            // PipeWire negotiates the capture format for us (see
            // `pw::CAPTURE_RATE`), so every stream should already be 48 kHz;
            // this is a configuration bug, not something to resample around.
            warn!(
                "[{:?}] Audio device '{}' opened at {} Hz, not the expected 48 kHz",
                device_type, device.name, sample_rate
            );
        }

        let sender = state.cloned_audio_sender();
        if sender.is_none() {
            warn!(
                "[{:?}] AudioCapture for '{}' created before the pipeline sender was ready",
                device_type, device.name
            );
        }

        Self {
            state,
            sample_rate,
            channels,
            device_type,
            sender,
            samples_sent: 0,
            chunk_counter: 0,
        }
    }

    /// Called directly from the PipeWire real-time thread for every
    /// quantum. Keep this on the fast path: no mutexes, no DSP, no
    /// allocation beyond the mono downmix.
    pub fn process_audio_data(&mut self, data: &[f32]) {
        // Both checks are atomics, not mutexes — safe on the RT thread.
        // `is_paused` mirrors the discard-while-paused behavior the old
        // `RecordingState::send_audio_chunk` used to provide.
        if !self.state.is_recording() || self.state.is_paused() {
            return;
        }

        let Some(sender) = &self.sender else {
            return;
        };

        // One allocation per quantum for the mono downmix — unavoidable
        // since ownership of the samples has to move through the channel to
        // the pipeline task.
        let mono_data = if self.channels > 1 {
            audio_to_mono(data, self.channels)
        } else {
            data.to_vec()
        };

        let timestamp = self.samples_sent as f64 / self.sample_rate as f64;
        self.samples_sent += mono_data.len() as u64;

        let chunk_id = self.chunk_counter;
        self.chunk_counter += 1;

        let audio_chunk = AudioChunk {
            data: mono_data,
            sample_rate: self.sample_rate,
            timestamp,
            chunk_id,
            device_type: self.device_type,
        };

        // Best-effort: a closed channel just means the pipeline has shut
        // down (e.g. stop_recording already cleared it). No logging here —
        // this runs on the RT thread — the pipeline shutdown path already
        // logs the transition.
        let _ = sender.send(audio_chunk);
    }
}

/// VAD-driven audio processing pipeline
/// Uses Voice Activity Detection to segment speech in real-time and send only speech to Whisper.
///
/// Source attribution: VAD runs INDEPENDENTLY on the mic and system streams (the un-mixed
/// windows the ring buffer extracts) so each speech segment is tagged with its source
/// (Mic or System). This is the foundation for asymmetric speaker attribution: mic
/// segments are labeled "Me" automatically; system segments feed the diarization layer.
pub struct AudioPipeline {
    receiver: mpsc::UnboundedReceiver<AudioChunk>,
    transcription_sender: mpsc::UnboundedSender<AudioChunk>,
    mic_vad_processor: ContinuousVadProcessor,
    system_vad_processor: ContinuousVadProcessor,
    sample_rate: u32,
    chunk_id_counter: u64,
    // Performance optimization: reduce logging frequency
    last_summary_time: std::time::Instant,
    processed_chunks: u64,
    // Smart batching for audio metrics
    metrics_batcher: Option<AudioMetricsBatcher>,
    // Aligns the async mic + system streams into equal-length windows.
    ring_buffer: AudioMixerRingBuffer,
    // Acoustic echo canceller: removes the system audio the mic picks up from
    // the speakers, using the aligned system window as the far-end reference.
    // `None` when AEC couldn't initialize — recording continues without it.
    echo_canceller: Option<super::aec::MicEchoCanceller>,
    // Mic enhancement chain (issue #21): runs AFTER `echo_canceller.cancel`,
    // never before it. AEC3 assumes a linear, time-invariant near-end path;
    // running the high-pass filter and loudness normalizer on the mic
    // upstream of AEC (as the old per-stream `AudioCapture` did) fed AEC a
    // time-varying, gain-boosted, clipped signal and broke its convergence.
    // Mic-only — system audio is left raw.
    mic_high_pass: Option<HighPassFilter>,
    mic_normalizer: Option<LoudnessNormalizer>,
    // Sender for the interleaved stereo recording chunks (mic L, system R).
    recording_sender_for_mixed: Option<mpsc::UnboundedSender<AudioChunk>>,
    // Streaming partials: snapshots of in-progress utterances sent to the
    // partial-decode task. None when streaming partials are disabled.
    partial_sender: Option<mpsc::UnboundedSender<super::recording_state::PartialAudioChunk>>,
    mic_partial: PartialEmitState,
    system_partial: PartialEmitState,
}

/// Per-source bookkeeping that throttles streaming-partial emission.
#[derive(Default)]
struct PartialEmitState {
    /// Monotonic utterance counter, bumped on each silence→speech transition.
    utterance_id: u64,
    /// Whether speech was active on the previous window (edge detection).
    was_active: bool,
    /// Partial-buffer length at the last emitted snapshot, so we only re-emit
    /// after enough new audio has accumulated.
    samples_at_last_emit: usize,
}

// Emit a partial snapshot at most once per ~1.2 s of new speech audio, and
// only once the utterance has at least ~0.8 s of audio (below that whisper has
// little to work with and tends to hallucinate).
const PARTIAL_MIN_SAMPLES: usize = 12_800; // 0.8 s @ 16 kHz
const PARTIAL_EMIT_INTERVAL_SAMPLES: usize = 19_200; // 1.2 s @ 16 kHz

impl AudioPipeline {
    pub fn new(
        receiver: mpsc::UnboundedReceiver<AudioChunk>,
        transcription_sender: mpsc::UnboundedSender<AudioChunk>,
        target_chunk_duration_ms: u32,
        sample_rate: u32,
        mic_device_name: String,
        mic_device_kind: super::device_detection::InputDeviceKind,
        system_device_name: String,
        system_device_kind: super::device_detection::InputDeviceKind,
    ) -> Self {
        // Log device characteristics for adaptive buffering
        info!("🎛️ AudioPipeline initializing with device characteristics:");
        info!(
            "   Mic: '{}' ({:?}) - Buffer: {:?}",
            mic_device_name,
            mic_device_kind,
            mic_device_kind.buffer_timeout()
        );
        info!(
            "   System: '{}' ({:?}) - Buffer: {:?}",
            system_device_name,
            system_device_kind,
            system_device_kind.buffer_timeout()
        );

        // Device kind information can be used for adaptive buffering in the future
        // For now, we log it for monitoring and potential optimization
        let _ = (
            mic_device_name,
            mic_device_kind,
            system_device_name,
            system_device_kind,
        );

        // Redemption time = the trailing-silence gap that ends a segment.
        // Per-source, because the two streams have different needs:
        //  - Mic (AEC-cleaned, usually just the local user): a looser 400ms gap
        //    bridges natural pauses so one person's speech isn't fragmented.
        //  - System (all the remote participants): a tighter gap so back-to-back
        //    remote speakers split into separate segments instead of merging
        //    into one — otherwise the whole turn gets a single speaker label.
        // Over-splitting is safe (extra pieces re-cluster to the same speaker);
        // merging two speakers into one segment is the error we're avoiding.
        let mic_redemption_time = 400;
        let system_redemption_time = 250;

        // Dual VAD: separate processors per source so segments arrive at the
        // transcription stage tagged with origin (Mic vs System).
        let mic_vad_processor = match ContinuousVadProcessor::new_with_source(
            sample_rate,
            mic_redemption_time,
            DeviceType::Microphone,
        ) {
            Ok(processor) => {
                info!("VAD-driven pipeline: mic VAD ready (source=Microphone)");
                processor
            }
            Err(e) => {
                error!("Failed to create mic VAD processor: {}", e);
                panic!("Mic VAD processor creation failed: {}", e);
            }
        };

        let system_vad_processor = match ContinuousVadProcessor::new_with_source(
            sample_rate,
            system_redemption_time,
            DeviceType::System,
        ) {
            Ok(processor) => {
                info!("VAD-driven pipeline: system VAD ready (source=System)");
                processor
            }
            Err(e) => {
                error!("Failed to create system VAD processor: {}", e);
                panic!("System VAD processor creation failed: {}", e);
            }
        };

        // Ring buffer aligns the asynchronously-arriving mic and system
        // streams into equal-length windows for interleaving.
        let ring_buffer = AudioMixerRingBuffer::new(sample_rate);
        // Echo canceller for the mic (uses the system window as reference).
        let echo_canceller = super::aec::MicEchoCanceller::new(sample_rate);

        // Mic enhancement chain (issue #21) — see the field docs on
        // `mic_high_pass` / `mic_normalizer` for why this now lives here,
        // downstream of AEC, instead of in the per-stream `AudioCapture`.
        let mic_high_pass = Some(HighPassFilter::new(sample_rate, 80.0));
        let mic_normalizer = match LoudnessNormalizer::new(1, sample_rate) {
            Ok(normalizer) => {
                info!("✅ EBU R128 normalizer initialized for microphone (target: -23 LUFS, capped +18/-12 dB)");
                Some(normalizer)
            }
            Err(e) => {
                warn!(
                    "⚠️ Failed to create mic loudness normalizer: {}, normalization disabled",
                    e
                );
                None
            }
        };

        // Note: target_chunk_duration_ms is ignored - VAD controls segmentation now
        let _ = target_chunk_duration_ms;

        Self {
            receiver,
            transcription_sender,
            mic_vad_processor,
            system_vad_processor,
            sample_rate,
            chunk_id_counter: 0,
            // Performance optimization: reduce logging frequency
            last_summary_time: std::time::Instant::now(),
            processed_chunks: 0,
            // Initialize metrics batcher for smart batching
            metrics_batcher: Some(AudioMetricsBatcher::new()),
            // Ring buffer for aligning mic + system into interleaved windows
            ring_buffer,
            echo_canceller,
            mic_high_pass,
            mic_normalizer,
            recording_sender_for_mixed: None, // Will be set by manager
            partial_sender: None,             // Will be set by manager if enabled
            mic_partial: PartialEmitState::default(),
            system_partial: PartialEmitState::default(),
        }
    }

    /// Run the VAD-driven audio processing pipeline
    pub async fn run(mut self) -> Result<()> {
        info!("VAD-driven audio pipeline started - segments sent in real-time based on speech detection");

        // CRITICAL FIX: Continue processing until channel is closed, not based on recording state
        // This ensures ALL chunks are processed during shutdown, fixing premature meeting completion
        // Previous bug: Loop checked `while self.state.is_recording()` which caused early exit when
        // stop_recording() was called, losing flush signals and remaining chunks in the pipeline
        loop {
            // Receive audio chunks with timeout
            match tokio::time::timeout(
                std::time::Duration::from_millis(50), // Shorter timeout for responsiveness
                self.receiver.recv(),
            )
            .await
            {
                Ok(Some(chunk)) => {
                    // PERFORMANCE: Check for flush signal (special chunk with ID >= u64::MAX - 10)
                    // Multiple flush signals may be sent to ensure processing
                    if chunk.chunk_id >= u64::MAX - 10 {
                        info!(
                            "📥 Received FLUSH signal #{} - flushing VAD processor",
                            u64::MAX - chunk.chunk_id
                        );
                        self.flush_remaining_audio()?;
                        // Continue processing to handle any remaining chunks
                        continue;
                    }

                    // PERFORMANCE OPTIMIZATION: Eliminate per-chunk logging overhead
                    // Logging in hot paths causes severe performance degradation
                    self.processed_chunks += 1;

                    // Smart batching: collect metrics instead of logging every chunk
                    if let Some(ref batcher) = self.metrics_batcher {
                        let avg_level = chunk.data.iter().map(|&x| x.abs()).sum::<f32>()
                            / chunk.data.len() as f32;
                        let duration_ms =
                            chunk.data.len() as f64 / chunk.sample_rate as f64 * 1000.0;

                        batch_audio_metric!(
                            Some(batcher),
                            chunk.chunk_id,
                            chunk.data.len(),
                            duration_ms,
                            avg_level
                        );
                    }

                    // CRITICAL: Log summary only every 200 chunks OR every 60 seconds (99.5% reduction)
                    // This eliminates I/O overhead in the audio processing hot path
                    // Use performance-optimized debug macro that compiles to nothing in release builds
                    if self.processed_chunks % 200 == 0
                        || self.last_summary_time.elapsed().as_secs() >= 60
                    {
                        perf_debug!(
                            "Pipeline processed {} chunks, current chunk: {} ({} samples)",
                            self.processed_chunks,
                            chunk.chunk_id,
                            chunk.data.len()
                        );
                        self.last_summary_time = std::time::Instant::now();
                    }

                    // STEP 1: Add raw audio to ring buffer for mixing
                    // Microphone audio is already normalized at capture level (AudioCapture)
                    // System audio remains raw
                    self.ring_buffer.add_samples(chunk.device_type, chunk.data);

                    // STEP 2: Process audio in fixed windows when streams have sufficient data.
                    // Each window yields un-mixed mic + system slices used for source-tagged
                    // VAD, plus a mixed slice used only for the recording WAV.
                    while self.ring_buffer.can_mix() {
                        if let Some((mut mic_window, sys_window)) = self.ring_buffer.extract_window()
                        {
                            // STEP 2.5: Acoustic echo cancellation. Subtract the
                            // system audio (played through the user's speakers)
                            // from the mic, using the aligned system window as
                            // the far-end reference. Runs before VAD and the
                            // recording split, so the cleaned mic flows to both
                            // transcription and the mic recording channel — a
                            // remote speaker no longer bleeds in as a duplicate
                            // "Me", and mic-side playback loses its echo.
                            if let Some(ref mut aec) = self.echo_canceller {
                                aec.cancel(&mut mic_window, &sys_window);
                            }

                            // STEP 2.7: Mic enhancement (issue #21) — high-pass
                            // then loudness normalization, mic only, and
                            // deliberately AFTER AEC (see field docs on
                            // `mic_high_pass`/`mic_normalizer`). System audio
                            // is left untouched.
                            if let Some(ref mut hpf) = self.mic_high_pass {
                                mic_window = hpf.process(&mic_window);
                            }
                            if let Some(ref mut normalizer) = self.mic_normalizer {
                                mic_window = normalizer.normalize_loudness(&mic_window);
                            }

                            // STEP 3: Source-tagged VAD on each stream independently
                            self.run_vad_for_source(&mic_window, DeviceType::Microphone);
                            self.run_vad_for_source(&sys_window, DeviceType::System);

                            // STEP 4: Interleave the two sources into a stereo
                            // frame for the recording — mic = left, system =
                            // right — so playback and downstream processing can
                            // keep them apart (source-aware per-segment
                            // playback, echo cancellation, …). The mono downmix
                            // is derived on demand (the decoder averages
                            // channels) rather than stored.
                            let frames = mic_window.len().max(sys_window.len());
                            let mut stereo = Vec::with_capacity(frames * 2);
                            for i in 0..frames {
                                stereo.push(mic_window.get(i).copied().unwrap_or(0.0)); // L: mic
                                stereo.push(sys_window.get(i).copied().unwrap_or(0.0)); // R: system
                            }

                            if let Some(ref sender) = self.recording_sender_for_mixed {
                                let recording_chunk = AudioChunk {
                                    data: stereo,
                                    sample_rate: self.sample_rate,
                                    timestamp: chunk.timestamp,
                                    chunk_id: self.chunk_id_counter,
                                    // device_type is unused by the saver for the
                                    // stereo recording chunk; left as Microphone.
                                    device_type: DeviceType::Microphone,
                                };
                                let _ = sender.send(recording_chunk);
                            }
                        }
                    }
                }
                Ok(None) => {
                    info!(
                        "Audio pipeline: sender closed after processing {} chunks",
                        self.processed_chunks
                    );
                    break;
                }
                Err(_) => {
                    // Timeout - just continue, VAD handles all segmentation
                    continue;
                }
            }
        }

        // Flush any remaining VAD segments
        self.flush_remaining_audio()?;

        info!("VAD-driven audio pipeline ended");
        Ok(())
    }

    fn flush_remaining_audio(&mut self) -> Result<()> {
        info!(
            "Flushing remaining audio from pipeline (processed {} chunks)",
            self.processed_chunks
        );

        // Flush both VAD processors so any in-flight speech is emitted with its source tag.
        match self.mic_vad_processor.flush() {
            Ok(final_segments) => self.dispatch_segments(final_segments, "final-mic"),
            Err(e) => warn!("Failed to flush mic VAD processor: {}", e),
        }
        match self.system_vad_processor.flush() {
            Ok(final_segments) => self.dispatch_segments(final_segments, "final-system"),
            Err(e) => warn!("Failed to flush system VAD processor: {}", e),
        }

        Ok(())
    }

    /// Run VAD over a single-source window and dispatch any completed segments.
    fn run_vad_for_source(&mut self, window: &[f32], source: DeviceType) {
        let processor = match source {
            DeviceType::Microphone => &mut self.mic_vad_processor,
            DeviceType::System => &mut self.system_vad_processor,
        };
        let segments = match processor.process_audio(window) {
            Ok(segments) => segments,
            Err(e) => {
                warn!("⚠️ {} VAD error: {}", source_label(source), e);
                return;
            }
        };

        // Streaming partial emission (best-effort, never blocks the final path).
        // Read speech-active + in-progress buffer BEFORE dispatch clears state.
        if self.partial_sender.is_some() {
            let active = processor.is_speech_active();
            let partial_len = processor.partial_samples().len();
            let snapshot = if active && partial_len >= PARTIAL_MIN_SAMPLES {
                Some(processor.partial_samples().to_vec())
            } else {
                None
            };
            self.maybe_emit_partial(source, active, partial_len, snapshot);
        }

        self.dispatch_segments(segments, source_label(source));
    }

    /// Decide whether to send a streaming-partial snapshot for `source`, using
    /// per-source edge detection (silence→speech bumps the utterance id) and a
    /// new-audio interval throttle.
    fn maybe_emit_partial(
        &mut self,
        source: DeviceType,
        active: bool,
        partial_len: usize,
        snapshot: Option<Vec<f32>>,
    ) {
        let state = match source {
            DeviceType::Microphone => &mut self.mic_partial,
            DeviceType::System => &mut self.system_partial,
        };

        // Edge: silence → speech starts a new utterance.
        if active && !state.was_active {
            state.utterance_id += 1;
            state.samples_at_last_emit = 0;
        }
        // Edge: speech → silence ends the utterance (the final path takes over).
        if !active && state.was_active {
            state.samples_at_last_emit = 0;
        }
        state.was_active = active;

        let Some(snapshot) = snapshot else { return };
        let new_since_emit = partial_len.saturating_sub(state.samples_at_last_emit);
        if new_since_emit < PARTIAL_EMIT_INTERVAL_SAMPLES {
            return;
        }
        state.samples_at_last_emit = partial_len;

        let utterance_id = state.utterance_id;
        if let Some(sender) = &self.partial_sender {
            let _ = sender.send(super::recording_state::PartialAudioChunk {
                samples: snapshot,
                source,
                utterance_id,
            });
        }
    }

    /// Send VAD segments to the transcription channel, preserving source identity
    /// on each emitted AudioChunk (chunk.device_type carries the speaker source).
    fn dispatch_segments(
        &mut self,
        segments: Vec<super::vad::SpeechSegment>,
        context: &str,
    ) {
        for segment in segments {
            let duration_ms = segment.end_timestamp_ms - segment.start_timestamp_ms;

            // Minimum 50ms at 16kHz — matches Whisper's minimum-input expectation.
            if segment.samples.len() < 800 {
                debug!(
                    "⏭️ Dropping short {} VAD segment: {:.1}ms ({} samples < 800)",
                    context,
                    duration_ms,
                    segment.samples.len()
                );
                continue;
            }

            info!(
                "📤 Sending {} VAD segment: {:.1}ms, {} samples (source={:?})",
                context,
                duration_ms,
                segment.samples.len(),
                segment.source,
            );

            let transcription_chunk = AudioChunk {
                data: segment.samples,
                sample_rate: 16000,
                timestamp: segment.start_timestamp_ms / 1000.0,
                chunk_id: self.chunk_id_counter,
                device_type: segment.source,
            };

            if let Err(e) = self.transcription_sender.send(transcription_chunk) {
                warn!("Failed to send {} VAD segment: {}", context, e);
            } else {
                self.chunk_id_counter += 1;
            }
        }
    }
}

fn source_label(source: DeviceType) -> &'static str {
    match source {
        DeviceType::Microphone => "mic",
        DeviceType::System => "system",
    }
}

/// Simple audio pipeline manager
pub struct AudioPipelineManager {
    pipeline_handle: Option<JoinHandle<Result<()>>>,
    audio_sender: Option<mpsc::UnboundedSender<AudioChunk>>,
}

impl AudioPipelineManager {
    pub fn new() -> Self {
        Self {
            pipeline_handle: None,
            audio_sender: None,
        }
    }

    /// Start the audio pipeline with device information for adaptive buffering
    pub fn start(
        &mut self,
        state: Arc<RecordingState>,
        transcription_sender: mpsc::UnboundedSender<AudioChunk>,
        target_chunk_duration_ms: u32,
        sample_rate: u32,
        recording_sender: Option<mpsc::UnboundedSender<AudioChunk>>,
        partial_sender: Option<mpsc::UnboundedSender<super::recording_state::PartialAudioChunk>>,
        mic_device_name: String,
        mic_device_kind: super::device_detection::InputDeviceKind,
        system_device_name: String,
        system_device_kind: super::device_detection::InputDeviceKind,
    ) -> Result<()> {
        // Log device information for adaptive buffering
        info!("🎙️ Starting pipeline with device info:");
        info!(
            "   Microphone: '{}' ({:?})",
            mic_device_name, mic_device_kind
        );
        info!(
            "   System Audio: '{}' ({:?})",
            system_device_name, system_device_kind
        );

        // Create audio processing channel
        let (audio_sender, audio_receiver) = mpsc::unbounded_channel::<AudioChunk>();

        // Set sender in state for audio captures to use
        state.set_audio_sender(audio_sender.clone());

        // Create and start pipeline with device information for adaptive mixing
        let mut pipeline = AudioPipeline::new(
            audio_receiver,
            transcription_sender,
            target_chunk_duration_ms,
            sample_rate,
            mic_device_name,
            mic_device_kind,
            system_device_name,
            system_device_kind,
        );

        // CRITICAL FIX: Connect recording sender to receive pre-mixed audio
        // This ensures both mic AND system audio are captured in recordings
        pipeline.recording_sender_for_mixed = recording_sender;
        // Streaming partials (None when disabled).
        pipeline.partial_sender = partial_sender;

        let handle = tokio::spawn(async move { pipeline.run().await });

        self.pipeline_handle = Some(handle);
        self.audio_sender = Some(audio_sender);

        info!("Audio pipeline manager started with mixed audio recording");
        Ok(())
    }

    /// Stop the audio pipeline
    pub async fn stop(&mut self) -> Result<()> {
        // Drop the sender to close the pipeline
        self.audio_sender = None;

        // Wait for pipeline to finish
        if let Some(handle) = self.pipeline_handle.take() {
            match handle.await {
                Ok(result) => result,
                Err(e) => {
                    error!("Pipeline task failed: {}", e);
                    Ok(())
                }
            }
        } else {
            Ok(())
        }
    }

    /// Force immediate flush of accumulated audio and stop pipeline
    /// PERFORMANCE CRITICAL: Eliminates 30+ second shutdown delays
    pub async fn force_flush_and_stop(&mut self) -> Result<()> {
        info!("🚀 Force flushing pipeline - processing ALL accumulated audio immediately");

        // If we have a sender, send a special flush signal first
        if let Some(sender) = &self.audio_sender {
            // Create a special flush chunk to trigger immediate processing
            let flush_chunk = AudioChunk {
                data: vec![], // Empty data signals flush
                sample_rate: 16000,
                timestamp: 0.0,
                chunk_id: u64::MAX, // Special ID to indicate flush
                device_type: super::recording_state::DeviceType::Microphone,
            };

            if let Err(e) = sender.send(flush_chunk) {
                warn!("Failed to send flush signal: {}", e);
            } else {
                info!("📤 Sent flush signal to pipeline");

                // PERFORMANCE OPTIMIZATION: Reduced wait time from 50ms to 20ms
                // Pipeline should process flush signal very quickly
                tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;

                // Send multiple flush signals to ensure the pipeline catches it
                // This aggressive approach eliminates shutdown delay issues
                for i in 0..3 {
                    let additional_flush = AudioChunk {
                        data: vec![],
                        sample_rate: 16000,
                        timestamp: 0.0,
                        chunk_id: u64::MAX - (i as u64),
                        device_type: super::recording_state::DeviceType::Microphone,
                    };
                    let _ = sender.send(additional_flush);
                }

                info!("📤 Sent additional flush signals for reliability");
                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            }
        }

        // Now stop normally
        self.stop().await
    }
}

impl Default for AudioPipelineManager {
    fn default() -> Self {
        Self::new()
    }
}
