"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { useAudioLevels } from "@/hooks/useAudioLevels";
import { CompactAudioLevelMeter } from "@/components/AudioLevelMeter";
import { Button } from "@/components/ui/button";

interface RecordingTopBarProps {
  isStopping: boolean;
  /** Called when the stop flow completes (just like the existing dock).
   *  Wires through to `useRecordingStop().handleRecordingStop`. */
  onStop: (callApi?: boolean) => void;
  /** Triggered immediately when the user clicks stop (so the parent can
   *  flip into a "stopping" UI state without waiting for the Tauri
   *  invoke to resolve). */
  onStopInitiated?: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Top status bar shown while a recording is active. Replaces the old
 * floating bottom dock. Layout:
 *
 *   ●  Recording 02:34   Mic ▆▄▆   System ▅▃▅          ⏸ Pause   ⏹ Stop
 *
 * Pause/resume/stop call the Tauri commands directly; live audio levels
 * come from `useAudioLevels`.
 */
export function RecordingTopBar({
  isStopping,
  onStop,
  onStopInitiated,
}: RecordingTopBarProps) {
  const { selectedDevices } = useConfig();
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;

  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const monitorNames = [
    selectedDevices?.micDevice ?? null,
    selectedDevices?.systemDevice ?? null,
  ].filter((n): n is string => !!n);
  const levels = useAudioLevels(monitorNames.length > 0 ? monitorNames : null);
  const micLevel = selectedDevices?.micDevice
    ? levels.get(selectedDevices.micDevice)
    : null;
  const systemLevel = selectedDevices?.systemDevice
    ? levels.get(selectedDevices.systemDevice)
    : null;

  const handlePauseToggle = async () => {
    if (isPaused) {
      setResuming(true);
      try {
        await invoke("resume_recording");
      } catch (err) {
        console.error("Failed to resume recording:", err);
      } finally {
        setResuming(false);
      }
    } else {
      setPausing(true);
      try {
        await invoke("pause_recording");
      } catch (err) {
        console.error("Failed to pause recording:", err);
      } finally {
        setPausing(false);
      }
    }
  };

  const handleStop = () => {
    onStopInitiated?.();
    onStop(true);
  };

  return (
    <div className="
      flex shrink-0 items-center gap-4 border-b border-border bg-background
      px-4 py-2
    ">
      <div className="flex items-center gap-2">
        <span
          className={`
            size-2.5 rounded-full
            ${isPaused
              ? "bg-orange-500"
              : "animate-pulse bg-destructive"}
          `}
        />
        <span className="text-sm font-medium">
          {isPaused ? "Paused" : "Recording"}
        </span>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {formatElapsed(now - startedAt)}
        </span>
      </div>

      <div className="hidden items-center gap-3 text-xs text-muted-foreground md:flex">
        {micLevel && (
          <div className="flex items-center gap-1.5">
            <span>Mic</span>
            <CompactAudioLevelMeter
              rmsLevel={micLevel.rms_level}
              peakLevel={micLevel.peak_level}
              isActive={micLevel.is_active && !isPaused}
            />
          </div>
        )}
        {systemLevel && (
          <div className="flex items-center gap-1.5">
            <span>System</span>
            <CompactAudioLevelMeter
              rmsLevel={systemLevel.rms_level}
              peakLevel={systemLevel.peak_level}
              isActive={systemLevel.is_active && !isPaused}
            />
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handlePauseToggle}
          disabled={pausing || resuming || isStopping}
          aria-label={isPaused ? "Resume recording" : "Pause recording"}
        >
          {isPaused ? (
            <>
              <Play className="mr-1 size-4" />
              {resuming ? "Resuming…" : "Resume"}
            </>
          ) : (
            <>
              <Pause className="mr-1 size-4" />
              {pausing ? "Pausing…" : "Pause"}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={handleStop}
          disabled={isStopping || pausing || resuming}
        >
          <Square className="mr-1 size-4" />
          {isStopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
    </div>
  );
}
