import { useEffect, useState } from "react";

/**
 * Ticks `Date.now()` once a second for as long as `startedAt` is set, and
 * returns the elapsed milliseconds since `startedAt` (0 when `startedAt` is
 * null). The interval is created only while `startedAt` is non-null and is
 * torn down as soon as it goes back to null - unlike the two independent
 * always-on 1Hz clocks this replaces (SidebarRecordingButton,
 * RecordingTopBar - issue #51), it does no work when there's nothing to
 * tick.
 */
export function useElapsedTime(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return startedAt === null ? 0 : now - startedAt;
}
