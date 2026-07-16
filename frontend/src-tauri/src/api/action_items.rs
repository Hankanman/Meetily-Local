//! Tauri commands for action items and meeting notes.
//!
//! Thin wrappers over `ActionItemsRepository` / `MeetingNotesRepository`, plus
//! the on-demand extraction entry point. Items created through this surface are
//! `source = 'manual'` — the extractor owns `'summary'` rows and replaces them
//! on every re-run, so anything the user typed must be tagged differently to
//! survive a re-summarization.

use crate::database::models::{ActionItem, MeetingNote};
use crate::database::repositories::action_item::{
    ActionItemsRepository, NewActionItem, SOURCE_MANUAL,
};
use crate::database::repositories::meeting_note::{
    MeetingNotesRepository, SOURCE_MANUAL as NOTE_SOURCE_MANUAL,
};
use crate::database::repositories::setting::SettingsRepository;
use crate::database::repositories::summary::SummaryProcessesRepository;
use crate::state::AppState;
use crate::summary::action_extraction;
use crate::summary::transcript_action_items;
use crate::summary::markdown_export::extract_markdown;
use tauri::{AppHandle, Runtime};
use tracing::info;

/// Action items for one meeting (open first, then oldest-first within each
/// group), or every item across every meeting when `meeting_id` is omitted.
#[tauri::command]
pub async fn list_action_items<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
) -> Result<Vec<ActionItem>, String> {
    let pool = state.db_manager.pool();
    match meeting_id {
        Some(mid) => ActionItemsRepository::list_by_meeting(pool, &mid)
            .await
            .map_err(|e| format!("Failed to list action items: {e}")),
        None => ActionItemsRepository::list_all(pool)
            .await
            .map_err(|e| format!("Failed to list action items: {e}")),
    }
}

/// Every open action item across all meetings, newest first.
#[tauri::command]
pub async fn list_open_action_items<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ActionItem>, String> {
    ActionItemsRepository::list_open(state.db_manager.pool(), None)
        .await
        .map_err(|e| format!("Failed to list open action items: {e}"))
}

#[tauri::command]
pub async fn create_action_item<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    text: String,
    assignee: Option<String>,
    due_hint: Option<String>,
) -> Result<ActionItem, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Action item text cannot be empty".to_string());
    }

    let item = NewActionItem {
        text,
        assignee: assignee.and_then(non_empty),
        due_hint: due_hint.and_then(non_empty),
        ..Default::default()
    };

    ActionItemsRepository::create(state.db_manager.pool(), &meeting_id, &item, SOURCE_MANUAL)
        .await
        .map_err(|e| format!("Failed to create action item: {e}"))
}

/// Toggle an item between `"open"` and `"done"`.
#[tauri::command]
pub async fn set_action_item_status<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    id: String,
    status: String,
) -> Result<ActionItem, String> {
    ActionItemsRepository::set_status(state.db_manager.pool(), &id, &status)
        .await
        .map_err(|e| format!("Failed to update action item status: {e}"))?
        .ok_or_else(|| format!("Action item not found: {id}"))
}

/// Patch an item's editable fields. Omitted arguments are left unchanged;
/// passing an empty string for `assignee`/`due_hint` clears it.
#[tauri::command]
pub async fn update_action_item<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    id: String,
    text: Option<String>,
    assignee: Option<String>,
    due_hint: Option<String>,
) -> Result<ActionItem, String> {
    ActionItemsRepository::update(
        state.db_manager.pool(),
        &id,
        text.as_deref(),
        assignee.as_deref(),
        due_hint.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to update action item: {e}"))?
    .ok_or_else(|| format!("Action item not found: {id}"))
}

#[tauri::command]
pub async fn delete_action_item<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    ActionItemsRepository::delete(state.db_manager.pool(), &id)
        .await
        .map_err(|e| format!("Failed to delete action item: {e}"))
}

/// Run action-item extraction for a meeting that already has a summary.
///
/// The automatic pass only fires when a summary finishes, so meetings
/// summarized before this feature shipped — or whose extraction failed at the
/// time — have no items until this is called. Unlike the automatic pass this
/// awaits the result and surfaces errors: the user asked for it and is watching
/// a spinner, so silence would be worse than a message.
#[tauri::command]
pub async fn extract_action_items<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<usize, String> {
    let pool = state.db_manager.pool();

    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to read model config: {e}"))?
        .ok_or_else(|| "No summary model configured. Set one in settings first.".to_string())?;

    info!(
        "On-demand action-item extraction for {} using {}/{}",
        meeting_id, config.provider, config.model
    );

    // Prefer the transcript (timestamped ground truth). Fall back to the
    // summary only for meetings whose transcript segments aren't stored.
    match transcript_action_items::extract_from_transcript(
        &app,
        pool,
        &meeting_id,
        &config.provider,
        &config.model,
    )
    .await
    {
        Ok(count) => Ok(count),
        Err(transcript_err) => {
            info!(
                "Transcript extraction unavailable for {meeting_id} ({transcript_err}); \
                 falling back to the summary"
            );
            let process =
                SummaryProcessesRepository::get_summary_data_for_meeting(pool, &meeting_id)
                    .await
                    .map_err(|e| format!("Failed to load summary: {e}"))?
                    .ok_or_else(|| {
                        "No transcript to extract from, and no summary either. Generate a \
                         summary first."
                            .to_string()
                    })?;
            let result_str = process
                .result
                .ok_or_else(|| "This meeting has no summary yet. Generate one first.".to_string())?;
            let result_json: serde_json::Value = serde_json::from_str(&result_str)
                .map_err(|e| format!("Stored summary is not valid JSON: {e}"))?;
            let markdown = extract_markdown(&result_json)
                .filter(|m| !m.trim().is_empty())
                .ok_or_else(|| {
                    "Nothing to extract from: no transcript and an empty summary.".to_string()
                })?;

            action_extraction::extract_for_meeting(
                &app,
                pool,
                &meeting_id,
                &markdown,
                &config.provider,
                &config.model,
            )
            .await
        }
    }
}

/// Start live (in-meeting) action-item extraction for the current recording.
/// Gated by the frontend on the Beta feature flag; runs the summary model
/// periodically over the in-memory transcript and emits provisional items.
#[tauri::command]
pub async fn start_live_action_extraction<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let pool = state.db_manager.pool();
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to read model config: {e}"))?
        .ok_or_else(|| "No summary model configured. Set one in settings first.".to_string())?;

    crate::summary::live_action_items::start(app, pool.clone(), config.provider, config.model);
    Ok(())
}

#[tauri::command]
pub async fn stop_live_action_extraction() -> Result<(), String> {
    crate::summary::live_action_items::stop();
    Ok(())
}

#[tauri::command]
pub async fn add_meeting_note<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    body: String,
) -> Result<MeetingNote, String> {
    MeetingNotesRepository::create(
        state.db_manager.pool(),
        &meeting_id,
        &body,
        NOTE_SOURCE_MANUAL,
    )
    .await
    .map_err(|e| format!("Failed to add note: {e}"))
}

#[tauri::command]
pub async fn list_meeting_notes<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Vec<MeetingNote>, String> {
    MeetingNotesRepository::list_by_meeting(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(|e| format!("Failed to list notes: {e}"))
}

#[tauri::command]
pub async fn delete_meeting_note<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    MeetingNotesRepository::delete(state.db_manager.pool(), &id)
        .await
        .map_err(|e| format!("Failed to delete note: {e}"))
}

/// Trim, then drop empty strings. The frontend sends `""` for a cleared input;
/// storing that instead of NULL would render as an empty assignee chip.
fn non_empty(s: String) -> Option<String> {
    let t = s.trim();
    (!t.is_empty()).then(|| t.to_string())
}
