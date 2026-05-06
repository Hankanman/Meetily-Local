"use client";

import { Mic, Square } from "lucide-react";
import { useEffect, useState } from "react";

interface SidebarRecordingButtonProps {
  isRecording: boolean;
  /** Triggered when the user clicks the button while not recording. The
   *  parent navigates to home and dispatches `start-recording-from-sidebar`. */
  onStart: () => void;
  /** Triggered when the user clicks the button *while* recording. Used to
   *  navigate back to the recording page (where the stop / pause controls
   *  live) — without this, a user who navigates away during a recording
   *  has no obvious way to get back to stop it. */
  onResumeView: () => void;
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
 *  - Idle: red "Start recording" pill — click starts the recording.
 *  - Recording: red pill with a pulse, "Recording", and elapsed time —
 *    click navigates back to the recording page so the user can hit stop.
 *
 * The button is always clickable; the parent decides via the two
 * callbacks (`onStart` when idle, `onResumeView` when recording) what
 * each click does. Without the recording-state click action, a user who
 * navigates to settings/details mid-recording has no path back to the
 * stop control short of digging through the sidebar's brand-as-home
 * shortcut.
 */
export function SidebarRecordingButton({
  isRecording,
  onStart,
  onResumeView,
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
  const handleClick = isRecording ? onResumeView : onStart;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={
          isRecording
            ? "Recording in progress — click to view"
            : "Start recording"
        }
        title={
          isRecording
            ? "Recording in progress — click to view"
            : "Start recording"
        }
        className="
          flex size-10 items-center justify-center rounded-full bg-destructive
          text-white shadow-sm transition-colors
          hover:bg-destructive/90
        "
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
      onClick={handleClick}
      title={
        isRecording
          ? "Recording in progress — click to return to the recording page"
          : "Start a new recording"
      }
      className="
        flex w-full items-center justify-center gap-2 rounded-md
        bg-destructive px-3 py-2.5 text-sm font-medium text-white shadow-sm
        transition-colors
        hover:bg-destructive/90
      "
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
