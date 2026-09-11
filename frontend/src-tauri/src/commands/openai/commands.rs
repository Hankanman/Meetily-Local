use crate::openai::openai::{self, OpenAIModel};
use tauri::command;

/// Fetch OpenAI models from API
///
/// # Arguments
/// * `api_key` - OpenAI API key
///
/// # Returns
/// Vector of available models, or fallback models on error
#[command]
pub async fn get_openai_models(api_key: Option<String>) -> Result<Vec<OpenAIModel>, String> {
    openai::get_openai_models(api_key).await
}
