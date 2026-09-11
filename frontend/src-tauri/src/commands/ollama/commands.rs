//! Tauri commands wrapping the Tauri-free Ollama client in `client.rs`.

use crate::ollama::client;
use tauri::{command, AppHandle, Runtime};

pub use client::{DownloadProgress, OllamaModel};

#[command]
pub async fn get_ollama_models(endpoint: Option<String>) -> Result<Vec<OllamaModel>, String> {
    client::get_ollama_models(endpoint).await
}

#[command]
pub async fn pull_ollama_model<R: Runtime>(
    app_handle: AppHandle<R>,
    model_name: String,
    endpoint: Option<String>,
) -> Result<(), String> {
    client::pull_ollama_model_with_progress(
        crate::tauri_events::shared_sink(&app_handle),
        model_name,
        endpoint,
    )
    .await
}

#[command]
pub async fn delete_ollama_model(
    model_name: String,
    endpoint: Option<String>,
) -> Result<(), String> {
    client::delete_ollama_model(model_name, endpoint).await
}

/// Get the context size for a specific Ollama model.
///
/// This command fetches model metadata and returns the context size.
/// Results are cached for 5 minutes to avoid repeated API calls.
#[command]
pub async fn get_ollama_model_context(
    model_name: String,
    endpoint: Option<String>,
) -> Result<usize, String> {
    client::get_ollama_model_context(model_name, endpoint).await
}
