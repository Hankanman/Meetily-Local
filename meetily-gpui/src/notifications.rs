//! Desktop notifications for recording start/stop, gated by the same
//! notification settings the Tauri app stores (`notification_settings` in
//! SQLite, via `SettingsRepository`/`KEY_NOTIFICATION_SETTINGS` —
//! Tauri-free, already in `meetily-core`).
//!
//! The full `NotificationSettings`/`NotificationPreferences` shape lives in
//! `frontend/src-tauri/src/notifications/settings.rs`, which — being built
//! around an `AppHandle`-based `ConsentManager` — isn't something this
//! shell can reuse directly without pulling in Tauri. Deserializing only
//! the handful of fields this needs (`serde` ignores the rest) reads the
//! same row without moving that module into core. If no row exists yet
//! (nobody has ever opened the Tauri app's notification settings), this
//! defaults to on, per the phase 1 tray spec.

use gpui_kit::App;
use serde::Deserialize;

use meetily_core::database::repositories::setting::{
    SettingsRepository, KEY_NOTIFICATION_SETTINGS,
};

use crate::app_state::AppServices;

#[derive(Clone, Copy)]
pub enum Kind {
    Started,
    Stopped,
}

#[derive(Debug, Deserialize)]
struct SettingsMini {
    #[serde(default = "default_true")]
    consent_given: bool,
    #[serde(default = "default_true")]
    system_permission_granted: bool,
    #[serde(default)]
    manual_dnd_mode: bool,
    #[serde(default)]
    notification_preferences: PreferencesMini,
}

#[derive(Debug, Deserialize)]
struct PreferencesMini {
    #[serde(default)]
    show_recording_started: bool,
    #[serde(default)]
    show_recording_stopped: bool,
}

impl Default for PreferencesMini {
    fn default() -> Self {
        // Matches the Tauri shell's `NotificationPreferences::default()`.
        Self {
            show_recording_started: false,
            show_recording_stopped: false,
        }
    }
}

fn default_true() -> bool {
    true
}

impl Default for SettingsMini {
    fn default() -> Self {
        Self {
            consent_given: true,
            system_permission_granted: true,
            manual_dnd_mode: false,
            notification_preferences: PreferencesMini {
                show_recording_started: true,
                show_recording_stopped: true,
            },
        }
    }
}

/// Look up whether `kind` should be shown right now, and fire it
/// (best-effort, via `notify-rust`/D-Bus) if so. Runs entirely on the io
/// runtime; never blocks the GPUI thread.
pub fn maybe_notify(cx: &mut App, kind: Kind) {
    let services = AppServices::global(cx);
    let io = services.io.clone();
    let pool = services.pool();

    io.spawn(async move {
        let settings = match pool {
            Some(pool) => {
                match SettingsRepository::get_setting::<SettingsMini>(
                    &pool,
                    KEY_NOTIFICATION_SETTINGS,
                )
                .await
                {
                    Ok(Some(settings)) => settings,
                    Ok(None) => {
                        log::debug!("no stored notification settings; defaulting to on");
                        SettingsMini::default()
                    }
                    Err(e) => {
                        log::warn!("failed to read notification settings, defaulting to on: {}", e);
                        SettingsMini::default()
                    }
                }
            }
            None => SettingsMini::default(),
        };

        if !settings.consent_given || !settings.system_permission_granted || settings.manual_dnd_mode {
            return;
        }

        let (enabled, title, body) = match kind {
            Kind::Started => (
                settings.notification_preferences.show_recording_started,
                "Parley",
                "Recording started",
            ),
            Kind::Stopped => (
                settings.notification_preferences.show_recording_stopped,
                "Parley",
                "Recording stopped",
            ),
        };
        if !enabled {
            return;
        }

        show(title, body).await;
    });
}

/// Show a system notification via D-Bus, off the calling task (notify-rust
/// makes a blocking D-Bus call).
async fn show(title: &'static str, body: &'static str) {
    let result =
        tokio::task::spawn_blocking(move || notify_rust::Notification::new().summary(title).body(body).show())
            .await;
    match result {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => log::warn!("failed to show desktop notification: {}", e),
        Err(e) => log::warn!("notification task panicked: {}", e),
    }
}
