/**
 * No-op unless the user has opted into verbose transcript logging via
 * `localStorage.setItem('meetily-debug', '1')`. Keeps hot-path
 * (per-segment / per-partial) console traffic out of normal operation
 * without deleting the diagnostic value of the logs.
 */
export function isDebugLogEnabled(): boolean {
  try {
    return localStorage.getItem("meetily-debug") === "1";
  } catch {
    return false;
  }
}

export function debugLog(...args: unknown[]): void {
  try {
    if (isDebugLogEnabled()) {
      console.log(...args);
    }
  } catch {
    // no-op — never let logging break the hot path
  }
}
