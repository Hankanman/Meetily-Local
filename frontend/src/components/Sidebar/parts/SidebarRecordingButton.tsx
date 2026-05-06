"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useState } from "react";

interface SidebarRecordingButtonProps {
  isRecording: boolean;
  /** Triggered when the user clicks the button while not recording. The
   *  parent navigates to home and dispatches `start-recording-from-sidebar`. */
  onStart: () => void;
  /** Hide the label, render an icon-only square pill (used by the collapsed
   *  rail). */
  collapsed?: boolean;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Primary call-to-action. Two visual states:
 *  - Idle: blue/primary "Start recording" pill
 *  - Recording: red pill with elapsed time and a stop icon, disabled
 *    (the actual stop is handled by the recording UI on the home page)
 */
export function SidebarRecordingButton({
  isRecording,
  onStart,
  collapsed = false,
}: SidebarRecordingButtonProps) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRecording) {
      setStartedAt(null);
      return;
    }
    setStartedAt((prev) => prev ?? Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRecording]);

  const elapsed = isRecording && startedAt ? now - startedAt : 0;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onStart}
        disabled={isRecording}
        aria-label={isRecording ? "Recording in progress" : "Start recording"}
        className={`
          flex size-10 items-center justify-center rounded-full text-white
          shadow-sm transition-colors
          ${isRecording
            ? "cursor-not-allowed bg-destructive"
            : "bg-destructive hover:bg-destructive/90"}
        `}
      >
        {isRecording ? (
          <Square className="size-4" />
        ) : (
          <Mic className="size-4" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={isRecording}
      className={`
        flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5
        text-sm font-medium text-white shadow-sm transition-colors
        ${isRecording
          ? "cursor-not-allowed bg-destructive"
          : "bg-destructive hover:bg-destructive/90"}
      `}
    >
      {isRecording ? (
        <>
          <span className="size-2 animate-pulse rounded-full bg-white" />
          <span>Recording</span>
          <span className="font-mono tabular-nums opacity-90">
            {formatElapsed(elapsed)}
          </span>
        </>
      ) : (
        <>
          <Mic className="size-4" />
          <span>Start recording</span>
        </>
      )}
    </button>
  );
}
