// Tauri commands for built-in AI model management
// Exposes model download, status, and management functionality to frontend

use tauri::{AppHandle, Runtime, State};

use crate::events::EventSinkExt;

use super::model_manager::ModelInfo;
use super::service;

// Re-export core state/logic so existing
// `summary_engine::{init_model_manager, ModelManagerState}`-style paths keep
// working unchanged.
pub use service::{
    init_model_manager, init_model_manager_at_startup, ModelManagerState,
};

// ============================================================================
// Tauri Commands
// ============================================================================

/// List all available built-in AI models with their status
#[tauri::command]
pub async fn builtin_ai_list_models<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
) -> Result<Vec<ModelInfo>, String> {
    let manager = service::ensure_manager(&state.0).await?;
    Ok(manager.list_models().await)
}

/// Get information about a specific model
#[tauri::command]
pub async fn builtin_ai_get_model_info<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
    model_name: String,
) -> Result<Option<ModelInfo>, String> {
    let manager = service::ensure_manager(&state.0).await?;
    Ok(manager.get_model_info(&model_name).await)
}

/// Download a built-in AI model with progress updates
#[tauri::command]
pub async fn builtin_ai_download_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
    model_name: String,
) -> Result<(), String> {
    let manager = service::ensure_manager(&state.0).await?;
    service::download_builtin_ai_model(manager, model_name, crate::events::shared_sink(&app)).await
}

/// Cancel an ongoing model download
#[tauri::command]
pub async fn builtin_ai_cancel_download<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
    model_name: String,
) -> Result<(), String> {
    let manager = {
        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone()
    };

    manager
        .cancel_download(&model_name)
        .await
        .map_err(|e| e.to_string())?;

    let _ = crate::events::shared_sink(&app).emit_event(
        "builtin-ai-download-progress",
        &serde_json::json!({
            "model": model_name,
            "progress": 0,
            "status": "cancelled"
        }),
    );

    Ok(())
}

/// Delete a corrupted or available model file
#[tauri::command]
pub async fn builtin_ai_delete_model(
    state: State<'_, ModelManagerState>,
    model_name: String,
) -> Result<(), String> {
    let manager = {
        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone()
    };

    manager
        .delete_model(&model_name)
        .await
        .map_err(|e| e.to_string())
}

/// Check if a model is ready to use
#[tauri::command]
pub async fn builtin_ai_is_model_ready<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
    model_name: String,
    refresh: Option<bool>, // NEW: Optional refresh parameter
) -> Result<bool, String> {
    let manager = service::ensure_manager(&state.0).await?;

    let refresh_scan = refresh.unwrap_or(false);
    let ready = manager.is_model_ready(&model_name, refresh_scan).await;

    log::info!(
        "Model '{}' ready check (refresh={}): {}",
        model_name,
        refresh_scan,
        ready
    );

    Ok(ready)
}

/// Check if any summary model is available (for onboarding)
/// Returns the first available model name by priority, or None if no models exist
#[tauri::command]
pub async fn builtin_ai_get_available_summary_model<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
) -> Result<Option<String>, String> {
    let manager = service::ensure_manager(&state.0).await?;
    service::get_available_summary_model(&manager).await
}

/// Get recommended summary model based on system RAM
#[tauri::command]
pub async fn builtin_ai_get_recommended_model() -> Result<String, String> {
    service::get_recommended_model()
}
