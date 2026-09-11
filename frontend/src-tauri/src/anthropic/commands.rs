use crate::anthropic::anthropic::{self, AnthropicModel};
use tauri::command;

/// Fetch Anthropic models from API
///
/// # Arguments
/// * `api_key` - Anthropic API key
///
/// # Returns
/// Vector of available models, or fallback models on error
#[command]
pub async fn get_anthropic_models(api_key: Option<String>) -> Result<Vec<AnthropicModel>, String> {
    anthropic::get_anthropic_models(api_key).await
}
