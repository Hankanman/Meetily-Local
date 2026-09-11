//! Tauri command wrappers for audio retranscription. Core logic (decoding,
//! VAD, transcription, DB writes) lives in `audio::retranscription`.

use std::sync::atomic::Ordering;

use log::error;
use tauri::{AppHandle, Manager, Runtime};

use crate::audio::retranscription::{
    cancel_retranscription, is_retranscription_in_progress, start_retranscription_with,
    RetranscriptionResult, RetranscriptionStarted, RETRANSCRIPTION_IN_PROGRESS,
};
use crate::state::AppState;

/// Start retranscription of a meeting's audio: resolves the event sink and
/// DB pool from a live `AppHandle`, then delegates to the Tauri-free core.
pub async fn start_retranscription<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    meeting_folder_path: String,
    language: Option<String>,
    model: Option<String>,
    provider: Option<String>,
) -> anyhow::Result<RetranscriptionResult> {
    let pool = app
        .try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone());
    start_retranscription_with(
        crate::tauri_events::shared_sink(&app),
        pool,
        meeting_id,
        meeting_folder_path,
        language,
        model,
        provider,
    )
    .await
}

// Start retranscription (Beta gated using configContext.betaFeatures)
#[tauri::command]
pub async fn start_retranscription_command<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    meeting_folder_path: String,
    language: Option<String>,
    model: Option<String>,
    provider: Option<String>,
) -> Result<RetranscriptionStarted, String> {
    // Check if retranscription is already in progress (guard will be acquired in start_retranscription)
    if RETRANSCRIPTION_IN_PROGRESS.load(Ordering::SeqCst) {
        return Err("Retranscription already in progress".to_string());
    }

    // Clone values for the spawned task
    let meeting_id_clone = meeting_id.clone();

    // Spawn the retranscription in a background task
    tauri::async_runtime::spawn(async move {
        let result = start_retranscription(
            app,
            meeting_id_clone,
            meeting_folder_path,
            language,
            model,
            provider,
        )
        .await;

        // Errors are already emitted as events in start_retranscription
        // so we just log here for debugging
        if let Err(e) = result {
            error!("Retranscription failed: {}", e);
        }
    });

    Ok(RetranscriptionStarted {
        meeting_id,
        message: "Retranscription started".to_string(),
    })
}

#[tauri::command]
pub async fn cancel_retranscription_command() -> Result<(), String> {
    if !is_retranscription_in_progress() {
        return Err("No retranscription in progress".to_string());
    }
    cancel_retranscription();
    Ok(())
}

#[tauri::command]
pub async fn is_retranscription_in_progress_command() -> bool {
    is_retranscription_in_progress()
}
