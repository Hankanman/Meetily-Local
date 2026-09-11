use crate::whisper_engine::models;
use crate::whisper_engine::ModelInfo;
use tauri::command;

// Re-export core state/logic so existing `whisper_engine::commands::WHISPER_ENGINE`-style
// paths (used across the audio module and elsewhere) keep working unchanged.
pub use models::{
    discover_models_standalone, download_model_with_progress, get_models_directory,
    set_models_directory, whisper_validate_model_ready_with_config, WHISPER_ENGINE,
};

#[command]
pub async fn whisper_init() -> Result<(), String> {
    models::whisper_init().await
}

#[command]
pub async fn whisper_get_available_models() -> Result<Vec<ModelInfo>, String> {
    models::whisper_get_available_models().await
}

#[command]
pub async fn whisper_has_available_models() -> Result<bool, String> {
    models::whisper_has_available_models().await
}

#[command]
pub async fn whisper_get_models_directory() -> Result<String, String> {
    models::whisper_get_models_directory().await
}

#[command]
pub async fn whisper_download_model(
    app_handle: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    models::download_model_with_progress(crate::tauri_events::shared_sink(&app_handle), model_name)
        .await
}

#[command]
pub async fn whisper_cancel_download(model_name: String) -> Result<(), String> {
    models::whisper_cancel_download(model_name).await
}

#[command]
pub async fn whisper_delete_corrupted_model(model_name: String) -> Result<String, String> {
    models::whisper_delete_corrupted_model(model_name).await
}

/// Open the models folder in the system file explorer
#[command]
pub async fn open_models_folder() -> Result<(), String> {
    models::open_models_folder_path().map(|_| ())
}
