//! "Transcription" settings page: the Whisper model catalog (with
//! download), which model is active, and language preference.
//!
//! Reads/writes the same `transcript_settings` row the Tauri app's
//! `api_save_transcript_config`/`api_get_transcript_config` commands use
//! (via `SettingsRepository`, already Tauri-free in core), and drives model
//! downloads through `whisper_engine::download_model_with_progress`, the
//! same core function those commands call — progress arrives back as the
//! `model-download-progress`/`-complete`/`-error` core events, which
//! `SettingsView` subscribes to and mirrors into `SettingsCache`.

use gpui_kit::component::{
    button::Button,
    h_flex, v_flex,
    label::Label,
    setting::{SettingField, SettingGroup, SettingItem, SettingPage},
    ActiveTheme, Disableable, Icon,
};
use gpui_kit::*;

use meetily_core::whisper_engine::ModelStatus;

use super::state::SettingsCache;
use super::SettingsView;

pub fn page(view: &Entity<SettingsView>, cx: &mut Context<SettingsView>) -> SettingPage {
    let view = view.clone();
    let models = SettingsCache::global(cx).whisper_models.clone();

    let available: Vec<(SharedString, SharedString)> = models
        .iter()
        .filter(|m| matches!(m.status, ModelStatus::Available))
        .map(|m| (SharedString::from(m.name.clone()), SharedString::from(m.name.clone())))
        .collect();

    let mut catalog_items: Vec<SettingItem> = Vec::new();
    for model in models {
        catalog_items.push(model_row(&view, model));
    }

    SettingPage::new("Transcription")
        .icon(Icon::new(gpui_kit::assets::IconName::Mic))
        .group(
            SettingGroup::new().title("Active model").item(
                SettingItem::new(
                    "Whisper model",
                    SettingField::dropdown(
                        available,
                        |cx: &App| SharedString::from(SettingsCache::global(cx).transcript.model.clone()),
                        {
                            let view = view.clone();
                            move |val: SharedString, cx: &mut App| {
                                let model = val.to_string();
                                {
                                    let cache = cx.global_mut::<SettingsCache>();
                                    cache.transcript.provider = "localWhisper".to_string();
                                    cache.transcript.model = model.clone();
                                }
                                super::state::save_transcript(
                                    cx,
                                    "localWhisper".to_string(),
                                    model,
                                );
                                let _ = view.update(cx, |_, cx| cx.notify());
                            }
                        },
                    ),
                )
                .description("Used for local, on-device transcription. Only downloaded models can be selected."),
            ),
        )
        .group(SettingGroup::new().title("Model catalog").items(catalog_items))
}

fn model_row(view: &Entity<SettingsView>, model: meetily_core::whisper_engine::ModelInfo) -> SettingItem {
    let view = view.clone();
    let name = model.name.clone();

    SettingItem::render(move |_options, _window, cx| {
        let status = SettingsCache::global(cx)
            .whisper_models
            .iter()
            .find(|m| m.name == name)
            .map(|m| m.status.clone())
            .unwrap_or(model.status.clone());
        let progress = SettingsCache::global(cx).download_progress.get(&name).copied();

        let status_text = match (&status, progress) {
            (_, Some(pct)) => format!("Downloading… {}%", pct),
            (ModelStatus::Available, _) => "Available".to_string(),
            (ModelStatus::Missing, _) => "Missing".to_string(),
            (ModelStatus::Downloading { progress }, _) => format!("Downloading… {}%", progress),
            (ModelStatus::Corrupted { .. }, _) => "Corrupted — re-download".to_string(),
            (ModelStatus::Error(e), _) => format!("Error: {}", e),
        };

        let is_downloading = matches!(status, ModelStatus::Downloading { .. }) || progress.is_some();
        let can_download = !matches!(status, ModelStatus::Available) && !is_downloading;

        let download_name = name.clone();
        let download_view = view.clone();

        h_flex()
            .w_full()
            .justify_between()
            .items_center()
            .gap_3()
            .child(
                v_flex()
                    .gap_1()
                    .child(Label::new(name.clone()).text_sm())
                    .child(
                        Label::new(format!("{} · {} MB · {}", model.accuracy, model.size_mb, status_text))
                            .text_xs()
                            .text_color(cx.theme().muted_foreground),
                    ),
            )
            .child(
                Button::new(SharedString::from(format!("download-{}", name)))
                    .outline()
                    .label(if is_downloading { "Downloading…" } else { "Download" })
                    .disabled(!can_download)
                    .on_click(move |_, _, cx| {
                        start_download(cx, &download_view, download_name.clone());
                    }),
            )
            .into_any_element()
    })
}

fn start_download(cx: &mut App, view: &Entity<SettingsView>, model_name: String) {
    let services = crate::app_state::AppServices::global(cx);
    let sink = services.sink.clone();
    let io = services.io.clone();

    {
        let cache = cx.global_mut::<SettingsCache>();
        cache.download_progress.insert(model_name.clone(), 0);
        cache.download_error = None;
    }
    let _ = view.update(cx, |_, cx| cx.notify());

    io.spawn(async move {
        if let Err(e) =
            meetily_core::whisper_engine::download_model_with_progress(sink, model_name.clone())
                .await
        {
            log::warn!("settings: failed to download model '{}': {}", model_name, e);
        }
    });
}
