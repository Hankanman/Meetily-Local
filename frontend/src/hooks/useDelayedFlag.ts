"use client";

import { useEffect, useState } from "react";

/**
 * Returns `true` only after `flag` has been `true` continuously for at
 * least `delayMs` milliseconds. If `flag` flips back to `false` before
 * the delay elapses, the returned value never goes true (no flash).
 *
 * Use for "skip the skeleton if loading is fast" UX:
 *
 * ```tsx
 * const showSkeleton = useDelayedFlag(isLoading, 250);
 * if (isLoading) return showSkeleton ? <Skeleton /> : null;
 * return <Content />;
 * ```
 *
 * — fast loads (< 250ms) render nothing then jump straight to content;
 * slow loads show the skeleton after the user would have noticed the
 * absence of content anyway. Eliminates the "skeleton flashes once
 * then disappears" perception bug.
 */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (!flag) {
      setDelayed(false);
      return;
    }
    const id = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(id);
  }, [flag, delayMs]);

  return delayed;
}
