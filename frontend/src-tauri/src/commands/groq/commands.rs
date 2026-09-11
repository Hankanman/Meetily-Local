use crate::groq::groq::{self, GroqModel};
use tauri::command;

/// Fetch Groq models from API
///
/// # Arguments
/// * `api_key` - Groq API key
///
/// # Returns
/// Vector of available models, or fallback models on error
#[command]
pub async fn get_groq_models(api_key: Option<String>) -> Result<Vec<GroqModel>, String> {
    groq::get_groq_models(api_key).await
}
