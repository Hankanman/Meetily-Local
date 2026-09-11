//! Meeting page: editable header (title + delete), a virtualized transcript
//! panel, and a summary panel with generate/regenerate, WYSIWYG editing,
//! copy/export and retranscription.
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
use meetily_core::summary::markdown_export;
use meetily_core::summary::service::SummaryService;
use zorite_editor::{EditorState, SyntaxStyle};

use crate::app_state::AppServices;
use crate::runtime::Io;
use crate::shell::{self, Route};

/// The full Lucide catalog (as opposed to `gpui_kit::component::IconName`,
/// which only carries a curated default subset — most of the icons this
/// page needs aren't in it).
type Lucide = gpui_kit::assets::IconName;

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
    /// Recording folder on disk, if any (needed for retranscription; absent
    /// when auto_save was off, or the meeting predates folder tracking).
    meeting_folder_path: Option<String>,
    transcripts: Vec<MeetingTranscript>,
    transcripts_loading: bool,
    load_error: Option<String>,
    summary_state: Entity<TextViewState>,
    /// Source-of-truth markdown for the summary: what `summary_state`
    /// renders, what "Edit" seeds the editor with, and what "Copy summary"
    /// and export read. `TextViewState` doesn't expose a text getter.
    summary_markdown: String,
    summary_has_content: bool,
    summary_phase: SummaryPhase,
    editing_summary: bool,
    summary_editor: Entity<EditorState>,
    saving_summary: bool,
    _poll_task: Option<Task<()>>,

    /// Available summary templates (id, name, description), loaded once at
    /// startup — same list `list_templates` returns for the Tauri UI.
    templates: Vec<(String, String, String)>,
    selected_template: String,
    /// Set once the user manually cycles the template picker, so the async
    /// default-setting fetch (`load_default_template`) doesn't clobber their
    /// choice if it resolves afterwards.
    template_user_selected: bool,
    custom_prompt: Entity<InputState>,
    show_custom_prompt: bool,

    retranscribe_open: bool,
    retranscribe_language: Entity<InputState>,
    /// Downloaded (`Available`) whisper models, fetched lazily the first
    /// time the retranscribe panel opens.
    retranscribe_models: Vec<String>,
    retranscribe_model_index: Option<usize>,
    retranscribe_in_progress: bool,
    retranscribe_progress_pct: u32,
    retranscribe_progress_message: String,
    retranscribe_error: Option<String>,

    _subscriptions: Vec<Subscription>,
}

impl MeetingView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let title_input = cx.new(|cx| InputState::new(window, cx).placeholder("Meeting title"));
        let retranscribe_language =
            cx.new(|cx| InputState::new(window, cx).placeholder("auto"));
        let summary_state = cx.new(|cx| TextViewState::markdown("", cx));
        let summary_editor = cx.new(|cx| {
            let mut editor = EditorState::new(window, cx).with_placeholder("No summary yet…");
            editor.set_markdown_style(syntax_style(cx), cx);
            editor
        });

        let core_events = AppServices::global(cx).core_events.clone();
        let subscriptions = vec![cx.subscribe(&core_events, |this, _, event, cx| {
            match event.name.as_str() {
                "summary-stream" => this.on_summary_stream(event, cx),
                "retranscription-progress" => this.on_retranscription_progress(event, cx),
                "retranscription-complete" => this.on_retranscription_complete(event, cx),
                "retranscription-error" => this.on_retranscription_error(event, cx),
                _ => {}
            }
        })];

        let templates = meetily_core::summary::templates::list_templates();
        let template_ids: Vec<String> = templates.iter().map(|(id, _, _)| id.clone()).collect();
        let selected_template = format::resolve_default_template(None, &template_ids);
        let custom_prompt =
            cx.new(|cx| InputState::new(window, cx).placeholder("Custom instructions (optional)…"));

        let view = Self {
            meeting_id: None,
            generation: 0,
            title: String::new(),
            title_input,
            editing_title: false,
            created_at: None,
            meeting_folder_path: None,
            transcripts: Vec::new(),
            transcripts_loading: false,
            load_error: None,
            summary_state,
            summary_markdown: String::new(),
            summary_has_content: false,
            summary_phase: SummaryPhase::Idle,
            editing_summary: false,
            summary_editor,
            saving_summary: false,
            _poll_task: None,
            templates,
            selected_template,
            template_user_selected: false,
            custom_prompt,
            show_custom_prompt: false,
            retranscribe_open: false,
            retranscribe_language,
            retranscribe_models: Vec::new(),
            retranscribe_model_index: None,
            retranscribe_in_progress: false,
            retranscribe_progress_pct: 0,
            retranscribe_progress_message: String::new(),
            retranscribe_error: None,
            _subscriptions: subscriptions,
        };
        view.load_default_template(cx);
        view
    }

    /// Fetch the stored default-template setting (if the Summary settings
    /// page has written one — see `views/settings/summary.rs`) and apply it
    /// as the picker's initial selection. A no-op if there's no pool yet or
    /// no such setting; the picker already has a sane default from
    /// `resolve_default_template(None, ..)`.
    fn load_default_template(&self, cx: &mut Context<Self>) {
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let io = Io::global(cx);
        let template_ids: Vec<String> = self.templates.iter().map(|(id, _, _)| id.clone()).collect();
        cx.spawn(async move |this, cx| {
            let configured = io
                .spawn(async move {
                    SettingsRepository::get_setting::<String>(
                        &pool,
                        meetily_core::database::repositories::setting::KEY_DEFAULT_SUMMARY_TEMPLATE,
                    ).await
                })
                .await;
            let default = match configured {
                Ok(Ok(Some(id))) => format::resolve_default_template(Some(&id), &template_ids),
                _ => format::resolve_default_template(None, &template_ids),
            };
            let _ = this.update(cx, |this, cx| {
                // Don't clobber a selection the user already made while this
                // was in flight.
                if !this.template_user_selected {
                    this.selected_template = default;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// Show the meeting with `id` (called by the shell on navigation).
    pub fn load(&mut self, id: String, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;

        self.meeting_id = Some(id.clone());
        self.title = String::new();
        self.editing_title = false;
        self.created_at = None;
        self.meeting_folder_path = None;
        self.transcripts = Vec::new();
        self.transcripts_loading = true;
        self.load_error = None;
        self.summary_phase = SummaryPhase::Loading;
        self.summary_has_content = false;
        self.summary_markdown = String::new();
        self.editing_summary = false;
        self.saving_summary = false;
        self._poll_task = None;
        self.retranscribe_open = false;
        self.retranscribe_in_progress = false;
        self.retranscribe_error = None;
        self.retranscribe_progress_pct = 0;
        self.retranscribe_progress_message = String::new();
        self.summary_state.update(cx, |state, cx| state.set_text("", cx));
        cx.notify();

        let Some(pool) = AppServices::global(cx).pool() else {
            self.load_error = Some("No database — complete onboarding in the Tauri app first.".into());
            self.transcripts_loading = false;
            return;
        };
        let io = Io::global(cx);

        // Meeting + transcripts + folder path (for retranscription).
        {
            let pool = pool.clone();
            let id = id.clone();
            let io = io.clone();
            cx.spawn(async move |this, cx| {
                let pool_meta = pool.clone();
                let id_meta = id.clone();
                let result = io
                    .spawn(async move { MeetingsRepository::get_meeting(&pool, &id).await })
                    .await;
                let metadata = io
                    .spawn(async move { MeetingsRepository::get_meeting_metadata(&pool_meta, &id_meta).await })
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
                    if let Ok(Ok(Some(meta))) = metadata {
                        this.meeting_folder_path = meta.folder_path;
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
                            this.summary_markdown = markdown.clone();
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

    fn cycle_template(&mut self, cx: &mut Context<Self>) {
        if self.templates.is_empty() {
            return;
        }
        let ids: Vec<String> = self.templates.iter().map(|(id, _, _)| id.clone()).collect();
        let current = ids.iter().position(|id| *id == self.selected_template).unwrap_or(0);
        let next = (current + 1) % ids.len();
        self.selected_template = ids[next].clone();
        self.template_user_selected = true;
        cx.notify();
    }

    fn toggle_custom_prompt(&mut self, cx: &mut Context<Self>) {
        self.show_custom_prompt = !self.show_custom_prompt;
        cx.notify();
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
        let template_id = self.selected_template.clone();
        let custom_prompt = self.custom_prompt.read(cx).value().to_string();

        self.summary_phase = SummaryPhase::Generating;
        self.summary_has_content = false;
        self.summary_markdown = String::new();
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
                custom_prompt,
                template_id,
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

    fn on_summary_stream(&mut self, event: &crate::core_events::CoreEvent, cx: &mut Context<Self>) {
        #[derive(serde::Deserialize)]
        struct Delta {
            meeting_id: String,
            delta: String,
        }
        let Some(payload) = event.decode::<Delta>() else {
            return;
        };
        if self.meeting_id.as_deref() != Some(payload.meeting_id.as_str()) {
            return;
        }
        if payload.delta.is_empty() {
            return;
        }
        self.summary_has_content = true;
        self.summary_markdown.push_str(&payload.delta);
        self.summary_state.update(cx, |state, cx| state.push_str(&payload.delta, cx));
    }

    // ---- Summary editing (zorite) ----------------------------------------

    fn start_edit_summary(&mut self, cx: &mut Context<Self>) {
        let markdown = self.summary_markdown.clone();
        self.summary_editor.update(cx, |editor, cx| editor.set_text(markdown, cx));
        self.editing_summary = true;
        cx.notify();
    }

    fn cancel_edit_summary(&mut self, cx: &mut Context<Self>) {
        self.editing_summary = false;
        cx.notify();
    }

    /// Whether the summary editor is open with edits that differ from the
    /// saved markdown — the trigger for the navigation-away guard (see
    /// [`format::has_unsaved_summary_edits`] and `shell::AppShell::guard_navigate`).
    pub fn has_unsaved_summary_edits(&self, cx: &App) -> bool {
        format::has_unsaved_summary_edits(
            self.editing_summary,
            &self.summary_editor.read(cx).text(),
            &self.summary_markdown,
        )
    }

    /// Discard the in-progress summary edit without saving. Used by the
    /// "Discard" choice of the unsaved-changes dialog.
    pub fn discard_summary_edits(&mut self, cx: &mut Context<Self>) {
        self.cancel_edit_summary(cx);
    }

    /// Save the in-progress summary edit. Used by the "Save" choice of the
    /// unsaved-changes dialog — fire-and-forget, like the regular Save
    /// button: the save task keeps running (and updates this entity) even
    /// after the shell has already navigated away, guarded by `generation`.
    pub fn save_summary_and_leave(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.save_summary(window, cx);
    }

    fn save_summary(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let markdown = self.summary_editor.read(cx).text().to_string();
        self.saving_summary = true;
        cx.notify();

        let io = Io::global(cx);
        let generation = self.generation;
        cx.spawn(async move |this, cx| {
            let value = serde_json::json!({ "markdown": markdown.clone() });
            let pool_for_md = pool.clone();
            let id_for_md = id.clone();
            let value_for_md = value.clone();
            let saved = io
                .spawn(async move { SummaryProcessesRepository::update_meeting_summary(&pool, &id, &value).await })
                .await;
            // Best-effort sidecar write, same as the Tauri save command —
            // failures here don't fail the save, the DB is the source of truth.
            let _ = io
                .spawn(async move { markdown_export::write_summary_md(&pool_for_md, &id_for_md, &value_for_md).await })
                .await;

            let _ = this.update(cx, |this, cx| {
                this.saving_summary = false;
                if this.generation != generation {
                    return;
                }
                match saved {
                    Ok(Ok(true)) => {
                        this.summary_markdown = markdown.clone();
                        this.summary_has_content = !markdown.is_empty();
                        this.summary_state.update(cx, |state, cx| state.set_text(&markdown, cx));
                        this.editing_summary = false;
                    }
                    _ => {
                        log::error!("meeting: failed to save edited summary");
                    }
                }
                cx.notify();
            });
        })
        .detach();

        window.push_notification(Notification::info("Saving summary…"), cx);
    }

    // ---- Copy / export -----------------------------------------------------

    fn copy_transcript(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.transcripts.is_empty() {
            window.push_notification(Notification::error("No transcripts available to copy"), cx);
            return;
        }
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let text = format::copy_transcript_text(&id, &self.title, self.created_at, &self.transcripts);
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        window.push_notification(Notification::success("Transcript copied to clipboard"), cx);
    }

    fn copy_summary(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.summary_markdown.trim().is_empty() {
            window.push_notification(Notification::error("No summary content available to copy"), cx);
            return;
        }
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let text = format::copy_summary_text(&id, &self.title, self.created_at, &self.summary_markdown);
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        window.push_notification(Notification::success("Summary copied to clipboard"), cx);
    }

    /// `format` is `"markdown"` or `"json"`, matching `export_meeting`'s
    /// core function.
    fn export_copy(&mut self, format: &'static str, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let io = Io::global(cx);
        cx.spawn(async move |_this, cx| {
            let result = io
                .spawn(async move { meetily_core::export::build_export(&pool, &id, format).await })
                .await;
            let _ = cx.update(|cx| match result {
                Ok(Ok(export)) => {
                    cx.write_to_clipboard(ClipboardItem::new_string(export.content));
                    let label = if format == "json" { "JSON" } else { "Markdown" };
                    notify(cx, Notification::success(format!("Meeting copied as {label}")));
                }
                _ => notify(cx, Notification::error("Failed to export meeting")),
            });
        })
        .detach();
    }

    /// Export, then a native save-file dialog, mirroring
    /// `export_meeting_to_file`'s Tauri command (minus the Tauri dialog
    /// plugin — GPUI's own `prompt_for_new_path`).
    fn export_save(&mut self, format: &'static str, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let io = Io::global(cx);
        cx.spawn(async move |_this, cx| {
            let result = io
                .spawn(async move { meetily_core::export::build_export(&pool, &id, format).await })
                .await;
            let export = match result {
                Ok(Ok(export)) => export,
                _ => {
                    let _ = cx.update(|cx| notify(cx, Notification::error("Failed to export meeting")));
                    return;
                }
            };

            let home = std::env::var("HOME").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from("/"));
            let rx = cx.update(|cx| cx.prompt_for_new_path(&home, Some(&export.filename)));
            match rx.await {
                Ok(Ok(Some(path))) => {
                    let content = export.content;
                    let write_result = io.spawn(async move { std::fs::write(&path, content) }).await;
                    let _ = cx.update(|cx| match write_result {
                        Ok(Ok(())) => notify(cx, Notification::success("Meeting exported")),
                        _ => notify(cx, Notification::error("Failed to write export")),
                    });
                }
                Ok(Ok(None)) => {
                    // Cancelled the save dialog — not an error, no toast.
                }
                _ => {
                    let _ = cx.update(|cx| notify(cx, Notification::error("Failed to export meeting")));
                }
            }
        })
        .detach();
    }

    // ---- Retranscription -----------------------------------------------------

    fn open_retranscribe(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.meeting_folder_path.is_none() {
            window.push_notification(Notification::error("This meeting has no saved audio to retranscribe."), cx);
            return;
        }
        self.retranscribe_open = true;
        self.retranscribe_error = None;
        cx.notify();

        if !self.retranscribe_models.is_empty() {
            return;
        }
        let io = Io::global(cx);
        let generation = self.generation;
        cx.spawn(async move |this, cx| {
            let models = io
                .spawn(async move { meetily_core::whisper_engine::whisper_get_available_models().await })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                if let Ok(Ok(models)) = models {
                    this.retranscribe_models = models
                        .into_iter()
                        .filter(|m| matches!(m.status, meetily_core::whisper_engine::ModelStatus::Available))
                        .map(|m| m.name)
                        .collect();
                    if this.retranscribe_model_index.is_none() && !this.retranscribe_models.is_empty() {
                        this.retranscribe_model_index = Some(0);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn close_retranscribe(&mut self, cx: &mut Context<Self>) {
        self.retranscribe_open = false;
        cx.notify();
    }

    fn cycle_retranscribe_model(&mut self, cx: &mut Context<Self>) {
        if self.retranscribe_models.is_empty() {
            return;
        }
        let next = self.retranscribe_model_index.map(|i| (i + 1) % self.retranscribe_models.len()).unwrap_or(0);
        self.retranscribe_model_index = Some(next);
        cx.notify();
    }

    fn start_retranscribe(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(folder) = self.meeting_folder_path.clone() else {
            return;
        };
        if meetily_core::audio::retranscription::is_retranscription_in_progress() {
            window.push_notification(Notification::error("Retranscription already in progress"), cx);
            return;
        }

        let language = self.retranscribe_language.read(cx).value().to_string();
        let language = {
            let trimmed = language.trim();
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("auto") {
                None
            } else {
                Some(trimmed.to_string())
            }
        };
        let model = self
            .retranscribe_model_index
            .and_then(|i| self.retranscribe_models.get(i).cloned());
        let provider = model.as_ref().map(|_| "localWhisper".to_string());

        self.retranscribe_in_progress = true;
        self.retranscribe_error = None;
        self.retranscribe_progress_pct = 0;
        self.retranscribe_progress_message = "Starting…".to_string();
        cx.notify();

        let sink = AppServices::global(cx).sink.clone();
        let pool = AppServices::global(cx).pool();
        let io = Io::global(cx);
        io.spawn(async move {
            if let Err(e) = meetily_core::audio::retranscription::start_retranscription_with(
                sink, pool, id, folder, language, model, provider,
            )
            .await
            {
                log::error!("meeting: retranscription failed: {e}");
            }
        });
    }

    fn cancel_retranscribe(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        meetily_core::audio::retranscription::cancel_retranscription();
    }

    fn on_retranscription_progress(&mut self, event: &crate::core_events::CoreEvent, cx: &mut Context<Self>) {
        let Some(payload) = event.decode::<meetily_core::audio::retranscription::RetranscriptionProgress>() else {
            return;
        };
        if self.meeting_id.as_deref() != Some(payload.meeting_id.as_str()) {
            return;
        }
        self.retranscribe_progress_pct = payload.progress_percentage;
        self.retranscribe_progress_message = payload.message;
        cx.notify();
    }

    fn on_retranscription_complete(&mut self, event: &crate::core_events::CoreEvent, cx: &mut Context<Self>) {
        let Some(payload) = event.decode::<meetily_core::audio::retranscription::RetranscriptionResult>() else {
            return;
        };
        if self.meeting_id.as_deref() != Some(payload.meeting_id.as_str()) {
            return;
        }
        self.retranscribe_in_progress = false;
        self.retranscribe_open = false;
        cx.notify();
        notify(cx, Notification::success(format!("Retranscription complete: {} segments", payload.segments_count)));
        self.reload_transcript(cx);
        shell::refresh_meetings(cx);
    }

    fn on_retranscription_error(&mut self, event: &crate::core_events::CoreEvent, cx: &mut Context<Self>) {
        let Some(payload) = event.decode::<meetily_core::audio::retranscription::RetranscriptionError>() else {
            return;
        };
        if self.meeting_id.as_deref() != Some(payload.meeting_id.as_str()) {
            return;
        }
        self.retranscribe_in_progress = false;
        self.retranscribe_error = Some(payload.error);
        cx.notify();
    }

    /// Re-fetch just the transcript after a retranscription completes.
    fn reload_transcript(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.meeting_id.clone() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let io = Io::global(cx);
        let generation = self.generation;
        cx.spawn(async move |this, cx| {
            let result = io.spawn(async move { MeetingsRepository::get_meeting(&pool, &id).await }).await;
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                if let Ok(Ok(Some(details))) = result {
                    this.transcripts = details.transcripts;
                }
                cx.notify();
            });
        })
        .detach();
    }
}

/// Show a notification on the main window from a context that doesn't carry
/// a `Window` (an async task after an `.await`, or a core-event
/// subscription callback) — via the `MainWindow` global stashed at startup.
fn notify(cx: &mut App, notification: Notification) {
    if let Some(main_window) = cx.try_global::<crate::tray::MainWindow>() {
        let handle = main_window.0;
        let _ = handle.update(cx, |_, window, cx| {
            window.push_notification(notification, cx);
        });
    }
}

fn syntax_style(cx: &App) -> SyntaxStyle {
    let theme = ActiveTheme::theme(cx);
    SyntaxStyle {
        block_label: None,
        block_label_gen: 0,
        block_ref_count: None,
        marker: theme.muted_foreground.opacity(0.6),
        code: theme.foreground,
        code_bg: theme.muted.opacity(0.5),
        link: theme.primary,
        tag: theme.accent_foreground,
        quote: theme.muted_foreground,
        alert_note: theme.primary,
        alert_tip: theme.primary,
        alert_important: theme.primary,
        alert_warning: theme.primary,
        alert_caution: theme.danger,
        alert_icons: None,
        rule: theme.border,
        mark_bg: theme.primary.opacity(0.25),
        popover_bg: theme.popover,
        popover_border: theme.border,
        popover_fg: theme.popover_foreground,
        popover_hover: theme.accent,
        popover_divider: theme.border,
        popover_danger: theme.danger,
        mono: gpui_kit::font("monospace"),
        property_icon: None,
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
            .when(self.retranscribe_open, |this| this.child(self.render_retranscribe(cx)))
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
        let can_retranscribe = self.meeting_folder_path.is_some();

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
                h_flex()
                    .gap_2()
                    .items_center()
                    .child(
                        Button::new("retranscribe")
                            .ghost()
                            .icon(Lucide::RefreshCw)
                            .tooltip("Retranscribe audio")
                            .disabled(!can_retranscribe || self.retranscribe_in_progress)
                            .on_click(cx.listener(|this, _, window, cx| this.open_retranscribe(window, cx))),
                    )
                    .child(
                        Button::new("copy-summary-md")
                            .ghost()
                            .icon(IconName::Copy)
                            .tooltip("Copy meeting as Markdown")
                            .on_click(cx.listener(|this, _, _, cx| this.export_copy("markdown", cx))),
                    )
                    .child(
                        Button::new("copy-summary-json")
                            .ghost()
                            .icon(Lucide::Braces)
                            .tooltip("Copy meeting as JSON")
                            .on_click(cx.listener(|this, _, _, cx| this.export_copy("json", cx))),
                    )
                    .child(
                        Button::new("save-summary-md")
                            .ghost()
                            .icon(Lucide::Download)
                            .tooltip("Save meeting as Markdown…")
                            .on_click(cx.listener(|this, _, _, cx| this.export_save("markdown", cx))),
                    )
                    .child(
                        Button::new("save-summary-json")
                            .ghost()
                            .icon(Lucide::FileCode)
                            .tooltip("Save meeting as JSON…")
                            .on_click(cx.listener(|this, _, _, cx| this.export_save("json", cx))),
                    )
                    .child(
                        Button::new("delete-meeting")
                            .danger()
                            .icon(IconName::Delete)
                            .tooltip("Delete meeting")
                            .on_click(cx.listener(|this, _, window, cx| this.confirm_delete(window, cx))),
                    ),
            )
    }

    fn render_retranscribe(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let model_label = self
            .retranscribe_model_index
            .and_then(|i| self.retranscribe_models.get(i))
            .cloned()
            .unwrap_or_else(|| "Default".to_string());

        v_flex()
            .w_full()
            .gap_2()
            .p_4()
            .border_b_1()
            .border_color(cx.theme().border)
            .bg(cx.theme().muted.opacity(0.3))
            .child(div().text_sm().font_semibold().child("Retranscribe meeting"))
            .when(!self.retranscribe_in_progress && self.retranscribe_error.is_none(), |this| {
                this.child(
                    h_flex()
                        .gap_2()
                        .items_center()
                        .child(div().text_xs().text_color(cx.theme().muted_foreground).w_20().child("Language"))
                        .child(div().w_32().child(Input::new(&self.retranscribe_language)))
                        .child(div().text_xs().text_color(cx.theme().muted_foreground).w_20().child("Model"))
                        .child(
                            Button::new("cycle-model")
                                .outline()
                                .label(model_label)
                                .disabled(self.retranscribe_models.is_empty())
                                .on_click(cx.listener(|this, _, _, cx| this.cycle_retranscribe_model(cx))),
                        )
                        .child(
                            Button::new("start-retranscribe")
                                .primary()
                                .label("Start")
                                .on_click(cx.listener(|this, _, window, cx| this.start_retranscribe(window, cx))),
                        )
                        .child(
                            Button::new("cancel-retranscribe-dialog")
                                .ghost()
                                .label("Cancel")
                                .on_click(cx.listener(|this, _, _, cx| this.close_retranscribe(cx))),
                        ),
                )
            })
            .when(self.retranscribe_in_progress, |this| {
                this.child(
                    h_flex()
                        .gap_2()
                        .items_center()
                        .child(
                            div()
                                .text_xs()
                                .child(format!("{}% — {}", self.retranscribe_progress_pct, self.retranscribe_progress_message)),
                        )
                        .child(
                            Button::new("cancel-retranscribe")
                                .ghost()
                                .icon(Lucide::X)
                                .label("Cancel")
                                .on_click(cx.listener(|this, _, window, cx| this.cancel_retranscribe(window, cx))),
                        ),
                )
            })
            .when_some(self.retranscribe_error.clone(), |this, err| {
                this.child(div().text_xs().text_color(cx.theme().danger).child(err)).child(
                    Button::new("close-retranscribe-error")
                        .ghost()
                        .label("Close")
                        .on_click(cx.listener(|this, _, _, cx| this.close_retranscribe(cx))),
                )
            })
    }

    fn render_transcript(&self, cx: &mut Context<Self>) -> AnyElement {
        let header = h_flex()
            .w_full()
            .items_center()
            .justify_between()
            .gap_2()
            .p_4()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(div().text_sm().font_semibold().child("Transcript"))
            .child(
                Button::new("copy-transcript")
                    .ghost()
                    .icon(IconName::Copy)
                    .tooltip("Copy transcript")
                    .disabled(self.transcripts.is_empty())
                    .on_click(cx.listener(|this, _, window, cx| this.copy_transcript(window, cx))),
            );

        if self.transcripts_loading {
            return v_flex()
                .size_full()
                .child(header)
                .child(div().p_4().child("Loading transcript…"))
                .into_any_element();
        }
        if let Some(err) = &self.load_error {
            return v_flex()
                .size_full()
                .child(header)
                .child(div().p_4().text_color(cx.theme().danger).child(err.clone()))
                .into_any_element();
        }
        if self.transcripts.is_empty() {
            return v_flex()
                .size_full()
                .child(header)
                .child(
                    div()
                        .p_4()
                        .text_color(cx.theme().muted_foreground)
                        .child("No transcript yet."),
                )
                .into_any_element();
        }

        let transcripts = self.transcripts.clone();
        let count = transcripts.len();

        v_flex()
            .size_full()
            .child(header)
            .child(
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
                .size_full(),
            )
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
        let template_label = self
            .templates
            .iter()
            .find(|(id, _, _)| *id == self.selected_template)
            .map(|(_, name, _)| name.clone())
            .unwrap_or_else(|| "Template".to_string());
        let template_tooltip = self
            .templates
            .iter()
            .find(|(id, _, _)| *id == self.selected_template)
            .map(|(_, _, desc)| desc.clone())
            .unwrap_or_default();

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
                        h_flex()
                            .gap_2()
                            .items_center()
                            .when(!self.editing_summary, |this| {
                                this.child(
                                    Button::new("copy-summary")
                                        .ghost()
                                        .icon(IconName::Copy)
                                        .tooltip("Copy summary")
                                        .disabled(!has_summary)
                                        .on_click(cx.listener(|this, _, window, cx| this.copy_summary(window, cx))),
                                )
                                .child(
                                    Button::new("edit-summary")
                                        .ghost()
                                        .icon(Lucide::Pencil)
                                        .tooltip("Edit summary")
                                        .disabled(!has_summary || matches!(self.summary_phase, SummaryPhase::Generating))
                                        .on_click(cx.listener(|this, _, _, cx| this.start_edit_summary(cx))),
                                )
                                .child(
                                    Button::new("cycle-summary-template")
                                        .outline()
                                        .icon(Lucide::FileText)
                                        .label(template_label)
                                        .tooltip(if template_tooltip.is_empty() {
                                            "Summary template".to_string()
                                        } else {
                                            template_tooltip
                                        })
                                        .disabled(self.templates.is_empty() || matches!(self.summary_phase, SummaryPhase::Generating))
                                        .on_click(cx.listener(|this, _, _, cx| this.cycle_template(cx))),
                                )
                                .child(
                                    Button::new("toggle-custom-prompt")
                                        .ghost()
                                        .icon(Lucide::MessageSquare)
                                        .tooltip("Custom instructions")
                                        .disabled(matches!(self.summary_phase, SummaryPhase::Generating))
                                        .on_click(cx.listener(|this, _, _, cx| this.toggle_custom_prompt(cx))),
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
                                )
                            })
                            .when(self.editing_summary, |this| {
                                this.child(
                                    Button::new("cancel-edit-summary")
                                        .ghost()
                                        .label("Cancel")
                                        .disabled(self.saving_summary)
                                        .on_click(cx.listener(|this, _, _, cx| this.cancel_edit_summary(cx))),
                                )
                                .child(
                                    Button::new("save-summary")
                                        .primary()
                                        .icon(Lucide::Save)
                                        .label(if self.saving_summary { "Saving…" } else { "Save" })
                                        .loading(self.saving_summary)
                                        .disabled(self.saving_summary)
                                        .on_click(cx.listener(|this, _, window, cx| this.save_summary(window, cx))),
                                )
                            }),
                    ),
            )
            .when(self.show_custom_prompt && !self.editing_summary, |this| {
                this.child(
                    h_flex()
                        .w_full()
                        .gap_2()
                        .items_center()
                        .px_4()
                        .py_2()
                        .border_b_1()
                        .border_color(cx.theme().border)
                        .child(div().flex_1().min_w_0().child(Input::new(&self.custom_prompt)))
                        .into_any_element(),
                )
            })
            .child(
                div()
                    .id("summary-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p_4()
                    .when(!self.editing_summary, |this| {
                        this.child(TextView::new(&self.summary_state).selectable(true))
                    })
                    .when(self.editing_summary, |this| this.child(self.summary_editor.clone())),
            )
    }
}
