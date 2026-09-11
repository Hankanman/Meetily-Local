use crate::openrouter::openrouter::{self, OpenRouterModel};
use tauri::command;

/// Fetch OpenRouter models from API (public endpoint, no API key required).
///
/// # Returns
/// Vector of available models, or fallback models on error
#[command]
pub async fn get_openrouter_models() -> Result<Vec<OpenRouterModel>, String> {
    openrouter::get_openrouter_models().await
}
