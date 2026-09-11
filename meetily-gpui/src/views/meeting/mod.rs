//! Meeting page: editable header (title + delete), a virtualized transcript
//! panel, and a read-only summary panel with generate/regenerate.
//!
//! Loading, generation and polling are all guarded by a `generation`
//! counter bumped on every [`MeetingView::load`] — async work started for an
//! older meeting id checks it before touching `self` so a fast
//! double-navigation can't clobber the currently-shown meeting with a
//! stale response (see `cx.spawn` closures below).

mod format;

use std::time::Duration;

use gpui_kit::component::{
    ActiveTheme, Disableable as _, IconName, WindowExt as _,
    button::{Button, ButtonVariants as _},
    h_flex,
    input::{Input, InputState},
    notification::Notification,
    text::{TextView, TextViewState},
    v_flex,
};
use gpui_kit::base::StyledExt as _;
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use meetily_core::database::models::{MeetingDetails, MeetingTranscript};
use meetily_core::database::repositories::meeting::MeetingsRepository;
use meetily_core::database::repositories::setting::SettingsRepository;
use meetily_core::database::repositories::summary::SummaryProcessesRepository;
use meetily_core::summary::service::SummaryService;

use crate::app_state::AppServices;
use crate::runtime::Io;
use crate::shell::{self, Route};

/// How far along the current meeting's summary is. Distinct from "there is
/// no summary yet", which is `Idle` with empty `summary_state` text.
#[derive(Clone, PartialEq)]
enum SummaryPhase {
    Idle,
    /// Initial `summary_processes` fetch for a newly-loaded meeting.
    Loading,
    /// A generation is in flight (started here, or resumed because the row
    /// was already "processing" when the page loaded).
    Generating,
    Error(String),
}

pub struct MeetingView {
    meeting_id: Option<String>,
    /// Bumped on every `load()`; async completions compare it to the
    /// current value before applying, so a stale in-flight fetch for a
    /// meeting the user has since navigated away from is dropped.
    generation: u64,
    title: String,
    title_input: Entity<InputState>,
    editing_title: bool,
    created_at: Option<chrono::DateTime<chrono::Utc>>,
    transcripts: Vec<MeetingTranscript>,
    transcripts_loading: bool,
    load_error: Option<String>,
    summary_state: Entity<TextViewState>,
    /// [`TextViewState`] doesn't expose a text getter, so this tracks
    /// whether it currently holds anything (for the "Regenerate" vs
    /// "Generate" button label).
    summary_has_content: bool,
    summary_phase: SummaryPhase,
    _poll_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl MeetingView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let title_input = cx.new(|cx| InputState::new(window, cx).placeholder("Meeting title"));
        let summary_state = cx.new(|cx| TextViewState::markdown("", cx));

        let core_events = AppServices::global(cx).core_events.clone();
        let subscriptions = vec![cx.subscribe(&core_events, |this, _, event, cx| {
            if event.name != "summary-stream" {
                return;
            }
            #[derive(serde::Deserialize)]
            struct Delta {
                meeting_id: String,
                delta: String,
            }
            let Some(payload) = event.decode::<Delta>() else {
                return;
            };
            if this.meeting_id.as_deref() != Some(payload.meeting_id.as_str()) {
                return;
            }
            if payload.delta.is_empty() {
                return;
            }
            this.summary_has_content = true;
            this.summary_state.update(cx, |state, cx| state.push_str(&payload.delta, cx));
        })];

        Self {
            meeting_id: None,
            generation: 0,
            title: String::new(),
            title_input,
            editing_title: false,
            created_at: None,
            transcripts: Vec::new(),
            transcripts_loading: false,
            load_error: None,
            summary_state,
            summary_has_content: false,
            summary_phase: SummaryPhase::Idle,
            _poll_task: None,
            _subscriptions: subscriptions,
        }
    }

    /// Show the meeting with `id` (called by the shell on navigation).
    pub fn load(&mut self, id: String, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;

        self.meeting_id = Some(id.clone());
        self.title = String::new();
        self.editing_title = false;
        self.created_at = None;
        self.transcripts = Vec::new();
        self.transcripts_loading = true;
        self.load_error = None;
        self.summary_phase = SummaryPhase::Loading;
        self.summary_has_content = false;
        self._poll_task = None;
        self.summary_state.update(cx, |state, cx| state.set_text("", cx));
        cx.notify();

        let Some(pool) = AppServices::global(cx).pool() else {
            self.load_error = Some("No database — complete onboarding in the Tauri app first.".into());
            self.transcripts_loading = false;
            return;
        };
        let io = Io::global(cx);

        // Meeting + transcripts.
        {
            let pool = pool.clone();
            let id = id.clone();
            cx.spawn(async move |this, cx| {
                let result = io
                    .spawn(async move { MeetingsRepository::get_meeting(&pool, &id).await })
                    .await;
                let _ = this.update(cx, |this, cx| {
                    if this.generation != generation {
                        return;
                    }
                    this.transcripts_loading = false;
                    match result {
                        Ok(Ok(Some(details))) => this.apply_meeting_details(details, cx),
                        Ok(Ok(None)) => this.load_error = Some("Meeting not found".to_string()),
                        Ok(Err(e)) => this.load_error = Some(format!("Failed to load meeting: {e}")),
                        Err(e) => this.load_error = Some(format!("Failed to load meeting: {e}")),
                    }
                    cx.notify();
                });
            })
            .detach();
        }

        // Existing summary (if any), and resume polling if one is already
        // in flight (e.g. started from the Tauri UI).
        self.refresh_summary(generation, cx);
    }

    fn apply_meeting_details(&mut self, details: MeetingDetails, _cx: &mut Context<Self>) {
        self.title = details.title;
        self.created_at = chrono::DateTime::parse_from_rfc3339(&details.created_at)
            .ok()
            .map(|dt| dt.with_timezone(&chrono::Utc));
        self.transcripts = details.transcripts;
    }

    fn refresh_summary(&mut self, generation: u64, cx: &mut Context<Self>) {
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let io = Io::global(cx);
        cx.spawn(async move |this, cx| {
            let result = io
                .spawn(async move { SummaryProcessesRepository::get_summary_data_for_meeting(&pool, &id).await })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                match result {
                    Ok(Ok(Some(process))) => {
                        let markdown = process
                            .result
                            .as_deref()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                            .and_then(|v| v.get("markdown").and_then(|m| m.as_str()).map(str::to_string));
                        if let Some(markdown) = markdown {
                            this.summary_has_content = !markdown.is_empty();
                            this.summary_state.update(cx, |state, cx| state.set_text(&markdown, cx));
                        }
                        match process.status.to_lowercase().as_str() {
                            "processing" | "pending" | "summarizing" => {
                                this.summary_phase = SummaryPhase::Generating;
                                this.start_poll(generation, cx);
                            }
                            "failed" | "error" => {
                                this.summary_phase =
                                    SummaryPhase::Error(process.error.unwrap_or_else(|| "Summary generation failed".into()));
                            }
                            _ => this.summary_phase = SummaryPhase::Idle,
                        }
                    }
                    Ok(Ok(None)) => this.summary_phase = SummaryPhase::Idle,
                    Ok(Err(e)) => this.summary_phase = SummaryPhase::Error(format!("Failed to load summary: {e}")),
                    Err(e) => this.summary_phase = SummaryPhase::Error(format!("Failed to load summary: {e}")),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn save_title(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let new_title = self.title_input.read(cx).value().to_string();
        if new_title.trim().is_empty() {
            return;
        }
        self.title = new_title.clone();
        self.editing_title = false;
        cx.notify();

        let io = Io::global(cx);
        cx.spawn(async move |_this, cx| {
            let _ = io
                .spawn(async move { MeetingsRepository::update_meeting_title(&pool, &id, &new_title).await })
                .await;
            let _ = cx.update(|cx| shell::refresh_meetings(cx));
        })
        .detach();
    }

    fn confirm_delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity();
        window.open_alert_dialog(cx, move |alert, _, _| {
            let this = this.clone();
            alert
                .title("Delete meeting")
                .description("This permanently deletes the meeting, its transcript, and its summary. This cannot be undone.")
                .show_cancel(true)
                .on_ok(move |_, _, cx| {
                    this.update(cx, |this, cx| this.delete(cx));
                    true
                })
        });
    }

    fn delete(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let io = Io::global(cx);
        cx.spawn(async move |_this, cx| {
            let result = io
                .spawn(async move { MeetingsRepository::delete_meeting(&pool, &id).await })
                .await;
            let _ = cx.update(|cx| {
                match result {
                    Ok(Ok(true)) => {
                        shell::refresh_meetings(cx);
                        shell::navigate(Route::Recording, cx);
                    }
                    Ok(Ok(false)) => log::warn!("Meeting already deleted"),
                    Ok(Err(e)) => log::error!("Failed to delete meeting: {e}"),
                    Err(e) => log::error!("Failed to delete meeting: {e}"),
                }
            });
        })
        .detach();
    }

    fn generate_summary(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        if self.transcripts.is_empty() {
            window.push_notification(Notification::error("No transcript available for this meeting."), cx);
            return;
        }
        let text = format::build_transcript_text(&self.transcripts);
        let sink = AppServices::global(cx).sink.clone();
        let io = Io::global(cx);
        let generation = self.generation;

        self.summary_phase = SummaryPhase::Generating;
        self.summary_has_content = false;
        self.summary_state.update(cx, |state, cx| state.set_text("", cx));
        cx.notify();

        let pool_for_config = pool.clone();
        cx.spawn(async move |this, cx| {
            let config = io
                .spawn(async move { SettingsRepository::get_model_config(&pool_for_config).await })
                .await;
            let Ok(Ok(Some(config))) = config else {
                let _ = this.update(cx, |this, cx| {
                    if this.generation != generation {
                        return;
                    }
                    this.summary_phase =
                        SummaryPhase::Error("No model configured — set one up in Settings first.".into());
                    cx.notify();
                });
                return;
            };

            let _ = io.spawn(SummaryService::process_transcript_background(
                sink,
                pool,
                id,
                text,
                config.provider,
                config.model,
                String::new(),
                "standard_meeting".to_string(),
            ));

            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                this.start_poll(generation, cx);
            });
        })
        .detach();
    }

    fn start_poll(&mut self, generation: u64, cx: &mut Context<Self>) {
        let task = cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(Duration::from_millis(1500)).await;
                let still_relevant = this
                    .update(cx, |this, cx| {
                        if this.generation != generation {
                            return false;
                        }
                        this.refresh_summary(generation, cx);
                        !matches!(this.summary_phase, SummaryPhase::Generating)
                    })
                    .unwrap_or(true);
                if still_relevant {
                    break;
                }
            }
        });
        self._poll_task = Some(task);
    }
}

impl Render for MeetingView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(_id) = self.meeting_id.clone() else {
            return v_flex().size_full().p_6().child("Select a meeting from the sidebar.");
        };

        v_flex()
            .size_full()
            .child(self.render_header(cx))
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .border_r_1()
                            .border_color(cx.theme().border)
                            .child(self.render_transcript(cx)),
                    )
                    .child(div().flex_1().min_w_0().h_full().child(self.render_summary(cx))),
            )
    }
}

impl MeetingView {
    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let date = self
            .created_at
            .map(format::format_header_date)
            .unwrap_or_default();

        h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .gap_3()
            .p_4()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(if self.editing_title {
                h_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_2()
                    .items_center()
                    .child(div().flex_1().min_w_0().child(Input::new(&self.title_input)))
                    .child(
                        Button::new("save-title")
                            .primary()
                            .label("Save")
                            .on_click(cx.listener(|this, _, _, cx| this.save_title(cx))),
                    )
                    .child(
                        Button::new("cancel-title")
                            .ghost()
                            .label("Cancel")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.editing_title = false;
                                cx.notify();
                            })),
                    )
                    .into_any_element()
            } else {
                h_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_3()
                    .items_center()
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .gap_1()
                            .child(
                                div()
                                    .text_lg()
                                    .font_semibold()
                                    .overflow_hidden()
                                    .child(if self.title.trim().is_empty() {
                                        "Untitled meeting".to_string()
                                    } else {
                                        self.title.clone()
                                    }),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(date),
                            ),
                    )
                    .child(
                        Button::new("edit-title")
                            .ghost()
                            .label("Rename")
                            .on_click(cx.listener(|this, _, window, cx| {
                                let title = this.title.clone();
                                this.title_input.update(cx, |state, cx| state.set_value(title, window, cx));
                                this.editing_title = true;
                                cx.notify();
                            })),
                    )
                    .into_any_element()
            })
            .child(
                Button::new("delete-meeting")
                    .danger()
                    .icon(IconName::Delete)
                    .tooltip("Delete meeting")
                    .on_click(cx.listener(|this, _, window, cx| this.confirm_delete(window, cx))),
            )
    }

    fn render_transcript(&self, cx: &mut Context<Self>) -> AnyElement {
        if self.transcripts_loading {
            return v_flex().size_full().p_4().child("Loading transcript…").into_any_element();
        }
        if let Some(err) = &self.load_error {
            return v_flex()
                .size_full()
                .p_4()
                .text_color(cx.theme().danger)
                .child(err.clone())
                .into_any_element();
        }
        if self.transcripts.is_empty() {
            return v_flex()
                .size_full()
                .p_4()
                .text_color(cx.theme().muted_foreground)
                .child("No transcript yet.")
                .into_any_element();
        }

        let transcripts = self.transcripts.clone();
        let count = transcripts.len();

        uniform_list("meeting-transcript", count, move |range, _window, cx| {
            range
                .map(|ix| {
                    let t = &transcripts[ix];
                    let time = format::segment_timestamp(t.audio_start_time, &t.timestamp);
                    let speaker = t.speaker.clone().unwrap_or_else(|| "Speaker".to_string());
                    v_flex()
                        .w_full()
                        .gap_1()
                        .px_4()
                        .py_2()
                        .child(
                            h_flex()
                                .gap_2()
                                .text_xs()
                                .text_color(cx.theme().muted_foreground)
                                .child(speaker)
                                .child(time),
                        )
                        .child(div().text_sm().child(t.text.clone()))
                        .into_any_element()
                })
                .collect::<Vec<_>>()
        })
        .flex_1()
        .size_full()
        .into_any_element()
    }

    fn render_summary(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let (status_label, button_label, button_disabled) = match &self.summary_phase {
            SummaryPhase::Idle => (None, "Generate summary", false),
            SummaryPhase::Loading => (Some("Loading summary…".to_string()), "Generate summary", true),
            SummaryPhase::Generating => (Some("Generating…".to_string()), "Generating…", true),
            SummaryPhase::Error(e) => (Some(e.clone()), "Regenerate summary", false),
        };
        let has_summary = self.summary_has_content;

        v_flex()
            .size_full()
            .child(
                h_flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .gap_2()
                    .p_4()
                    .border_b_1()
                    .border_color(cx.theme().border)
                    .child(
                        v_flex()
                            .gap_1()
                            .child(div().text_sm().font_semibold().child("Summary"))
                            .when_some(status_label, |this, label| {
                                this.child(
                                    div()
                                        .text_xs()
                                        .text_color(cx.theme().muted_foreground)
                                        .child(label),
                                )
                            }),
                    )
                    .child(
                        Button::new("generate-summary")
                            .primary()
                            .label(if has_summary && button_label == "Generate summary" {
                                "Regenerate summary"
                            } else {
                                button_label
                            })
                            .loading(matches!(self.summary_phase, SummaryPhase::Generating))
                            .disabled(button_disabled)
                            .on_click(cx.listener(|this, _, window, cx| this.generate_summary(window, cx))),
                    ),
            )
            .child(
                div()
                    .id("summary-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_4()
                    .child(TextView::new(&self.summary_state).selectable(true)),
            )
    }
}
