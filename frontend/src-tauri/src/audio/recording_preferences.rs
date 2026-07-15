use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

use anyhow::{anyhow, Result};

use crate::database::repositories::setting::{SettingsRepository, KEY_RECORDING_PREFERENCES};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordingPreferences {
    pub save_folder: PathBuf,
    pub auto_save: bool,
    pub file_format: String,
    #[serde(default)]
    pub preferred_mic_device: Option<String>,
    #[serde(default)]
    pub preferred_system_device: Option<String>,
    /// Show the "inform participants" toast when a recording starts.
    /// Previously its own tauri-plugin-store file (`preferences.json`,
    /// written by the frontend directly); folded in here so all recording
    /// settings live in one place.
    #[serde(default = "default_true")]
    pub show_recording_notification: bool,
}

fn default_true() -> bool {
    true
}

impl Default for RecordingPreferences {
    fn default() -> Self {
        Self {
            save_folder: get_default_recordings_folder(),
            auto_save: true,
            file_format: "mp4".to_string(),
            preferred_mic_device: None,
            preferred_system_device: None,
            show_recording_notification: true,
        }
    }
}

/// Get the default recordings folder (~/Documents/meetily-recordings)
pub fn get_default_recordings_folder() -> PathBuf {
    dirs::document_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("meetily-recordings")
}

/// Ensure the recordings directory exists
pub fn ensure_recordings_directory(path: &PathBuf) -> Result<()> {
    if !path.exists() {
        std::fs::create_dir_all(path)?;
        info!("Created recordings directory: {:?}", path);
    }
    Ok(())
}

/// Generate a unique filename for a recording
pub fn generate_recording_filename(format: &str) -> String {
    let now = chrono::Utc::now();
    let timestamp = now.format("%Y%m%d_%H%M%S");
    format!("recording_{}.{}", timestamp, format)
}

/// Fetch the SQLite pool, if `AppState` has been managed yet. `None` early
/// in startup — e.g. on a first-launch cold start, before the frontend has
/// created the database.
fn db_pool<R: Runtime>(app: &AppHandle<R>) -> Option<sqlx::SqlitePool> {
    app.try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone())
}

/// One-time, read-only import of recording preferences from the legacy
/// tauri-plugin-store JSON file (`recording_preferences.json`), written
/// before this moved to SQLite. Read directly off disk (same `$APPDATA`
/// location and flat `{"preferences": ...}` shape the store plugin used,
/// with its default serializer) so this module no longer depends on the
/// plugin at all. The file is left in place afterward.
fn import_legacy_recording_preferences<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<RecordingPreferences> {
    let path = app
        .path()
        .app_data_dir()
        .ok()?
        .join("recording_preferences.json");
    let content = std::fs::read_to_string(&path).ok()?;
    let root: serde_json::Value = serde_json::from_str(&content).ok()?;
    let value = root.get("preferences")?;
    match serde_json::from_value::<RecordingPreferences>(value.clone()) {
        Ok(prefs) => Some(prefs),
        Err(e) => {
            warn!("Failed to deserialize legacy recording preferences: {}", e);
            None
        }
    }
}

/// One-time, read-only import of the "show recording notification" toggle
/// from the legacy tauri-plugin-store JSON file (`preferences.json`) — a
/// *different* file from `recording_preferences.json`, written directly by
/// the frontend's JS-side `Store` API (`RecordingSettings.tsx` /
/// `recordingNotification.tsx`). Folded into `RecordingPreferences` on
/// import so it lives in the same SQLite row going forward. The file is
/// left in place afterward.
fn import_legacy_show_recording_notification<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    let path = app.path().app_data_dir().ok()?.join("preferences.json");
    let content = std::fs::read_to_string(&path).ok()?;
    let root: serde_json::Value = serde_json::from_str(&content).ok()?;
    root.get("show_recording_notification")?.as_bool()
}

/// Load recording preferences from the database
pub async fn load_recording_preferences<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<RecordingPreferences> {
    let pool = match db_pool(app) {
        Some(pool) => pool,
        None => {
            info!("Database not yet initialized, using default recording preferences");
            return Ok(RecordingPreferences::default());
        }
    };

    let prefs = match SettingsRepository::get_setting::<RecordingPreferences>(
        &pool,
        KEY_RECORDING_PREFERENCES,
    )
    .await
    {
        Ok(Some(p)) => {
            info!("Loaded recording preferences from database");
            p
        }
        Ok(None) => {
            let base_imported = import_legacy_recording_preferences(app);
            let notification_imported = import_legacy_show_recording_notification(app);

            if base_imported.is_none() && notification_imported.is_none() {
                info!("No stored preferences found, using defaults");
                RecordingPreferences::default()
            } else {
                let mut imported = base_imported.unwrap_or_default();
                if let Some(show_notification) = notification_imported {
                    imported.show_recording_notification = show_notification;
                }
                info!("Importing legacy recording preferences (recording_preferences.json / preferences.json)");
                if let Err(e) =
                    SettingsRepository::set_setting(&pool, KEY_RECORDING_PREFERENCES, &imported)
                        .await
                {
                    warn!("Failed to persist imported recording preferences: {}", e);
                }
                imported
            }
        }
        Err(e) => {
            warn!(
                "Failed to load recording preferences: {}, using defaults",
                e
            );
            RecordingPreferences::default()
        }
    };

    info!("Loaded recording preferences: save_folder={:?}, auto_save={}, format={}, mic={:?}, system={:?}",
          prefs.save_folder, prefs.auto_save, prefs.file_format,
          prefs.preferred_mic_device, prefs.preferred_system_device);
    Ok(prefs)
}

/// Save recording preferences to the database
pub async fn save_recording_preferences<R: Runtime>(
    app: &AppHandle<R>,
    preferences: &RecordingPreferences,
) -> Result<()> {
    info!("Saving recording preferences: save_folder={:?}, auto_save={}, format={}, mic={:?}, system={:?}",
          preferences.save_folder, preferences.auto_save, preferences.file_format,
          preferences.preferred_mic_device, preferences.preferred_system_device);

    let pool =
        db_pool(app).ok_or_else(|| anyhow!("Database not yet initialized — try again shortly"))?;
    SettingsRepository::set_setting(&pool, KEY_RECORDING_PREFERENCES, preferences)
        .await
        .map_err(|e| anyhow!("Failed to save recording preferences: {}", e))?;

    info!("Successfully persisted recording preferences to database");

    // Ensure the directory exists
    ensure_recordings_directory(&preferences.save_folder)?;

    Ok(())
}

/// Tauri commands for recording preferences
#[tauri::command]
pub async fn get_recording_preferences<R: Runtime>(
    app: AppHandle<R>,
) -> Result<RecordingPreferences, String> {
    load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load recording preferences: {}", e))
}

#[tauri::command]
pub async fn set_recording_preferences<R: Runtime>(
    app: AppHandle<R>,
    preferences: RecordingPreferences,
) -> Result<(), String> {
    save_recording_preferences(&app, &preferences)
        .await
        .map_err(|e| format!("Failed to save recording preferences: {}", e))
}

#[tauri::command]
pub async fn get_default_recordings_folder_path() -> Result<String, String> {
    let path = get_default_recordings_folder();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_recordings_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let preferences = load_recording_preferences(&app)
        .await
        .map_err(|e| format!("Failed to load preferences: {}", e))?;

    // Ensure directory exists before trying to open it
    ensure_recordings_directory(&preferences.save_folder)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    let folder_path = preferences.save_folder.to_string_lossy().to_string();

    std::process::Command::new("xdg-open")
        .arg(&folder_path)
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;

    info!("Opened recordings folder: {}", folder_path);
    Ok(())
}

#[tauri::command]
pub async fn select_recording_folder<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<Option<String>, String> {
    // Use Tauri's dialog to select folder
    // For now, return None - this would need to be implemented with tauri-plugin-dialog
    // when it's available in the Cargo.toml
    warn!("Folder selection not yet implemented - using dialog plugin");
    Ok(None)
}
