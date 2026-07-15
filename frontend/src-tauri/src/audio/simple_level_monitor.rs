//! Real-time RMS/peak meter for the recording page, on native
//! PipeWire capture streams.
//!
//! The frontend asks to monitor a microphone and/or a system-audio
//! device by PipeWire node id (or `"default"`). Levels are emitted via
//! the `audio-levels` event, keyed by **role** (`"mic"` / `"system"`)
//! — the UI renders exactly one meter per role, so role keys avoid
//! making the frontend track device-id changes.

use anyhow::Result;
use log::{debug, info, warn};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Runtime};

use super::pw::PwCaptureStream;
use super::recording_state::DeviceType;
use super::stream::capture_target_for;

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelData {
    /// Role key: `"mic"` or `"system"`.
    pub device_name: String,
    pub device_type: String,
    pub rms_level: f32,
    pub peak_level: f32,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelUpdate {
    pub timestamp: u64,
    pub levels: Vec<AudioLevelData>,
}

/// Monotonically increasing generation; bumping it invalidates the
/// running emit task and any streams from a prior start.
static GENERATION: AtomicU64 = AtomicU64::new(0);

struct MonitorSession {
    streams: Vec<PwCaptureStream>,
}

static SESSION: OnceLock<Mutex<Option<MonitorSession>>> = OnceLock::new();

fn session_slot() -> &'static Mutex<Option<MonitorSession>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

fn open_role_stream(
    role: &'static str,
    device_id: &str,
    device_type: DeviceType,
    levels: Arc<Mutex<HashMap<&'static str, AudioLevelData>>>,
) -> Result<PwCaptureStream> {
    let target = capture_target_for(device_id, device_type);
    let type_label = match device_type {
        DeviceType::Microphone => "input",
        DeviceType::System => "output",
    };
    PwCaptureStream::open(
        target,
        Box::new(move |samples| {
            if samples.is_empty() {
                return;
            }
            let rms =
                (samples.iter().map(|&x| x * x).sum::<f32>() / samples.len() as f32).sqrt();
            let peak = samples.iter().map(|&x| x.abs()).fold(0.0_f32, f32::max);
            let entry = AudioLevelData {
                device_name: role.to_string(),
                device_type: type_label.to_string(),
                rms_level: rms.min(1.0),
                peak_level: peak.min(1.0),
                is_active: rms > 0.001,
            };
            if let Ok(mut map) = levels.lock() {
                map.insert(role, entry);
            }
        }),
    )
}

/// Start (or restart) level monitoring.
///
/// `mic_device` / `system_device`: PipeWire node id, `"default"`, or
/// `None` to skip that role.
pub async fn start_monitoring<R: Runtime>(
    app_handle: AppHandle<R>,
    mic_device: Option<String>,
    system_device: Option<String>,
) -> Result<()> {
    info!(
        "level monitor: start (mic={:?}, system={:?})",
        mic_device, system_device
    );

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    stop_current_session();

    let levels: Arc<Mutex<HashMap<&'static str, AudioLevelData>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Opening streams blocks on the PipeWire roundtrip — keep it off
    // the async runtime.
    let levels_for_open = levels.clone();
    let streams = tokio::task::spawn_blocking(move || {
        let mut streams = Vec::new();
        if let Some(mic) = mic_device {
            match open_role_stream("mic", &mic, DeviceType::Microphone, levels_for_open.clone()) {
                Ok(s) => streams.push(s),
                Err(e) => warn!("level monitor: could not open mic '{}': {}", mic, e),
            }
        }
        if let Some(system) = system_device {
            match open_role_stream(
                "system",
                &system,
                DeviceType::System,
                levels_for_open.clone(),
            ) {
                Ok(s) => streams.push(s),
                Err(e) => warn!(
                    "level monitor: could not open system audio '{}': {}",
                    system, e
                ),
            }
        }
        streams
    })
    .await?;

    if streams.is_empty() {
        warn!("level monitor: no streams opened; UI will receive no events");
        return Ok(());
    }

    if let Ok(mut guard) = session_slot().lock() {
        *guard = Some(MonitorSession { streams });
    }

    let app = app_handle.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));
        while GENERATION.load(Ordering::SeqCst) == generation {
            interval.tick().await;

            let snapshot: Vec<AudioLevelData> = match levels.lock() {
                Ok(guard) => guard.values().cloned().collect(),
                Err(_) => continue,
            };
            if snapshot.is_empty() {
                continue;
            }

            let update = AudioLevelUpdate {
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
                levels: snapshot,
            };

            if app.emit("audio-levels", &update).is_err() {
                break;
            }
        }
        debug!("level monitor: emit task exiting (generation {})", generation);
    });

    Ok(())
}

pub async fn stop_monitoring() -> Result<()> {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    // Stream teardown joins the PipeWire loop threads — keep it off
    // the async runtime.
    tokio::task::spawn_blocking(stop_current_session).await?;
    Ok(())
}

fn stop_current_session() {
    if let Ok(mut guard) = session_slot().lock() {
        if let Some(session) = guard.take() {
            for stream in session.streams {
                stream.stop();
            }
        }
    }
}

pub fn is_monitoring() -> bool {
    session_slot()
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}
