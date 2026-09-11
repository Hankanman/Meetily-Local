use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::calendar::models::{CalendarEvent, CalendarSourceRow};
use crate::calendar::repository::CalendarRepository;
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
    let normalized = crate::calendar::normalize_calendar_url(&url)?;

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
    let event_count = crate::calendar::refresh_source(pool, &source_id).await?;
    Ok(RefreshResult {
        source_id,
        event_count,
    })
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
    meetily_core::calendar::service::link_meeting_with_snapshot(
        state.db_manager.pool(),
        &meeting_id,
        event_id.as_deref(),
    )
    .await
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
