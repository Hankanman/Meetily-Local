// audio/recording_commands.rs
//
// Slim Tauri command layer for recording functionality.
// Delegates to transcription and recording modules for actual implementation.

use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::task::JoinHandle;

use super::devices::{AudioDevice, DeviceType};
use super::recording_phase::{self, RecordingPhase};
use super::transcript_db_writer::TranscriptDbWriter;
use super::RecordingManager;
use crate::database::repositories::meeting::MeetingsRepository;
use crate::state::AppState;

// Import transcription modules
use super::transcription::{self, reset_speech_detected_flag};

// Re-export TranscriptUpdate for backward compatibility
pub use super::transcription::TranscriptUpdate;

// ============================================================================
// GLOBAL STATE
// ============================================================================

// Global recording manager and transcription task to keep them alive during recording
static RECORDING_MANAGER: Mutex<Option<RecordingManager>> = Mutex::new(None);
static TRANSCRIPTION_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Batched SQLite writer for the current session's live transcript segments
/// (issue #57 slice 2), and its task handle. Started once `start_recording*`
/// has a `meeting_id` and a DB pool; shut down (sender dropped, task
/// awaited) partway through `stop_recording`, after the transcription drain
/// has published every tail segment to the transcript bus.
static TRANSCRIPT_DB_WRITER: Mutex<Option<TranscriptDbWriter>> = Mutex::new(None);
static TRANSCRIPT_DB_WRITER_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Fetch the SQLite pool, if `AppState` has been managed yet. `None` early
/// in startup — e.g. a first-launch cold start racing a start/stop call
/// before the frontend has created the database. Every call site here
/// treats a missing pool as "log and continue" rather than failing the
/// recording (issue #57 slice 2's explicit contract for the meeting-row
/// writes).
fn db_pool<R: Runtime>(app: &AppHandle<R>) -> Option<sqlx::SqlitePool> {
    app.try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone())
}

/// Best-effort: mark `meeting_id`'s row "interrupted" (issue #57 slice 2).
/// Used on every abnormal stop path — a fatal recording error, or the audio
/// streams themselves failing to stop — so a row never lingers at
/// "recording" while the app keeps running (only a real crash needs the
/// startup sweep; this covers every case that doesn't crash the process).
/// Never fails the caller's own error path: logs and returns either way.
async fn mark_meeting_interrupted_best_effort<R: Runtime>(
    app: &AppHandle<R>,
    meeting_id: &Option<String>,
) {
    let Some(mid) = meeting_id else { return };
    let Some(pool) = db_pool(app) else {
        warn!(
            "No DB pool available; meeting {} row was not marked interrupted",
            mid
        );
        return;
    };
    match MeetingsRepository::mark_meeting_interrupted(&pool, mid).await {
        Ok(true) => info!("DB: meeting {} row marked interrupted", mid),
        Ok(false) => warn!("DB: meeting {} row not found to mark interrupted", mid),
        Err(e) => warn!("DB: failed to mark meeting {} row interrupted: {}", mid, e),
    }
}

/// Held from the first line of a `start_recording*` call until it returns.
/// `is_recording()` only flips true once the manager is stored — after
/// several awaits (model validation, preferences, device enumeration,
/// PipeWire stream open) — so without this two overlapping starts both pass
/// the "already recording" check and the second silently drops the first
/// manager and its un-finalised audio.
static START_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Held for the whole of `stop_recording` — `is_recording()` reads false
/// ~100 ms in (force-flush clears the state) while the transcription drain,
/// model unload and audio merge run for seconds to minutes. A start that
/// sneaks in during that window would take over the global manager slot and
/// the tail of the stop would then finalise (and drop) the *new* recording.
static STOP_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// RAII flag holder: clears the flag on every exit path, including `?`.
struct PhaseGuard(&'static AtomicBool);

impl PhaseGuard {
    /// Atomically claim `flag`; `None` if it is already held.
    fn try_acquire(flag: &'static AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| PhaseGuard(flag))
    }
}

impl Drop for PhaseGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// True while a stop is still draining / finalising a previous recording.
pub fn is_stop_in_progress() -> bool {
    STOP_IN_PROGRESS.load(Ordering::SeqCst)
}

/// Move the canonical recording-state machine (`audio::recording_phase`) to
/// `phase` and broadcast the resulting snapshot as `recording-state`,
/// merging in the live duration/queue-depth data this module owns
/// (`RECORDING_MANAGER`, the transcription queue). This is the single place
/// every phase transition in this file goes through.
fn emit_phase<R: Runtime>(app: &AppHandle<R>, phase: RecordingPhase) {
    let (active_duration_secs, total_pause_secs) = {
        let guard = RECORDING_MANAGER.lock().unwrap();
        match guard.as_ref() {
            Some(m) => (
                m.get_active_recording_duration(),
                m.get_total_pause_duration(),
            ),
            None => (None, 0.0),
        }
    };
    let chunks_in_queue = transcription::queue_depth();
    recording_phase::set_phase(app, phase, active_duration_secs, total_pause_secs, chunks_in_queue);
}

/// Shared entry check for every start path. Refuses while another start is
/// already running or a previous stop is still finalising, then re-checks the
/// live recording flag. Returns the guard that must be held until the start
/// call returns.
async fn begin_start_phase() -> Result<PhaseGuard, String> {
    let guard = PhaseGuard::try_acquire(&START_IN_PROGRESS)
        .ok_or_else(|| "Recording start already in progress".to_string())?;

    if is_stop_in_progress() {
        return Err(
            "The previous recording is still being finalised. Please wait a moment and try again."
                .to_string(),
        );
    }

    let current_recording_state = is_recording().await;
    info!("🔍 recording state check: {}", current_recording_state);
    if current_recording_state {
        return Err("Recording already in progress".to_string());
    }

    Ok(guard)
}

/// Snapshot the transcript segments accumulated so far in the current recording
/// session — in memory, before they're persisted on stop. Empty when nothing is
/// recording. Used by the live action-item extractor, which has no `meeting_id`
/// or DB rows to read during a recording.
pub fn snapshot_segments() -> Vec<crate::audio::common::TranscriptSegment> {
    RECORDING_MANAGER
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|m| m.get_transcript_segments()))
        .unwrap_or_default()
}

/// Subscribe this session's persistence to the transcript bus: every finished
/// segment is enqueued for SQLite (issue #57 slice 2) and handed to the
/// recording manager. `meeting_id` is captured by value so each segment
/// carries it without touching the (frequently swapped) `RECORDING_MANAGER`
/// lock to look it up. Removed by `transcript_bus::unsubscribe` in
/// `stop_recording` once the transcription worker has drained.
fn subscribe_transcript_persistence(meeting_id: String) {
    let replaced_stale = super::transcript_bus::subscribe(move |update: &TranscriptUpdate| {
        let segment = crate::audio::recording_saver::TranscriptSegment {
            id: format!("seg_{}", update.sequence_id),
            text: update.text.clone(),
            timestamp: None,
            audio_start_time: Some(update.audio_start_time),
            audio_end_time: Some(update.audio_end_time),
            duration: Some(update.duration),
            display_time: Some(update.timestamp.clone()), // Use wall-clock timestamp for display
            confidence: Some(update.confidence),
            sequence_id: Some(update.sequence_id),
            speaker: update.speaker.clone(),
            voice_profile_id: update.voice_profile_id.clone(),
            source: Some(update.source.clone()),
        };

        // Persist to SQLite via the batched writer — a cheap channel send,
        // non-blocking, independent of the RecordingSaver copy saved below.
        if let Ok(writer_guard) = TRANSCRIPT_DB_WRITER.lock() {
            if let Some(writer) = writer_guard.as_ref() {
                writer.enqueue(meeting_id.clone(), segment.clone());
            }
        }

        if let Ok(manager_guard) = RECORDING_MANAGER.lock() {
            if let Some(manager) = manager_guard.as_ref() {
                manager.add_transcript_segment(segment);
            } else {
                // Manager is briefly out of the slot (e.g. mid force-flush
                // during stop) — buffer instead of dropping; replayed once
                // it's back (issue #25).
                PENDING_SEGMENT_BUFFER.lock().unwrap().push(segment);
            }
        }
    });
    // A stale subscriber means a previous session never reached its
    // unsubscribe (error-path stop, crash recovery); it has just been
    // replaced, otherwise every segment would be persisted twice.
    if replaced_stale {
        warn!("⚠️ Replaced a stale transcript subscriber from a previous session");
    }
    info!("✅ Transcript persistence subscribed for this session");
}

/// Transcript segments that arrived on the transcript bus
/// while `RECORDING_MANAGER` was briefly empty — e.g. during the
/// `stop_streams_and_force_flush().await` call in `stop_recording`, which
/// takes the manager out of the slot for its duration. Without this they'd
/// be silently dropped (issue #25): buffered here instead, then replayed
/// into the manager via `replay_buffered_segments` as soon as it's back.
static PENDING_SEGMENT_BUFFER: Mutex<Vec<crate::audio::recording_saver::TranscriptSegment>> =
    Mutex::new(Vec::new());

/// Called from `RecordingState::report_error` (via `set_error_callback`)
/// exactly once per session on a fatal error. Emits a user-facing
/// `recording-error` event, then runs the exact same `stop_recording`
/// command flow the Stop button runs — draining transcription, finalising
/// audio, releasing the manager and emitting `recording-stopped` — so a
/// fatal error can never leave streams/pipeline/worker dangling with the
/// user's own Stop button reduced to a silent no-op (issue #24).
fn spawn_fatal_error_stop<R: Runtime>(
    app: &AppHandle<R>,
    error: &super::recording_state::AudioError,
) {
    warn!(
        "Fatal recording error ({}); auto-stopping via the full stop flow",
        error.user_message()
    );
    let _ = app.emit("recording-error", error.user_message());
    recording_phase::set_error_message(Some(error.user_message().to_string()));
    emit_phase(app, RecordingPhase::Error);

    let app_for_stop = app.clone();
    tauri::async_runtime::spawn(async move {
        // `stop_recording` doesn't actually use `save_path` for anything
        // beyond ensuring its parent directory exists (see `lib::stop_recording`,
        // which is the caller for a user-initiated stop); build one the same
        // way the tray's stop handlers do.
        let save_path = app_for_stop
            .path()
            .app_data_dir()
            .map(|dir| {
                let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
                dir.join(format!("recording-error-{}.wav", timestamp))
                    .to_string_lossy()
                    .to_string()
            })
            .unwrap_or_else(|_| "recording-error.wav".to_string());

        if let Err(e) = stop_recording(app_for_stop.clone(), RecordingArgs { save_path }).await {
            error!("Auto-stop after fatal recording error failed: {}", e);
        }
    });
}

/// Drain `buffer` into `manager`, in arrival order. Pure function (no
/// statics touched) so it's unit-testable on its own — see the `tests`
/// module at the bottom of this file.
fn replay_buffered_segments(
    buffer: &mut Vec<crate::audio::recording_saver::TranscriptSegment>,
    manager: &RecordingManager,
) {
    for segment in buffer.drain(..) {
        manager.add_transcript_segment(segment);
    }
}

// ============================================================================
// PUBLIC TYPES
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct RecordingArgs {
    pub save_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscriptionStatus {
    pub chunks_in_queue: usize,
    pub is_processing: bool,
    pub last_activity_ms: u64,
}

// ============================================================================
// RECORDING COMMANDS
// ============================================================================

/// Start recording with default devices
pub async fn start_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    start_recording_with_meeting_name(app, None).await
}

/// Start recording with default devices and optional meeting name
pub async fn start_recording_with_meeting_name<R: Runtime>(
    app: AppHandle<R>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    info!(
        "Starting recording with default devices, meeting: {:?}",
        meeting_name
    );

    // Claim the start phase (rejects overlapping starts and starts during a
    // still-finalising stop) and check the live recording flag.
    let _start_phase = begin_start_phase().await?;

    // The canonical state machine's first transition: Idle -> Starting,
    // before any of the awaits below (model validation, preferences, device
    // enumeration, PipeWire stream open) that can take a noticeable moment.
    emit_phase(&app, RecordingPhase::Starting);

    // Validate that transcription models are available before starting recording
    info!("🔍 Validating transcription model availability before starting recording...");
    if let Err(validation_error) = transcription::validate_transcription_model_ready(&app).await {
        error!("Model validation failed: {}", validation_error);

        // Emit error event for frontend - actionable: false to show toast instead of modal
        // (download progress is already shown in top-right toast)
        let _ = app.emit(
            "transcription-error",
            serde_json::json!({
                "error": validation_error,
                "userMessage": format!("Recording cannot start: {}", validation_error),
                "actionable": false
            }),
        );

        emit_phase(&app, RecordingPhase::Idle);
        return Err(validation_error);
    }
    info!("✅ Transcription model validation passed");

    // Async-first approach - no more blocking operations!
    info!("🚀 Starting async recording initialization");

    // Create new recording manager
    let mut manager = RecordingManager::new();

    // Load recording preferences to get auto_save AND device preferences
    let (auto_save, preferred_mic_name, preferred_system_name, streaming_partials) =
        match super::recording_preferences::load_recording_preferences(&app).await {
            Ok(prefs) => {
                info!("📋 Loaded recording preferences: auto_save={}, preferred_mic={:?}, preferred_system={:?}",
                      prefs.auto_save, prefs.preferred_mic_device, prefs.preferred_system_device);
                (
                    prefs.auto_save,
                    prefs.preferred_mic_device,
                    prefs.preferred_system_device,
                    prefs.streaming_partials,
                )
            }
            Err(e) => {
                warn!(
                    "Failed to load recording preferences, using defaults: {}",
                    e
                );
                (true, None, None, true)
            }
        };

    // ============================================================================
    // DEVICE RESOLUTION: saved preference (PipeWire node id) → default.
    // A stale saved id (device unplugged/renamed) falls back to default.
    // ============================================================================
    let known_ids: Vec<String> = match super::devices::list_audio_devices().await {
        Ok(devices) => devices.into_iter().map(|d| d.id).collect(),
        Err(e) => {
            warn!("Could not enumerate devices ({}); trusting saved ids", e);
            Vec::new()
        }
    };
    let resolve = |pref: Option<String>, role: &str| -> String {
        match pref {
            Some(id) if known_ids.is_empty() || known_ids.iter().any(|k| *k == id) => {
                info!("✅ Using preferred {}: '{}'", role, id);
                id
            }
            Some(id) => {
                warn!(
                    "⚠️ Preferred {} '{}' not present; falling back to default",
                    role, id
                );
                "default".to_string()
            }
            None => {
                info!("🎧 No {} preference set, using system default", role);
                "default".to_string()
            }
        }
    };

    let microphone_device = Some(Arc::new(AudioDevice::new(
        resolve(preferred_mic_name, "microphone"),
        DeviceType::Input,
    )));
    let system_device = Some(Arc::new(AudioDevice::new(
        resolve(preferred_system_name, "system audio"),
        DeviceType::Output,
    )));

    // Always ensure a meeting name is set so incremental saver initializes
    let effective_meeting_name = meeting_name.clone().unwrap_or_else(|| {
        // Example: Meeting 2025-10-03_08-25-23
        let now = chrono::Local::now();
        format!("Meeting {}", now.format("%Y-%m-%d_%H-%M-%S"))
    });
    manager.set_meeting_name(Some(effective_meeting_name.clone()));

    // Mint the meeting_id up front (issue #57 slice 2): kept for the whole
    // session so live transcript upserts, `recording-started`/
    // `recording-stopped`, and the `meetings` row itself all agree on one
    // id. Minting it doesn't depend on the DB insert below succeeding — a
    // failed insert still leaves every other use of this id well-defined
    // (transcript upserts just won't have a row to match against).
    let meeting_id = uuid::Uuid::new_v4().to_string();
    manager.set_meeting_id(Some(meeting_id.clone()));

    // Set up error callback: on a fatal error (report_error only calls this
    // once per session — see recording_state::report_error) tell the user
    // and run the exact same full stop flow the Stop button runs, so
    // streams/pipeline/worker/save/`recording-stopped` all still happen
    // instead of leaving everything dangling (issue #24).
    let app_for_error = app.clone();
    manager.set_error_callback(move |error| {
        spawn_fatal_error_stop(&app_for_error, error);
    });

    // Start recording with resolved devices (replaces start_recording_with_defaults_and_auto_save call)
    let transcription_receiver = match manager
        .start_recording(microphone_device, system_device, auto_save, streaming_partials)
        .await
    {
        Ok(rx) => rx,
        Err(e) => {
            emit_phase(&app, RecordingPhase::Idle);
            return Err(format!("Failed to start recording: {}", e));
        }
    };

    // Recording itself only needs raw PCM, but finalizing it into a
    // playable file needs ffmpeg — warn (once, non-fatal) rather than
    // blocking start on it.
    if super::ffmpeg::find_ffmpeg_path().is_none() {
        warn!("FFmpeg not found; recording will be kept as PCM checkpoints until it is installed");
        let _ = app.emit(
            "transcription-warning",
            "FFmpeg is not installed; the recording will be kept as PCM checkpoints until it is.",
        );
    }

    // Claim the streaming-partial receiver before the manager is moved into
    // the global (None when partials are disabled).
    let partial_receiver = manager.take_partial_receiver();

    // Record the meeting name/folder for the canonical snapshot while we
    // still own `manager` locally (the folder is created inside
    // `start_recording` above, via the recording saver's accumulation).
    let folder_path_for_phase = manager
        .get_meeting_folder()
        .map(|p| p.to_string_lossy().to_string());
    recording_phase::set_meeting_info(
        Some(effective_meeting_name.clone()),
        folder_path_for_phase.clone(),
        Some(meeting_id.clone()),
    );

    // Create the `meetings` row now, status "recording" (issue #57 slice 2)
    // — Rust owns the row's whole lifecycle from here, so a crash mid-
    // recording leaves a real "recording"-status row for the next startup's
    // sweep to mark "interrupted" instead of nothing at all. Best-effort:
    // the recording itself must never fail because this insert did.
    if let Some(pool) = db_pool(&app) {
        if let Err(e) = MeetingsRepository::create_recording_meeting(
            &pool,
            &meeting_id,
            &effective_meeting_name,
            folder_path_for_phase.as_deref(),
        )
        .await
        {
            warn!(
                "Failed to create meeting row {} at recording start (continuing without it): {}",
                meeting_id, e
            );
        }
        // Batched writer for live transcript-segment upserts, regardless of
        // whether the insert above succeeded — see its own doc comment.
        let (writer, writer_task) = TranscriptDbWriter::start(pool);
        *TRANSCRIPT_DB_WRITER.lock().unwrap() = Some(writer);
        let stale_task = TRANSCRIPT_DB_WRITER_TASK.lock().unwrap().replace(writer_task);
        if let Some(stale_task) = stale_task {
            // Same defensive cleanup as the stale transcript subscriber
            // below: a previous session's task should already be gone, but
            // never leave two writers racing against the same DB rows.
            stale_task.abort();
            warn!("⚠️ Aborted a stale transcript DB writer task from a previous session");
        }
    } else {
        warn!(
            "No DB pool available yet; meeting {} won't be persisted to SQLite live (transcripts.ndjson on disk is unaffected)",
            meeting_id
        );
    }

    // Store the manager globally to keep it alive
    {
        let mut global_manager = RECORDING_MANAGER.lock().unwrap();
        *global_manager = Some(manager);
    }

    // Reset speech detection flag for the new recording session. Recording
    // state itself is already tracked by `RecordingState` (set inside
    // `manager.start_recording()` above) — no separate flag to flip here.
    info!("🔍 Resetting SPEECH_DETECTED_EMITTED for new recording session");
    reset_speech_detected_flag(); // Reset for new recording session

    // Initialize the speaker diarizer for this session if the model is on disk.
    // Failure is non-fatal: recording proceeds with the "Speaker" placeholder.
    match crate::speaker_diarization::commands::try_init_for_recording(&app).await {
        Ok(true) => info!("🗣️ Speaker diarization enabled for this session"),
        Ok(false) => info!("🗣️ Speaker diarization disabled (model not downloaded)"),
        Err(e) => warn!("Speaker diarizer init failed: {}", e),
    }

    // Start optimized parallel transcription task and store handle
    let task_handle = transcription::start_transcription_task(app.clone(), transcription_receiver);
    {
        let mut global_task = TRANSCRIPTION_TASK.lock().unwrap();
        *global_task = Some(task_handle);
    }

    // Start the streaming-partial preview task (best-effort, additive to the
    // final path). Detached — it ends when the pipeline drops its sender.
    if let Some(rx) = partial_receiver {
        transcription::start_partial_decode_task(app.clone(), rx);
    }

    // Persist every finished segment for this session (SQLite writer +
    // RecordingSaver copy) via the in-process transcript bus.
    subscribe_transcript_persistence(meeting_id.clone());

    // Emit success event
    app.emit(
        "recording-started",
        serde_json::json!({
            "message": "Recording started successfully with parallel processing",
            "devices": ["Default Microphone", "Default System Audio"],
            "workers": 3,
            "meeting_id": meeting_id
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect recording state
    crate::tray::update_tray_menu(&app);
    emit_phase(&app, RecordingPhase::Recording);

    info!("✅ Recording started successfully with async-first approach");

    Ok(())
}

/// Start recording with specific devices
pub async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

/// Start recording with specific devices and optional meeting name
pub async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    info!(
        "Starting recording with specific devices: mic={:?}, system={:?}, meeting={:?}",
        mic_device_name, system_device_name, meeting_name
    );

    // Claim the start phase (rejects overlapping starts and starts during a
    // still-finalising stop) and check the live recording flag.
    let _start_phase = begin_start_phase().await?;

    // The canonical state machine's first transition: Idle -> Starting,
    // before any of the awaits below (model validation, preferences, device
    // enumeration, PipeWire stream open) that can take a noticeable moment.
    emit_phase(&app, RecordingPhase::Starting);

    // Validate that transcription models are available before starting recording
    info!("🔍 Validating transcription model availability before starting recording...");
    if let Err(validation_error) = transcription::validate_transcription_model_ready(&app).await {
        error!("Model validation failed: {}", validation_error);

        // Emit error event for frontend - actionable: false to show toast instead of modal
        // (download progress is already shown in top-right toast)
        let _ = app.emit(
            "transcription-error",
            serde_json::json!({
                "error": validation_error,
                "userMessage": format!("Recording cannot start: {}", validation_error),
                "actionable": false
            }),
        );

        emit_phase(&app, RecordingPhase::Idle);
        return Err(validation_error);
    }
    info!("✅ Transcription model validation passed");

    // Which stream a device drives is determined by the parameter it
    // arrives in — ids are opaque PipeWire node names (or "default").
    let mic_device = mic_device_name
        .as_ref()
        .map(|id| Arc::new(AudioDevice::new(id.clone(), DeviceType::Input)));
    let system_device = system_device_name
        .as_ref()
        .map(|id| Arc::new(AudioDevice::new(id.clone(), DeviceType::Output)));

    // Async-first approach for custom devices - no more blocking operations!
    info!("🚀 Starting async recording initialization with custom devices");

    // Create new recording manager
    let mut manager = RecordingManager::new();

    // Load recording preferences to check auto_save setting
    let (auto_save, streaming_partials) =
        match super::recording_preferences::load_recording_preferences(&app).await {
            Ok(prefs) => {
                info!(
                    "📋 Loaded recording preferences: auto_save={}",
                    prefs.auto_save
                );
                (prefs.auto_save, prefs.streaming_partials)
            }
            Err(e) => {
                warn!(
                    "Failed to load recording preferences, defaulting to auto_save=true: {}",
                    e
                );
                (true, true) // Defaults if preferences can't be loaded
            }
        };

    // Always ensure a meeting name is set so incremental saver initializes
    let effective_meeting_name = meeting_name.clone().unwrap_or_else(|| {
        let now = chrono::Local::now();
        format!("Meeting {}", now.format("%Y-%m-%d_%H-%M-%S"))
    });
    manager.set_meeting_name(Some(effective_meeting_name.clone()));

    // Mint the meeting_id up front (issue #57 slice 2): kept for the whole
    // session so live transcript upserts, `recording-started`/
    // `recording-stopped`, and the `meetings` row itself all agree on one
    // id. Minting it doesn't depend on the DB insert below succeeding — a
    // failed insert still leaves every other use of this id well-defined
    // (transcript upserts just won't have a row to match against).
    let meeting_id = uuid::Uuid::new_v4().to_string();
    manager.set_meeting_id(Some(meeting_id.clone()));

    // Set up error callback: on a fatal error (report_error only calls this
    // once per session — see recording_state::report_error) tell the user
    // and run the exact same full stop flow the Stop button runs, so
    // streams/pipeline/worker/save/`recording-stopped` all still happen
    // instead of leaving everything dangling (issue #24).
    let app_for_error = app.clone();
    manager.set_error_callback(move |error| {
        spawn_fatal_error_stop(&app_for_error, error);
    });

    // Start recording with specified devices and auto_save setting
    let transcription_receiver = match manager
        .start_recording(mic_device, system_device, auto_save, streaming_partials)
        .await
    {
        Ok(rx) => rx,
        Err(e) => {
            emit_phase(&app, RecordingPhase::Idle);
            return Err(format!("Failed to start recording: {}", e));
        }
    };

    // Recording itself only needs raw PCM, but finalizing it into a
    // playable file needs ffmpeg — warn (once, non-fatal) rather than
    // blocking start on it.
    if super::ffmpeg::find_ffmpeg_path().is_none() {
        warn!("FFmpeg not found; recording will be kept as PCM checkpoints until it is installed");
        let _ = app.emit(
            "transcription-warning",
            "FFmpeg is not installed; the recording will be kept as PCM checkpoints until it is.",
        );
    }

    // Claim the streaming-partial receiver before the manager is moved into
    // the global (None when partials are disabled).
    let partial_receiver = manager.take_partial_receiver();

    // Record the meeting name/folder for the canonical snapshot while we
    // still own `manager` locally (the folder is created inside
    // `start_recording` above, via the recording saver's accumulation).
    let folder_path_for_phase = manager
        .get_meeting_folder()
        .map(|p| p.to_string_lossy().to_string());
    recording_phase::set_meeting_info(
        Some(effective_meeting_name.clone()),
        folder_path_for_phase.clone(),
        Some(meeting_id.clone()),
    );

    // Create the `meetings` row now, status "recording" (issue #57 slice 2)
    // — Rust owns the row's whole lifecycle from here, so a crash mid-
    // recording leaves a real "recording"-status row for the next startup's
    // sweep to mark "interrupted" instead of nothing at all. Best-effort:
    // the recording itself must never fail because this insert did.
    if let Some(pool) = db_pool(&app) {
        if let Err(e) = MeetingsRepository::create_recording_meeting(
            &pool,
            &meeting_id,
            &effective_meeting_name,
            folder_path_for_phase.as_deref(),
        )
        .await
        {
            warn!(
                "Failed to create meeting row {} at recording start (continuing without it): {}",
                meeting_id, e
            );
        }
        // Batched writer for live transcript-segment upserts, regardless of
        // whether the insert above succeeded — see its own doc comment.
        let (writer, writer_task) = TranscriptDbWriter::start(pool);
        *TRANSCRIPT_DB_WRITER.lock().unwrap() = Some(writer);
        let stale_task = TRANSCRIPT_DB_WRITER_TASK.lock().unwrap().replace(writer_task);
        if let Some(stale_task) = stale_task {
            // Same defensive cleanup as the stale transcript subscriber
            // below: a previous session's task should already be gone, but
            // never leave two writers racing against the same DB rows.
            stale_task.abort();
            warn!("⚠️ Aborted a stale transcript DB writer task from a previous session");
        }
    } else {
        warn!(
            "No DB pool available yet; meeting {} won't be persisted to SQLite live (transcripts.ndjson on disk is unaffected)",
            meeting_id
        );
    }

    // Store the manager globally to keep it alive
    {
        let mut global_manager = RECORDING_MANAGER.lock().unwrap();
        *global_manager = Some(manager);
    }

    // Reset speech detection flag for the new recording session. Recording
    // state itself is already tracked by `RecordingState` (set inside
    // `manager.start_recording()` above) — no separate flag to flip here.
    info!("🔍 Resetting SPEECH_DETECTED_EMITTED for new recording session");
    reset_speech_detected_flag(); // Reset for new recording session

    // Initialize the speaker diarizer for this session if the model is on disk.
    // Failure is non-fatal: recording proceeds with the "Speaker" placeholder.
    match crate::speaker_diarization::commands::try_init_for_recording(&app).await {
        Ok(true) => info!("🗣️ Speaker diarization enabled for this session"),
        Ok(false) => info!("🗣️ Speaker diarization disabled (model not downloaded)"),
        Err(e) => warn!("Speaker diarizer init failed: {}", e),
    }

    // Start optimized parallel transcription task and store handle
    let task_handle = transcription::start_transcription_task(app.clone(), transcription_receiver);
    {
        let mut global_task = TRANSCRIPTION_TASK.lock().unwrap();
        *global_task = Some(task_handle);
    }

    // Start the streaming-partial preview task (best-effort, additive to the
    // final path). Detached — it ends when the pipeline drops its sender.
    if let Some(rx) = partial_receiver {
        transcription::start_partial_decode_task(app.clone(), rx);
    }

    // Persist every finished segment for this session (SQLite writer +
    // RecordingSaver copy) via the in-process transcript bus.
    subscribe_transcript_persistence(meeting_id.clone());

    // Emit success event
    app.emit(
        "recording-started",
        serde_json::json!({
            "message": "Recording started with custom devices and parallel processing",
            "devices": [
                mic_device_name.unwrap_or_else(|| "Default Microphone".to_string()),
                system_device_name.unwrap_or_else(|| "Default System Audio".to_string())
            ],
            "workers": 3,
            "meeting_id": meeting_id
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect recording state
    crate::tray::update_tray_menu(&app);
    emit_phase(&app, RecordingPhase::Recording);

    info!("✅ Recording started with custom devices using async-first approach");

    Ok(())
}

/// Stop recording with optimized graceful shutdown ensuring NO transcript chunks are lost
pub async fn stop_recording<R: Runtime>(
    app: AppHandle<R>,
    _args: RecordingArgs,
) -> Result<(), String> {
    info!(
        "🛑 Starting optimized recording shutdown - ensuring ALL transcript chunks are preserved"
    );

    // "Nothing to stop" is decided by whether a manager is actually present
    // (and no stop is already draining one) — NOT by `is_recording()`.
    // `report_error` (see recording_state.rs) no longer force-stops on a
    // fatal error, but even before that: `stop_streams_and_force_flush`
    // itself calls `state.cleanup()`, so `is_recording()` already reads
    // false while a manager is still present and mid-drain. Basing the
    // early return on the atomic made the user's own Stop button a silent
    // no-op in both cases (issue #24) — a manager in the slot, or a stop
    // already in progress, always means there's real work to finish here.
    {
        let manager_present = RECORDING_MANAGER.lock().unwrap().is_some();
        if !manager_present && !is_stop_in_progress() {
            info!("Recording was not active");
            return Ok(());
        }
    }

    // Hold the stop phase until this function returns so no start can take
    // over the manager slot while the drain / save below is still running.
    let _stop_phase = PhaseGuard::try_acquire(&STOP_IN_PROGRESS)
        .ok_or_else(|| "Recording stop already in progress".to_string())?;

    // Captured before the Stopping transition below moves the canonical
    // phase away from Error — distinguishes a fatal-error-triggered stop
    // (issue #57 slice 2: the meeting row should end up "interrupted") from
    // a normal user-initiated stop ("completed"). This function runs
    // unchanged for both — `spawn_fatal_error_stop` just calls it.
    let was_fatal_error = recording_phase::current_phase() == RecordingPhase::Error;

    // The meeting_id for this session, if any (issue #57 slice 2) — read
    // once, up front, while the manager is still definitely present; used at
    // the end of this function to finalise the `meetings` row.
    let meeting_id_for_stop: Option<String> = RECORDING_MANAGER
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|m| m.get_meeting_id());

    // Canonical state machine: Recording/Paused/Error -> Stopping, as early
    // as possible in the stop flow.
    emit_phase(&app, RecordingPhase::Stopping);

    // Emit shutdown progress to frontend
    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({
            "stage": "stopping_audio",
            "message": "Stopping audio capture...",
            "progress": 20
        }),
    );

    // Step 1: Stop audio capture immediately (no more new chunks). Take the
    // manager out just long enough to force-flush the pipeline, then put it
    // BACK in the global slot so the transcript bus subscriber can still reach
    // it while the worker drains the flushed tail below. `force_flush` calls
    // `state.cleanup()`, so `is_recording()` already reads false here even with
    // the manager present. It's taken out again for the final save after the
    // drain (Step 4).
    let manager = {
        let mut global_manager = RECORDING_MANAGER.lock().unwrap();
        global_manager.take()
    };

    let stop_result = if let Some(mut manager) = manager {
        // Use FORCE FLUSH to immediately process all accumulated audio - eliminates 30s delay!
        info!("🚀 Using FORCE FLUSH to eliminate pipeline accumulation delays");
        let result = manager.stop_streams_and_force_flush().await;
        // Replay any segments the transcript bus subscriber buffered while
        // the manager was out of RECORDING_MANAGER during the await above
        // (issue #25) — before putting the manager back, so nothing else
        // can observe it as "present but missing tail segments".
        {
            let mut pending = PENDING_SEGMENT_BUFFER.lock().unwrap();
            if !pending.is_empty() {
                info!(
                    "↩️ Replaying {} transcript segment(s) buffered during force-flush",
                    pending.len()
                );
                replay_buffered_segments(&mut pending, &manager);
            }
        }
        // Return the manager to the global slot for the drain window so the
        // bus subscriber can persist the tail segments transcribed below.
        *RECORDING_MANAGER.lock().unwrap() = Some(manager);
        result
    } else {
        warn!("No recording manager found to stop");
        Ok(())
    };

    match stop_result {
        Ok(_) => {
            info!("✅ Audio streams stopped successfully - no more chunks will be created");
            // Canonical state machine: Stopping -> Finalising — the force
            // flush is done, and the drain/save that follows below can take
            // seconds to minutes.
            emit_phase(&app, RecordingPhase::Finalising);
        }
        Err(e) => {
            error!("❌ Failed to stop audio streams: {}", e);
            recording_phase::set_error_message(Some(e.to_string()));
            emit_phase(&app, RecordingPhase::Error);
            mark_meeting_interrupted_best_effort(&app, &meeting_id_for_stop).await;
            return Err(format!("Failed to stop audio streams: {}", e));
        }
    }

    // NOTE: the transcript bus subscriber and the speaker diarizer are torn
    // down *after* the transcription drain below — not here. The force-flush
    // above only *queues* the tail segments; they're transcribed during the
    // drain and their segments must still reach the subscriber
    // (which persists them) and the diarizer (which attributes them). Removing
    // either now drops the final utterance(s) — and for a short recording whose
    // entire content is one un-closed utterance, that means zero saved
    // segments even though the live partials looked perfect.

    // Step 2: Signal transcription workers to finish processing ALL queued chunks
    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({
            "stage": "processing_transcripts",
            "message": "Processing remaining transcript chunks...",
            "progress": 40
        }),
    );

    // Wait for transcription task with enhanced progress monitoring (NO TIMEOUT - we must process all chunks)
    let transcription_task = {
        let mut global_task = TRANSCRIPTION_TASK.lock().unwrap();
        global_task.take()
    };

    if let Some(mut task_handle) = transcription_task {
        info!("⏳ Waiting for ALL transcription chunks to be processed (draining the queue, no fixed cap)");

        // Issue #26: there is no hard cap on drain time any more as long as
        // the worker is making progress — only a *stall* (the queue depth
        // hasn't shrunk at all for 10 minutes) aborts the wait. This avoids
        // silently discarding a legitimate backlog just because it took
        // longer than some fixed budget to transcribe.
        const STALL_LIMIT: std::time::Duration = std::time::Duration::from_secs(600);
        let shutdown_start = std::time::Instant::now();
        let mut last_progress_at = shutdown_start;
        let mut last_depth = transcription::queue_depth();

        let outcome = loop {
            tokio::select! {
                biased;
                res = &mut task_handle => {
                    break Some(res);
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(500)) => {
                    let depth = transcription::queue_depth();
                    if depth < last_depth {
                        last_progress_at = std::time::Instant::now();
                    }
                    last_depth = depth;

                    let elapsed = shutdown_start.elapsed().as_secs();
                    let _ = app.emit(
                        "recording-shutdown-progress",
                        serde_json::json!({
                            "stage": "processing_transcripts",
                            "message": format!(
                                "Processing transcripts... ({}s elapsed, {} chunk(s) queued)",
                                elapsed, depth
                            ),
                            "progress": 40,
                            "detailed": true,
                            "elapsed_seconds": elapsed,
                            "chunks_in_queue": depth
                        }),
                    );

                    if last_progress_at.elapsed() >= STALL_LIMIT {
                        warn!(
                            "⏱️ Transcription queue stalled at {} chunk(s) for {}s with no progress, aborting to prevent indefinite hang",
                            depth,
                            STALL_LIMIT.as_secs()
                        );
                        task_handle.abort();
                        break None;
                    }
                }
            }
        };

        match outcome {
            Some(Ok(())) => {
                info!("✅ ALL transcription chunks processed successfully - no data lost");
            }
            Some(Err(e)) => {
                warn!("⚠️ Transcription task completed with error: {:?}", e);
                // Continue anyway - the worker may have processed most chunks
            }
            None => {
                warn!("⏱️ Transcription drain stalled and was aborted, continuing shutdown (some chunks may be unprocessed)");
            }
        }
    } else {
        info!("ℹ️ No transcription task found to wait for");
    }

    // The worker has drained: the flushed tail segments are transcribed and
    // were published to the transcript bus synchronously as they finished,
    // so every one has already been persisted. Removing the subscriber
    // earlier than this would lose the last utterance(s) — see the note above.
    if super::transcript_bus::unsubscribe() {
        info!("✅ Transcript persistence unsubscribed (after transcription drain)");
    }

    // Shut down the transcript DB writer (issue #57 slice 2): every segment
    // this session enqueued has been sent by now (the subscriber above is
    // gone), so dropping the writer closes its channel — the task then
    // flushes whatever's left in its current batch and returns, which this
    // awaits (bounded) before moving on.
    {
        let writer = TRANSCRIPT_DB_WRITER.lock().unwrap().take();
        drop(writer);
        let task = TRANSCRIPT_DB_WRITER_TASK.lock().unwrap().take();
        if let Some(task) = task {
            match tokio::time::timeout(tokio::time::Duration::from_secs(5), task).await {
                Ok(_) => info!("✅ Transcript DB writer task drained and finished"),
                Err(_) => warn!(
                    "⏱️ Transcript DB writer task still running after drain; abandoning wait (transcripts.ndjson on disk is unaffected)"
                ),
            }
        }
    }

    // The streaming-partial task ends on its own once the pipeline drops its
    // sender (it clears the overlay as it exits). Give it a moment, then
    // abort anything still running so a late partial can never re-populate
    // the overlay after `recording-stopped`.
    if let Some(partial_task) = transcription::take_partial_task_handle() {
        match tokio::time::timeout(tokio::time::Duration::from_secs(5), partial_task).await {
            Ok(_) => info!("✅ Streaming-partial task finished"),
            Err(_) => warn!("⏱️ Streaming-partial task still running after drain; aborting"),
        }
    }

    // Drop the speaker diarizer now (not before the drain) so a fresh session
    // starts with empty cluster IDs — the tail segments needed it above.
    crate::speaker_diarization::commands::shutdown_for_recording();

    // Take the manager back out of the global slot now the tail is persisted;
    // it's needed (owned) for the final save in Step 4.
    let manager_for_cleanup = { RECORDING_MANAGER.lock().unwrap().take() };

    // Step 3: Whisper model stays resident across recordings by default
    // (#47) — reloading it at the start of every recording was the main
    // cost this shutdown path used to pay for no benefit, since the same
    // model is almost always used for the next recording too. Only unload
    // it here when the user has explicitly opted into freeing it between
    // recordings via `unload_model_after_recording` (see
    // `recording_preferences::should_unload_after_stop`); otherwise it's
    // left loaded and idle (no background work runs against it while no
    // recording or batch job is using it).
    let preferences = super::recording_preferences::load_recording_preferences(&app)
        .await
        .unwrap_or_default();

    if super::recording_preferences::should_unload_after_stop(&preferences) {
        let _ = app.emit(
            "recording-shutdown-progress",
            serde_json::json!({
                "stage": "unloading_model",
                "message": "Unloading speech recognition model...",
                "progress": 70
            }),
        );

        info!("🧠 unload_model_after_recording is set — unloading Whisper model...");
        let engine_clone = {
            let engine_guard = crate::whisper_engine::commands::WHISPER_ENGINE
                .lock()
                .unwrap();
            engine_guard.as_ref().cloned()
        };

        if let Some(engine) = engine_clone {
            let current_model = engine
                .get_current_model()
                .await
                .unwrap_or_else(|| "unknown".to_string());
            info!("Current Whisper model before unload: '{}'", current_model);

            if engine.unload_model().await {
                info!("✅ Whisper model '{}' unloaded successfully", current_model);
            } else {
                warn!("⚠️ Failed to unload Whisper model '{}'", current_model);
            }
        } else {
            warn!("⚠️ No Whisper engine found to unload model");
        }
    } else {
        info!("🧠 All transcript chunks processed. Keeping Whisper model resident for the next recording.");
    }

    // Step 4: Finalize recording state and cleanup resources safely
    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({
            "stage": "finalizing",
            "message": "Finalizing recording and cleaning up resources...",
            "progress": 90
        }),
    );

    // Perform final cleanup with the manager if available
    let (meeting_folder, meeting_name, final_audio_path, final_duration_seconds) =
        if let Some(mut manager) = manager_for_cleanup {
            info!("🧹 Performing final cleanup and saving recording data");

            // Extract meeting info BEFORE async operations
            let meeting_folder = manager.get_meeting_folder();
            let meeting_name = manager.get_meeting_name();

            let (audio_path, duration_seconds) = match tokio::time::timeout(
                tokio::time::Duration::from_secs(300), // 5 minutes max for file I/O
                manager.save_recording_only(&app),
            )
            .await
            {
                Ok(Ok((audio_path, duration_seconds))) => {
                    info!("✅ Recording data saved successfully during cleanup");
                    (audio_path, duration_seconds)
                }
                Ok(Err(e)) => {
                    warn!(
                        "⚠️ Error during recording cleanup (transcripts preserved): {}",
                        e
                    );
                    // Don't fail shutdown - transcripts are already preserved
                    (None, None)
                }
                Err(_) => {
                    warn!(
                        "⏱️ File I/O timeout (5 minutes) reached during save, continuing shutdown"
                    );
                    // Don't fail shutdown - transcripts are already preserved
                    (None, None)
                }
            };

            (meeting_folder, meeting_name, audio_path, duration_seconds)
        } else {
            info!("ℹ️ No recording manager available for cleanup");
            (None, None, None, None)
        };

    // Recording state was already cleared when the manager was taken out of
    // `RECORDING_MANAGER` (and via `RecordingState::cleanup()`/`stop_recording()`
    // internally) earlier in this shutdown sequence — nothing left to flip here.

    // Step 4.5: Finalise the meeting row (issue #57 slice 2) and prepare
    // metadata for the frontend. The row itself — title, transcripts,
    // status — is entirely Rust's; the frontend's post-stop save now only
    // ever touches fields it still owns (see `api_save_meeting_title`).
    let (folder_path_str, meeting_name_str) = match (&meeting_folder, &meeting_name) {
        (Some(path), Some(name)) => (Some(path.to_string_lossy().to_string()), Some(name.clone())),
        _ => (None, None),
    };

    info!("📤 Preparing recording metadata for frontend");
    info!("   folder_path: {:?}", folder_path_str);
    info!("   meeting_name: {:?}", meeting_name_str);
    info!("   meeting_id: {:?}", meeting_id_for_stop);

    if let Some(mid) = &meeting_id_for_stop {
        if let Some(pool) = db_pool(&app) {
            let result = if was_fatal_error {
                MeetingsRepository::mark_meeting_interrupted(&pool, mid)
                    .await
                    .map(|_| ())
            } else {
                MeetingsRepository::mark_meeting_completed(
                    &pool,
                    mid,
                    final_duration_seconds,
                    final_audio_path.as_deref(),
                )
                .await
                .map(|_| ())
            };
            match result {
                Ok(_) => info!(
                    "DB: meeting {} row finalised ({})",
                    mid,
                    if was_fatal_error { "interrupted" } else { "completed" }
                ),
                Err(e) => warn!("DB: failed to finalise meeting {} row: {}", mid, e),
            }
        } else {
            warn!(
                "No DB pool available; meeting {} row was not finalised",
                mid
            );
        }
    }

    // Step 5: Complete shutdown
    let _ = app.emit(
        "recording-shutdown-progress",
        serde_json::json!({
            "stage": "complete",
            "message": "Recording stopped successfully",
            "progress": 100
        }),
    );

    // Emit final stop event with folder_path, meeting_name and meeting_id.
    // The frontend no longer needs meeting_id to look up *whether* it has a
    // meeting to update — the row already exists — only to know which row.
    app.emit(
        "recording-stopped",
        serde_json::json!({
            "message": "Recording stopped",
            "folder_path": folder_path_str,
            "meeting_name": meeting_name_str,
            "meeting_id": meeting_id_for_stop
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect stopped state
    crate::tray::update_tray_menu(&app);
    // Canonical state machine: Finalising -> Idle, now that
    // `recording-stopped` has been emitted.
    emit_phase(&app, RecordingPhase::Idle);

    info!("🎉 Recording stopped successfully with ZERO transcript chunks lost");
    Ok(())
}

/// Check if recording is active. Single source of truth: reads through the
/// live `RecordingManager` (in turn backed by `RecordingState`'s own atomic)
/// rather than a separately-flipped flag, so it can never drift out of sync.
pub async fn is_recording() -> bool {
    RECORDING_MANAGER
        .lock()
        .unwrap()
        .as_ref()
        .map(|m| m.is_recording())
        .unwrap_or(false)
}

/// Get recording statistics
pub async fn get_transcription_status() -> TranscriptionStatus {
    TranscriptionStatus {
        chunks_in_queue: transcription::queue_depth(),
        is_processing: is_recording().await,
        last_activity_ms: 0,
    }
}

/// Pause the current recording
#[tauri::command]
pub async fn pause_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    info!("Pausing recording");

    // Check if currently recording
    if !is_recording().await {
        return Err("No recording is currently active".to_string());
    }

    // Access the recording manager and pause it. Scoped so the lock is
    // dropped before `emit_phase` below re-locks the same (non-reentrant)
    // static to read live duration data.
    {
        let manager_guard = RECORDING_MANAGER.lock().unwrap();
        match manager_guard.as_ref() {
            Some(manager) => manager.pause_recording().map_err(|e| e.to_string())?,
            None => return Err("No recording manager found".to_string()),
        }
    }

    // Emit pause event to frontend
    app.emit(
        "recording-paused",
        serde_json::json!({
            "message": "Recording paused"
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect paused state
    crate::tray::update_tray_menu(&app);
    emit_phase(&app, RecordingPhase::Paused);

    info!("Recording paused successfully");
    Ok(())
}

/// Resume the current recording
#[tauri::command]
pub async fn resume_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    info!("Resuming recording");

    // Check if currently recording
    if !is_recording().await {
        return Err("No recording is currently active".to_string());
    }

    // Access the recording manager and resume it. Scoped so the lock is
    // dropped before `emit_phase` below re-locks the same (non-reentrant)
    // static to read live duration data.
    {
        let manager_guard = RECORDING_MANAGER.lock().unwrap();
        match manager_guard.as_ref() {
            Some(manager) => manager.resume_recording().map_err(|e| e.to_string())?,
            None => return Err("No recording manager found".to_string()),
        }
    }

    // Emit resume event to frontend
    app.emit(
        "recording-resumed",
        serde_json::json!({
            "message": "Recording resumed"
        }),
    )
    .map_err(|e| e.to_string())?;

    // Update tray menu to reflect resumed state
    crate::tray::update_tray_menu(&app);
    emit_phase(&app, RecordingPhase::Recording);

    info!("Recording resumed successfully");
    Ok(())
}

/// Check if recording is currently paused
#[tauri::command]
pub async fn is_recording_paused() -> bool {
    let manager_guard = RECORDING_MANAGER.lock().unwrap();
    if let Some(manager) = manager_guard.as_ref() {
        manager.is_paused()
    } else {
        false
    }
}

/// Get detailed recording state
#[tauri::command]
pub async fn get_recording_state() -> serde_json::Value {
    let (
        is_recording_flag,
        is_paused_flag,
        is_active_flag,
        recording_duration,
        active_duration,
        total_pause_duration,
        current_pause_duration,
    ) = {
        let manager_guard = RECORDING_MANAGER.lock().unwrap();
        match manager_guard.as_ref() {
            Some(manager) => (
                manager.is_recording(),
                manager.is_paused(),
                manager.is_active(),
                manager.get_recording_duration(),
                manager.get_active_recording_duration(),
                manager.get_total_pause_duration(),
                manager.get_current_pause_duration(),
            ),
            None => (false, false, false, None, None, 0.0, None),
        }
    };
    let chunks_in_queue = transcription::queue_depth();

    // The canonical snapshot (phase, started_at_ms, meeting_name,
    // folder_path, error, seq) merged with the live duration/queue data
    // above — the same fields `recording-state` events carry, so a fresh
    // window/tab that only calls this once on mount gets exactly what it
    // would have received had it been listening from the start.
    let snapshot = recording_phase::build_snapshot(active_duration, total_pause_duration, chunks_in_queue);

    let mut value = serde_json::to_value(&snapshot).unwrap_or_else(|_| serde_json::json!({}));
    if let serde_json::Value::Object(map) = &mut value {
        // Legacy keys kept for compatibility with existing callers.
        map.insert("is_recording".to_string(), serde_json::json!(is_recording_flag));
        map.insert(
            "is_finalising".to_string(),
            serde_json::json!(is_stop_in_progress()),
        );
        map.insert("is_paused".to_string(), serde_json::json!(is_paused_flag));
        map.insert("is_active".to_string(), serde_json::json!(is_active_flag));
        map.insert(
            "recording_duration".to_string(),
            serde_json::json!(recording_duration),
        );
        map.insert(
            "active_duration".to_string(),
            serde_json::json!(active_duration),
        );
        map.insert(
            "total_pause_duration".to_string(),
            serde_json::json!(total_pause_duration),
        );
        map.insert(
            "current_pause_duration".to_string(),
            serde_json::json!(current_pause_duration),
        );
    }
    value
}

/// Get the meeting folder path for the current recording
/// Returns the path if a meeting name was set and folder structure initialized
#[tauri::command]
pub async fn get_meeting_folder_path() -> Result<Option<String>, String> {
    let manager_guard = RECORDING_MANAGER.lock().unwrap();
    if let Some(manager) = manager_guard.as_ref() {
        Ok(manager
            .get_meeting_folder()
            .map(|p| p.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

/// Get accumulated transcript segments from current recording session
/// Used for syncing frontend state after page reload during active recording
#[tauri::command]
pub async fn get_transcript_history(
) -> Result<Vec<crate::audio::recording_saver::TranscriptSegment>, String> {
    let manager_guard = RECORDING_MANAGER.lock().unwrap();

    if let Some(manager) = manager_guard.as_ref() {
        Ok(manager.get_transcript_segments())
    } else {
        Ok(Vec::new()) // No recording active, return empty
    }
}

/// Get meeting name from current recording session
/// Used for syncing frontend state after page reload during active recording
#[tauri::command]
pub async fn get_recording_meeting_name() -> Result<Option<String>, String> {
    let manager_guard = RECORDING_MANAGER.lock().unwrap();

    if let Some(manager) = manager_guard.as_ref() {
        Ok(manager.get_meeting_name())
    } else {
        Ok(None)
    }
}

// Device disconnect/reconnect polling was removed with the move to
// native PipeWire capture: streams target nodes by name and the graph
// reroutes/renegotiates on device changes without app involvement.

/// Kick off the post-meeting auto-refine pass for a just-saved meeting.
///
/// `stop_recording` itself never has a `meeting_id` — the `meetings` row
/// (and its id) is only created afterward by the frontend's
/// `api_save_transcript` call once the live transcript has streamed in and
/// the user confirms the save. So the frontend calls this command right
/// after that save succeeds, passing the freshly-minted `meeting_id`
/// alongside the `meeting_folder_path` it already has from the
/// `recording-stopped` event.
///
/// Returns immediately — the actual refine work (decode, VAD, batch
/// transcribe, diarize, DB write) runs in its own background tokio task via
/// `retranscription::spawn_auto_refine`, so this never blocks the UI. All
/// skip/failure reasons are logged there and surfaced only via the
/// `meeting-refining` / `meeting-refined` / `meeting-refine-failed` events.
///
/// Two passes run here, in a deliberate order inside one background task:
///
/// 1. **Speaker refinement** — re-clusters the live session's embeddings
///    offline and rewrites `speaker` labels in place (fast: in-memory
///    clustering plus a handful of UPDATEs).
/// 2. **Transcription auto-refine** — optionally re-transcribes the whole
///    meeting with a higher-accuracy model.
///
/// The order is load-bearing, and they must not overlap. Auto-refine
/// `DELETE`s every transcript row for the meeting and re-`INSERT`s from its
/// own batch pass; running speaker refinement concurrently would race that,
/// with its UPDATEs landing on rows about to be deleted. It also installs
/// its batch diarizer as the process-wide `current_diarizer`, which would
/// swap the history out from under a concurrent refinement. Running speaker
/// refinement first, awaited, avoids both: it reads the live diarizer and
/// finishes before auto-refine can touch anything.
///
/// When auto-refine does run, it re-diarizes from scratch and supersedes
/// pass 1's labels — which is fine and intended: batch diarization over the
/// full audio is strictly better than re-clustering the live embeddings.
/// Pass 1 is what makes the common case good, since auto-refine skips
/// whenever no higher-accuracy model is downloaded.
#[tauri::command]
pub async fn trigger_post_meeting_refine<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    meeting_folder_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        // Never let a speaker-refinement failure block the transcription
        // pass — they're independent improvements to the same meeting.
        if let Err(e) =
            crate::speaker_diarization::commands::refine_and_persist(&app, &meeting_id).await
        {
            log::warn!(
                "Speaker refinement failed for meeting {}: {} (transcript labels left as recorded)",
                meeting_id,
                e
            );
        }

        super::retranscription::spawn_auto_refine(app, meeting_id, meeting_folder_path);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::recording_saver::TranscriptSegment;

    fn segment(id: &str, sequence_id: u64) -> TranscriptSegment {
        TranscriptSegment {
            id: id.to_string(),
            text: format!("text for {}", id),
            timestamp: None,
            audio_start_time: None,
            audio_end_time: None,
            duration: None,
            display_time: None,
            confidence: None,
            sequence_id: Some(sequence_id),
            speaker: None,
            voice_profile_id: None,
            source: None,
        }
    }

    // Issue #25: segments buffered while the manager was out of
    // RECORDING_MANAGER must be replayed into it, in arrival order, and the
    // buffer must end up empty so nothing is replayed twice.
    #[test]
    fn replay_buffered_segments_drains_in_order_into_manager() {
        let manager = RecordingManager::new();
        let mut buffer = vec![segment("seg_1", 1), segment("seg_2", 2), segment("seg_3", 3)];

        replay_buffered_segments(&mut buffer, &manager);

        assert!(buffer.is_empty(), "buffer should be fully drained");
        let stored = manager.get_transcript_segments();
        let ids: Vec<&str> = stored.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, vec!["seg_1", "seg_2", "seg_3"]);
    }

    #[test]
    fn replay_buffered_segments_is_a_noop_on_empty_buffer() {
        let manager = RecordingManager::new();
        let mut buffer: Vec<TranscriptSegment> = Vec::new();

        replay_buffered_segments(&mut buffer, &manager);

        assert!(buffer.is_empty());
        assert!(manager.get_transcript_segments().is_empty());
    }
}
