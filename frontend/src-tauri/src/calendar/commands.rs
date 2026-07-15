use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use super::fetcher;
use super::models::{CalendarEvent, CalendarSourceRow};
use super::repository::CalendarRepository;
use super::snapshot::{
    self, lookup_meeting_folder, CalendarEventSnapshot, SNAPSHOT_FILENAME,
};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarSource {
    pub id: String,
    pub url: String,
    pub label: Option<String>,
    #[serde(rename = "lastFetchedAt")]
    pub last_fetched_at: Option<String>,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

impl From<CalendarSourceRow> for CalendarSource {
    fn from(r: CalendarSourceRow) -> Self {
        Self {
            id: r.id,
            url: r.url,
            label: r.label,
            last_fetched_at: r.last_fetched_at,
            last_error: r.last_error,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RefreshResult {
    #[serde(rename = "sourceId")]
    pub source_id: String,
    #[serde(rename = "eventCount")]
    pub event_count: usize,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn calendar_list_sources<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CalendarSource>, String> {
    let rows = CalendarRepository::list_sources(state.db_manager.pool())
        .await
        .map_err(err)?;
    Ok(rows.into_iter().map(CalendarSource::from).collect())
}

#[tauri::command]
pub async fn calendar_add_source<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    url: String,
    label: Option<String>,
) -> Result<CalendarSource, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Calendar URL cannot be empty".to_string());
    }
    if !(trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("webcal://"))
    {
        return Err("Calendar URL must start with http(s):// or webcal://".to_string());
    }
    let normalized = if let Some(rest) = trimmed.strip_prefix("webcal://") {
        format!("https://{}", rest)
    } else {
        trimmed.to_string()
    };

    let row = CalendarRepository::add_source(
        state.db_manager.pool(),
        &normalized,
        label.as_deref().filter(|s| !s.trim().is_empty()),
    )
    .await
    .map_err(err)?;
    Ok(row.into())
}

#[tauri::command]
pub async fn calendar_remove_source<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    source_id: String,
) -> Result<bool, String> {
    CalendarRepository::remove_source(state.db_manager.pool(), &source_id)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn calendar_refresh_source<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    source_id: String,
) -> Result<RefreshResult, String> {
    let pool = state.db_manager.pool();
    let source = CalendarRepository::get_source(pool, &source_id)
        .await
        .map_err(err)?
        .ok_or_else(|| format!("Calendar source {} not found", source_id))?;

    match fetcher::fetch_and_expand(&source.url).await {
        Ok(occurrences) => {
            let count = CalendarRepository::replace_events(pool, &source_id, &occurrences)
                .await
                .map_err(err)?;
            CalendarRepository::mark_source_fetched(pool, &source_id, None)
                .await
                .map_err(err)?;
            Ok(RefreshResult {
                source_id,
                event_count: count,
            })
        }
        Err(e) => {
            let msg = e.to_string();
            CalendarRepository::mark_source_fetched(pool, &source_id, Some(&msg))
                .await
                .map_err(err)?;
            Err(msg)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct EventRangeRequest {
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn calendar_list_events<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    request: EventRangeRequest,
) -> Result<Vec<CalendarEvent>, String> {
    let from = parse_rfc3339(&request.from, "from")?;
    let to = parse_rfc3339(&request.to, "to")?;
    CalendarRepository::list_events_in_range(state.db_manager.pool(), from, to)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn calendar_find_event_for_now<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<CalendarEvent>, String> {
    CalendarRepository::find_event_for_now(state.db_manager.pool())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn calendar_link_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    event_id: Option<String>,
) -> Result<bool, String> {
    let pool = state.db_manager.pool();

    let updated = CalendarRepository::link_meeting(pool, &meeting_id, event_id.as_deref())
        .await
        .map_err(err)?;

    if !updated {
        return Ok(false);
    }

    // Best-effort sidecar write so a portable copy of the event details
    // travels with the recording folder (alongside metadata.json /
    // transcripts.json). Failure here doesn't roll back the DB link —
    // the link is still valid; the user just won't get the offline
    // snapshot. We log so it's debuggable.
    let folder = match lookup_meeting_folder(pool, &meeting_id).await {
        Ok(Some(p)) => Some(PathBuf::from(p)),
        Ok(None) => None,
        Err(e) => {
            log::warn!(
                "calendar snapshot: meeting folder lookup failed for {}: {}",
                meeting_id,
                e
            );
            None
        }
    };

    if let Some(folder) = folder {
        if let Some(event_id_ref) = event_id.as_deref() {
            match CalendarRepository::get_event(pool, event_id_ref).await {
                Ok(Some(event)) => {
                    let snapshot_data = CalendarEventSnapshot::from_event(&event);
                    if let Err(e) = snapshot::write_snapshot(&folder, &snapshot_data) {
                        log::warn!(
                            "calendar snapshot: failed to write {} for meeting {}: {}",
                            SNAPSHOT_FILENAME,
                            meeting_id,
                            e
                        );
                    }
                }
                Ok(None) => log::warn!(
                    "calendar snapshot: event {} not found when writing snapshot for meeting {}",
                    event_id_ref,
                    meeting_id
                ),
                Err(e) => log::warn!(
                    "calendar snapshot: get_event {} failed: {}",
                    event_id_ref,
                    e
                ),
            }
        } else if let Err(e) = snapshot::delete_snapshot(&folder) {
            log::warn!(
                "calendar snapshot: failed to delete {} for meeting {}: {}",
                SNAPSHOT_FILENAME,
                meeting_id,
                e
            );
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn calendar_get_event_for_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<CalendarEvent>, String> {
    CalendarRepository::get_event_for_meeting(state.db_manager.pool(), &meeting_id)
        .await
        .map_err(err)
}

fn parse_rfc3339(s: &str, label: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| format!("invalid {} timestamp '{}': {}", label, s, e))
}
