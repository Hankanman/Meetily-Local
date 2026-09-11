// audio/recording_commands.rs
//
// Slim Tauri command layer for recording functionality. All orchestration
// (start/stop/pause/resume, the fatal-error auto-stop, meeting-row
// lifecycle, transcript persistence wiring) lives in `recording_service`,
// which depends only on a `RecordingContext` (an event sink + an optional DB
// pool) instead of an `AppHandle`. This module's job is just to:
//
//   1. build that context (and, for `start`, the two hooks it still needs)
//      from the live `AppHandle`/`AppState`, and
//   2. register the actual `#[tauri::command]` entry points the frontend
//      calls, each a one-line delegation into the service.
//
// See `recording_service.rs` for the orchestration itself and the ordering
// guarantees (issues #24, #25, #26, #57 slice 2) it preserves.

use tauri::{AppHandle, Manager, Runtime};

use super::recording_service::{self, RecordingContext, StartHooks, StartRequest};
use crate::events::{EventSink, SharedEventSink};
use crate::state::AppState;

// Import transcription modules
use super::transcription;

// Re-export TranscriptUpdate for backward compatibility
pub use super::transcription::TranscriptUpdate;

// Re-export the service's public types/functions under their historical
// `recording_commands::` path — every other module in the crate (tray.rs,
// lib.rs, audio/common.rs, retranscription.rs, import.rs,
// speaker_diarization/enrollment.rs, summary/live_action_items.rs) reaches
// these through `audio::recording_commands::*` or the `audio::*` re-export
// in `audio/mod.rs`.
pub use recording_service::{
    is_recording, is_stop_in_progress, snapshot_segments, RecordingArgs, TranscriptionStatus,
};

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

/// Forwards every event to the wrapped `AppHandle` like a plain
/// `events::shared_sink`, and additionally refreshes the tray menu whenever
/// it sees a `recording-state` event. This is how tray refresh is driven now
/// that orchestration lives in `recording_service` (which has no `AppHandle`
/// and so cannot call `tray::update_tray_menu` itself): every phase
/// transition in the service already goes through one `emit_phase` call
/// (`recording_phase::set_phase`, which emits `recording-state`), so hanging
/// the refresh off that one event covers start/stop/pause/resume/error
/// uniformly instead of scattering `update_tray_menu` calls through the
/// service at each call site that used to have one. `update_tray_menu`
/// itself queries current state fresh (async, ~100ms debounce) and is cheap
/// to call more often than strictly necessary, so the extra refreshes on
/// transient phases (Starting/Stopping/Finalising) that the old call-site
/// list didn't trigger are harmless.
struct TrayRefreshingSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> EventSink for TrayRefreshingSink<R> {
    fn emit_value(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        let result = self.app.emit_value(event, payload);
        if event == "recording-state" {
            crate::tray::update_tray_menu(&self.app);
        }
        result
    }
}

/// Build the Tauri-free context `recording_service` needs, from the live
/// `AppHandle`.
fn build_context<R: Runtime>(app: &AppHandle<R>) -> RecordingContext {
    let sink: SharedEventSink = std::sync::Arc::new(TrayRefreshingSink { app: app.clone() });
    RecordingContext::new(sink, db_pool(app))
}

/// Build the two shell-side hooks `recording_service::start` needs mid-flow.
///
/// `// TODO(WP-E reconcile)`: `transcription::validate_transcription_model_ready`
/// and `speaker_diarization::commands::try_init_for_recording` still take an
/// `AppHandle` on this branch; another work package (WP-E) is converting
/// both to Tauri-free signatures concurrently. Once that lands, drop these
/// two hooks and call the functions directly from `recording_service::start`
/// instead of through this closure indirection.
fn build_start_hooks<R: Runtime>(app: &AppHandle<R>) -> StartHooks {
    let app_for_validate = app.clone();
    let app_for_diarizer = app.clone();
    StartHooks {
        validate_transcription_model: Box::new(move || {
            Box::pin(async move {
                transcription::validate_transcription_model_ready(&app_for_validate).await
            })
        }),
        init_speaker_diarizer: Box::new(move || {
            Box::pin(async move {
                crate::speaker_diarization::commands::try_init_for_recording(&app_for_diarizer)
                    .await
                    .map_err(|e| e.to_string())
            })
        }),
    }
}

async fn start_recording_impl<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    let ctx = build_context(&app);
    let hooks = build_start_hooks(&app);
    recording_service::start(
        ctx,
        hooks,
        StartRequest {
            mic_device_name,
            system_device_name,
            meeting_name,
        },
    )
    .await
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
    start_recording_impl(app, None, None, meeting_name).await
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
    start_recording_impl(app, mic_device_name, system_device_name, meeting_name).await
}

/// Stop recording with optimized graceful shutdown ensuring NO transcript chunks are lost
pub async fn stop_recording<R: Runtime>(
    app: AppHandle<R>,
    args: RecordingArgs,
) -> Result<(), String> {
    let ctx = build_context(&app);
    recording_service::stop(ctx, args).await
}

/// Get recording statistics
pub async fn get_transcription_status() -> TranscriptionStatus {
    recording_service::get_transcription_status().await
}

/// Pause the current recording
#[tauri::command]
pub async fn pause_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let ctx = build_context(&app);
    recording_service::pause_recording(&ctx).await
}

/// Resume the current recording
#[tauri::command]
pub async fn resume_recording<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let ctx = build_context(&app);
    recording_service::resume_recording(&ctx).await
}

/// Check if recording is currently paused
#[tauri::command]
pub async fn is_recording_paused() -> bool {
    recording_service::is_recording_paused().await
}

/// Get detailed recording state
#[tauri::command]
pub async fn get_recording_state() -> serde_json::Value {
    recording_service::get_recording_state().await
}

/// Get the meeting folder path for the current recording
/// Returns the path if a meeting name was set and folder structure initialized
#[tauri::command]
pub async fn get_meeting_folder_path() -> Result<Option<String>, String> {
    recording_service::get_meeting_folder_path().await
}

/// Get accumulated transcript segments from current recording session
/// Used for syncing frontend state after page reload during active recording
#[tauri::command]
pub async fn get_transcript_history(
) -> Result<Vec<crate::audio::recording_saver::TranscriptSegment>, String> {
    recording_service::get_transcript_history().await
}

/// Get meeting name from current recording session
/// Used for syncing frontend state after page reload during active recording
#[tauri::command]
pub async fn get_recording_meeting_name() -> Result<Option<String>, String> {
    recording_service::get_recording_meeting_name().await
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
    // `recording_service`'s own test module covers the orchestration logic
    // that used to live here (replay_buffered_segments, PhaseGuard,
    // begin_start_phase). Nothing left in this thin command layer is worth
    // unit-testing on its own — it's one-line delegation plus Tauri
    // plumbing (AppHandle -> RecordingContext/StartHooks) that needs a real
    // AppHandle to exercise meaningfully.
}
