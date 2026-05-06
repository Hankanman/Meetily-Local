"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AudioLevel {
  device_name: string;
  device_type: string;
  rms_level: number;
  peak_level: number;
  is_active: boolean;
}

interface AudioLevelUpdate {
  timestamp: number;
  levels: AudioLevel[];
}

/**
 * Subscribe to the backend `audio-level-updates` event and start/stop the
 * monitor for the requested device names. Returns the latest level keyed
 * by device_name.
 *
 * Pass `null` to disable monitoring (e.g. when leaving the pre-recording
 * hero — the backend stops emitting and the map clears).
 */
export function useAudioLevels(
  deviceNames: string[] | null,
): Map<string, AudioLevel> {
  const [levels, setLevels] = useState<Map<string, AudioLevel>>(new Map());
  // Track the most-recently-requested set so we don't flap the backend on
  // every re-render — only restart monitoring when the names actually change.
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const key = deviceNames === null ? null : [...deviceNames].sort().join("|");
    if (key === lastKey.current) return;
    lastKey.current = key;

    (async () => {
      // Stop any prior monitor before starting (or stopping) again.
      try {
        await invoke("stop_audio_level_monitoring");
      } catch {
        // ignore — first run, or backend already stopped
      }
      if (cancelled) return;

      if (!deviceNames || deviceNames.length === 0) {
        setLevels(new Map());
        return;
      }

      try {
        await invoke("start_audio_level_monitoring", { deviceNames });
      } catch (err) {
        console.error("Failed to start audio level monitoring:", err);
        return;
      }

      try {
        unlisten = await listen<AudioLevelUpdate>(
          "audio-level-updates",
          (event) => {
            const next = new Map<string, AudioLevel>();
            for (const lvl of event.payload.levels) {
              next.set(lvl.device_name, lvl);
            }
            setLevels(next);
          },
        );
      } catch (err) {
        console.error("Failed to subscribe to audio-level-updates:", err);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // Don't stop monitoring here — the next effect run will replace it.
      // The cleanup-on-unmount case is handled by the parent component
      // dropping `deviceNames` to null before unmount.
    };
  }, [deviceNames]);

  // Stop monitoring on full unmount.
  useEffect(() => {
    return () => {
      void invoke("stop_audio_level_monitoring").catch(() => {});
    };
  }, []);

  return levels;
}
