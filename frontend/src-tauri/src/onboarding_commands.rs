//! Tauri command wrappers for onboarding status. Core logic (loading,
//! saving, resetting, legacy JSON import) lives in `onboarding`.

use log::{error, info};
use tauri::{AppHandle, Manager, Runtime};

use crate::config::DEFAULT_WHISPER_MODEL;
use crate::database::repositories::setting::SettingsRepository;
use crate::onboarding::{
    self, fetch_onboarding_status, load_onboarding_status, reset_onboarding_status,
    save_onboarding_status, OnboardingStatus,
};
use crate::state::AppState;

/// Fetch the SQLite pool, if `AppState` has been managed yet. `None` early
/// in startup — e.g. on a first-launch cold start, before the frontend has
/// created the database via `initialize_fresh_database` /
/// `import_and_initialize_database`.
fn db_pool<R: Runtime>(app: &AppHandle<R>) -> Option<sqlx::SqlitePool> {
    app.try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone())
}

#[tauri::command]
pub async fn get_onboarding_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<OnboardingStatus>, String> {
    fetch_onboarding_status(db_pool(&app))
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))
}

#[tauri::command]
pub async fn save_onboarding_status_cmd<R: Runtime>(
    app: AppHandle<R>,
    status: OnboardingStatus,
) -> Result<(), String> {
    save_onboarding_status(db_pool(&app), &status)
        .await
        .map_err(|e| format!("Failed to save onboarding status: {}", e))
}

#[tauri::command]
pub async fn reset_onboarding_status_cmd<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    reset_onboarding_status(db_pool(&app))
        .await
        .map_err(|e| format!("Failed to reset onboarding status: {}", e))
}

#[tauri::command]
pub async fn complete_onboarding<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    model: String,
) -> Result<(), String> {
    info!("Completing onboarding with builtin-ai model: {}", model);

    // Step 1: Save model configuration to SQLite database FIRST
    let pool = state.db_manager.pool();

    // Onboarding always uses builtin-ai (local LLM)
    if let Err(e) =
        SettingsRepository::save_model_config(pool, "builtin-ai", &model, "large-v3", None).await
    {
        error!("Failed to save builtin-ai model config: {}", e);
        return Err(format!("Failed to save builtin-ai model config: {}", e));
    }
    info!("Saved builtin-ai model config: model={}", model);

    // Save transcription model config — local Whisper is the default ASR engine.
    if let Err(e) =
        SettingsRepository::save_transcript_config(pool, "localWhisper", DEFAULT_WHISPER_MODEL)
            .await
    {
        error!("Failed to save transcription model config: {}", e);
        return Err(format!("Failed to save transcription model config: {}", e));
    }
    info!(
        "Saved transcription model config: provider=localWhisper, model={}",
        DEFAULT_WHISPER_MODEL
    );

    // Step 2: Only NOW mark onboarding as complete (after DB operations succeed)
    let mut status = load_onboarding_status(db_pool(&app))
        .await
        .map_err(|e| format!("Failed to load onboarding status: {}", e))?;

    status.completed = true;
    status.current_step = 4; // Max step (4 on macOS with permissions, 3 on other platforms)
    status.model_status.transcription = "downloaded".to_string();
    status.model_status.summary = "downloaded".to_string();

    save_onboarding_status(db_pool(&app), &status)
        .await
        .map_err(|e| format!("Failed to save completed onboarding status: {}", e))?;

    info!("Onboarding completed successfully with model: {}", model);
    Ok(())
}

/// Shell-side helper for `tray.rs`: resolve the pool from a live `AppHandle`
/// and load onboarding status through the Tauri-free core.
pub async fn load_onboarding_status_for_app<R: Runtime>(
    app: &AppHandle<R>,
) -> anyhow::Result<OnboardingStatus> {
    onboarding::load_onboarding_status(db_pool(app)).await
}
