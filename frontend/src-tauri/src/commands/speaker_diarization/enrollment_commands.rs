//! Tauri command wrappers for self-voice enrollment. Core logic lives in
//! `speaker_diarization::enrollment`.

use tauri::{command, AppHandle, Manager, Runtime};

use crate::speaker_diarization::enrollment::{
    cancel_self_voice_enrollment as cancel_self_voice_enrollment_core,
    delete_self_voice_profile_with_pool, finish_self_voice_enrollment_with_pool,
    rename_self_voice_profile_with_pool, self_voice_status_with_pool,
    start_self_voice_enrollment_with_sink, SelfVoiceStatus,
};
use crate::state::AppState;

/// Begin capturing the user's voice from `mic_device` (a PipeWire node id, or
/// `None`/`"default"` for the system default source).
#[command]
pub async fn start_self_voice_enrollment<R: Runtime>(
    app: AppHandle<R>,
    mic_device: Option<String>,
) -> Result<(), String> {
    start_self_voice_enrollment_with_sink(crate::tauri_events::shared_sink(&app), mic_device).await
}

/// Discard an in-progress enrollment capture. Safe to call when nothing is
/// running.
#[command]
pub async fn cancel_self_voice_enrollment() -> Result<(), String> {
    cancel_self_voice_enrollment_core().await
}

/// Stop capturing and turn the recording into the self voice profile,
/// replacing any previous one. Returns the resulting status.
#[command]
pub async fn finish_self_voice_enrollment<R: Runtime>(
    app: AppHandle<R>,
    name: Option<String>,
) -> Result<SelfVoiceStatus, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    finish_self_voice_enrollment_with_pool(state.db_manager.pool(), name).await
}

/// Rename the enrolled self profile without re-recording. A blank name resets
/// the label to "Me". Returns the updated status.
#[command]
pub async fn rename_self_voice_profile<R: Runtime>(
    app: AppHandle<R>,
    name: String,
) -> Result<SelfVoiceStatus, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    rename_self_voice_profile_with_pool(state.db_manager.pool(), name).await
}

/// Whether the user has enrolled their voice, plus enough detail for the
/// settings screen to describe it.
#[command]
pub async fn self_voice_status<R: Runtime>(app: AppHandle<R>) -> Result<SelfVoiceStatus, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    self_voice_status_with_pool(state.db_manager.pool()).await
}

/// Delete the enrolled self profile. Past transcripts keep their "Me" labels
/// (the text is still true) but stop being linked to the profile; future
/// meetings fall back to clustering the user as "Speaker N" again.
#[command]
pub async fn delete_self_voice_profile<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState unavailable".to_string())?;
    delete_self_voice_profile_with_pool(state.db_manager.pool()).await
}
