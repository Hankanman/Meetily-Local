use serde::{Deserialize, Serialize};

// Shell-only modules: Tauri command/event glue. Core logic (audio, summary,
// database, ...) lives in the `meetily-core` crate and is re-exported below
// under the same top-level names so existing `crate::audio::…` etc. paths
// throughout this crate keep resolving unchanged.
pub mod api;
pub mod commands;
pub mod mcp_config_commands;
pub mod notifications;
pub mod onboarding_commands;
pub mod tauri_events;
pub mod tray;

// Re-export meetily-core's top-level modules under their historical names.
pub use meetily_core::{
    anthropic, audio, calendar, config, database, events, groq, llm_providers, mcp_config,
    ollama, onboarding, openai, openrouter, paths, speaker_diarization, state, summary, utils,
    whisper_engine,
};

use audio::{list_audio_devices, trigger_audio_permission};
use events::EventSinkExt;
use log::{error as log_error, info as log_info};
use notifications::commands::NotificationManagerState;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::RwLock;

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
    if !commands::audio::recording_commands::is_recording().await {
        log_info!("Recording is already stopped");
        return Ok(());
    }

    // Call the actual audio recording system to stop
    match commands::audio::recording_commands::stop_recording(
        app.clone(),
        commands::audio::recording_commands::RecordingArgs {
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
    commands::audio::recording_commands::is_recording().await
}

#[tauri::command]
async fn get_transcription_status() -> TranscriptionStatus {
    TranscriptionStatus {
        chunks_in_queue: audio::transcription::queue_depth(),
        is_processing: commands::audio::recording_commands::is_recording().await,
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

    audio::simple_level_monitor::start_monitoring(tauri_events::shared_sink(&app), mic_device, system_device)
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

/// Explicitly trigger ffmpeg download/installation (e.g. from a
/// first-run or settings screen). `find_ffmpeg_path()` never downloads
/// on its own, so callers that need ffmpeg installed on demand call
/// this instead. Idempotent — a no-op once ffmpeg is already found.
#[tauri::command]
async fn ffmpeg_ensure_installed() -> Result<String, String> {
    audio::ffmpeg::ensure_ffmpeg_installed()
        .await
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to install FFmpeg: {}", e))
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
            commands::audio::recording_commands::start_recording_with_meeting_name(app.clone(), meeting_name)
                .await
        }
        _ => {
            log_info!(
                "Starting with specified devices: mic={:?}, system={:?}, meeting={:?}",
                mic_device_name,
                system_device_name,
                meeting_name
            );
            commands::audio::recording_commands::start_recording_with_devices_and_meeting(
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
    log_info!("Setting language preference to: {}", language);
    utils::set_language_preference_internal(language);
    Ok(())
}

/// Initialize the database on app startup: handles first-launch detection
/// and conditional setup. Thin Tauri shell around
/// `meetily_core::bootstrap::prepare_database` (Tauri-free) — this is just
/// the part that manages the resulting `DatabaseManager` as app state (and
/// returns a clone of its pool, for `bootstrap::spawn_background_init`), or,
/// on a first launch, schedules the delayed `first-launch-detected` event
/// once the window and its React listeners are ready.
async fn initialize_database_on_startup<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<sqlx::SqlitePool>, String> {
    match meetily_core::bootstrap::prepare_database().await? {
        database::setup::StartupOutcome::FirstLaunch => {
            // Delay event emission to ensure window is ready and React listeners are registered
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                tauri_events::TauriSink(app_handle)
                    .emit_event("first-launch-detected", &())
                    .expect("Failed to emit first-launch-detected event");
                log_info!("Emitted first-launch-detected after delay");
            });
            Ok(None)
        }
        database::setup::StartupOutcome::Initialized(db_manager) => {
            let pool = db_manager.pool().clone();
            app.manage(state::AppState { db_manager });
            Ok(Some(pool))
        }
    }
}

/// Guards against handling a close/exit request more than once (issue #30):
/// both `WindowEvent::CloseRequested` and `RunEvent::ExitRequested` can fire
/// for the same user action (e.g. closing the last window), and each of them
/// can themselves recur if the user mashes the close button while the first
/// stop is still draining.
static SHUTDOWN_STOP_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Closing the app mid-recording used to perform no stop or flush at all —
/// `RunEvent::Exit` went straight to DB/sidecar cleanup and `libc::_exit(0)`,
/// discarding whatever the pipeline/transcription worker hadn't already
/// flushed to disk. This intercepts the close/exit request, prevents it,
/// runs the exact same full `stop_recording` flow a user-initiated Stop
/// runs (only when a recording is actually active or a stop is already
/// draining one, via `bootstrap::finish_recording_for_exit`), and only then
/// asks the app to exit for real — which lets the existing `RunEvent::Exit`
/// cleanup above run unchanged.
fn begin_shutdown_stop<R: Runtime>(app_handle: &AppHandle<R>) {
    if SHUTDOWN_STOP_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        // Already stopping/exiting from a previous close/exit request.
        return;
    }

    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        // Same context a live `stop_recording` call builds (event sink +
        // DB pool), including the tray-refreshing sink wrapper — see
        // `commands::audio::recording_commands::build_context`.
        let ctx = commands::audio::recording_commands::build_context(&app);
        meetily_core::bootstrap::finish_recording_for_exit(ctx).await;

        app.exit(0);
    });
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

            // Shared, Tauri-free path setup: whisper models dir, speaker
            // diarization models dir, custom summary templates dir.
            meetily_core::bootstrap::init_paths();

            // Initialize database (handles first launch detection and
            // conditional setup). Deliberately runs *before* the background
            // init spawned below: that init includes the speaker-diarizer
            // pre-warm, which needs the real DB pool to load voice profiles
            // — spawning it before the DB existed used to race and log
            // "DB pool unavailable; cannot load voice profiles" on every
            // normal (non-first) launch.
            let pool = tauri::async_runtime::block_on(async {
                initialize_database_on_startup(&_app.handle()).await
            })
            .expect("Failed to initialize database");

            // Spawn all non-blocking background startup work (whisper init,
            // speaker diarizer pre-warm, summary ModelManager init, model
            // audit log, model downloads) now that the DB pool (if any, i.e.
            // not a first launch) is known. Wrapped in
            // `tauri::async_runtime::spawn` so `spawn_background_init`'s
            // internal `tokio::spawn` calls run inside tauri's tokio
            // runtime — `setup()` itself isn't guaranteed to be.
            let model_manager_slot = _app
                .state::<summary::summary_engine::ModelManagerState>()
                .0
                .clone();
            let sink = tauri_events::shared_sink(&_app.handle());
            tauri::async_runtime::spawn(async move {
                meetily_core::bootstrap::spawn_background_init(sink, pool, model_manager_slot);
            });

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            stop_recording,
            is_recording,
            get_transcription_status,
            read_audio_file,
            save_transcript,
            commands::whisper_engine::commands::whisper_init,
            commands::whisper_engine::commands::whisper_get_available_models,
            commands::whisper_engine::commands::whisper_has_available_models,
            commands::whisper_engine::commands::whisper_get_models_directory,
            commands::whisper_engine::commands::whisper_download_model,
            commands::whisper_engine::commands::whisper_cancel_download,
            commands::whisper_engine::commands::whisper_delete_corrupted_model,
            // Speaker diarization commands
            commands::speaker_diarization::commands::speaker_model_status,
            commands::speaker_diarization::commands::speaker_model_download,
            commands::speaker_diarization::commands::ensure_pyannote_segmentation_model,
            commands::speaker_diarization::commands::list_voice_profiles,
            commands::speaker_diarization::commands::delete_voice_profile,
            commands::speaker_diarization::commands::update_voice_profile,
            commands::speaker_diarization::commands::promote_speaker_to_profile,
            commands::speaker_diarization::commands::merge_voice_profiles,
            commands::speaker_diarization::commands::merge_cluster_into_profile,
            // "Record my voice" self-enrollment
            commands::speaker_diarization::enrollment_commands::start_self_voice_enrollment,
            commands::speaker_diarization::enrollment_commands::cancel_self_voice_enrollment,
            commands::speaker_diarization::enrollment_commands::finish_self_voice_enrollment,
            commands::speaker_diarization::enrollment_commands::rename_self_voice_profile,
            commands::speaker_diarization::enrollment_commands::self_voice_status,
            commands::speaker_diarization::enrollment_commands::delete_self_voice_profile,
            get_audio_devices,
            trigger_microphone_permission,
            start_recording_with_devices,
            start_recording_with_devices_and_meeting,
            start_audio_level_monitoring,
            stop_audio_level_monitoring,
            is_audio_level_monitoring,
            ffmpeg_ensure_installed,
            commands::audio::ffmpeg_commands::ffmpeg_status,
            // Recording pause/resume commands
            commands::audio::recording_commands::pause_recording,
            commands::audio::recording_commands::resume_recording,
            commands::audio::recording_commands::is_recording_paused,
            commands::audio::recording_commands::get_recording_state,
            commands::audio::recording_commands::get_meeting_folder_path,
            // Reload sync commands (retrieve transcript history and meeting name)
            commands::audio::recording_commands::get_transcript_history,
            commands::audio::recording_commands::get_recording_meeting_name,
            // Post-meeting auto-refine (background high-accuracy re-pass)
            commands::audio::recording_commands::trigger_post_meeting_refine,
            // Audio recovery commands (for transcript recovery feature)
            commands::audio::incremental_saver_commands::recover_audio_from_checkpoints,
            commands::audio::incremental_saver_commands::cleanup_checkpoints,
            commands::audio::incremental_saver_commands::has_audio_checkpoints,
            // Interrupted-meeting recovery (issue #57 slice 2: DB-driven,
            // replaces the old IndexedDB scan)
            commands::audio::recovery_commands::list_interrupted_meetings,
            commands::audio::recovery_commands::recover_meeting,
            commands::ollama::commands::get_ollama_models,
            commands::ollama::commands::pull_ollama_model,
            commands::ollama::commands::delete_ollama_model,
            commands::ollama::commands::get_ollama_model_context,
            commands::openai::commands::get_openai_models,
            commands::anthropic::commands::get_anthropic_models,
            commands::groq::commands::get_groq_models,
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
            commands::audio::clip_commands::get_meeting_audio_clip,
            commands::audio::clip_commands::play_meeting_audio_clip,
            commands::audio::clip_commands::stop_meeting_audio_clip,
            api::action_items::start_live_action_extraction,
            api::action_items::stop_live_action_extraction,
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
            commands::summary::commands::api_process_transcript,
            commands::summary::commands::api_get_summary,
            commands::summary::commands::api_save_meeting_summary,
            commands::summary::commands::api_cancel_summary,
            // Template commands
            commands::summary::template_commands::api_list_templates,
            commands::summary::template_commands::api_get_template_details,
            commands::summary::template_commands::api_validate_template,
            // Built-in AI commands
            commands::summary::summary_engine::commands::builtin_ai_list_models,
            commands::summary::summary_engine::commands::builtin_ai_get_model_info,
            commands::summary::summary_engine::commands::builtin_ai_download_model,
            commands::summary::summary_engine::commands::builtin_ai_cancel_download,
            commands::summary::summary_engine::commands::builtin_ai_delete_model,
            commands::summary::summary_engine::commands::builtin_ai_is_model_ready,
            commands::summary::summary_engine::commands::builtin_ai_get_available_summary_model,
            commands::summary::summary_engine::commands::builtin_ai_get_recommended_model,
            commands::openrouter::commands::get_openrouter_models,
            commands::audio::recording_preferences_commands::get_recording_preferences,
            commands::audio::recording_preferences_commands::set_recording_preferences,
            commands::audio::recording_preferences_commands::get_default_recordings_folder_path,
            commands::audio::recording_preferences_commands::open_recordings_folder,
            commands::audio::recording_preferences_commands::select_recording_folder,
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
            commands::database::commands::check_first_launch,
            commands::database::commands::initialize_fresh_database,
            // Database and Models path commands
            commands::database::commands::get_database_directory,
            commands::database::commands::open_database_folder,
            // MCP server config surface (Settings → Integrations)
            mcp_config_commands::get_mcp_server_info,
            mcp_config_commands::reveal_mcp_binary,
            commands::whisper_engine::commands::open_models_folder,
            // Onboarding commands
            onboarding_commands::get_onboarding_status,
            onboarding_commands::save_onboarding_status_cmd,
            onboarding_commands::reset_onboarding_status_cmd,
            onboarding_commands::complete_onboarding,
            // Frontend UI config commands (language, confidence indicator,
            // auto-summary, provider model cache, ...)
            commands::database::commands::api_get_ui_config,
            commands::database::commands::api_save_ui_config,
            // Retranscription commands
            commands::audio::retranscription_commands::start_retranscription_command,
            commands::audio::retranscription_commands::cancel_retranscription_command,
            commands::audio::retranscription_commands::is_retranscription_in_progress_command,
            // Import audio commands
            commands::audio::import_commands::select_and_validate_audio_command,
            commands::audio::import_commands::validate_audio_file_command,
            commands::audio::import_commands::start_import_audio_command,
            commands::audio::import_commands::cancel_import_command,
            commands::audio::import_commands::is_import_in_progress_command,
            // Calendar / ICS commands
            commands::calendar::commands::calendar_list_sources,
            commands::calendar::commands::calendar_add_source,
            commands::calendar::commands::calendar_remove_source,
            commands::calendar::commands::calendar_refresh_source,
            commands::calendar::commands::calendar_list_events,
            commands::calendar::commands::calendar_find_event_for_now,
            commands::calendar::commands::calendar_link_meeting,
            commands::calendar::commands::calendar_get_event_for_meeting,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            match &event {
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } => {
                    api.prevent_close();
                    begin_shutdown_stop(_app_handle);
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();
                    begin_shutdown_stop(_app_handle);
                }
                _ => {}
            }

            if let tauri::RunEvent::Exit = event {
                log::info!("Application exiting, cleaning up resources...");
                tauri::async_runtime::block_on(async {
                    let app_state = _app_handle.try_state::<state::AppState>();
                    meetily_core::bootstrap::shutdown(
                        app_state.as_deref().map(|s| &s.db_manager),
                    )
                    .await;
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
