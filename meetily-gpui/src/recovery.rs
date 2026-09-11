//! Interrupted-meeting recovery: on startup, once the database is ready,
//! offer to recover any meeting an unclean shutdown left `"recording"`
//! (marked `"interrupted"` by the startup sweep in
//! `database::setup::prepare_database_on_startup`, or by a fatal recording
//! error). Mirrors `frontend/src/components/TranscriptRecovery/**` +
//! `frontend/src/hooks/useTranscriptRecovery.ts` + the wiring in
//! `frontend/src/app/page.tsx`, calling the same Tauri-free core functions
//! the Tauri `list_interrupted_meetings` / `recover_meeting` commands
//! (`commands/audio/recovery_commands.rs`) wrap directly.

use gpui_kit::component::{
    ActiveTheme, Disableable as _, StyledExt as _, WindowExt as _, h_flex, v_flex,
    button::{Button, ButtonVariants as _},
    dialog::Dialog,
    label::Label,
};
use gpui_kit::*;

use meetily_core::audio::incremental_saver::{
    cleanup_checkpoints, has_audio_checkpoints, recover_audio_from_checkpoints,
};
use meetily_core::database::repositories::meeting::{InterruptedMeetingRow, MeetingsRepository};

use crate::app_state::AppServices;
use crate::shell;

/// Entry point: call once the shell is showing (normal launch with an
/// already-completed onboarding, or right after onboarding finishes). A
/// no-op if there's no database yet or nothing is interrupted.
pub fn check_on_startup(window: &mut Window, cx: &mut App) {
    let Some(pool) = AppServices::global(cx).pool() else {
        return;
    };
    let io = AppServices::global(cx).io.clone();
    let window_handle = window.window_handle();

    cx.spawn(async move |cx| {
        let rows = io
            .spawn(async move { MeetingsRepository::list_interrupted_meetings(&pool).await })
            .await;
        let rows: Vec<InterruptedMeetingRow> = match rows {
            Ok(Ok(rows)) if !rows.is_empty() => rows,
            Ok(Ok(_)) => return,
            Ok(Err(e)) => {
                log::warn!("Failed to list interrupted meetings: {}", e);
                return;
            }
            Err(e) => {
                log::warn!("Interrupted-meetings lookup task panicked: {}", e);
                return;
            }
        };

        let _ = cx.update_window(window_handle, |_, window, cx| {
            open_dialog(rows, window, cx);
        });
    })
    .detach();
}

struct RecoveryState {
    rows: Vec<InterruptedMeetingRow>,
    busy: Option<String>,
    error: Option<String>,
}

impl RecoveryState {
    fn new(rows: Vec<InterruptedMeetingRow>, _window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self { rows, busy: None, error: None }
    }

    /// Mirrors the Tauri `recover_meeting` command: merge any leftover
    /// `.checkpoints/` audio into `audio.mp4` (best-effort — transcripts
    /// recover regardless), then mark the row `"completed"`.
    fn recover(&mut self, meeting_id: String, cx: &mut Context<Self>) {
        if self.busy.is_some() {
            return;
        }
        self.busy = Some(meeting_id.clone());
        self.error = None;
        cx.notify();

        let Some(pool) = AppServices::global(cx).pool() else {
            self.busy = None;
            self.error = Some("Database not ready".to_string());
            cx.notify();
            return;
        };
        let io = AppServices::global(cx).io.clone();
        let id_for_task = meeting_id.clone();

        cx.spawn(async move |this, cx| {
            let result = io
                .spawn(async move {
                    let meeting = MeetingsRepository::get_meeting_metadata(&pool, &id_for_task)
                        .await
                        .map_err(|e| e.to_string())?
                        .ok_or_else(|| "Meeting not found".to_string())?;

                    let mut duration_seconds = None;
                    let mut audio_path = None;
                    if let Some(folder) = meeting.folder_path.clone() {
                        if has_audio_checkpoints(folder.clone()).await.unwrap_or(false) {
                            if let Ok(status) =
                                recover_audio_from_checkpoints(folder.clone(), 48000).await
                            {
                                if status.status == "success" {
                                    let _ = cleanup_checkpoints(folder.clone()).await;
                                }
                                duration_seconds = Some(status.estimated_duration_seconds);
                                audio_path = status.audio_file_path;
                            }
                        }
                    }

                    MeetingsRepository::mark_meeting_completed(
                        &pool,
                        &id_for_task,
                        duration_seconds,
                        audio_path.as_deref(),
                    )
                    .await
                    .map_err(|e| e.to_string())
                })
                .await;

            let _ = this.update(cx, |this, cx| {
                this.busy = None;
                match result {
                    Ok(Ok(_)) => {
                        this.rows.retain(|r| r.meeting_id != meeting_id);
                        shell::refresh_meetings(cx);
                        log::info!("Recovered interrupted meeting {}", meeting_id);
                    }
                    Ok(Err(e)) => this.error = Some(e),
                    Err(e) => this.error = Some(format!("Recovery task panicked: {}", e)),
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Discard an interrupted meeting outright — mirrors
    /// `deleteRecoverableMeeting` (`api_delete_meeting`).
    fn delete(&mut self, meeting_id: String, cx: &mut Context<Self>) {
        if self.busy.is_some() {
            return;
        }
        self.busy = Some(meeting_id.clone());
        self.error = None;
        cx.notify();

        let Some(pool) = AppServices::global(cx).pool() else {
            self.busy = None;
            self.error = Some("Database not ready".to_string());
            cx.notify();
            return;
        };
        let io = AppServices::global(cx).io.clone();
        let id_for_task = meeting_id.clone();

        cx.spawn(async move |this, cx| {
            let result = io
                .spawn(async move { MeetingsRepository::delete_meeting(&pool, &id_for_task).await })
                .await;

            let _ = this.update(cx, |this, cx| {
                this.busy = None;
                match result {
                    Ok(Ok(true)) => {
                        this.rows.retain(|r| r.meeting_id != meeting_id);
                        shell::refresh_meetings(cx);
                    }
                    Ok(Ok(false)) => this.error = Some("Meeting not found".to_string()),
                    Ok(Err(e)) => this.error = Some(e.to_string()),
                    Err(e) => this.error = Some(format!("Delete task panicked: {}", e)),
                }
                cx.notify();
            });
        })
        .detach();
    }
}

fn open_dialog(rows: Vec<InterruptedMeetingRow>, window: &mut Window, cx: &mut App) {
    if window.has_active_dialog(cx) {
        return;
    }
    let state = cx.new(|cx| RecoveryState::new(rows, window, cx));
    window.open_dialog(cx, move |dialog, window, cx| {
        render_dialog(dialog, state.clone(), window, cx)
    });
}

fn render_dialog(
    dialog: Dialog,
    state: Entity<RecoveryState>,
    _window: &mut Window,
    cx: &mut App,
) -> Dialog {
    let n = state.read(cx).rows.len();
    let title = if n == 1 {
        "1 interrupted meeting found".to_string()
    } else {
        format!("{} interrupted meetings found", n)
    };

    dialog
        .title(Label::new(title).text_lg().font_semibold())
        .width(px(520.))
        .overlay_closable(true)
        .keyboard(true)
        .content(move |content, window, cx| render_body(content, &state, window, cx))
}

fn render_body<'a>(
    content: gpui_kit::component::dialog::DialogContent,
    state: &Entity<RecoveryState>,
    _window: &mut Window,
    cx: &mut App,
) -> gpui_kit::component::dialog::DialogContent {
    let s = state.read(cx);
    let rows = s.rows.clone();
    let busy = s.busy.clone();
    let error = s.error.clone();

    let mut body = v_flex().gap_3().w_full().child(Label::new(
        "A previous run of Parley closed unexpectedly while one of these meetings \
         was recording. You can recover what was captured, or discard it.",
    ));

    if let Some(err) = error {
        body = body.child(Label::new(format!("Error: {}", err)).text_sm());
    }

    for row in rows {
        let id = row.meeting_id.clone();
        let recover_id = id.clone();
        let delete_id = id.clone();
        let is_busy = busy.as_deref() == Some(id.as_str());
        let recover_state = state.clone();
        let delete_state = state.clone();

        body = body.child(
            h_flex()
                .justify_between()
                .items_center()
                .p_2()
                .rounded_md()
                .border_1()
                .border_color(cx.theme().border)
                .child(
                    v_flex()
                        .child(Label::new(if row.title.trim().is_empty() {
                            "Untitled meeting".to_string()
                        } else {
                            row.title.clone()
                        }))
                        .child(
                            Label::new(format!("{} segment(s)", row.segment_count)).text_sm(),
                        ),
                )
                .child(
                    h_flex()
                        .gap_2()
                        .child(
                            Button::new(SharedString::from(format!("recovery-delete-{}", id)))
                                .label("Delete")
                                .disabled(is_busy)
                                .on_click(move |_, _, cx| {
                                    delete_state.update(cx, |s, cx| s.delete(delete_id.clone(), cx));
                                }),
                        )
                        .child(
                            Button::new(SharedString::from(format!("recovery-recover-{}", id)))
                                .label(if is_busy { "Working…" } else { "Recover" })
                                .primary()
                                .disabled(is_busy)
                                .on_click(move |_, _, cx| {
                                    recover_state
                                        .update(cx, |s, cx| s.recover(recover_id.clone(), cx));
                                }),
                        ),
                ),
        );
    }

    content.child(body)
}
