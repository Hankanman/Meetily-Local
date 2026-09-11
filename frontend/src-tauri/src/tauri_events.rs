//! Tauri shell implementation of [`meetily_core::events::EventSink`].
//!
//! Core code reports progress through the UI-agnostic `EventSink` trait
//! (see `meetily-core/src/events.rs`). This module wires that trait up to a
//! live Tauri `AppHandle` so call sites that hold one can pass
//! `&TauriSink(app.clone())` (or `shared_sink(&app)` for long-lived tasks)
//! wherever a `&dyn EventSink` / `SharedEventSink` is expected.
//!
//! `EventSink` and `AppHandle` are both foreign to this crate (the former
//! lives in `meetily-core`, the latter in `tauri`), so the orphan rule
//! forbids `impl EventSink for AppHandle<R>` directly — hence the local
//! [`TauriSink`] newtype, which this crate does own.

use std::sync::Arc;

use crate::events::{EventSink, SharedEventSink};

/// Newtype around a Tauri `AppHandle` so this crate can implement the
/// (foreign) `EventSink` trait for it without violating the orphan rule.
#[derive(Clone)]
pub struct TauriSink<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> EventSink for TauriSink<R> {
    fn emit_value(&self, event: &str, payload: serde_json::Value) -> Result<(), String> {
        tauri::Emitter::emit(&self.0, event, payload).map_err(|e| e.to_string())
    }
}

/// Wrap a Tauri `AppHandle` as a [`SharedEventSink`] for long-lived tasks.
pub fn shared_sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> SharedEventSink {
    Arc::new(TauriSink(app.clone()))
}
