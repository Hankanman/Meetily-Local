//! Real-time RMS/peak meter for the recording-page hero.
//!
//! Earlier this module was a stub that emitted a sine-wave so the UI
//! had something to draw. That hid two bugs: the meter never told the
//! user whether their actual mic / system-audio source was alive, and
//! the event name didn't match what the frontend hook was listening
//! for. This implementation opens real cpal input streams for each
//! requested device, computes RMS + peak per buffer, and emits via
//! `audio-levels` (the same event name the legacy
//! `level_monitor.rs` uses, kept for compatibility with
//! `DeviceSelection.tsx`).
//!
//! System-audio entries are surfaced in the picker as
//! `<description> (System Audio)` (see `audio::devices::platform::linux`).
//! cpal can't see PulseAudio / PipeWire `*.monitor` sources directly,
//! so for those entries we resolve the description back to a PA source
//! name via `pactl` and redirect cpal's default-input PCM through the
//! `PIPEWIRE_NODE` env var. Same trick as the recording path; see
//! `audio::devices::configuration::open_linux_system_audio_input`.

use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Runtime};

use super::audio_processing::audio_to_mono;

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelData {
    pub device_name: String,
    pub device_type: String, // "input" or "output"
    pub rms_level: f32,
    pub peak_level: f32,
    pub is_active: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelUpdate {
    pub timestamp: u64,
    pub levels: Vec<AudioLevelData>,
}

static IS_MONITORING: AtomicBool = AtomicBool::new(false);

/// Newtype that lets us park `cpal::Stream` instances in a `static`
/// without the compiler reasoning about cpal's auto-trait derivations.
/// Streams only get touched on creation (the thread that calls
/// `start_monitoring`) and on drop (the thread that calls
/// `stop_monitoring`); cpal callbacks themselves run on cpal's
/// internal threads and don't read this Vec. The unsafe `Send + Sync`
/// claim covers exactly that access pattern — never share a single
/// stream across threads through this container.
// Field is read-implicitly via Drop (which stops every stream) — the
// dead-code lint can't see that.
#[allow(dead_code)]
struct StreamHolder(Vec<cpal::Stream>);
unsafe impl Send for StreamHolder {}
unsafe impl Sync for StreamHolder {}

static ACTIVE_STREAMS: OnceLock<Mutex<Option<StreamHolder>>> = OnceLock::new();

fn streams_slot() -> &'static Mutex<Option<StreamHolder>> {
    ACTIVE_STREAMS.get_or_init(|| Mutex::new(None))
}

/// Begin emitting `audio-levels` events for the requested device names.
/// Call again with a different list to switch — this drops the prior
/// streams and replaces them.
pub async fn start_monitoring<R: Runtime>(
    app_handle: AppHandle<R>,
    device_names: Vec<String>,
) -> Result<()> {
    info!("level monitor: start for {:?}", device_names);

    // Drop any previous streams + emit task before opening new ones.
    stop_monitoring().await?;
    // Tiny breather so the prior emit task notices the flag flip and
    // exits before we set it back to true.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    IS_MONITORING.store(true, Ordering::SeqCst);

    let level_data: Arc<Mutex<HashMap<String, AudioLevelData>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let mut streams = Vec::new();
    for name in &device_names {
        match build_level_stream(name, level_data.clone()) {
            Ok(stream) => {
                debug!("level monitor: opened stream for '{}'", name);
                streams.push(stream);
            }
            Err(e) => {
                warn!("level monitor: could not open '{}': {}", name, e);
            }
        }
    }

    if streams.is_empty() {
        warn!("level monitor: no streams opened; UI will receive no events");
    }

    if let Ok(mut guard) = streams_slot().lock() {
        *guard = Some(StreamHolder(streams));
    }

    let app = app_handle.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));
        while IS_MONITORING.load(Ordering::SeqCst) {
            interval.tick().await;

            let snapshot: Vec<AudioLevelData> = match level_data.lock() {
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

            if let Err(e) = app.emit("audio-levels", &update) {
                error!("level monitor: emit failed: {}", e);
                break;
            }
        }
        debug!("level monitor: emit task exiting");
    });

    Ok(())
}

pub async fn stop_monitoring() -> Result<()> {
    IS_MONITORING.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = streams_slot().lock() {
        // Dropping each cpal::Stream stops it.
        guard.take();
    }
    Ok(())
}

pub fn is_monitoring() -> bool {
    IS_MONITORING.load(Ordering::SeqCst)
}

fn build_level_stream(
    device_name: &str,
    level_data: Arc<Mutex<HashMap<String, AudioLevelData>>>,
) -> Result<cpal::Stream> {
    if device_name
        .to_lowercase()
        .ends_with("(system audio)")
    {
        return build_system_audio_stream(device_name, level_data);
    }
    build_input_stream(device_name, level_data)
}

fn build_input_stream(
    device_name: &str,
    level_data: Arc<Mutex<HashMap<String, AudioLevelData>>>,
) -> Result<cpal::Stream> {
    let host = cpal::default_host();

    // "default" is the magic name the picker uses for "system default
    // input" — there's both a real cpal entry called "default" *and* the
    // `default_input_device()` API. Either is fine; iterate first since
    // it gives us a name match path that works for any device.
    let mut device: Option<cpal::Device> = None;
    if let Ok(inputs) = host.input_devices() {
        for d in inputs {
            if d.name().map(|n| n == device_name).unwrap_or(false) {
                device = Some(d);
                break;
            }
        }
    }

    let device = match device {
        Some(d) => d,
        None if device_name == "default" => host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default input device available"))?,
        None => return Err(anyhow!("input device not found in cpal: {}", device_name)),
    };

    let config = device
        .default_input_config()
        .with_context(|| format!("default_input_config({})", device_name))?;
    open_input_stream(&device, config, device_name, "input", level_data)
}

#[cfg(target_os = "linux")]
fn build_system_audio_stream(
    device_name: &str,
    level_data: Arc<Mutex<HashMap<String, AudioLevelData>>>,
) -> Result<cpal::Stream> {
    use crate::audio::devices::platform::resolve_source_name_by_description;

    let description = device_name
        .trim()
        .trim_end_matches("(System Audio)")
        .trim()
        .to_string();
    let source_name = resolve_source_name_by_description(&description)?
        .ok_or_else(|| anyhow!("no PulseAudio source matches '{}'", description))?;

    let prev = std::env::var("PIPEWIRE_NODE").ok();
    std::env::set_var("PIPEWIRE_NODE", &source_name);

    let result = (|| -> Result<cpal::Stream> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default input device for system-audio meter"))?;
        let config = device.default_input_config()?;
        open_input_stream(&device, config, device_name, "output", level_data)
    })();

    match prev {
        Some(v) => std::env::set_var("PIPEWIRE_NODE", v),
        None => std::env::remove_var("PIPEWIRE_NODE"),
    }
    result
}

#[cfg(not(target_os = "linux"))]
fn build_system_audio_stream(
    _device_name: &str,
    _level_data: Arc<Mutex<HashMap<String, AudioLevelData>>>,
) -> Result<cpal::Stream> {
    Err(anyhow!(
        "system-audio level monitoring not implemented for this platform yet"
    ))
}

fn open_input_stream(
    device: &cpal::Device,
    config: cpal::SupportedStreamConfig,
    label: &str,
    device_type: &str,
    level_data: Arc<Mutex<HashMap<String, AudioLevelData>>>,
) -> Result<cpal::Stream> {
    let channels = config.channels();
    let sample_format = config.sample_format();
    let stream_config: StreamConfig = config.into();
    let label = label.to_string();
    let device_type = device_type.to_string();

    let stream = match sample_format {
        SampleFormat::F32 => {
            let label = label.clone();
            let device_type = device_type.clone();
            let level_data = level_data.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    push_levels(data, channels, &label, &device_type, &level_data);
                },
                move |e| error!("level monitor stream error: {}", e),
                None,
            )?
        }
        SampleFormat::I16 => {
            let label = label.clone();
            let device_type = device_type.clone();
            let level_data = level_data.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let f: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / i16::MAX as f32)
                        .collect();
                    push_levels(&f, channels, &label, &device_type, &level_data);
                },
                move |e| error!("level monitor stream error: {}", e),
                None,
            )?
        }
        SampleFormat::I32 => {
            let label = label.clone();
            let device_type = device_type.clone();
            let level_data = level_data.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i32], _: &cpal::InputCallbackInfo| {
                    let f: Vec<f32> = data
                        .iter()
                        .map(|&s| s as f32 / i32::MAX as f32)
                        .collect();
                    push_levels(&f, channels, &label, &device_type, &level_data);
                },
                move |e| error!("level monitor stream error: {}", e),
                None,
            )?
        }
        f => return Err(anyhow!("unsupported sample format: {:?}", f)),
    };

    stream.play()?;
    Ok(stream)
}

fn push_levels(
    data: &[f32],
    channels: u16,
    label: &str,
    device_type: &str,
    level_data: &Arc<Mutex<HashMap<String, AudioLevelData>>>,
) {
    if data.is_empty() {
        return;
    }
    let mono = if channels > 1 {
        audio_to_mono(data, channels)
    } else {
        data.to_vec()
    };

    let rms = (mono.iter().map(|&x| x * x).sum::<f32>() / mono.len() as f32).sqrt();
    let peak = mono.iter().map(|&x| x.abs()).fold(0.0_f32, f32::max);
    let entry = AudioLevelData {
        device_name: label.to_string(),
        device_type: device_type.to_string(),
        rms_level: rms.min(1.0),
        peak_level: peak.min(1.0),
        is_active: rms > 0.001,
    };

    if let Ok(mut map) = level_data.lock() {
        map.insert(label.to_string(), entry);
    }
}
