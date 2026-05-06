"use client";

import { Mic } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";

interface HeroStartButtonProps {
  onStart: () => void;
  /** True while recording_start is in flight (device validation / model
   *  load). Renders a spinner instead of the mic icon. */
  isStarting: boolean;
  /** Disabled when no microphone is detected or another flow is in
   *  progress. */
  disabled?: boolean;
}

/**
 * Center-stage hero CTA. Big circular red button with a soft pulse halo
 * to draw the eye. Calls `onStart` on click — the parent owns the
 * `useRecordingStart` hook, so this component is purely presentational.
 */
export function HeroStartButton({
  onStart,
  isStarting,
  disabled = false,
}: HeroStartButtonProps) {
  const isDisabled = disabled || isStarting;

  return (
    // No constant pulse animation — the button is already visually loud
    // (big, red, circular) and the recording page can sit idle for long
    // periods. We rely on hover/active scale + a soft hover ring for
    // interactive feedback instead.
    <button
      type="button"
      onClick={onStart}
      disabled={isDisabled}
      aria-label="Start recording"
      className={`
        relative flex size-28 items-center justify-center rounded-full
        text-white shadow-lg transition-all duration-150
        ${isDisabled
          ? "cursor-not-allowed bg-muted text-muted-foreground"
          : `
            bg-destructive
            hover:scale-105 hover:shadow-xl hover:ring-8 hover:ring-destructive/15
            active:scale-95
          `}
      `}
    >
      {isStarting ? (
        <Spinner size="lg" className="text-background" />
      ) : (
        <Mic className="size-12" />
      )}
    </button>
  );
}
