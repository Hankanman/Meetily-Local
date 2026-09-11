//! Tauri command wrappers for audio import. Core logic (validation,
//! decoding, VAD, transcription, DB writes) lives in `audio::import`.

use std::path::Path;
use std::sync::atomic::Ordering;

use log::{error, info};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::audio::constants::AUDIO_EXTENSIONS;
use crate::audio::import::{
    cancel_import, is_import_in_progress, start_import_with, validate_audio_file, AudioFileInfo,
    ImportResult, ImportStarted, IMPORT_IN_PROGRESS,
};
use crate::state::AppState;

/// Start import of an audio file: resolves the event sink and DB pool from a
/// live `AppHandle`, then delegates to the Tauri-free core.
pub async fn start_import<R: Runtime>(
    app: AppHandle<R>,
    source_path: String,
    title: String,
    language: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    num_speakers: i32,
) -> anyhow::Result<ImportResult> {
    let pool = app
        .try_state::<AppState>()
        .map(|s| s.db_manager.pool().clone());
    start_import_with(
        crate::tauri_events::shared_sink(&app),
        pool,
        source_path,
        title,
        language,
        model,
        provider,
        num_speakers,
    )
    .await
}

/// Select an audio file and validate it
#[tauri::command]
pub async fn select_and_validate_audio_command<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<AudioFileInfo>, String> {
    info!("Opening file dialog for audio import");

    // Use spawn_blocking to avoid blocking async runtime
    let app_clone = app.clone();
    let file_path = tokio::task::spawn_blocking(move || {
        app_clone
            .dialog()
            .file()
            .add_filter(
                "Audio Files",
                &AUDIO_EXTENSIONS.iter().map(|s| *s).collect::<Vec<_>>(),
            )
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("File dialog task failed: {}", e))?;

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            info!("User selected: {}", path_str);

            match validate_audio_file(Path::new(&path_str)) {
                Ok(info) => Ok(Some(info)),
                Err(e) => {
                    error!("Validation failed: {}", e);
                    Err(e.to_string())
                }
            }
        }
        None => {
            info!("User cancelled file selection");
            Ok(None)
        }
    }
}

/// Validate an audio file from a given path (for drag-drop)
#[tauri::command]
pub async fn validate_audio_file_command(path: String) -> Result<AudioFileInfo, String> {
    info!("Validating audio file: {}", path);
    validate_audio_file(Path::new(&path)).map_err(|e| e.to_string())
}

/// Start importing an audio file (Beta gated using configContext.betaFeatures)
#[tauri::command]
pub async fn start_import_audio_command<R: Runtime>(
    app: AppHandle<R>,
    source_path: String,
    title: String,
    language: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    num_speakers: Option<i32>,
) -> Result<ImportStarted, String> {
    // Check if import is already in progress (guard will be acquired in start_import)
    if IMPORT_IN_PROGRESS.load(Ordering::SeqCst) {
        return Err("Import already in progress".to_string());
    }

    // 0 / absent → auto-estimate the speaker count.
    let num_speakers = num_speakers.unwrap_or(0);

    // Spawn import in background
    tauri::async_runtime::spawn(async move {
        let result = start_import(
            app,
            source_path,
            title,
            language,
            model,
            provider,
            num_speakers,
        )
        .await;

        if let Err(e) = result {
            error!("Import failed: {}", e);
        }
    });

    Ok(ImportStarted {
        message: "Import started".to_string(),
    })
}

/// Cancel ongoing import
#[tauri::command]
pub async fn cancel_import_command() -> Result<(), String> {
    if !is_import_in_progress() {
        return Err("No import in progress".to_string());
    }
    cancel_import();
    Ok(())
}

/// Check if import is in progress
#[tauri::command]
pub async fn is_import_in_progress_command() -> bool {
    is_import_in_progress()
}

