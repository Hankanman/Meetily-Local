//! Tauri shell implementation of [`crate::events::EventSink`].
//!
//! Core code reports progress through the UI-agnostic `EventSink` trait
//! (see `src/events.rs`). This module wires that trait up to a live Tauri
//! `AppHandle` so call sites that hold one can pass `&app` (or
//! `shared_sink(&app)` for long-lived tasks) wherever a `&dyn EventSink` /
//! `SharedEventSink` is expected.

use std::sync::Arc;

use crate::events::{EventSink, SharedEventSink};

impl<R: tauri::Runtime> EventSink for tauri::AppHandle<R> {
    fn emit_value(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        tauri::Emitter::emit(self, event, payload).map_err(|e| e.to_string())
    }
}

/// Wrap a Tauri `AppHandle` as a [`SharedEventSink`] for long-lived tasks.
pub fn shared_sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> SharedEventSink {
    Arc::new(app.clone())
}
