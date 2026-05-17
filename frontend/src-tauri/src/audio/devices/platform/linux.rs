use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};

use crate::audio::devices::configuration::{AudioDevice, DeviceType};

/// Decide whether a Linux device name is worth showing to the user.
///
/// On PipeWire/PulseAudio systems, cpal's ALSA backend enumerates every raw
/// ALSA PCM (`sysdefault:CARD=X`, `front:CARD=X,DEV=0`, `surround51:CARD=X`,
/// `iec958:CARD=X`, `hw:CARD=X`, etc.). None of these are meaningful choices
/// — the user should pick a logical endpoint (`pipewire`, `default`, `pulse`)
/// and let PipeWire route to the currently selected source/sink.
///
/// Returns true when `name` should appear in the picker.
pub fn is_user_facing_linux_device(name: &str) -> bool {
    // Always-show logical endpoints.
    const LOGICAL: &[&str] = &["default", "pipewire", "pulse", "jack", "sysdefault"];
    if LOGICAL.contains(&name) {
        return true;
    }

    // Raw ALSA PCM profile entries — hide.
    const RAW_ALSA_PREFIXES: &[&str] = &[
        "front:",
        "rear:",
        "center_lfe:",
        "side:",
        "surround21:",
        "surround40:",
        "surround41:",
        "surround50:",
        "surround51:",
        "surround71:",
        "iec958:",
        "hdmi:",
        "dmix:",
        "dsnoop:",
        "hw:",
        "plughw:",
        "plug:",
        "sysdefault:",
    ];
    if RAW_ALSA_PREFIXES.iter().any(|p| name.starts_with(p)) {
        return false;
    }

    // Otherwise keep — covers PulseAudio/PipeWire named nodes like
    // `alsa_input.usb-Rode_NT-USB-00.pro-input-0` and anything else cpal
    // surfaces that doesn't match the raw-ALSA pattern.
    true
}

/// Configure Linux audio devices using ALSA / PulseAudio / PipeWire.
pub fn configure_linux_audio(host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    // Microphones.
    for device in host.input_devices()? {
        if let Ok(name) = device.name() {
            if is_user_facing_linux_device(&name) {
                devices.push(AudioDevice::new(name, DeviceType::Input));
            }
        }
    }

    // Monitor sources = system-audio capture (meeting participants).
    //
    // On modern Fedora / Arch / Ubuntu the host is PipeWire (with the
    // `pipewire-alsa` shim). cpal's ALSA backend only sees ALSA PCMs
    // (`arecord -L`), and per-sink `*.monitor` sources are PulseAudio
    // / PipeWire concepts that don't appear in that list — so the
    // previous `name.contains("monitor")` filter on
    // `alsa_host.input_devices()` returned nothing on every modern
    // Linux setup. We now ask `pactl` directly, which is the
    // authoritative source. The capture path
    // (`get_device_and_config` for `DeviceType::Output`) translates
    // the user's pick back to a source name and redirects via
    // `PIPEWIRE_NODE`.
    let monitors_via_pactl = match super::pulseaudio::list_pulseaudio_monitors() {
        Ok(m) => m,
        Err(e) => {
            log::warn!("pactl monitor enumeration failed: {}", e);
            Vec::new()
        }
    };
    if !monitors_via_pactl.is_empty() {
        for monitor in monitors_via_pactl {
            // Use the human description as the device name so the
            // picker shows "Monitor of Arctis Pro Wireless Game"
            // rather than the raw alsa_output.usb-... source name.
            // Resolution back to the source name happens at capture
            // time.
            devices.push(AudioDevice::new(
                format!("{} (System Audio)", monitor.description),
                DeviceType::Output,
            ));
        }
    } else if let Ok(alsa_host) = cpal::host_from_id(cpal::HostId::Alsa) {
        // Fallback for hosts where pactl isn't installed but cpal
        // somehow surfaces monitor sources (rare, mostly legacy
        // PulseAudio + alsa-plugins-pulseaudio setups).
        for device in alsa_host.input_devices()? {
            if let Ok(name) = device.name() {
                if name.contains("monitor") && is_user_facing_linux_device(&name) {
                    devices.push(AudioDevice::new(
                        format!("{} (System Audio)", name),
                        DeviceType::Output,
                    ));
                }
            }
        }
    }

    Ok(devices)
}
