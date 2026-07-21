import * as React from "react";

import { cn } from "@/lib/utils";

function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.floor(total));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export interface TimestampProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  /** Seconds to format as [H:]MM:SS. Ignored when `children` is provided. */
  seconds?: number;
  /** Tint the timestamp with the brand colour (e.g. first / active segment). */
  brand?: boolean;
}

/**
 * Monospace, tabular-nums timestamp — Parley's `[MM:SS]` transcript gutter and
 * elapsed timers. Pass `seconds` to auto-format, or `children` for a value the
 * caller already formatted.
 */
export function Timestamp({
  seconds,
  brand,
  className,
  children,
  ...props
}: TimestampProps) {
  return (
    <span
      className={cn(
        "font-mono text-xs font-medium tabular-nums",
        brand ? "text-brand-strong" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (seconds !== undefined ? formatSeconds(seconds) : null)}
    </span>
  );
}

export { formatSeconds };
