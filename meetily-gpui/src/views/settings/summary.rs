//! "Summary" settings page: provider + model, and the Ollama endpoint.
//!
//! Reads/writes the same `settings` row the Tauri app's
//! `api_save_model_config`/`api_get_model_config` commands use (via
//! `SettingsRepository`, already Tauri-free in core). Built-in AI models
//! come from `summary::summary_engine::models::get_available_models`, the
//! same catalog the sidecar downloads from.
//!
//! API-key entry is out of scope for this slice (it needs secure storage
//! and per-provider validation UX beyond a single masked input) — deferred,
//! same as noted in the phase 1 report.

use gpui_kit::component::{
    setting::{SettingField, SettingGroup, SettingItem, SettingPage},
    Icon,
};
use gpui_kit::*;

use meetily_core::summary::summary_engine::models::get_available_models;

use super::state::SettingsCache;
use super::SettingsView;

const PROVIDERS: &[(&str, &str)] = &[
    ("builtin-ai", "Built-in AI (local)"),
    ("ollama", "Ollama"),
    ("openai", "OpenAI"),
    ("anthropic", "Claude"),
    ("groq", "Groq"),
    ("openrouter", "OpenRouter"),
];

pub fn page(view: &Entity<SettingsView>, cx: &mut Context<SettingsView>) -> SettingPage {
    let view = view.clone();

    let provider_options: Vec<(SharedString, SharedString)> = PROVIDERS
        .iter()
        .map(|(id, label)| (SharedString::from(*id), SharedString::from(*label)))
        .collect();

    let builtin_models = get_available_models();
    let model_options: Vec<(SharedString, SharedString)> = builtin_models
        .iter()
        .map(|m| (SharedString::from(m.name.clone()), SharedString::from(m.display_name.clone())))
        .collect();

    let provider = SettingsCache::global(cx).summary.provider.clone();
    let is_builtin = provider.is_empty() || provider == "builtin-ai";

    SettingPage::new("Summary")
        .icon(Icon::new(gpui_kit::assets::IconName::MessageSquare))
        .group(
            SettingGroup::new().title("Provider").items(vec![
                SettingItem::new(
                    "Provider",
                    SettingField::dropdown(
                        provider_options,
                        |cx: &App| {
                            let provider = SettingsCache::global(cx).summary.provider.clone();
                            SharedString::from(if provider.is_empty() {
                                "builtin-ai".to_string()
                            } else {
                                provider
                            })
                        },
                        {
                            let view = view.clone();
                            move |val: SharedString, cx: &mut App| {
                                set_summary(cx, &view, |cfg| cfg.provider = val.to_string());
                            }
                        },
                    ),
                )
                .description("Which service generates meeting summaries."),
                SettingItem::new(
                    "Model",
                    if is_builtin {
                        SettingField::dropdown(
                            model_options,
                            |cx: &App| SharedString::from(SettingsCache::global(cx).summary.model.clone()),
                            {
                                let view = view.clone();
                                move |val: SharedString, cx: &mut App| {
                                    set_summary(cx, &view, |cfg| cfg.model = val.to_string());
                                }
                            },
                        )
                    } else {
                        SettingField::input(
                            |cx: &App| SharedString::from(SettingsCache::global(cx).summary.model.clone()),
                            {
                                let view = view.clone();
                                move |val: SharedString, cx: &mut App| {
                                    set_summary(cx, &view, |cfg| cfg.model = val.to_string());
                                }
                            },
                        )
                    },
                )
                .description("Built-in AI runs entirely on-device; other providers send transcripts out."),
            ]),
        )
        .group(
            SettingGroup::new().title("Ollama").item(
                SettingItem::new(
                    "Endpoint",
                    SettingField::input(
                        |cx: &App| SharedString::from(SettingsCache::global(cx).summary.ollama_endpoint.clone()),
                        {
                            let view = view.clone();
                            move |val: SharedString, cx: &mut App| {
                                set_summary(cx, &view, |cfg| cfg.ollama_endpoint = val.to_string());
                            }
                        },
                    )
                    .default_value(SharedString::from("http://localhost:11434")),
                )
                .description("Used only when the provider above is set to Ollama."),
            ),
        )
}

fn set_summary(
    cx: &mut App,
    view: &Entity<SettingsView>,
    mutate: impl FnOnce(&mut super::state::SummaryConfig),
) {
    let updated = {
        let cache = cx.global_mut::<SettingsCache>();
        mutate(&mut cache.summary);
        cache.summary.clone()
    };
    let whisper_model = SettingsCache::global(cx).transcript.model.clone();
    super::state::save_summary(
        cx,
        updated.provider,
        updated.model,
        whisper_model,
        if updated.ollama_endpoint.is_empty() {
            None
        } else {
            Some(updated.ollama_endpoint)
        },
    );
    let _ = view.update(cx, |_, cx| cx.notify());
}
