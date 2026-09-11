//! Shared, loaded-once cache backing every settings page.
//!
//! `gpui-kit`'s `SettingField` getters/setters are plain synchronous
//! `Fn(&App) -> T` / `Fn(T, &mut App)` closures — there's nowhere to
//! `.await` a DB round trip in them. So settings are read from SQLite once
//! (on `SettingsView::new`, via `Io`) into this `Global`, and every field
//! reads/writes the cache directly (instant, no flicker) while a setter
//! also fires an async save through `Io` to persist it. This is the same
//! shape the Tauri frontend uses (React state + a debounced/immediate save
//! call), just without React.
use std::collections::HashMap;

use gpui_kit::{App, BorrowAppContext, Entity, Global};

use meetily_core::audio::pw::PwDevice;
use meetily_core::audio::recording_preferences::RecordingPreferences;
use meetily_core::database::repositories::setting::SettingsRepository;
use meetily_core::whisper_engine::ModelInfo;

use crate::app_state::AppServices;
use crate::runtime::Io;

use super::SettingsView;

/// Saved transcript config (`transcript_settings` table): which provider is
/// active, and — for `localWhisper` — which model.
#[derive(Clone, Default)]
pub struct TranscriptConfig {
    pub provider: String,
    pub model: String,
}

/// Saved summary/model config (`settings` table): the built-in-AI or remote
/// provider/model pair the summary engine uses, plus the Ollama endpoint.
#[derive(Clone, Default)]
pub struct SummaryConfig {
    pub provider: String,
    pub model: String,
    pub ollama_endpoint: String,
}

#[derive(Clone, Default)]
pub struct SettingsCache {
    pub loaded: bool,
    pub recording: RecordingPreferences,
    pub transcript: TranscriptConfig,
    pub summary: SummaryConfig,
    pub whisper_models: Vec<ModelInfo>,
    pub mic_devices: Vec<PwDevice>,
    pub system_devices: Vec<PwDevice>,
    /// modelName -> percent complete, for a model currently downloading.
    pub download_progress: HashMap<String, u8>,
    pub download_error: Option<String>,
}

impl Global for SettingsCache {}

impl SettingsCache {
    pub fn global(cx: &App) -> &SettingsCache {
        cx.global::<SettingsCache>()
    }
}

/// Load every setting this view needs from SQLite/the whisper engine/the
/// PipeWire registry, then populate the `SettingsCache` global and redraw
/// `view`. Best-effort per field: a failure on one doesn't block the rest.
pub fn load(view: Entity<SettingsView>, cx: &mut App) {
    if !cx.has_global::<SettingsCache>() {
        cx.set_global(SettingsCache::default());
    }

    let services = AppServices::global(cx);
    let io = services.io.clone();
    let pool = services.pool();

    // Every core call below needs a live tokio reactor (sqlx is
    // `runtime-tokio`), which GPUI's own executor doesn't provide — so the
    // whole batch runs as one future on `Io`'s tokio runtime, and only the
    // finished result crosses back over to a GPUI task to update the cache.
    cx.spawn(async move |cx| {
        let loaded = io
            .spawn(async move {
                let recording =
                    meetily_core::audio::recording_preferences::load_recording_preferences(
                        pool.clone(),
                    )
                    .await
                    .unwrap_or_default();

                let transcript = match &pool {
                    Some(pool) => match SettingsRepository::get_transcript_config(pool).await {
                        Ok(Some(cfg)) => TranscriptConfig {
                            provider: cfg.provider,
                            model: cfg.model,
                        },
                        _ => TranscriptConfig {
                            provider: "localWhisper".to_string(),
                            model: meetily_core::config::DEFAULT_WHISPER_MODEL.to_string(),
                        },
                    },
                    None => TranscriptConfig {
                        provider: "localWhisper".to_string(),
                        model: meetily_core::config::DEFAULT_WHISPER_MODEL.to_string(),
                    },
                };

                let summary = match &pool {
                    Some(pool) => match SettingsRepository::get_model_config(pool).await {
                        Ok(Some(cfg)) => SummaryConfig {
                            provider: cfg.provider,
                            model: cfg.model,
                            ollama_endpoint: cfg.ollama_endpoint.unwrap_or_default(),
                        },
                        _ => SummaryConfig::default(),
                    },
                    None => SummaryConfig::default(),
                };

                let whisper_models = meetily_core::whisper_engine::whisper_get_available_models()
                    .await
                    .unwrap_or_default();

                let (mic_devices, system_devices) =
                    match meetily_core::audio::list_audio_devices().await {
                        Ok(devices) => {
                            let mic = devices
                                .iter()
                                .filter(|d| {
                                    d.kind == meetily_core::audio::pw::PwDeviceKind::Microphone
                                })
                                .cloned()
                                .collect();
                            let sys = devices
                                .into_iter()
                                .filter(|d| {
                                    d.kind == meetily_core::audio::pw::PwDeviceKind::System
                                })
                                .collect();
                            (mic, sys)
                        }
                        Err(e) => {
                            log::warn!("settings: failed to enumerate audio devices: {}", e);
                            (Vec::new(), Vec::new())
                        }
                    };

                (recording, transcript, summary, whisper_models, mic_devices, system_devices)
            })
            .await;

        let Ok((recording, transcript, summary, whisper_models, mic_devices, system_devices)) =
            loaded
        else {
            log::warn!("settings: load task panicked");
            return;
        };

        let _ = cx.update(|cx| {
            cx.update_global::<SettingsCache, _>(|cache, _| {
                cache.loaded = true;
                cache.recording = recording;
                cache.transcript = transcript;
                cache.summary = summary;
                cache.whisper_models = whisper_models;
                cache.mic_devices = mic_devices;
                cache.system_devices = system_devices;
            });
        });
        let _ = view.update(cx, |_, cx| cx.notify());
    })
    .detach();
}

/// Persist `preferences` (recording tab) to SQLite. Fire-and-forget.
pub fn save_recording(cx: &mut App, preferences: RecordingPreferences) {
    let services = AppServices::global(cx);
    let io = services.io.clone();
    let pool = services.pool();
    io.spawn(async move {
        if let Err(e) =
            meetily_core::audio::recording_preferences::save_recording_preferences(
                pool,
                &preferences,
            )
            .await
        {
            log::warn!("settings: failed to save recording preferences: {}", e);
        }
    });
}

/// Persist the transcript (Whisper) config to SQLite.
pub fn save_transcript(cx: &mut App, provider: String, model: String) {
    let Some(pool) = AppServices::global(cx).pool() else {
        log::warn!("settings: no DB pool yet, transcript config not saved");
        return;
    };
    Io::global(cx).spawn(async move {
        if let Err(e) = SettingsRepository::save_transcript_config(&pool, &provider, &model).await
        {
            log::warn!("settings: failed to save transcript config: {}", e);
        }
    });
}

/// Persist the summary/model config to SQLite.
pub fn save_summary(
    cx: &mut App,
    provider: String,
    model: String,
    whisper_model: String,
    ollama_endpoint: Option<String>,
) {
    let Some(pool) = AppServices::global(cx).pool() else {
        log::warn!("settings: no DB pool yet, model config not saved");
        return;
    };
    Io::global(cx).spawn(async move {
        if let Err(e) = SettingsRepository::save_model_config(
            &pool,
            &provider,
            &model,
            &whisper_model,
            ollama_endpoint.as_deref(),
        )
        .await
        {
            log::warn!("settings: failed to save model config: {}", e);
        }
    });
}
