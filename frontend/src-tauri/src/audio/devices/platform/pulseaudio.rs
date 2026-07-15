//! Linux-only helpers for enumerating PulseAudio / PipeWire monitor sources
//! and resolving a user-facing description back to its source name.
//!
//! Why this exists: cpal's ALSA backend only sees ALSA PCMs (`arecord -L`),
//! which on a PipeWire / PulseAudio system does *not* include the
//! per-sink `*.monitor` sources used to record what's coming out of
//! speakers. The previous Linux device enumerator filtered cpal's ALSA
//! input list for `name.contains("monitor")` and consequently found
//! nothing on every modern Fedora / Arch / Ubuntu install. Shelling out
//! to `pactl` (always available where PipeWire / PulseAudio is) gives us
//! the authoritative list.
//!
//! The corresponding capture redirect lives in
//! `audio::devices::configuration::get_device_and_config` and uses the
//! `PIPEWIRE_NODE` environment variable, which `pipewire-alsa` reads at
//! `snd_pcm_open` time to bind the default PCM to a specific source.

use std::process::Command;

use anyhow::{anyhow, Result};

#[derive(Debug, Clone)]
pub struct MonitorSource {
    /// Internal PA name (e.g.
    /// `alsa_output.usb-RODE_..._NT-USB-00.pro-output-0.monitor`). Used
    /// as `PIPEWIRE_NODE` at capture time.
    pub name: String,
    /// User-facing description from `pactl` (e.g.
    /// "Monitor of RODE NT-USB Pro"). Used in the device picker.
    pub description: String,
}

/// Run `pactl list sources` and parse out monitor entries. Returns an
/// empty Vec — not Err — when `pactl` isn't on PATH so the caller can
/// fall back to the cpal-based enumeration without polluting logs.
pub fn list_pulseaudio_monitors() -> Result<Vec<MonitorSource>> {
    let output = match Command::new("pactl").arg("list").arg("sources").output() {
        Ok(o) => o,
        Err(e) => {
            log::debug!(
                "pactl not available ({}); skipping PulseAudio monitor enumeration",
                e
            );
            return Ok(Vec::new());
        }
    };
    if !output.status.success() {
        return Err(anyhow!(
            "pactl exited with status {}",
            output.status
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_pactl_sources(&stdout))
}

/// Find the PA source whose `Description` matches `description` and
/// return the PipeWire node name to set as `PIPEWIRE_NODE`. Description
/// match is exact and case-insensitive trimmed; PA descriptions are
/// stable enough that this is safe.
pub fn resolve_source_name_by_description(description: &str) -> Result<Option<String>> {
    let monitors = list_pulseaudio_monitors()?;
    let needle = description.trim().to_lowercase();
    Ok(monitors
        .into_iter()
        .find(|m| m.description.trim().to_lowercase() == needle)
        .map(|m| capture_node_name(m.name)))
}

/// `PIPEWIRE_NODE` must name a real PipeWire node. The pulse-compat
/// `<sink>.monitor` source is not one — passing it leaves the capture
/// stream waiting forever for a node that doesn't exist (the PCM opens
/// fine but no data ever arrives). Target the sink node itself instead;
/// PipeWire connects capture streams to a sink's monitor ports
/// automatically.
fn capture_node_name(source_name: String) -> String {
    match source_name.strip_suffix(".monitor") {
        Some(sink) => sink.to_string(),
        None => source_name,
    }
}

fn parse_pactl_sources(stdout: &str) -> Vec<MonitorSource> {
    let mut out = Vec::new();
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut device_class: Option<String> = None;

    let flush = |out: &mut Vec<MonitorSource>,
                 name: &mut Option<String>,
                 description: &mut Option<String>,
                 device_class: &mut Option<String>| {
        if let (Some(n), Some(d)) = (name.take(), description.take()) {
            let class_is_monitor = device_class
                .take()
                .map(|c| c.eq_ignore_ascii_case("monitor"))
                .unwrap_or(false);
            if class_is_monitor || n.ends_with(".monitor") {
                out.push(MonitorSource {
                    name: n,
                    description: d,
                });
            }
        } else {
            *device_class = None;
        }
    };

    for line in stdout.lines() {
        let trimmed = line.trim();
        if line.starts_with("Source #") {
            flush(&mut out, &mut name, &mut description, &mut device_class);
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("Name: ") {
            name = Some(rest.to_string());
        } else if let Some(rest) = trimmed.strip_prefix("Description: ") {
            description = Some(rest.to_string());
        } else if let Some(rest) = trimmed.strip_prefix("device.class = ") {
            device_class = Some(rest.trim_matches('"').to_string());
        }
    }
    // Final block (no trailing "Source #" header).
    flush(&mut out, &mut name, &mut description, &mut device_class);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = "Source #9301\n\
\tName: alsa_output.usb-RODE_Microphones_RODE_NT-USB-00.pro-output-0.monitor\n\
\tDescription: Monitor of RODE NT-USB Pro\n\
\tProperties:\n\
\t\tdevice.class = \"monitor\"\n\
Source #9302\n\
\tName: alsa_input.usb-RODE_Microphones_RODE_NT-USB-00.pro-input-0\n\
\tDescription: RODE NT-USB Pro\n\
\tProperties:\n\
\t\tdevice.class = \"sound\"\n\
Source #13141\n\
\tName: alsa_output.usb-SteelSeries_Arctis_Pro_Wireless-00.stereo-game.monitor\n\
\tDescription: Monitor of Arctis Pro Wireless Game\n\
\tProperties:\n\
\t\tdevice.class = \"monitor\"\n\
";

    #[test]
    fn capture_node_name_strips_monitor_suffix() {
        assert_eq!(
            capture_node_name("alsa_output.pci-0000_2d_00.1.hdmi-stereo.monitor".into()),
            "alsa_output.pci-0000_2d_00.1.hdmi-stereo"
        );
        assert_eq!(
            capture_node_name("alsa_input.usb-mic-00.pro-input-0".into()),
            "alsa_input.usb-mic-00.pro-input-0"
        );
    }

    #[test]
    fn parses_only_monitor_sources() {
        let monitors = parse_pactl_sources(FIXTURE);
        assert_eq!(monitors.len(), 2);
        assert_eq!(monitors[0].description, "Monitor of RODE NT-USB Pro");
        assert!(monitors[0].name.ends_with(".monitor"));
        assert_eq!(
            monitors[1].description,
            "Monitor of Arctis Pro Wireless Game"
        );
    }
}
