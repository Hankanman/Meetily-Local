use serde::{Deserialize, Serialize};
use std::sync::Mutex as StdMutex;

// Performance optimization: Conditional logging macros for hot paths
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => {
        log::debug!($($arg)*)
    };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};
}

// perf_debug! is auto-visible through `crate::` paths.

// Declare audio module
pub mod anthropic;
pub mod api;
pub mod audio;
pub mod calendar;
pub mod config;
pub mod database;
pub mod groq;
pub mod llm_providers;
pub mod mcp_config;
pub mod notifications;
pub mod ollama;
pub mod onboarding;
pub mod openai;
pub mod openrouter;
pub mod speaker_diarization;
pub mod state;
pub mod summary;
pub mod tray;
pub mod utils;
pub mod whisper_engine;

use audio::{list_audio_devices, trigger_audio_permission};
use log::{error as log_error, info as log_info};
use notifications::commands::NotificationManagerState;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::RwLock;

// Global language preference storage (default to "auto-translate" for automatic translation to English)
static LANGUAGE_PREFERENCE: std::sync::LazyLock<StdMutex<String>> =
    std::sync::LazyLock::new(|| StdMutex::new("auto-translate".to_string()));

#[derive(Debug, Deserialize)]
struct RecordingArgs {
    save_path: String,
}

#[derive(Debug, Serialize, Clone)]
struct TranscriptionStatus {
    chunks_in_queue: usize,
    is_processing: bool,
    last_activity_ms: u64,
}

#[tauri::command]
async fn stop_recording<R: Runtime>(app: AppHandle<R>, args: RecordingArgs) -> Result<(), String> {
    log_info!("Attempting to stop recording...");

    // Check the actual audio recording system state instead of the flag
    if !audio::recording_commands::is_recording().await {
        log_info!("Recording is already stopped");
        return Ok(());
    }

    // Call the actual audio recording system to stop
    match audio::recording_commands::stop_recording(
        app.clone(),
        audio::recording_commands::RecordingArgs {
            save_path: args.save_path.clone(),
        },
    )
    .await
    {
        Ok(_) => {
            tray::update_tray_menu(&app);

            // Create the save directory if it doesn't exist
            if let Some(parent) = std::path::Path::new(&args.save_path).parent() {
                if !parent.exists() {
                    log_info!("Creating directory: {:?}", parent);
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        let err_msg = format!("Failed to create save directory: {}", e);
                        log_error!("{}", err_msg);
                        return Err(err_msg);
                    }
                }
            }

            // Show recording stopped notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_stopped_notification(
                &app,
                &notification_manager_state,
            )
            .await
            {
                log_error!("Failed to show recording stopped notification: {}", e);
            } else {
                log_info!("Successfully showed recording stopped notification");
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to stop audio recording: {}", e);
            tray::update_tray_menu(&app);
            Err(format!("Failed to stop recording: {}", e))
        }
    }
}

#[tauri::command]
async fn is_recording() -> bool {
    audio::recording_commands::is_recording().await
}

#[tauri::command]
fn get_transcription_status() -> TranscriptionStatus {
    TranscriptionStatus {
        chunks_in_queue: 0,
        is_processing: false,
        last_activity_ms: 0,
    }
}

#[tauri::command]
fn read_audio_file(file_path: String) -> Result<Vec<u8>, String> {
    match std::fs::read(&file_path) {
        Ok(data) => Ok(data),
        Err(e) => Err(format!("Failed to read audio file: {}", e)),
    }
}

#[tauri::command]
async fn save_transcript(file_path: String, content: String) -> Result<(), String> {
    log_info!("Saving transcript to: {}", file_path);

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&file_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }

    // Write content to file
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    log_info!("Transcript saved successfully");
    Ok(())
}

// Audio level monitoring commands
#[tauri::command]
async fn start_audio_level_monitoring<R: Runtime>(
    app: AppHandle<R>,
    mic_device: Option<String>,
    system_device: Option<String>,
) -> Result<(), String> {
    log_info!(
        "Starting audio level monitoring (mic={:?}, system={:?})",
        mic_device,
        system_device
    );

    audio::simple_level_monitor::start_monitoring(app, mic_device, system_device)
        .await
        .map_err(|e| format!("Failed to start audio level monitoring: {}", e))
}

#[tauri::command]
async fn stop_audio_level_monitoring() -> Result<(), String> {
    log_info!("Stopping audio level monitoring");

    audio::simple_level_monitor::stop_monitoring()
        .await
        .map_err(|e| format!("Failed to stop audio level monitoring: {}", e))
}

#[tauri::command]
async fn is_audio_level_monitoring() -> bool {
    audio::simple_level_monitor::is_monitoring()
}

// Whisper commands are now handled by whisper_engine::commands module

#[tauri::command]
async fn get_audio_devices() -> Result<Vec<audio::pw::PwDevice>, String> {
    list_audio_devices()
        .await
        .map_err(|e| format!("Failed to list audio devices: {}", e))
}

#[tauri::command]
async fn trigger_microphone_permission() -> Result<bool, String> {
    trigger_audio_permission()
        .map_err(|e| format!("Failed to trigger microphone permission: {}", e))
}

#[tauri::command]
async fn start_recording_with_devices<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
) -> Result<(), String> {
    start_recording_with_devices_and_meeting(app, mic_device_name, system_device_name, None).await
}

#[tauri::command]
async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String> {
    log_info!("🚀 CALLED start_recording_with_devices_and_meeting - Mic: {:?}, System: {:?}, Meeting: {:?}",
             mic_device_name, system_device_name, meeting_name);

    // Clone meeting_name for notification use later
    let meeting_name_for_notification = meeting_name.clone();

    // Call the recording module functions that support meeting names
    let recording_result = match (mic_device_name.clone(), system_device_name.clone()) {
        (None, None) => {
            log_info!(
                "No devices specified, starting with defaults and meeting: {:?}",
                meeting_name
            );
            audio::recording_commands::start_recording_with_meeting_name(app.clone(), meeting_name)
                .await
        }
        _ => {
            log_info!(
                "Starting with specified devices: mic={:?}, system={:?}, meeting={:?}",
                mic_device_name,
                system_device_name,
                meeting_name
            );
            audio::recording_commands::start_recording_with_devices_and_meeting(
                app.clone(),
                mic_device_name,
                system_device_name,
                meeting_name,
            )
            .await
        }
    };

    match recording_result {
        Ok(_) => {
            log_info!("Recording started successfully via tauri command");

            // Show recording started notification through NotificationManager
            // This respects user's notification preferences
            let notification_manager_state = app.state::<NotificationManagerState<R>>();
            if let Err(e) = notifications::commands::show_recording_started_notification(
                &app,
                &notification_manager_state,
                meeting_name_for_notification.clone(),
            )
            .await
            {
                log_error!("Failed to show recording started notification: {}", e);
            }

            Ok(())
        }
        Err(e) => {
            log_error!("Failed to start recording via tauri command: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
async fn set_language_preference(language: String) -> Result<(), String> {
    let mut lang_pref = LANGUAGE_PREFERENCE
        .lock()
        .map_err(|e| format!("Failed to set language preference: {}", e))?;
    log_info!("Setting language preference to: {}", language);
    *lang_pref = language;
    Ok(())
}

// Internal helper function to get language preference (for use within Rust code)
pub fn get_language_preference_internal() -> Option<String> {
    LANGUAGE_PREFERENCE.lock().ok().map(|lang| lang.clone())
}

/// Diagnostic startup audit — logs the on-disk state of every model the app
/// depends on. Pure logging, no behavioural side effects: useful for ruling
/// out missing-model interactions when investigating crashes (especially the
/// sherpa-onnx / silero-rs / ort coexistence issue tracked in retranscription).
async fn audit_models_at_startup<R: Runtime>(app: &AppHandle<R>) {
    log::info!("───────────────── [startup-audit] models report ─────────────────");

    // ── Whisper (ASR) ─────────────────────────────────────────────────────
    match whisper_engine::commands::whisper_get_available_models().await {
        Ok(models) if models.is_empty() => {
            log::warn!("[startup-audit] whisper:  NO models in models directory");
        }
        Ok(models) => {
            for m in &models {
                log::info!(
                    "[startup-audit] whisper:  {:<28} status={:?} size={}MB path={}",
                    m.name,
                    m.status,
                    m.size_mb,
                    m.path.display()
                );
            }
            let n_available = models
                .iter()
                .filter(|m| matches!(m.status, whisper_engine::ModelStatus::Available))
                .count();
            log::info!(
                "[startup-audit] whisper:  {} model(s) available, {} total catalog entries",
                n_available,
                models.len()
            );
        }
        Err(e) => log::warn!("[startup-audit] whisper:  failed to enumerate models: {}", e),
    }

    // ── Speaker diarizer ──────────────────────────────────────────────────
    let speaker_filename = speaker_diarization::model_filename();
    match speaker_diarization::default_model_path() {
        Some(path) => {
            let size_mb = path
                .metadata()
                .map(|m| m.len() / (1024 * 1024))
                .unwrap_or(0);
            let ready = speaker_diarization::model::model_is_ready(&path);
            let status = if ready { "PRESENT" } else { "MISSING" };
            log::info!(
                "[startup-audit] speaker:  {:<28} status={} size={}MB path={}",
                speaker_filename,
                status,
                size_mb,
                path.display()
            );
        }
        None => log::warn!("[startup-audit] speaker:  models directory not configured"),
    }

    // ── VAD (silero via sherpa-onnx) ──────────────────────────────────────
    match speaker_diarization::model::silero_vad_path() {
        Some(path) => {
            let size_mb = path
                .metadata()
                .map(|m| m.len() / (1024 * 1024))
                .unwrap_or(0);
            let ready = speaker_diarization::model::model_is_ready(&path);
            let status = if ready { "PRESENT" } else { "MISSING" };
            log::info!(
                "[startup-audit] vad:      silero_vad.onnx              status={} size={}MB path={}",
                status,
                size_mb,
                path.display()
            );
        }
        None => log::warn!("[startup-audit] vad:      models directory not configured"),
    }

    // ── Summary (built-in AI) ─────────────────────────────────────────────
    match summary::summary_engine::commands::builtin_ai_get_available_summary_model(
        app.clone(),
        app.state(),
    )
    .await
    {
        Ok(Some(name)) => {
            log::info!("[startup-audit] summary:  {} (built-in AI, available)", name);
        }
        Ok(None) => {
            log::warn!(
                "[startup-audit] summary:  NO built-in AI model available (gemma3:1b/4b not downloaded)"
            );
        }
        Err(e) => log::warn!("[startup-audit] summary:  status check failed: {}", e),
    }

    log::info!("─────────────────────────────────────────────────────────────────");
}

/// Background fetch of any built-in models that are missing on disk. Today
/// fetches:
/// - `silero_vad.onnx` — required for VAD (the audio pipeline can't function
///   without it; this is the model sherpa-onnx's `VoiceActivityDetector` uses).
/// - The speaker diarization model — required for "Speaker N" attribution
///   on system audio; without it, system transcripts fall back to the
///   "Speaker" placeholder.
///
/// Both are tiny (~2.3MB + ~28MB). Non-fatal: a failed download just leaves
/// the corresponding feature degraded.
async fn ensure_required_models_downloaded<R: Runtime>(app: &AppHandle<R>) {
    // ── silero VAD ──
    if let Some(silero_path) = speaker_diarization::model::silero_vad_path() {
        if !speaker_diarization::model::model_is_ready(&silero_path) {
            let url = speaker_diarization::model::silero_vad_download_url();
            log::info!(
                "[startup-download] silero-vad missing — fetching {} (~2.3MB, one-time)",
                url
            );
            match download_file_to(url, &silero_path).await {
                Ok(()) => log::info!(
                    "[startup-download] silero-vad downloaded → {}",
                    silero_path.display()
                ),
                Err(e) => log::warn!(
                    "[startup-download] silero-vad download failed: {} \
                     (VAD disabled until next launch — recording / retranscription will error)",
                    e
                ),
            }
        }
    }

    // ── Speaker embedding ──
    let Some(speaker_path) = speaker_diarization::default_model_path() else {
        log::warn!(
            "[startup-download] speaker models dir not configured; cannot fetch speaker model"
        );
        return;
    };

    if speaker_diarization::model::model_is_ready(&speaker_path) {
        log::debug!(
            "[startup-download] speaker model already present at {}",
            speaker_path.display()
        );
    } else {
        log::info!(
            "[startup-download] speaker model missing — fetching {} (~28MB, one-time)",
            speaker_diarization::model_filename()
        );
        match speaker_diarization::commands::speaker_model_download(app.clone()).await {
            Ok(()) => log::info!(
                "[startup-download] speaker model downloaded → {}",
                speaker_path.display()
            ),
            Err(e) => {
                log::warn!(
                    "[startup-download] speaker model download failed: {} \
                     (speaker N attribution disabled)",
                    e
                );
                return;
            }
        }
    }

    // Now that both models are on disk, build the diarizer and pin it in
    // the global slot so the first recording / retranscription doesn't
    // pay the load cost.
    match speaker_diarization::commands::build_diarizer(app).await {
        Ok(Some(diarizer)) => {
            speaker_diarization::set_current_diarizer(Some(diarizer));
            log::info!("✅ [startup-download] speaker diarizer initialized");
        }
        Ok(None) => log::warn!(
            "[startup-download] speaker model present but diarizer build returned None"
        ),
        Err(e) => log::warn!("[startup-download] diarizer build failed: {}", e),
    }
}

/// Plain HTTP-streaming download to a destination path. Used for built-in
/// models that don't have their own dedicated downloader command. Cleans up
/// partial files on error.
async fn download_file_to(url: &str, dest: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::anyhow;
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let response = reqwest::get(url)
        .await
        .map_err(|e| anyhow!("HTTP error fetching {}: {}", url, e))?;
    if !response.status().is_success() {
        return Err(anyhow!("HTTP {} fetching {}", response.status(), url));
    }

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| anyhow!("Cannot create {}: {}", dest.display(), e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| anyhow!("Download stream error: {}", e))?;
        if let Err(e) = file.write_all(&chunk).await {
            let _ = std::fs::remove_file(dest);
            return Err(anyhow!("Write error: {}", e));
        }
    }
    if let Err(e) = file.flush().await {
        let _ = std::fs::remove_file(dest);
        return Err(anyhow!("Flush error: {}", e));
    }
    Ok(())
}

pub fn run() {
    log::set_max_level(log::LevelFilter::Info);

    // Route whisper.cpp's internal logs (beam search traces, decoder
    // diagnostics, etc.) through Rust's `log` crate. Without this they
    // bypass log filtering entirely and dump to stderr at every decode
    // step. With it, they're filterable via RUST_LOG (e.g.
    // `whisper_rs=warn` keeps warnings/errors only).
    whisper_rs::install_logging_hooks();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(Arc::new(RwLock::new(
            None::<notifications::manager::NotificationManager<tauri::Wry>>,
        )) as NotificationManagerState<tauri::Wry>)
        .manage(summary::summary_engine::ModelManagerState(Arc::new(
            tokio::sync::Mutex::new(None),
        )))
        .setup(|_app| {
            log::info!("Application setup complete");

            // Initialize system tray
            if let Err(e) = tray::create_tray(_app.handle()) {
                log::error!("Failed to create system tray: {}", e);
            }

            // Notification system is initialized *after* the database below —
            // it reads consent and persists settings, so starting it before the
            // DB is ready raced and logged a spurious init error every launch.

            // Set models directory to use app_data_dir (unified storage location)
            whisper_engine::commands::set_models_directory(&_app.handle());

            // Initialize Whisper engine on startup
            tauri::async_runtime::spawn(async {
                if let Err(e) = whisper_engine::commands::whisper_init().await {
                    log::error!("Failed to initialize Whisper engine on startup: {}", e);
                }
            });

            // Set speaker-diarization models directory (separate from ASR models
            // so the speaker model can be downloaded independently).
            speaker_diarization::model::set_models_dir(&_app.handle());

            // Pre-warm the speaker diarizer at startup (if model is on disk)
            // so the first recording / retranscription doesn't pay the model
            // load latency. Async + non-blocking. Stores in the global slot;
            // recording start replaces it with a fresh instance to reset
            // cluster IDs per session.
            let app_handle_for_diarizer = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match speaker_diarization::commands::build_diarizer(&app_handle_for_diarizer).await
                {
                    Ok(Some(diarizer)) => {
                        speaker_diarization::set_current_diarizer(Some(diarizer));
                        log::info!("✅ Speaker diarizer pre-initialized at startup");
                    }
                    Ok(None) => log::info!(
                        "Speaker diarizer pre-init skipped (model not downloaded yet)"
                    ),
                    Err(e) => log::warn!("Speaker diarizer pre-init failed: {}", e),
                }
            });

            // Initialize ModelManager for summary engine (async, non-blocking)
            let app_handle_for_model_manager = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match summary::summary_engine::commands::init_model_manager_at_startup(
                    &app_handle_for_model_manager,
                )
                .await
                {
                    Ok(_) => log::info!("ModelManager initialized successfully at startup"),
                    Err(e) => {
                        log::warn!("Failed to initialize ModelManager at startup: {}", e);
                        log::warn!("ModelManager will be lazy-initialized on first use");
                    }
                }
            });

            // Startup model audit — logs the on-disk state of every model the
            // app uses (Whisper / speaker diarizer / summary builtin-AI / VAD).
            // Pure diagnostic, non-fatal: helps rule out missing-model side
            // effects when investigating crashes. Runs after the engines have
            // had a moment to scan their directories.
            let app_handle_for_audit = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Small delay so the other startup tasks have logged first
                // and the audit shows the steady-state, not the racing init.
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                audit_models_at_startup(&app_handle_for_audit).await;
            });

            // Auto-download missing built-in models. Only the speaker diarization
            // model is fetched here today — Whisper is user-selectable so we leave
            // it to onboarding / settings, and summary models are picked by the
            // existing built-in AI flow. The speaker model is small (~28MB) and
            // diarization won't work without it, so silent background fetch is
            // the right UX. Failures are non-fatal (the diarizer just stays
            // disabled and labels fall back to the "Speaker" placeholder).
            let app_handle_for_dl = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Run after the audit so its log block stays unbroken.
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                ensure_required_models_downloaded(&app_handle_for_dl).await;
            });

            // Initialize database (handles first launch detection and conditional setup)
            tauri::async_runtime::block_on(async {
                database::setup::initialize_database_on_startup(&_app.handle()).await
            })
            .expect("Failed to initialize database");

            // Initialize notification system now that the database is ready.
            // (Consent lookup + settings persistence both need the DB pool; the
            // block_on above guarantees it's initialized before this spawns.)
            log::info!("Initializing notification system...");
            let app_for_notif = _app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let notif_state = app_for_notif.state::<NotificationManagerState<tauri::Wry>>();
                match notifications::commands::initialize_notification_manager(
                    app_for_notif.clone(),
                )
                .await
                {
                    Ok(manager) => {
                        // Set default consent and permissions on first launch
                        if let Err(e) = manager.set_consent(true).await {
                            log::error!("Failed to set initial consent: {}", e);
                        }
                        if let Err(e) = manager.request_permission().await {
                            log::error!("Failed to request initial permission: {}", e);
                        }

                        // Store the initialized manager
                        let mut state_lock = notif_state.write().await;
                        *state_lock = Some(manager);
                        log::info!("Notification system initialized with default permissions");
                    }
                    Err(e) => {
                        log::error!("Failed to initialize notification manager: {}", e);
                    }
                }
            });

            // Initialize bundled templates directory for dynamic template discovery
            log::info!("Initializing bundled templates directory...");
            if let Ok(resource_path) = _app.handle().path().resource_dir() {
                let templates_dir = resource_path.join("templates");
                log::info!(
                    "Setting bundled templates directory to: {:?}",
                    templates_dir
                );
                summary::templates::set_bundled_templates_dir(templates_dir);
            } else {
                log::warn!("Failed to resolve resource directory for templates");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            stop_recording,
            is_recording,
            get_transcription_status,
            read_audio_file,
            save_transcript,
            whisper_engine::commands::whisper_init,
            whisper_engine::commands::whisper_get_available_models,
            whisper_engine::commands::whisper_has_available_models,
            whisper_engine::commands::whisper_get_models_directory,
            whisper_engine::commands::whisper_download_model,
            whisper_engine::commands::whisper_cancel_download,
            whisper_engine::commands::whisper_delete_corrupted_model,
            // Speaker diarization commands
            speaker_diarization::commands::speaker_model_status,
            speaker_diarization::commands::speaker_model_download,
            speaker_diarization::commands::list_voice_profiles,
            speaker_diarization::commands::delete_voice_profile,
            speaker_diarization::commands::update_voice_profile,
            speaker_diarization::commands::promote_speaker_to_profile,
            speaker_diarization::commands::merge_voice_profiles,
            speaker_diarization::commands::merge_cluster_into_profile,
            speaker_diarization::commands::refine_speaker_assignments,
            // "Record my voice" self-enrollment
            speaker_diarization::enrollment::start_self_voice_enrollment,
            speaker_diarization::enrollment::cancel_self_voice_enrollment,
            speaker_diarization::enrollment::finish_self_voice_enrollment,
            speaker_diarization::enrollment::rename_self_voice_profile,
            speaker_diarization::enrollment::self_voice_status,
            speaker_diarization::enrollment::delete_self_voice_profile,
            get_audio_devices,
            trigger_microphone_permission,
            start_recording_with_devices,
            start_recording_with_devices_and_meeting,
            start_audio_level_monitoring,
            stop_audio_level_monitoring,
            is_audio_level_monitoring,
            // Recording pause/resume commands
            audio::recording_commands::pause_recording,
            audio::recording_commands::resume_recording,
            audio::recording_commands::is_recording_paused,
            audio::recording_commands::get_recording_state,
            audio::recording_commands::get_meeting_folder_path,
            // Reload sync commands (retrieve transcript history and meeting name)
            audio::recording_commands::get_transcript_history,
            audio::recording_commands::get_recording_meeting_name,
            // Post-meeting auto-refine (background high-accuracy re-pass)
            audio::recording_commands::trigger_post_meeting_refine,
            // Audio recovery commands (for transcript recovery feature)
            audio::incremental_saver::recover_audio_from_checkpoints,
            audio::incremental_saver::cleanup_checkpoints,
            audio::incremental_saver::has_audio_checkpoints,
            ollama::get_ollama_models,
            ollama::pull_ollama_model,
            ollama::delete_ollama_model,
            ollama::get_ollama_model_context,
            openai::openai::get_openai_models,
            anthropic::anthropic::get_anthropic_models,
            groq::groq::get_groq_models,
            api::api_get_meetings,
            api::api_search_transcripts,
            api::api_get_model_config,
            api::api_save_model_config,
            api::api_get_api_key,
            // api::api_get_auto_generate_setting,
            // api::api_save_auto_generate_setting,
            api::api_get_transcript_config,
            api::api_save_transcript_config,
            api::api_get_transcript_api_key,
            api::api_delete_meeting,
            api::api_get_meeting,
            api::api_get_meeting_metadata,
            api::api_get_meeting_transcripts,
            api::api_save_meeting_title,
            api::api_save_transcript,
            api::open_meeting_folder,
            api::open_external_url,
            // Custom OpenAI commands
            api::api_save_custom_openai_config,
            api::api_get_custom_openai_config,
            api::api_test_custom_openai_connection,
            // Action items + meeting notes
            audio::clip::get_meeting_audio_clip,
            api::action_items::list_action_items,
            api::action_items::list_open_action_items,
            api::action_items::create_action_item,
            api::action_items::set_action_item_status,
            api::action_items::update_action_item,
            api::action_items::delete_action_item,
            api::action_items::extract_action_items,
            api::action_items::add_meeting_note,
            api::action_items::list_meeting_notes,
            api::action_items::delete_meeting_note,
            // AI-ingestable meeting export
            api::export::export_meeting,
            api::export::export_meeting_to_file,
            // Summary commands
            summary::commands::api_process_transcript,
            summary::commands::api_get_summary,
            summary::commands::api_save_meeting_summary,
            summary::commands::api_cancel_summary,
            // Template commands
            summary::template_commands::api_list_templates,
            summary::template_commands::api_get_template_details,
            summary::template_commands::api_validate_template,
            // Built-in AI commands
            summary::summary_engine::commands::builtin_ai_list_models,
            summary::summary_engine::commands::builtin_ai_get_model_info,
            summary::summary_engine::commands::builtin_ai_download_model,
            summary::summary_engine::commands::builtin_ai_cancel_download,
            summary::summary_engine::commands::builtin_ai_delete_model,
            summary::summary_engine::commands::builtin_ai_is_model_ready,
            summary::summary_engine::commands::builtin_ai_get_available_summary_model,
            summary::summary_engine::commands::builtin_ai_get_recommended_model,
            openrouter::get_openrouter_models,
            audio::recording_preferences::get_recording_preferences,
            audio::recording_preferences::set_recording_preferences,
            audio::recording_preferences::get_default_recordings_folder_path,
            audio::recording_preferences::open_recordings_folder,
            audio::recording_preferences::select_recording_folder,
            // Language preference commands
            set_language_preference,
            // Notification system commands
            notifications::commands::get_notification_settings,
            notifications::commands::set_notification_settings,
            notifications::commands::request_notification_permission,
            notifications::commands::show_notification,
            notifications::commands::show_test_notification,
            notifications::commands::is_dnd_active,
            notifications::commands::get_system_dnd_status,
            notifications::commands::set_manual_dnd,
            notifications::commands::set_notification_consent,
            notifications::commands::clear_notifications,
            notifications::commands::is_notification_system_ready,
            notifications::commands::initialize_notification_manager_manual,
            notifications::commands::test_notification_with_auto_consent,
            notifications::commands::get_notification_stats,
            // Database import commands
            database::commands::check_first_launch,
            database::commands::initialize_fresh_database,
            // Database and Models path commands
            database::commands::get_database_directory,
            database::commands::open_database_folder,
            // MCP server config surface (Settings → Integrations)
            mcp_config::get_mcp_server_info,
            mcp_config::reveal_mcp_binary,
            whisper_engine::commands::open_models_folder,
            // Onboarding commands
            onboarding::get_onboarding_status,
            onboarding::save_onboarding_status_cmd,
            onboarding::reset_onboarding_status_cmd,
            onboarding::complete_onboarding,
            // Frontend UI config commands (language, confidence indicator,
            // auto-summary, provider model cache, ...)
            database::repositories::setting::api_get_ui_config,
            database::repositories::setting::api_save_ui_config,
            // Retranscription commands
            audio::retranscription::start_retranscription_command,
            audio::retranscription::cancel_retranscription_command,
            audio::retranscription::is_retranscription_in_progress_command,
            // Import audio commands
            audio::import::select_and_validate_audio_command,
            audio::import::validate_audio_file_command,
            audio::import::start_import_audio_command,
            audio::import::cancel_import_command,
            audio::import::is_import_in_progress_command,
            // Calendar / ICS commands
            calendar::commands::calendar_list_sources,
            calendar::commands::calendar_add_source,
            calendar::commands::calendar_remove_source,
            calendar::commands::calendar_refresh_source,
            calendar::commands::calendar_list_events,
            calendar::commands::calendar_find_event_for_now,
            calendar::commands::calendar_link_meeting,
            calendar::commands::calendar_get_event_for_meeting,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                log::info!("Application exiting, cleaning up resources...");
                tauri::async_runtime::block_on(async {
                    // Clean up database connection and checkpoint WAL
                    if let Some(app_state) = _app_handle.try_state::<state::AppState>() {
                        log::info!("Starting database cleanup...");
                        if let Err(e) = app_state.db_manager.cleanup().await {
                            log::error!("Failed to cleanup database: {}", e);
                        } else {
                            log::info!("Database cleanup completed successfully");
                        }
                    } else {
                        log::warn!(
                            "AppState not available for database cleanup (likely first launch)"
                        );
                    }

                    // Clean up sidecar
                    log::info!("Cleaning up sidecar...");
                    if let Err(e) = summary::summary_engine::force_shutdown_sidecar().await {
                        log::error!("Failed to force shutdown sidecar: {}", e);
                    }
                });
                log::info!("Application cleanup complete");

                // Exit immediately, skipping C/C++ static destructors.
                //
                // With a GPU whisper backend (CUDA/Vulkan/HIP), ggml's
                // finalizers run `cudaStreamSynchronize` during __cxa_finalize
                // — but by then the NVIDIA driver's own atexit handlers have
                // begun tearing down (the log shows `current device: -1` /
                // "CUDA error: driver shutting down"). ggml treats any CUDA
                // error as fatal and abort()s, dumping core *after* everything
                // we care about already succeeded (DB checkpointed above,
                // sidecar stopped, transcript + summary persisted). It's a
                // pure teardown-ordering race, harmless to data but alarming
                // and it trips crash reporters.
                //
                // All real cleanup happens in this handler and the logger is
                // unbuffered, so there is nothing left for the finalizers to
                // do except crash. `_exit` ends the process at the kernel
                // level and lets the driver reclaim the GPU context on process
                // death. NOTE: this means shutdown work must live in *this
                // handler*, not in Drop impls that expect a normal exit.
                unsafe { libc::_exit(0) };
            }
        });
}
