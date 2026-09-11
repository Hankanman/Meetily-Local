// Tauri commands for built-in AI model management
// Exposes model download, status, and management functionality to frontend

use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tokio::sync::Mutex;

use crate::events::{EventSinkExt, SharedEventSink};

use super::model_manager::{DownloadProgress, ModelInfo, ModelManager};

// ============================================================================
// Global State
// ============================================================================

/// Global model manager instance
pub struct ModelManagerState(pub Arc<Mutex<Option<Arc<ModelManager>>>>);

/// Initialize the model manager, writing the result into `manager_state`
/// (the shared slot backing [`ModelManagerState`]).
pub async fn init_model_manager(
    manager_state: &Arc<Mutex<Option<Arc<ModelManager>>>>,
) -> anyhow::Result<()> {
    let models_dir = crate::paths::app_data_dir()
        .map_err(|e| anyhow::anyhow!(e))?
        .join("models")
        .join("summary");

    let manager = ModelManager::new_with_models_dir(Some(models_dir))?;
    manager.init().await?;

    let mut manager_lock = manager_state.lock().await;
    *manager_lock = Some(Arc::new(manager));

    log::info!("Built-in AI model manager initialized");
    Ok(())
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// List all available built-in AI models with their status
#[tauri::command]
pub async fn builtin_ai_list_models<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
) -> Result<Vec<ModelInfo>, String> {
    let manager = {
        // Ensure manager is initialized
        {
            let manager_lock = state.0.lock().await;
            if manager_lock.is_none() {
                drop(manager_lock);
                init_model_manager(&state.0)
                    .await
                    .map_err(|e| format!("Failed to initialize model manager: {}", e))?;
            }
        }

        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone()
    };

    let models = manager.list_models().await;
    Ok(models)
}

/// Get information about a specific model
#[tauri::command]
pub async fn builtin_ai_get_model_info<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
    model_name: String,
) -> Result<Option<ModelInfo>, String> {
    let manager = {
        // Ensure manager is initialized
        {
            let manager_lock = state.0.lock().await;
            if manager_lock.is_none() {
                drop(manager_lock);
                init_model_manager(&state.0)
                    .await
                    .map_err(|e| format!("Failed to initialize model manager: {}", e))?;
            }
        }

        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone()
    };

    let info = manager.get_model_info(&model_name).await;
    Ok(info)
}

/// Download `model_name` into `manager`, reporting progress through `sink`
/// via `builtin-ai-download-progress` (status `downloading` while running,
/// then a final `completed` or `error` event) — the same events the command
/// previously emitted directly through the `AppHandle`.
pub async fn download_builtin_ai_model(
    manager: Arc<ModelManager>,
    model_name: String,
    sink: SharedEventSink,
) -> Result<(), String> {
    // IMPORTANT: Only emit "downloading" status here, never "completed"
    // Completion event is emitted AFTER download task fully finishes (validation, etc.)
    let progress_sink = sink.clone();
    let model_name_clone = model_name.clone();
    let progress_callback = Box::new(move |progress: DownloadProgress| {
        let _ = progress_sink.emit_event(
            "builtin-ai-download-progress",
            &serde_json::json!({
                "model": model_name_clone,
                "progress": progress.percent,
                "downloaded_mb": progress.downloaded_mb,
                "total_mb": progress.total_mb,
                "speed_mbps": progress.speed_mbps,
                "status": "downloading"  // Always "downloading", never "completed" from progress callback
            }),
        );
    });

    match manager
        .download_model_detailed(&model_name, Some(progress_callback))
        .await
    {
        Ok(_) => {
            // Download task completed successfully (validation passed, status set to Available)
            let _ = sink.emit_event(
                "builtin-ai-download-progress",
                &serde_json::json!({
                    "model": model_name,
                    "progress": 100,
                    "downloaded_mb": 0,  // Not used by completion handler
                    "total_mb": 0,       // Not used by completion handler
                    "speed_mbps": 0,     // Not used by completion handler
                    "status": "completed"
                }),
            );
            Ok(())
        }
        Err(e) => {
            let error_msg = e.to_string();

            // Check if this is a cancellation error (marked with "CANCELLED:" prefix)
            // Don't emit error event for cancellations - cancel command already emits cancelled event
            if !error_msg.starts_with("CANCELLED:") {
                // Emit error via progress event for frontend to display (only for real errors)
                let _ = sink.emit_event(
                    "builtin-ai-download-progress",
                    &serde_json::json!({
                        "model": model_name,
                        "progress": 0,
                        "downloaded_mb": 0,
                        "total_mb": 0,
                        "speed_mbps": 0,
                        "status": "error",
                        "error": error_msg
                    }),
                );
            }
            Err(error_msg)
        }
    }
}

/// Download a built-in AI model with progress updates
#[tauri::command]
pub async fn builtin_ai_download_model<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ModelManagerState>,
    model_name: String,
) -> Result<(), String> {
    let manager = {
        // Ensure manager is initialized
        {
            let manager_lock = state.0.lock().await;
            if manager_lock.is_none() {
                drop(manager_lock);
                init_model_manager(&state.0)
                    .await
                    .map_err(|e| format!("Failed to initialize model manager: {}", e))?;
            }
        }

        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone() // Clone the Arc, not the ModelManager
    };

    download_builtin_ai_model(manager, model_name, crate::events::shared_sink(&app)).await
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
    let manager = {
        // Ensure manager is initialized
        {
            let manager_lock = state.0.lock().await;
            if manager_lock.is_none() {
                drop(manager_lock);
                init_model_manager(&state.0)
                    .await
                    .map_err(|e| format!("Failed to initialize model manager: {}", e))?;
            }
        }

        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone()
    };

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
    let manager = {
        // Ensure manager is initialized
        {
            let manager_lock = state.0.lock().await;
            if manager_lock.is_none() {
                drop(manager_lock);
                init_model_manager(&state.0)
                    .await
                    .map_err(|e| format!("Failed to initialize model manager: {}", e))?;
            }
        }

        let manager_lock = state.0.lock().await;
        manager_lock
            .as_ref()
            .ok_or_else(|| "Model manager not initialized".to_string())?
            .clone()
    };

    // Force fresh scan to ensure accurate state
    manager
        .scan_models()
        .await
        .map_err(|e| format!("Failed to scan models: {}", e))?;

    // Get all available models
    let all_models = manager.list_models().await;

    // Find first available summary model
    let available = all_models
        .iter()
        .filter(|m| {
            matches!(
                m.status,
                crate::summary::summary_engine::model_manager::ModelStatus::Available
            )
        })
        .max_by_key(|m| match m.name.as_str() {
            "gemma3:4b" => 2,
            "gemma3:1b" => 1,
            _ => 0,
        })
        .map(|m| m.name.clone());

    log::info!("Available summary model check: {:?}", available);
    Ok(available)
}

// ============================================================================
// Startup Initialization & Utility Commands
// ============================================================================

pub async fn init_model_manager_at_startup(
    manager_state: &Arc<Mutex<Option<Arc<ModelManager>>>>,
) -> Result<(), String> {
    init_model_manager(manager_state)
        .await
        .map_err(|e| e.to_string())?;

    log::info!("ModelManager initialized at startup");
    Ok(())
}

/// Get recommended summary model based on system RAM
/// gemma3:1b (806 MB, fast) is recommended on Linux regardless of RAM.
#[tauri::command]
pub async fn builtin_ai_get_recommended_model() -> Result<String, String> {
    // Get system RAM in GB (informational only; the recommendation below is
    // constant on Linux)
    let system_ram_gb = get_system_ram_gb()?;

    let recommended = "gemma3:1b";

    log::info!(
        "Recommended summary model: {} ({}GB RAM)",
        recommended,
        system_ram_gb
    );
    Ok(recommended.to_string())
}

/// Get total system RAM in gigabytes
fn get_system_ram_gb() -> Result<u64, String> {
    use sysinfo::System;

    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_memory_bytes = sys.total_memory();
    let total_memory_gb = total_memory_bytes / (1024 * 1024 * 1024);

    Ok(total_memory_gb)
}
