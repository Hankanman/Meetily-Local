import React from "react";

interface AudioLevelMeterProps {
  rmsLevel: number; // 0.0 to 1.0
  peakLevel: number; // 0.0 to 1.0
  isActive: boolean; // Whether audio is being detected
  deviceName: string;
  className?: string;
  size?: "small" | "medium" | "large";
}

export function AudioLevelMeter({
  rmsLevel,
  peakLevel,
  isActive,
  deviceName,
  className = "",
  size = "medium",
}: AudioLevelMeterProps) {
  // Normalize levels to 0-1 range and apply log scaling for better visual representation
  const normalizedRms = Math.max(0, Math.min(1, rmsLevel));
  const normalizedPeak = Math.max(0, Math.min(1, peakLevel));

  // Apply logarithmic scaling for better visual representation of audio levels
  const logRms = normalizedRms > 0 ? Math.log10(normalizedRms * 9 + 1) : 0;
  const logPeak = normalizedPeak > 0 ? Math.log10(normalizedPeak * 9 + 1) : 0;

  // Calculate percentages for display
  const rmsPercent = Math.round(logRms * 100);
  const peakPercent = Math.round(logPeak * 100);

  // Parley meters read brand-azure; clipping (near-max) flips to destructive
  // so the "you're too hot" signal survives the retint.
  const getLevelColor = (level: number) => (level >= 0.92 ? "bg-destructive" : "bg-brand");

  const rmsColor = getLevelColor(logRms);
  const peakColor = getLevelColor(logPeak);

  // Size variants
  const sizeClasses = {
    small: {
      container: "h-2",
      text: "text-sm",
      meter: "h-1.5",
    },
    medium: {
      container: "h-3",
      text: "text-sm",
      meter: "h-2",
    },
    large: {
      container: "h-4",
      text: "text-sm",
      meter: "h-3",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div className={`
      flex items-center space-x-2
      ${className}
    `}>
      {/* Device activity indicator */}
      <div
        className={`
          size-2 rounded-full
          ${
          isActive ? "animate-parley-pulse bg-brand" : "bg-muted"
        }
        `}
        title={`${deviceName} - ${isActive ? "Active" : "Inactive"}`}
      />

      {/* Level meter container */}
      <div className={`
        flex-1
        ${sizes.container}
        relative
      `}>
        {/* Background */}
        <div className="size-full overflow-hidden rounded-md bg-muted">
          {/* RMS level bar (main level) */}
          <div
            className={`
              ${sizes.meter}
              ${rmsColor}
              rounded-md transition-all duration-150 ease-out
            `}
            style={{ width: `${rmsPercent}%` }}
          />

          {/* Peak level indicator (thin line) */}
          {peakPercent > rmsPercent && (
            <div
              className={`
                absolute inset-y-0 w-0.5
                ${peakColor}
                transition-all duration-75
              `}
              style={{ left: `${peakPercent}%` }}
            />
          )}
        </div>

        {/* Level markers */}
        <div className="
          pointer-events-none absolute inset-0 flex items-center justify-between
          px-1
        ">
          {/* 25% marker */}
          <div
            className="h-full w-px bg-muted opacity-30"
            style={{ marginLeft: "25%" }}
          />
          {/* 50% marker */}
          <div
            className="h-full w-px bg-muted opacity-30"
            style={{ marginLeft: "50%" }}
          />
          {/* 75% marker */}
          <div
            className="h-full w-px bg-muted opacity-30"
            style={{ marginLeft: "75%" }}
          />
        </div>
      </div>

      {/* Level percentage display */}
      <div
        className={`
          ${sizes.text}
          min-w-12 text-right font-mono text-muted-foreground
        `}
      >
        {rmsPercent}%
      </div>
    </div>
  );
}

interface CompactAudioLevelMeterProps {
  rmsLevel: number;
  peakLevel: number;
  isActive: boolean;
  className?: string;
}

// Compact version for inline display in dropdowns
export function CompactAudioLevelMeter({
  rmsLevel,
  peakLevel,
  isActive,
  className = "",
}: CompactAudioLevelMeterProps) {
  const normalizedRms = Math.max(0, Math.min(1, rmsLevel));
  const logRms = normalizedRms > 0 ? Math.log10(normalizedRms * 9 + 1) : 0;
  const rmsPercent = Math.round(logRms * 100);

  const getLevelColor = (level: number) => (level >= 0.92 ? "bg-destructive" : "bg-brand");

  return (
    <div className={`
      flex items-center space-x-1
      ${className}
    `}>
      {/* Activity dot */}
      <div
        className={`
          size-1.5 rounded-full
          ${
          isActive ? "bg-brand" : "bg-muted"
        }
        `}
      />

      {/* Mini meter */}
      <div className="h-1.5 w-8 overflow-hidden rounded-md bg-muted">
        <div
          className={`
            h-full
            ${getLevelColor(logRms)}
            transition-all duration-150
          `}
          style={{ width: `${rmsPercent}%` }}
        />
      </div>
    </div>
  );
}

interface SignalBarsProps {
  rmsLevel: number;
  isActive: boolean;
  bars?: number;
  height?: number;
  className?: string;
}

/**
 * Signal-bar meter (Parley recording status bar). Renders `bars` vertical
 * bars that light up brand-azure in sequence with the (log-scaled) level.
 * Inactive bars sit muted; the top bar flips destructive when clipping.
 */
export function SignalBars({
  rmsLevel,
  isActive,
  bars = 5,
  height = 18,
  className = "",
}: SignalBarsProps) {
  const normalizedRms = Math.max(0, Math.min(1, rmsLevel));
  const logRms = normalizedRms > 0 ? Math.log10(normalizedRms * 9 + 1) : 0;
  const active = isActive ? Math.round(logRms * bars) : 0;

  return (
    <div
      className={`flex items-end gap-0.5 ${className}`}
      style={{ height }}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, i) => {
        const lit = i < active;
        const clipping = lit && logRms >= 0.92 && i === bars - 1;
        return (
          <div
            key={i}
            className={`
              w-1 rounded-full transition-[height,background-color] duration-150
              ${clipping ? "bg-destructive" : lit ? "bg-brand" : "bg-muted-foreground/30"}
            `}
            style={{ height: `${((i + 1) / bars) * 100}%` }}
          />
        );
      })}
    </div>
  );
}
