//! Process-wide services the views reach through `cx.global::<AppServices>()`.

use gpui_kit::{App, Entity, Global};
use meetily_core::audio::recording_service::RecordingContext;
use meetily_core::database::manager::DatabaseManager;
use meetily_core::events::SharedEventSink;

use crate::core_events::CoreEvents;
use crate::runtime::Io;

pub struct AppServices {
    pub io: Io,
    /// Where core code emits UI events (a [`crate::core_events::GpuiSink`]).
    pub sink: SharedEventSink,
    /// Re-emits core events as GPUI events; views subscribe to this.
    pub core_events: Entity<CoreEvents>,
    /// `None` on a first launch until onboarding creates the database.
    pub db: Option<DatabaseManager>,
}

impl Global for AppServices {}

impl AppServices {
    pub fn global(cx: &App) -> &Self {
        cx.global::<AppServices>()
    }

    pub fn pool(&self) -> Option<sqlx::SqlitePool> {
        self.db.as_ref().map(|db| db.pool().clone())
    }

    /// Context for `meetily_core::audio::recording_service` calls.
    pub fn recording_context(&self) -> RecordingContext {
        RecordingContext {
            sink: self.sink.clone(),
            pool: self.pool(),
        }
    }
}
