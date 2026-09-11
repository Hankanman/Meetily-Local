use log::{info, warn};
use tauri::{AppHandle, Emitter, Manager};

use super::manager::DatabaseManager;
use super::repositories::meeting::MeetingsRepository;
use crate::state::AppState;

/// Initialize database on app startup
/// Handles first launch detection and conditional initialization
pub async fn initialize_database_on_startup(app: &AppHandle) -> Result<(), String> {
    // Check if this is the first launch (no database exists yet)
    let is_first_launch = DatabaseManager::is_first_launch(app)
        .await
        .map_err(|e| format!("Failed to check first launch status: {}", e))?;

    if is_first_launch {
        info!("First launch detected - will notify window when ready");

        // Delay event emission to ensure window is ready and React listeners are registered
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            app_handle
                .emit("first-launch-detected", ())
                .expect("Failed to emit first-launch-detected event");
            info!("Emitted first-launch-detected after delay");
        });
    } else {
        // Normal flow - initialize database immediately
        let db_manager = DatabaseManager::new_from_app_handle(app)
            .await
            .map_err(|e| format!("Failed to initialize database manager: {}", e))?;

        let pool = db_manager.pool().clone();
        app.manage(AppState { db_manager });
        info!("Database initialized successfully");

        // Crash marker (issue #57 slice 2): a meeting row still "recording"
        // at this point predates this very process — the app that created
        // it never reached `stop_recording`'s finalisation (a crash, kill,
        // or forced shutdown). Sweep them to "interrupted" once, here, so
        // the recovery dialog can find them via a plain status query.
        match MeetingsRepository::mark_stale_recording_meetings_interrupted(&pool).await {
            Ok(0) => {}
            Ok(n) => info!(
                "Marked {} meeting(s) left 'recording' by a previous run as 'interrupted'",
                n
            ),
            Err(e) => warn!("Failed to sweep stale 'recording' meetings at startup: {}", e),
        }
    }

    Ok(())
}
