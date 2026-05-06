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
    <div className="relative inline-flex items-center justify-center">
      {/* Soft pulsing halo behind the button — purely decorative, signals
          "ready to record". Disabled (visually muted) when the button is. */}
      {!isDisabled && (
        <span className="
          absolute inset-0 -m-2 animate-ping rounded-full bg-destructive/20
        " />
      )}
      <button
        type="button"
        onClick={onStart}
        disabled={isDisabled}
        aria-label="Start recording"
        className={`
          relative flex size-28 items-center justify-center rounded-full
          text-white shadow-lg transition-transform
          ${isDisabled
            ? "cursor-not-allowed bg-muted text-muted-foreground"
            : `
              bg-destructive
              hover:scale-105
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
    </div>
  );
}
