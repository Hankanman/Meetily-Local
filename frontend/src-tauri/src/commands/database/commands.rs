use log::{error, info};
use tauri::{AppHandle, Manager, State};

use super::manager::DatabaseManager;
use super::repositories::setting::{SettingsRepository, KEY_UI_CONFIG};
use crate::events::EventSinkExt;
use crate::state::AppState;

/// Check if this is the first launch (no database exists yet)
#[tauri::command]
pub async fn check_first_launch(_app: AppHandle) -> Result<bool, String> {
    DatabaseManager::is_first_launch()
        .await
        .map_err(|e| format!("Failed to check first launch: {}", e))
}

/// Initialize a fresh database (for users who don't want to import)
#[tauri::command]
pub async fn initialize_fresh_database(app: AppHandle) -> Result<(), String> {
    info!("Initializing fresh database");

    let db_manager = DatabaseManager::new_default().await.map_err(|e| {
        error!("Failed to initialize fresh database: {}", e);
        format!("Failed to initialize database: {}", e)
    })?;

    // Update app state with the new manager
    app.manage(AppState {
        db_manager: db_manager.clone(),
    });

    // Set default model configuration for fresh installs
    let pool = db_manager.pool();

    // Default Summary Model: Built-in AI (Gemma 3 1B)
    if let Err(e) = crate::database::repositories::setting::SettingsRepository::save_model_config(
        pool,
        "builtin-ai",
        "gemma3:1b",
        "large-v3", // Default whisper model (unused for builtin but required)
        None,
    )
    .await
    {
        error!("Failed to set default summary model config: {}", e);
    }

    // Default transcription model: local Whisper.
    if let Err(e) =
        crate::database::repositories::setting::SettingsRepository::save_transcript_config(
            pool,
            "localWhisper",
            crate::config::DEFAULT_WHISPER_MODEL,
        )
        .await
    {
        error!("Failed to set default transcription model config: {}", e);
    }

    info!("Fresh database initialized successfully with default models");

    // Emit event to notify frontend that database is ready
    app.emit_event("database-initialized", &())
        .map_err(|e| format!("Failed to emit database-initialized event: {}", e))?;

    Ok(())
}

/// Get the database directory path
#[tauri::command]
pub async fn get_database_directory(_app: AppHandle) -> Result<String, String> {
    let app_data_dir = crate::paths::app_data_dir()?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

/// Open the database folder in the system file explorer
#[tauri::command]
pub async fn open_database_folder(_app: AppHandle) -> Result<(), String> {
    let app_data_dir = crate::paths::app_data_dir()?;

    // Ensure directory exists before trying to open it
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let folder_path = app_data_dir.to_string_lossy().to_string();

    std::process::Command::new("xdg-open")
        .arg(&folder_path)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    info!("Opened database folder: {}", folder_path);
    Ok(())
}

// ===== FRONTEND UI CONFIG COMMANDS =====
//
// Thin Tauri commands backing ConfigContext's previously-localStorage-only
// preferences (primary language, confidence indicator toggle, auto-summary
// toggle, per-provider model cache, ...). The shape is owned entirely by the
// frontend — the backend just persists whatever JSON blob it's handed.

/// Gets the saved frontend UI config blob, or `None` if nothing has been saved yet.
#[tauri::command]
pub async fn api_get_ui_config(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let pool = state.db_manager.pool();
    SettingsRepository::get_setting_json(pool, KEY_UI_CONFIG)
        .await
        .map(|opt| opt.and_then(|json| serde_json::from_str(&json).ok()))
        .map_err(|e| format!("Failed to load UI config: {}", e))
}

/// Saves the frontend UI config blob (full replace).
#[tauri::command]
pub async fn api_save_ui_config(
    state: State<'_, AppState>,
    config: serde_json::Value,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    SettingsRepository::set_setting(pool, KEY_UI_CONFIG, &config)
        .await
        .map_err(|e| format!("Failed to save UI config: {}", e))
}
