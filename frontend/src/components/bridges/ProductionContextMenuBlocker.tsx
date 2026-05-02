"use client";

import { useEffect } from "react";

// Disables the browser context menu in production builds (so users don't see
// "Reload", "Inspect", etc. in a desktop app). Dev builds keep the menu so
// DevTools is reachable.
export function ProductionContextMenuBlocker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  return null;
}
