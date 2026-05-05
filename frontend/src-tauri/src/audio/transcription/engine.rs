// audio/transcription/engine.rs
//
// TranscriptionEngine enum and model initialization/validation logic.
// Whisper is the local ASR engine; remote providers (OpenAI, Groq, Deepgram,
// etc.) plug in via the `Provider` variant + `TranscriptionProvider` trait.

use super::provider::TranscriptionProvider;
use log::{info, warn};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

// Transcription engine abstraction.
pub enum TranscriptionEngine {
    Whisper(Arc<crate::whisper_engine::WhisperEngine>), // Local Whisper (direct access)
    Provider(Arc<dyn TranscriptionProvider>),           // Trait-based (remote / future engines)
}

impl TranscriptionEngine {
    pub async fn is_model_loaded(&self) -> bool {
        match self {
            Self::Whisper(engine) => engine.is_model_loaded().await,
            Self::Provider(provider) => provider.is_model_loaded().await,
        }
    }

    pub async fn get_current_model(&self) -> Option<String> {
        match self {
            Self::Whisper(engine) => engine.get_current_model().await,
            Self::Provider(provider) => provider.get_current_model().await,
        }
    }

    pub fn provider_name(&self) -> &str {
        match self {
            Self::Whisper(_) => "Whisper (direct)",
            Self::Provider(provider) => provider.provider_name(),
        }
    }
}

/// Validate that the local Whisper model is ready before recording starts.
pub async fn validate_transcription_model_ready<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    info!("🔍 Validating Whisper model...");

    if let Err(init_error) = crate::whisper_engine::commands::whisper_init().await {
        warn!("❌ Failed to initialize Whisper engine: {}", init_error);
        return Err(format!(
            "Failed to initialize speech recognition: {}",
            init_error
        ));
    }

    match crate::whisper_engine::commands::whisper_validate_model_ready_with_config(app).await {
        Ok(model_name) => {
            info!(
                "✅ Whisper model validation successful: {} is ready",
                model_name
            );
            Ok(())
        }
        Err(e) => {
            warn!("❌ Whisper model validation failed: {}", e);
            Err(e)
        }
    }
}

/// Get or initialize the Whisper transcription engine for live recording.
/// Remote providers (e.g., OpenAI) are not used during the live audio path —
/// the worker pool is currently Whisper-only.
pub async fn get_or_init_transcription_engine<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TranscriptionEngine, String> {
    info!("🎤 Initializing Whisper transcription engine");
    let whisper_engine = get_or_init_whisper(app).await?;
    Ok(TranscriptionEngine::Whisper(whisper_engine))
}

/// Get or initialize the Whisper engine, loading the model from saved config.
pub async fn get_or_init_whisper<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Arc<crate::whisper_engine::WhisperEngine>, String> {
    // Check if engine already exists and has a model loaded
    let existing_engine = {
        let engine_guard = crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .unwrap();
        engine_guard.as_ref().cloned()
    };

    if let Some(engine) = existing_engine {
        if engine.is_model_loaded().await {
            let current_model = engine
                .get_current_model()
                .await
                .unwrap_or_else(|| "unknown".to_string());

            // Check if loaded model matches saved config; reload if not.
            let configured_model = match crate::api::api::api_get_transcript_config(
                app.clone(),
                app.clone().state(),
                None,
            )
            .await
            {
                Ok(Some(config)) => {
                    info!(
                        "📝 Saved transcript config - provider: {}, model: {}",
                        config.provider, config.model
                    );
                    if config.provider == "localWhisper" && !config.model.is_empty() {
                        Some(config.model)
                    } else {
                        None
                    }
                }
                Ok(None) => None,
                Err(e) => {
                    warn!("⚠️ Failed to get transcript config: {}", e);
                    None
                }
            };

            if let Some(ref expected_model) = configured_model {
                if current_model == *expected_model {
                    info!(
                        "✅ Loaded model '{}' matches saved config, reusing",
                        current_model
                    );
                    return Ok(engine);
                } else {
                    info!(
                        "🔄 Loaded model '{}' doesn't match saved config '{}', reloading...",
                        current_model, expected_model
                    );
                    engine.unload_model().await;
                }
            } else {
                info!(
                    "✅ No specific model configured, using currently loaded model: '{}'",
                    current_model
                );
                return Ok(engine);
            }
        } else {
            info!("🔄 Whisper engine exists but no model loaded, will load model from config");
        }
    }

    info!("Initializing Whisper engine");
    if let Err(e) = crate::whisper_engine::commands::whisper_init().await {
        return Err(format!("Failed to initialize Whisper engine: {}", e));
    }

    let engine = {
        let engine_guard = crate::whisper_engine::commands::WHISPER_ENGINE
            .lock()
            .unwrap();
        engine_guard
            .as_ref()
            .cloned()
            .ok_or("Failed to get initialized engine")?
    };

    let model_to_load = match crate::api::api::api_get_transcript_config(
        app.clone(),
        app.clone().state(),
        None,
    )
    .await
    {
        Ok(Some(config)) => {
            info!(
                "Got transcript config from API - provider: {}, model: {}",
                config.provider, config.model
            );
            if config.provider == "localWhisper" {
                config.model
            } else {
                return Err(format!(
                    "Cannot initialize Whisper engine: config uses provider '{}'. Local recording requires 'localWhisper'.",
                    config.provider
                ));
            }
        }
        Ok(None) => {
            info!("No transcript config found in API, falling back to 'small'");
            "small".to_string()
        }
        Err(e) => {
            warn!(
                "Failed to get transcript config from API: {}, falling back to 'small'",
                e
            );
            "small".to_string()
        }
    };

    info!("Selected model to load: {}", model_to_load);
    let models = engine
        .discover_models()
        .await
        .map_err(|e| format!("Failed to discover models: {}", e))?;

    let model_info = models.iter().find(|model| model.name == model_to_load);

    match model_info {
        Some(model) => match model.status {
            crate::whisper_engine::ModelStatus::Available => {
                info!("Loading model: {}", model_to_load);
                engine
                    .load_model(&model_to_load)
                    .await
                    .map_err(|e| format!("Failed to load model '{}': {}", model_to_load, e))?;
                info!("✅ Model '{}' loaded successfully", model_to_load);
            }
            crate::whisper_engine::ModelStatus::Missing => {
                return Err(format!(
                    "Model '{}' is not downloaded. Please download it from settings first.",
                    model_to_load
                ));
            }
            crate::whisper_engine::ModelStatus::Downloading { progress } => {
                return Err(format!(
                    "Model '{}' is currently downloading ({}%). Please wait.",
                    model_to_load, progress
                ));
            }
            crate::whisper_engine::ModelStatus::Error(ref err) => {
                return Err(format!(
                    "Model '{}' has an error: {}. Please re-download.",
                    model_to_load, err
                ));
            }
            crate::whisper_engine::ModelStatus::Corrupted { .. } => {
                return Err(format!(
                    "Model '{}' is corrupted. Please delete and re-download.",
                    model_to_load
                ));
            }
        },
        None => {
            // Fall back to any available model
            let available_models: Vec<_> = models
                .iter()
                .filter(|m| matches!(m.status, crate::whisper_engine::ModelStatus::Available))
                .collect();

            if let Some(fallback_model) = available_models.first() {
                warn!(
                    "Model '{}' not found, falling back to available model: '{}'",
                    model_to_load, fallback_model.name
                );
                engine.load_model(&fallback_model.name).await.map_err(|e| {
                    format!(
                        "Failed to load fallback model '{}': {}",
                        fallback_model.name, e
                    )
                })?;
                info!(
                    "✅ Fallback model '{}' loaded successfully",
                    fallback_model.name
                );
            } else {
                return Err(format!(
                    "Model '{}' is not supported and no other models are available. Please download a model from settings.",
                    model_to_load
                ));
            }
        }
    }

    Ok(engine)
}
