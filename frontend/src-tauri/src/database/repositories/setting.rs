use crate::database::models::{Setting, TranscriptSetting};
use crate::state::AppState;
use crate::summary::CustomOpenAIConfig;
use sqlx::SqlitePool;
use tauri::State;

// ===== NAMESPACED JSON SETTING KEYS =====
//
// Keys for the generic `app_settings` key-value store (see the "GENERIC
// KEY-VALUE SETTINGS" section below). Each backs a JSON blob previously
// persisted via tauri-plugin-store or hand-rolled file I/O:

/// Onboarding status (see `onboarding::OnboardingStatus`).
pub const KEY_ONBOARDING_STATUS: &str = "onboarding_status";
/// Recording preferences (see `audio::recording_preferences::RecordingPreferences`).
pub const KEY_RECORDING_PREFERENCES: &str = "recording_preferences";
/// Notification settings (see `notifications::settings::NotificationSettings`).
pub const KEY_NOTIFICATION_SETTINGS: &str = "notification_settings";
/// Frontend UI config (language, confidence indicator, auto-summary, provider model cache, ...).
/// Shape is owned by the frontend; the backend stores it as an opaque JSON blob.
pub const KEY_UI_CONFIG: &str = "ui_config";

#[derive(serde::Deserialize, Debug)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(serde::Deserialize, Debug)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

pub struct SettingsRepository;

// Transcript providers: localWhisper, deepgram, elevenLabs, groq, openai
// Summary providers: openai, claude, ollama, groq, added openrouter
// NOTE: Handle data exclusion in the higher layer as this is database abstraction layer(using SELECT *)

impl SettingsRepository {
    pub async fn get_model_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<Setting>, sqlx::Error> {
        let setting = sqlx::query_as::<_, Setting>("SELECT * FROM settings LIMIT 1")
            .fetch_optional(pool)
            .await?;
        Ok(setting)
    }

    pub async fn save_model_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
        whisper_model: &str,
        ollama_endpoint: Option<&str>,
    ) -> std::result::Result<(), sqlx::Error> {
        // Using id '1' for backward compatibility
        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, ollamaEndpoint)
            VALUES ('1', $1, $2, $3, $4)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                whisperModel = excluded.whisperModel,
                ollamaEndpoint = excluded.ollamaEndpoint
            "#,
        )
        .bind(provider)
        .bind(model)
        .bind(whisper_model)
        .bind(ollama_endpoint)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn save_api_key(
        pool: &SqlitePool,
        provider: &str,
        api_key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        // Custom OpenAI uses JSON config (customOpenAIConfig) instead of a separate API key column
        if provider == "custom-openai" {
            return Err(sqlx::Error::Protocol(
                "custom-openai provider should use save_custom_openai_config() instead of save_api_key()".into(),
            ));
        }

        let api_key_column = match provider {
            "openai" => "openaiApiKey",
            "claude" => "anthropicApiKey",
            "ollama" => "ollamaApiKey",
            "groq" => "groqApiKey",
            "openrouter" => "openRouterApiKey",
            "builtin-ai" => return Ok(()), // No API key needed
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = format!(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, "{}")
            VALUES ('1', 'openai', 'gpt-4o-2024-11-20', 'large-v3', $1)
            ON CONFLICT(id) DO UPDATE SET
                "{}" = $1
            "#,
            api_key_column, api_key_column
        );
        sqlx::query(&query).bind(api_key).execute(pool).await?;

        Ok(())
    }

    pub async fn get_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        // Custom OpenAI uses JSON config - extract API key from there
        if provider == "custom-openai" {
            let config = Self::get_custom_openai_config(pool).await?;
            return Ok(config.and_then(|c| c.api_key));
        }

        let api_key_column = match provider {
            "openai" => "openaiApiKey",
            "ollama" => "ollamaApiKey",
            "groq" => "groqApiKey",
            "claude" => "anthropicApiKey",
            "openrouter" => "openRouterApiKey",
            "builtin-ai" => return Ok(None), // No API key needed
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = format!(
            "SELECT {} FROM settings WHERE id = '1' LIMIT 1",
            api_key_column
        );
        let api_key = sqlx::query_scalar(&query).fetch_optional(pool).await?;
        Ok(api_key)
    }

    pub async fn get_transcript_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<TranscriptSetting>, sqlx::Error> {
        let setting =
            sqlx::query_as::<_, TranscriptSetting>("SELECT * FROM transcript_settings LIMIT 1")
                .fetch_optional(pool)
                .await?;
        Ok(setting)
    }

    pub async fn save_transcript_config(
        pool: &SqlitePool,
        provider: &str,
        model: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO transcript_settings (id, provider, model)
            VALUES ('1', $1, $2)
            ON CONFLICT(id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model
            "#,
        )
        .bind(provider)
        .bind(model)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn save_transcript_api_key(
        pool: &SqlitePool,
        provider: &str,
        api_key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        let api_key_column = match provider {
            "localWhisper" => "whisperApiKey",
            "deepgram" => "deepgramApiKey",
            "elevenLabs" => "elevenLabsApiKey",
            "groq" => "groqApiKey",
            "openai" => "openaiApiKey",
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        // Default row inserted when first setting an API key uses the local
        // Whisper provider/model — the user can switch later from settings.
        let query = format!(
            r#"
            INSERT INTO transcript_settings (id, provider, model, "{}")
            VALUES ('1', 'localWhisper', '{}', $1)
            ON CONFLICT(id) DO UPDATE SET
                "{}" = $1
            "#,
            api_key_column,
            crate::config::DEFAULT_WHISPER_MODEL,
            api_key_column
        );
        sqlx::query(&query).bind(api_key).execute(pool).await?;

        Ok(())
    }

    pub async fn get_transcript_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        let api_key_column = match provider {
            "localWhisper" => "whisperApiKey",
            "deepgram" => "deepgramApiKey",
            "elevenLabs" => "elevenLabsApiKey",
            "groq" => "groqApiKey",
            "openai" => "openaiApiKey",
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = format!(
            "SELECT {} FROM transcript_settings WHERE id = '1' LIMIT 1",
            api_key_column
        );
        let api_key = sqlx::query_scalar(&query).fetch_optional(pool).await?;
        Ok(api_key)
    }

    pub async fn delete_api_key(
        pool: &SqlitePool,
        provider: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        // Custom OpenAI uses JSON config - clear the entire config
        if provider == "custom-openai" {
            sqlx::query("UPDATE settings SET customOpenAIConfig = NULL WHERE id = '1'")
                .execute(pool)
                .await?;
            return Ok(());
        }

        let api_key_column = match provider {
            "openai" => "openaiApiKey",
            "ollama" => "ollamaApiKey",
            "groq" => "groqApiKey",
            "claude" => "anthropicApiKey",
            "openrouter" => "openRouterApiKey",
            "builtin-ai" => return Ok(()), // No API key needed
            _ => {
                return Err(sqlx::Error::Protocol(
                    format!("Invalid provider: {}", provider).into(),
                ))
            }
        };

        let query = format!(
            "UPDATE settings SET {} = NULL WHERE id = '1'",
            api_key_column
        );
        sqlx::query(&query).execute(pool).await?;

        Ok(())
    }

    // ===== CUSTOM OPENAI CONFIG METHODS =====

    /// Gets the custom OpenAI configuration from JSON
    ///
    /// # Returns
    /// * `Ok(Some(CustomOpenAIConfig))` - Config exists and is valid JSON
    /// * `Ok(None)` - No config stored
    /// * `Err(sqlx::Error)` - Database error
    pub async fn get_custom_openai_config(
        pool: &SqlitePool,
    ) -> std::result::Result<Option<CustomOpenAIConfig>, sqlx::Error> {
        use sqlx::Row;

        let row = sqlx::query(
            r#"
            SELECT customOpenAIConfig
            FROM settings
            WHERE id = '1'
            LIMIT 1
            "#,
        )
        .fetch_optional(pool)
        .await?;

        match row {
            Some(record) => {
                let config_json: Option<String> = record.get("customOpenAIConfig");

                if let Some(json) = config_json {
                    // Parse JSON into CustomOpenAIConfig
                    let config: CustomOpenAIConfig = serde_json::from_str(&json).map_err(|e| {
                        sqlx::Error::Protocol(
                            format!("Invalid JSON in customOpenAIConfig: {}", e).into(),
                        )
                    })?;

                    Ok(Some(config))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    /// Saves the custom OpenAI configuration as JSON
    ///
    /// # Arguments
    /// * `pool` - Database connection pool
    /// * `config` - CustomOpenAIConfig to save (includes endpoint, apiKey, model, maxTokens, temperature, topP)
    ///
    /// # Returns
    /// * `Ok(())` - Config saved successfully
    /// * `Err(sqlx::Error)` - Database or JSON serialization error
    pub async fn save_custom_openai_config(
        pool: &SqlitePool,
        config: &CustomOpenAIConfig,
    ) -> std::result::Result<(), sqlx::Error> {
        // Serialize config to JSON
        let config_json = serde_json::to_string(config).map_err(|e| {
            sqlx::Error::Protocol(format!("Failed to serialize config to JSON: {}", e).into())
        })?;

        // Upsert into settings table
        sqlx::query(
            r#"
            INSERT INTO settings (id, provider, model, whisperModel, customOpenAIConfig)
            VALUES ('1', 'custom-openai', $1, 'large-v3', $2)
            ON CONFLICT(id) DO UPDATE SET
                customOpenAIConfig = excluded.customOpenAIConfig
            "#,
        )
        .bind(&config.model)
        .bind(config_json)
        .execute(pool)
        .await?;

        Ok(())
    }

    // ===== GENERIC KEY-VALUE SETTINGS =====
    //
    // Backs namespaced JSON settings blobs (onboarding status, recording
    // preferences, notification settings, frontend UI config) in the
    // `app_settings` table, replacing tauri-plugin-store JSON files and
    // hand-rolled config file I/O across the app.

    /// Gets the raw JSON string stored under `key`, if any.
    pub async fn get_setting_json(
        pool: &SqlitePool,
        key: &str,
    ) -> std::result::Result<Option<String>, sqlx::Error> {
        let value: Option<String> =
            sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
                .bind(key)
                .fetch_optional(pool)
                .await?;
        Ok(value)
    }

    /// Upserts a raw JSON string under `key`.
    pub async fn set_setting_json(
        pool: &SqlitePool,
        key: &str,
        value: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(key)
        .bind(value)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Deletes the row stored under `key`, if any.
    pub async fn delete_setting(
        pool: &SqlitePool,
        key: &str,
    ) -> std::result::Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM app_settings WHERE key = $1")
            .bind(key)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// Gets and deserializes a typed setting stored under `key`.
    pub async fn get_setting<T: serde::de::DeserializeOwned>(
        pool: &SqlitePool,
        key: &str,
    ) -> std::result::Result<Option<T>, sqlx::Error> {
        match Self::get_setting_json(pool, key).await? {
            Some(json) => {
                let value = serde_json::from_str(&json).map_err(|e| {
                    sqlx::Error::Protocol(
                        format!("Invalid JSON for setting '{}': {}", key, e).into(),
                    )
                })?;
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    /// Serializes and upserts a typed setting under `key`.
    pub async fn set_setting<T: serde::Serialize>(
        pool: &SqlitePool,
        key: &str,
        value: &T,
    ) -> std::result::Result<(), sqlx::Error> {
        let json = serde_json::to_string(value).map_err(|e| {
            sqlx::Error::Protocol(format!("Failed to serialize setting '{}': {}", key, e).into())
        })?;
        Self::set_setting_json(pool, key, &json).await
    }
}

// ===== FRONTEND UI CONFIG COMMANDS =====
//
// Thin Tauri commands backing ConfigContext's previously-localStorage-only
// preferences (primary language, confidence indicator toggle, auto-summary
// toggle, per-provider model cache, ...). The shape is owned entirely by the
// frontend — the backend just persists whatever JSON blob it's handed.

/// Gets the saved frontend UI config blob, or `None` if nothing has been saved yet.
#[tauri::command]
pub async fn api_get_ui_config(
    state: State<'_, AppState>,
) -> std::result::Result<Option<serde_json::Value>, String> {
    let pool = state.db_manager.pool();
    SettingsRepository::get_setting_json(pool, KEY_UI_CONFIG)
        .await
        .map(|opt| opt.and_then(|json| serde_json::from_str(&json).ok()))
        .map_err(|e| format!("Failed to load UI config: {}", e))
}

/// Saves the frontend UI config blob (full replace).
#[tauri::command]
pub async fn api_save_ui_config(
    state: State<'_, AppState>,
    config: serde_json::Value,
) -> std::result::Result<(), String> {
    let pool = state.db_manager.pool();
    SettingsRepository::set_setting(pool, KEY_UI_CONFIG, &config)
        .await
        .map_err(|e| format!("Failed to save UI config: {}", e))
}
