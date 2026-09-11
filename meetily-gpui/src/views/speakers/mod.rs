//! Speakers page: the stored voice profiles list from the frontend's
//! `SpeakerSettings.tsx` — rename, merge, or delete a saved speaker.
//!
//! Self-voice enrollment (`SelfVoiceEnrollment.tsx`, which records a short
//! sample from the microphone to name the local user's own voice) is
//! deliberately **not** implemented here: it's optional per this package's
//! brief, and this page must stay safe to open in an automated/smoke-test
//! run without ever touching the microphone. The self-enrolled profile
//! (`VoiceProfile::is_self`) is simply excluded from the list — same as the
//! frontend, which owns it in a separate section.

mod logic;

use gpui_kit::component::{
    ActiveTheme, Disableable as _, IconName, WindowExt as _,
    button::{Button, ButtonVariants as _},
    h_flex,
    input::{Input, InputState},
    v_flex,
};
use gpui_kit::assets::IconName as AssetIcon;
use gpui_kit::base::StyledExt as _;
use gpui_kit::*;
use meetily_core::database::models::VoiceProfile;
use meetily_core::database::repositories::voice_profile::VoiceProfilesRepository;
use meetily_core::speaker_diarization::service::merge_voice_profiles_core;

use crate::app_state::AppServices;
use crate::runtime::Io;

pub struct SpeakersView {
    profiles: Vec<VoiceProfile>,
    loading: bool,
    error: Option<String>,
    /// Profile currently shown with editable name/email fields, if any.
    editing_id: Option<String>,
    name_input: Entity<InputState>,
    email_input: Entity<InputState>,
    /// Profile currently showing a "merge into…" candidate list, if any.
    merging_id: Option<String>,
}

impl SpeakersView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name_input = cx.new(|cx| InputState::new(window, cx).placeholder("Name"));
        let email_input = cx.new(|cx| InputState::new(window, cx).placeholder("Email (optional)"));

        let mut this = Self {
            profiles: Vec::new(),
            loading: true,
            error: None,
            editing_id: None,
            name_input,
            email_input,
            merging_id: None,
        };
        this.refresh(cx);
        this
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        let Some(pool) = AppServices::global(cx).pool() else {
            self.error = Some("No database — complete onboarding in the Tauri app first.".into());
            self.loading = false;
            return;
        };
        self.loading = true;
        self.error = None;
        cx.notify();

        let io = Io::global(cx);
        cx.spawn(async move |this, cx| {
            let result = io.spawn(async move { VoiceProfilesRepository::list_all(&pool).await }).await;
            let _ = this.update(cx, |this, cx| {
                this.loading = false;
                match result {
                    Ok(Ok(profiles)) => this.profiles = profiles,
                    Ok(Err(e)) => this.error = Some(format!("Failed to load speakers: {e}")),
                    Err(e) => this.error = Some(format!("Failed to load speakers: {e}")),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn start_edit(&mut self, profile: &VoiceProfile, window: &mut Window, cx: &mut Context<Self>) {
        self.editing_id = Some(profile.id.clone());
        self.merging_id = None;
        let name = profile.name.clone();
        let email = profile.email.clone().unwrap_or_default();
        self.name_input.update(cx, |state, cx| state.set_value(name, window, cx));
        self.email_input.update(cx, |state, cx| state.set_value(email, window, cx));
        cx.notify();
    }

    fn cancel_edit(&mut self, cx: &mut Context<Self>) {
        self.editing_id = None;
        cx.notify();
    }

    fn save_edit(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.editing_id.take() else {
            return;
        };
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        let name = self.name_input.read(cx).value().to_string();
        if name.trim().is_empty() {
            return;
        }
        let email = self.email_input.read(cx).value().to_string();
        let email = if email.trim().is_empty() { None } else { Some(email) };
        cx.notify();

        let io = Io::global(cx);
        cx.spawn(async move |this, cx| {
            let result = io
                .spawn(async move { VoiceProfilesRepository::update_profile(&pool, &id, &name, email.as_deref()).await })
                .await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(Ok(_)) => this.refresh(cx),
                Ok(Err(e)) => log::error!("Failed to update speaker: {e}"),
                Err(e) => log::error!("Update-speaker task panicked: {e}"),
            });
        })
        .detach();
    }

    fn confirm_delete(&mut self, profile: &VoiceProfile, window: &mut Window, cx: &mut Context<Self>) {
        let this = cx.entity();
        let id = profile.id.clone();
        let name = profile.name.clone();
        window.open_alert_dialog(cx, move |alert, _, _| {
            let this = this.clone();
            let id = id.clone();
            alert
                .title("Delete speaker")
                .description(format!(
                    "Removes the voice profile for \"{name}\". Past transcripts keep the \
                     displayed name but stop being linked to a profile, and future meetings \
                     won't auto-tag this voice."
                ))
                .show_cancel(true)
                .on_ok(move |_, _, cx| {
                    this.update(cx, |this, cx| this.delete(id.clone(), cx));
                    true
                })
        });
    }

    fn delete(&mut self, id: String, cx: &mut Context<Self>) {
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        self.profiles.retain(|p| p.id != id);
        cx.notify();

        let io = Io::global(cx);
        cx.spawn(async move |this, cx| {
            let result = io.spawn(async move { VoiceProfilesRepository::delete(&pool, &id).await }).await;
            if !matches!(result, Ok(Ok(true))) {
                let _ = this.update(cx, |this, cx| this.refresh(cx));
            }
        })
        .detach();
    }

    fn start_merge(&mut self, loser_id: String, cx: &mut Context<Self>) {
        self.editing_id = None;
        self.merging_id = Some(loser_id);
        cx.notify();
    }

    fn cancel_merge(&mut self, cx: &mut Context<Self>) {
        self.merging_id = None;
        cx.notify();
    }

    fn confirm_merge(
        &mut self,
        loser: &VoiceProfile,
        winner: &VoiceProfile,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let this = cx.entity();
        let winner_id = winner.id.clone();
        let loser_id = loser.id.clone();
        let winner_name = winner.name.clone();
        let loser_name = loser.name.clone();
        window.open_alert_dialog(cx, move |alert, _, _| {
            let this = this.clone();
            let winner_id = winner_id.clone();
            let loser_id = loser_id.clone();
            alert
                .title("Merge speaker")
                .description(format!(
                    "Folds \"{loser_name}\" into \"{winner_name}\". The chosen speaker keeps its \
                     name and email; samples from both profiles are combined and every \
                     transcript currently linked to \"{loser_name}\" is re-pointed at \
                     \"{winner_name}\". This profile is then deleted."
                ))
                .show_cancel(true)
                .on_ok(move |_, _, cx| {
                    this.update(cx, |this, cx| this.merge(winner_id.clone(), loser_id.clone(), cx));
                    true
                })
        });
    }

    fn merge(&mut self, winner_id: String, loser_id: String, cx: &mut Context<Self>) {
        let Some(pool) = AppServices::global(cx).pool() else {
            return;
        };
        self.merging_id = None;
        cx.notify();

        let io = Io::global(cx);
        cx.spawn(async move |this, cx| {
            let result = io
                .spawn(async move { merge_voice_profiles_core(&pool, &winner_id, &loser_id).await })
                .await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(Ok(_)) => this.refresh(cx),
                Ok(Err(e)) => log::error!("Failed to merge speakers: {e}"),
                Err(e) => log::error!("Merge-speakers task panicked: {e}"),
            });
        })
        .detach();
    }
}

impl Render for SpeakersView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex().size_full().child(self.render_header(cx)).child(self.render_body(cx))
    }
}

impl SpeakersView {
    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .w_full()
            .gap_1()
            .p_4()
            .border_b_1()
            .border_color(cx.theme().border)
            .child(
                h_flex()
                    .items_center()
                    .gap_2()
                    .child(IconName::User.view(cx))
                    .child(div().text_lg().font_semibold().child("Speakers")),
            )
            .child(
                div().text_xs().text_color(cx.theme().muted_foreground).child(
                    "Voice profiles saved from your transcripts. Rename, merge duplicates, or \
                     remove one you no longer need.",
                ),
            )
    }

    fn render_body(&self, cx: &mut Context<Self>) -> impl IntoElement {
        if self.loading {
            return div().size_full().p_6().child("Loading speakers…").into_any_element();
        }
        if let Some(err) = &self.error {
            return div()
                .size_full()
                .p_6()
                .text_color(cx.theme().danger)
                .child(err.clone())
                .into_any_element();
        }

        let visible = logic::visible_profiles(&self.profiles);
        if visible.is_empty() {
            return v_flex()
                .size_full()
                .items_center()
                .justify_center()
                .gap_2()
                .p_6()
                .text_color(cx.theme().muted_foreground)
                .child("No saved speakers yet.")
                .child(
                    div()
                        .text_xs()
                        .child("Name a \"Speaker N\" chip on a transcript to save a voice profile here."),
                )
                .into_any_element();
        }

        div()
            .id("speakers-scroll")
            .size_full()
            .overflow_y_scroll()
            .child(
                v_flex()
                    .w_full()
                    .gap_2()
                    .p_4()
                    .children(visible.iter().map(|p| self.render_row(p, &visible, cx))),
            )
            .into_any_element()
    }

    fn render_row(
        &self,
        profile: &VoiceProfile,
        visible: &[&VoiceProfile],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = profile.id.clone();

        if self.editing_id.as_deref() == Some(profile.id.as_str()) {
            return v_flex()
                .w_full()
                .gap_2()
                .px_3()
                .py_2()
                .rounded_md()
                .border_1()
                .border_color(cx.theme().border)
                .child(Input::new(&self.name_input))
                .child(Input::new(&self.email_input))
                .child(
                    h_flex()
                        .gap_2()
                        .child(
                            Button::new(format!("save-speaker-{id}"))
                                .primary()
                                .label("Save")
                                .on_click(cx.listener(|this, _, _, cx| this.save_edit(cx))),
                        )
                        .child(
                            Button::new(format!("cancel-speaker-{id}"))
                                .ghost()
                                .label("Cancel")
                                .on_click(cx.listener(|this, _, _, cx| this.cancel_edit(cx))),
                        ),
                )
                .into_any_element();
        }

        let id_for_edit = id.clone();
        let id_for_merge = id.clone();
        let id_for_delete = id.clone();

        let row = h_flex()
            .w_full()
            .items_center()
            .gap_3()
            .px_3()
            .py_2()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_1()
                    .child(div().text_sm().font_medium().child(profile.name.clone()))
                    .child(
                        h_flex()
                            .gap_3()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(profile.email.clone().unwrap_or_else(|| "—".to_string()))
                            .child(format!(
                                "{} sample{}",
                                profile.sample_count,
                                if profile.sample_count == 1 { "" } else { "s" }
                            ))
                            .child(format!("Updated {}", logic::format_updated(&profile.updated_at))),
                    ),
            )
            .child(
                Button::new(format!("edit-speaker-{id}"))
                    .ghost()
                    .icon(AssetIcon::Pencil)
                    .tooltip("Rename")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(profile) = this.profiles.iter().find(|p| p.id == id_for_edit).cloned() {
                            this.start_edit(&profile, window, cx);
                        }
                    })),
            )
            .child(
                Button::new(format!("merge-speaker-{id}"))
                    .ghost()
                    .icon(AssetIcon::Merge)
                    .tooltip("Merge into another speaker")
                    .disabled(visible.len() < 2)
                    .on_click(cx.listener(move |this, _, _, cx| this.start_merge(id_for_merge.clone(), cx))),
            )
            .child(
                Button::new(format!("delete-speaker-{id}"))
                    .ghost()
                    .icon(IconName::Delete)
                    .tooltip("Delete")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(profile) = this.profiles.iter().find(|p| p.id == id_for_delete).cloned() {
                            this.confirm_delete(&profile, window, cx);
                        }
                    })),
            );

        if self.merging_id.as_deref() != Some(profile.id.as_str()) {
            return row.into_any_element();
        }

        let candidates = logic::merge_candidates(visible, &profile.id);
        v_flex()
            .w_full()
            .gap_2()
            .child(row)
            .child(
                v_flex()
                    .gap_1()
                    .pl_3()
                    .child(div().text_xs().text_color(cx.theme().muted_foreground).child("Merge into:"))
                    .children(candidates.iter().map(|winner| {
                        let winner_id = winner.id.clone();
                        let loser_id = profile.id.clone();
                        Button::new(format!("merge-into-{}-{}", profile.id, winner.id))
                            .ghost()
                            .label(winner.name.clone())
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let loser = this.profiles.iter().find(|p| p.id == loser_id).cloned();
                                let winner = this.profiles.iter().find(|p| p.id == winner_id).cloned();
                                if let (Some(loser), Some(winner)) = (loser, winner) {
                                    this.confirm_merge(&loser, &winner, window, cx);
                                }
                            }))
                    }))
                    .child(
                        Button::new(format!("cancel-merge-{}", profile.id))
                            .ghost()
                            .label("Cancel")
                            .on_click(cx.listener(|this, _, _, cx| this.cancel_merge(cx))),
                    ),
            )
            .into_any_element()
    }
}
