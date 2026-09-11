//! "Summary" settings page: provider + model, API keys, the custom
//! OpenAI-compatible endpoint, default summary template, and the
//! language/auto-summary preferences the React app keeps in `ConfigContext`.
//!
//! Reads/writes the same `settings` row the Tauri app's
//! `api_save_model_config`/`api_get_model_config` commands use (via
//! `SettingsRepository`, already Tauri-free in core). Built-in AI models
//! come from `summary::summary_engine::models::get_available_models`, the
//! same catalog the sidecar downloads from.
//!
//! - API keys: same `settings`/`transcript_settings` columns as
//!   `SettingsRepository::save_api_key`/`get_api_key`/`delete_api_key`
//!   (the core logic behind `api_save_model_config`'s key-saving branch and
//!   `api_delete_api_key`), keyed by the same provider ids React's
//!   `ModelConfig.provider` uses (`openai`/`claude`/`groq`/`openrouter`) —
//!   note this page previously used `"anthropic"` for Claude's provider id,
//!   which doesn't match any `save_api_key` column and silently failed key
//!   lookups; fixed to `"claude"` here since API-key wiring depends on it.
//! - Custom OpenAI-compatible endpoint: same `settings.customOpenAIConfig`
//!   JSON blob as `ModelSettingsModal`'s `CustomOpenAISection`
//!   (`SettingsRepository::save_custom_openai_config`/`get_custom_openai_config`).
//! - Default summary template: `KEY_DEFAULT_SUMMARY_TEMPLATE` — NEW, since
//!   React's `useTemplates` keeps template selection as per-meeting-session
//!   local state only (see that key's doc comment in `meetily-core`).
//! - Language / confidence indicator / auto-summary: the same `ui_config`
//!   JSON blob (`KEY_UI_CONFIG`) React's `ConfigContext.persistUiConfig`
//!   writes (`primaryLanguage`/`showConfidenceIndicator`/`isAutoSummary`).

use gpui_kit::component::{
    h_flex,
    input::{Input, InputContentType, InputEvent, InputState},
    label::Label,
    setting::{SettingField, SettingGroup, SettingItem, SettingPage},
    ActiveTheme, Icon, Sizable as _,
};
use gpui_kit::*;

use meetily_core::summary::summary_engine::models::get_available_models;
use meetily_core::summary::CustomOpenAIConfig;

use super::state::SettingsCache;
use super::SettingsView;

const PROVIDERS: &[(&str, &str)] = &[
    ("builtin-ai", "Built-in AI (local)"),
    ("ollama", "Ollama"),
    ("openai", "OpenAI"),
    ("claude", "Claude"),
    ("groq", "Groq"),
    ("openrouter", "OpenRouter"),
    ("custom-openai", "Custom OpenAI-compatible"),
];

/// Providers that take a plain API key via `SettingsRepository::save_api_key`.
/// `custom-openai` is handled separately (its key lives inside the JSON
/// `customOpenAIConfig` blob); `builtin-ai`/`ollama` need no key.
const API_KEY_PROVIDERS: &[(&str, &str)] = &[
    ("openai", "OpenAI API key"),
    ("claude", "Claude API key"),
    ("groq", "Groq API key"),
    ("openrouter", "OpenRouter API key"),
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
    let is_custom_openai = provider == "custom-openai";

    let mut page = SettingPage::new("Summary")
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
            ]),
        );

    if is_custom_openai {
        page = page.group(custom_openai_group(&view));
    } else {
        page = page.group(
            SettingGroup::new().title("Model").items(vec![
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
        );
    }

    page = page.group(
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
    );

    let mut key_items = Vec::new();
    for (id, label) in API_KEY_PROVIDERS {
        key_items.push(api_key_item(&view, id, label));
    }
    page = page.group(
        SettingGroup::new()
            .title("API keys")
            .description("Stored locally in SQLite (plaintext), same as the Tauri app. Leave blank to clear.")
            .items(key_items),
    );

    page = page.group(
        SettingGroup::new().title("Templates").item(
            SettingItem::new(
                "Default summary template",
                SettingField::dropdown(
                    SettingsCache::global(cx)
                        .templates
                        .iter()
                        .map(|(id, name, _)| (SharedString::from(id.clone()), SharedString::from(name.clone())))
                        .collect(),
                    |cx: &App| SharedString::from(SettingsCache::global(cx).default_template_id.clone()),
                    {
                        let view = view.clone();
                        move |val: SharedString, cx: &mut App| {
                            super::state::save_default_template(cx, &view, val.to_string());
                        }
                    },
                ),
            )
            .description("Pre-selected when generating a new meeting summary."),
        ),
    );

    page = page.group(
        SettingGroup::new().title("Language & summaries").items(vec![
            SettingItem::new(
                "Transcription language",
                SettingField::input(
                    |cx: &App| SharedString::from(SettingsCache::global(cx).ui_str("primaryLanguage")),
                    {
                        let view = view.clone();
                        move |val: SharedString, cx: &mut App| {
                            super::state::save_ui_field(
                                cx,
                                &view,
                                "primaryLanguage",
                                serde_json::Value::String(val.to_string()),
                            );
                        }
                    },
                )
                .default_value(SharedString::from("en")),
            )
            .description("ISO language code, or blank for auto-detect. Same `ui_config` row the React app uses."),
            SettingItem::new(
                "Show transcription confidence",
                SettingField::switch(
                    |cx: &App| SettingsCache::global(cx).ui_bool("showConfidenceIndicator", false),
                    {
                        let view = view.clone();
                        move |val: bool, cx: &mut App| {
                            super::state::save_ui_field(
                                cx,
                                &view,
                                "showConfidenceIndicator",
                                serde_json::Value::Bool(val),
                            );
                        }
                    },
                ),
            ),
            SettingItem::new(
                "Auto-summarize after recording",
                SettingField::switch(
                    |cx: &App| SettingsCache::global(cx).ui_bool("isAutoSummary", false),
                    {
                        let view = view.clone();
                        move |val: bool, cx: &mut App| {
                            super::state::save_ui_field(cx, &view, "isAutoSummary", serde_json::Value::Bool(val));
                        }
                    },
                ),
            ),
        ]),
    );

    page
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

/// A masked API-key entry for `provider`. Saves on every change (same
/// auto-save UX as every other field on this page); an empty value clears
/// the stored key (`SettingsRepository::delete_api_key`, via
/// `state::save_api_key`).
fn api_key_item(view: &Entity<SettingsView>, provider: &'static str, label: &'static str) -> SettingItem {
    let view = view.clone();
    SettingItem::new(
        label,
        SettingField::render(move |_options, window, cx| {
            let has_key = SettingsCache::global(cx)
                .api_key_present
                .get(provider)
                .copied()
                .unwrap_or(false);

            struct KeyInputState {
                input: Entity<InputState>,
                _subscription: Subscription,
            }

            let key_id = SharedString::from(format!("summary-api-key-{}", provider));
            let state = window.use_keyed_state(key_id, cx, {
                let view = view.clone();
                move |window, cx| {
                    let input = cx.new(|cx| {
                        InputState::new(window, cx).placeholder(if has_key {
                            "•••••••••••••••• (saved — type to replace)"
                        } else {
                            "Not set"
                        })
                    });
                    let subscription = cx.subscribe(&input, {
                        let view = view.clone();
                        move |_, input, event: &InputEvent, cx| {
                            if matches!(event, InputEvent::Change) {
                                let value = input.read(cx).value().to_string();
                                super::state::save_api_key(cx, &view, provider.to_string(), value);
                            }
                        }
                    });
                    KeyInputState { input, _subscription: subscription }
                }
            });
            let input_entity = state.read(cx).input.clone();

            h_flex()
                .w_full()
                .items_center()
                .gap_2()
                .child(
                    Input::new(&input_entity)
                        .content_type(InputContentType::Password)
                        .small()
                        .w_64(),
                )
                .child(if has_key {
                    Label::new("Configured").text_color(cx.theme().success)
                } else {
                    Label::new("Not set").text_color(cx.theme().muted_foreground)
                })
                .into_any_element()
        }),
    )
}

/// Custom OpenAI-compatible endpoint config: mirrors `ModelSettingsModal`'s
/// `CustomOpenAISection` (endpoint/model/max tokens/temperature/top-p plus
/// its own API key), saved as one JSON blob via
/// `SettingsRepository::save_custom_openai_config`.
fn custom_openai_group(view: &Entity<SettingsView>) -> SettingGroup {
    let view = view.clone();

    fn current(cx: &App) -> CustomOpenAIConfig {
        SettingsCache::global(cx).custom_openai.clone().unwrap_or(CustomOpenAIConfig {
            endpoint: String::new(),
            api_key: None,
            model: String::new(),
            max_tokens: None,
            temperature: None,
            top_p: None,
        })
    }

    fn set(cx: &mut App, view: &Entity<SettingsView>, mutate: impl FnOnce(&mut CustomOpenAIConfig)) {
        let mut config = current(cx);
        mutate(&mut config);
        super::state::save_custom_openai(cx, view, config);
    }

    SettingGroup::new()
        .title("Custom OpenAI-compatible endpoint")
        .description("For self-hosted or third-party servers implementing the OpenAI chat-completions API.")
        .items(vec![
            SettingItem::new(
                "Endpoint URL",
                SettingField::input(
                    |cx: &App| SharedString::from(current(cx).endpoint),
                    {
                        let view = view.clone();
                        move |val: SharedString, cx: &mut App| {
                            set(cx, &view, |c| c.endpoint = val.to_string());
                        }
                    },
                )
                .default_value(SharedString::from("http://localhost:8000/v1")),
            ),
            SettingItem::new(
                "Model",
                SettingField::input(
                    |cx: &App| SharedString::from(current(cx).model),
                    {
                        let view = view.clone();
                        move |val: SharedString, cx: &mut App| {
                            set(cx, &view, |c| c.model = val.to_string());
                        }
                    },
                ),
            ),
            SettingItem::new(
                "API key",
                SettingField::input(
                    |cx: &App| SharedString::from(current(cx).api_key.unwrap_or_default()),
                    {
                        let view = view.clone();
                        move |val: SharedString, cx: &mut App| {
                            let text = val.to_string();
                            set(cx, &view, |c| {
                                c.api_key = if text.is_empty() { None } else { Some(text) };
                            });
                        }
                    },
                )
                .default_value(SharedString::default()),
            )
            .description("Optional — leave blank if the server doesn't require one."),
        ])
}
