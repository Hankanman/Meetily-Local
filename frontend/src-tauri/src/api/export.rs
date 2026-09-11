//! Tauri command wrappers for meeting export. All content-building logic
//! (gathering the meeting, rendering markdown/JSON, slugifying the filename)
//! lives in `meetily_core::export::build_export` — Tauri-free, so the GPUI
//! shell calls it directly. This file only adds the Tauri-specific bits:
//! pulling the pool out of `AppState` and, for `export_meeting_to_file`, the
//! native save-file dialog.

use meetily_core::export::{build_export, ExportResult};
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;
use tracing::info;

use crate::state::AppState;

/// Build a clean, self-contained export of a meeting.
///
/// `format` is `"markdown"` or `"json"` (case-insensitive).
#[tauri::command]
pub async fn export_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    format: String,
) -> Result<ExportResult, String> {
    let pool = state.db_manager.pool();
    let export = build_export(pool, &meeting_id, &format).await?;
    info!(
        "Exported meeting {} as {} ({} bytes)",
        export.meeting_id,
        export.format,
        export.content.len()
    );
    Ok(export)
}

/// Export, then ask the user where to put it. Returns the written path, or
/// `None` if they cancelled the dialog.
#[tauri::command]
pub async fn export_meeting_to_file<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    format: String,
) -> Result<Option<String>, String> {
    let export = export_meeting(app.clone(), state, meeting_id, format).await?;

    let extension = if export.format == "json" { "json" } else { "md" };
    let filter_name = if export.format == "json" {
        "JSON"
    } else {
        "Markdown"
    };

    // blocking_save_file parks the calling thread until the user picks; keep it
    // off the async runtime's worker threads.
    let path = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(export.filename.clone())
            .add_filter(filter_name, &[extension])
            .blocking_save_file()
            .map(|p| (p, export.content))
    })
    .await
    .map_err(|e| format!("File dialog task failed: {e}"))?;

    let Some((path, content)) = path else {
        return Ok(None);
    };

    let path_str = path.to_string();
    std::fs::write(&path_str, content).map_err(|e| format!("Failed to write export: {e}"))?;
    info!("Wrote meeting export to {}", path_str);
    Ok(Some(path_str))
}
