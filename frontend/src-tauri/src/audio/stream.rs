//! Capture stream management on top of the native PipeWire layer.
//!
//! Every stream delivers interleaved f32 @ 48 kHz stereo (the PipeWire
//! graph negotiates/resamples), feeding `AudioCapture` → pipeline
//! unchanged. Device identity is the PipeWire `node.name` (or the
//! literal `"default"` for the system default source/sink).

use anyhow::Result;
use log::{error, info};
use std::sync::Arc;

use super::devices::AudioDevice;
use super::pipeline::AudioCapture;
use super::pw::{CaptureTarget, PwCaptureStream, PwDeviceKind, CAPTURE_CHANNELS, CAPTURE_RATE};
use super::recording_state::{DeviceType, RecordingState};

/// Translate a selected device into a PipeWire capture target.
pub fn capture_target_for(device_id: &str, device_type: DeviceType) -> CaptureTarget {
    match (device_id, device_type) {
        ("default", DeviceType::Microphone) => CaptureTarget::DefaultMicrophone,
        ("default", DeviceType::System) => CaptureTarget::DefaultSystem,
        (id, DeviceType::Microphone) => CaptureTarget::Node {
            id: id.to_string(),
            kind: PwDeviceKind::Microphone,
        },
        (id, DeviceType::System) => CaptureTarget::Node {
            id: id.to_string(),
            kind: PwDeviceKind::System,
        },
    }
}

/// A running capture stream bound to the recording pipeline.
pub struct AudioStream {
    device: Arc<AudioDevice>,
    stream: PwCaptureStream,
}

impl AudioStream {
    pub async fn create(
        device: Arc<AudioDevice>,
        state: Arc<RecordingState>,
        device_type: DeviceType,
    ) -> Result<Self> {
        info!(
            "🎵 Stream: opening PipeWire capture for '{}' ({:?})",
            device.name, device_type
        );

        let capture = AudioCapture::new(
            device.clone(),
            state,
            CAPTURE_RATE,
            CAPTURE_CHANNELS as u16,
            device_type,
        );

        let target = capture_target_for(&device.name, device_type);
        let stream = PwCaptureStream::open(
            target,
            Box::new(move |samples| capture.process_audio_data(samples)),
        )?;

        Ok(Self { device, stream })
    }

    pub fn device(&self) -> &AudioDevice {
        &self.device
    }

    pub fn stop(self) -> Result<()> {
        info!("Stopping audio stream for device: {}", self.device.name);
        self.stream.stop();
        Ok(())
    }
}

/// Manages the microphone + system capture stream pair.
pub struct AudioStreamManager {
    microphone_stream: Option<AudioStream>,
    system_stream: Option<AudioStream>,
    state: Arc<RecordingState>,
}

impl AudioStreamManager {
    pub fn new(state: Arc<RecordingState>) -> Self {
        Self {
            microphone_stream: None,
            system_stream: None,
            state,
        }
    }

    /// Start audio streams for the given devices.
    pub async fn start_streams(
        &mut self,
        microphone_device: Option<Arc<AudioDevice>>,
        system_device: Option<Arc<AudioDevice>>,
    ) -> Result<()> {
        if let Some(mic_device) = microphone_device {
            info!("🎤 Creating microphone stream: {}", mic_device.name);
            match AudioStream::create(
                mic_device.clone(),
                self.state.clone(),
                DeviceType::Microphone,
            )
            .await
            {
                Ok(stream) => {
                    self.state.set_microphone_device(mic_device);
                    self.microphone_stream = Some(stream);
                    info!("✅ Microphone stream created successfully");
                }
                Err(e) => {
                    error!("❌ Failed to create microphone stream: {}", e);
                    return Err(e);
                }
            }
        } else {
            info!("ℹ️ No microphone device specified, skipping microphone stream");
        }

        if let Some(sys_device) = system_device {
            info!("🔊 Creating system audio stream: {}", sys_device.name);
            match AudioStream::create(sys_device.clone(), self.state.clone(), DeviceType::System)
                .await
            {
                Ok(stream) => {
                    self.state.set_system_device(sys_device);
                    self.system_stream = Some(stream);
                    info!("✅ System audio stream created successfully");
                }
                Err(e) => {
                    // Don't fail the whole recording if only system audio fails.
                    error!("⚠️ Failed to create system audio stream: {}", e);
                }
            }
        } else {
            info!("ℹ️ No system device specified, skipping system audio stream");
        }

        if self.microphone_stream.is_none() && self.system_stream.is_none() {
            return Err(anyhow::anyhow!("No audio streams could be created"));
        }

        Ok(())
    }

    /// Stop all audio streams.
    pub fn stop_streams(&mut self) -> Result<()> {
        info!("Stopping all audio streams");

        if let Some(mic_stream) = self.microphone_stream.take() {
            mic_stream.stop()?;
        }
        if let Some(sys_stream) = self.system_stream.take() {
            sys_stream.stop()?;
        }

        info!("All audio streams stopped");
        Ok(())
    }

    pub fn active_stream_count(&self) -> usize {
        self.microphone_stream.is_some() as usize + self.system_stream.is_some() as usize
    }

    pub fn has_active_streams(&self) -> bool {
        self.microphone_stream.is_some() || self.system_stream.is_some()
    }
}

impl Drop for AudioStreamManager {
    fn drop(&mut self) {
        if let Err(e) = self.stop_streams() {
            error!("Error stopping streams during drop: {}", e);
        }
    }
}
