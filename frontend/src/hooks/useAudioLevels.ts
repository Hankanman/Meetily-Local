"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AudioLevel {
  device_name: string; // role key: "mic" | "system"
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevel[];
}

export interface RoleLevels {
  mic: AudioLevel | null;
  system: AudioLevel | null;
}

const EMPTY_LEVELS: RoleLevels = { mic: null, system: null };

/**
 * Subscribe to the backend `audio-levels` event and start/stop the level
 * monitor for the given devices.
 *
 * `micDevice` / `systemDevice` are PipeWire node ids or `"default"`;
 * pass `null` to skip that role. Pass both as `null` to disable
 * monitoring entirely. Levels come back keyed by role ("mic"/"system"),
 * so callers don't track device ids.
 */
export function useAudioLevels(
  micDevice: string | null,
  systemDevice: string | null,
): RoleLevels {
  const [levels, setLevels] = useState<RoleLevels>(EMPTY_LEVELS);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    (async () => {
      // Stop any prior monitor before starting (or stopping) again.
      try {
        await invoke("stop_audio_level_monitoring");
      } catch {
        // ignore — first run, or backend already stopped
      }
      if (cancelled) return;

      if (micDevice === null && systemDevice === null) {
        setLevels(EMPTY_LEVELS);
        return;
      }

      try {
        await invoke("start_audio_level_monitoring", {
          mic_device: micDevice,
          system_device: systemDevice,
        });
      } catch (err) {
        console.error("Failed to start audio level monitoring:", err);
        return;
      }

      try {
        unlisten = await listen<AudioLevelUpdate>("audio-levels", (event) => {
          const next: RoleLevels = { mic: null, system: null };
          for (const lvl of event.payload.levels) {
            if (lvl.device_name === "mic") next.mic = lvl;
            if (lvl.device_name === "system") next.system = lvl;
          }
          setLevels(next);
        });
      } catch (err) {
        console.error("Failed to subscribe to audio-levels:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // The next effect run replaces the monitor; unmount cleanup below.
    };
  }, [micDevice, systemDevice]);

  // Stop monitoring on full unmount.
  useEffect(() => {
    return () => {
      void invoke("stop_audio_level_monitoring").catch(() => {});
    };
  }, []);

  return levels;
}
