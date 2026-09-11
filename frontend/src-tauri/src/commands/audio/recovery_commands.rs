// audio/recovery_commands.rs
//
// Issue #57 slice 2: recovery of a meeting an unclean shutdown interrupted
// mid-recording is now a database query (`meetings.status = 'interrupted'`,
// set by `mark_stale_recording_meetings_interrupted` at startup and by the
// fatal-error stop path) instead of the frontend scanning an IndexedDB
// cache it built up itself. IndexedDB stays only as a per-viewer
// write-ahead cache for the live transcript list — it has no say in what
// counts as recoverable any more.

use log::{info, warn};
use serde::Serialize;
use tauri::State;

use crate::database::repositories::meeting::{InterruptedMeetingRow, MeetingsRepository};
use crate::state::AppState;

use super::incremental_saver::{
    cleanup_checkpoints, has_audio_checkpoints, recover_audio_from_checkpoints,
    AudioRecoveryStatus,
};

/// One row of `list_interrupted_meetings`. `has_audio_checkpoints` folds in
/// a filesystem check (whether `.checkpoints/` still holds unmerged audio)
/// alongside the DB-only fields from `InterruptedMeetingRow`.
#[derive(Debug, Clone, Serialize)]
pub struct InterruptedMeeting {
    pub meeting_id: String,
    pub title: String,
    pub folder_path: Option<String>,
    pub created_at: String,
    pub segment_count: i64,
    pub has_audio_checkpoints: bool,
}

/// List every meeting an unclean shutdown left in "recording" long enough
/// for the startup sweep to mark it "interrupted" (or that a fatal
/// recording error marked interrupted directly). Ordered most-recent
/// first, matching the old IndexedDB-backed dialog's sort.
#[tauri::command]
pub async fn list_interrupted_meetings(
    state: State<'_, AppState>,
) -> Result<Vec<InterruptedMeeting>, String> {
    let pool = state.db_manager.pool();
    let rows: Vec<InterruptedMeetingRow> = MeetingsRepository::list_interrupted_meetings(pool)
        .await
        .map_err(|e| format!("Failed to list interrupted meetings: {}", e))?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let has_audio = match &row.folder_path {
            Some(folder) => has_audio_checkpoints(folder.clone())
                .await
                .unwrap_or(false),
            None => false,
        };
        out.push(InterruptedMeeting {
            meeting_id: row.meeting_id,
            title: row.title,
            folder_path: row.folder_path,
            created_at: row.created_at.0.to_rfc3339(),
            segment_count: row.segment_count,
            has_audio_checkpoints: has_audio,
        });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct RecoverMeetingResult {
    pub success: bool,
    pub meeting_id: String,
    pub audio_recovery_status: Option<AudioRecoveryStatus>,
}

/// Recover one interrupted meeting: merge any `.checkpoints/` audio still on
/// disk into `audio.mp4` (best-effort — a meeting can still be recovered
/// with transcripts only), then mark the row "completed". The transcript
/// rows themselves need no recovery work here — they were already upserted
/// live by `transcript_db_writer` while the meeting recorded, up to
/// whatever was flushed before the interruption.
#[tauri::command]
pub async fn recover_meeting(
    state: State<'_, AppState>,
    meeting_id: String,
) -> Result<RecoverMeetingResult, String> {
    let pool = state.db_manager.pool();

    let meeting = MeetingsRepository::get_meeting_metadata(pool, &meeting_id)
        .await
        .map_err(|e| format!("Failed to look up meeting {}: {}", meeting_id, e))?
        .ok_or_else(|| format!("Meeting {} not found", meeting_id))?;

    let mut audio_recovery_status: Option<AudioRecoveryStatus> = None;
    if let Some(folder) = meeting.folder_path.clone() {
        if has_audio_checkpoints(folder.clone())
            .await
            .unwrap_or(false)
        {
            match recover_audio_from_checkpoints(folder.clone(), 48000).await {
                Ok(status) => {
                    if status.status == "success" {
                        if let Err(e) = cleanup_checkpoints(folder.clone()).await {
                            warn!(
                                "Recovered meeting {} but failed to clean up checkpoints: {}",
                                meeting_id, e
                            );
                        }
                    }
                    audio_recovery_status = Some(status);
                }
                Err(e) => {
                    warn!(
                        "Audio recovery failed for meeting {} (transcripts are recovered regardless): {}",
                        meeting_id, e
                    );
                }
            }
        }
    }

    let duration_seconds = audio_recovery_status
        .as_ref()
        .map(|s| s.estimated_duration_seconds);
    let audio_path = audio_recovery_status
        .as_ref()
        .and_then(|s| s.audio_file_path.clone());

    MeetingsRepository::mark_meeting_completed(
        pool,
        &meeting_id,
        duration_seconds,
        audio_path.as_deref(),
    )
    .await
    .map_err(|e| format!("Failed to finalise recovered meeting {}: {}", meeting_id, e))?;

    info!("✅ Recovered meeting {}", meeting_id);

    Ok(RecoverMeetingResult {
        success: true,
        meeting_id,
        audio_recovery_status,
    })
}
