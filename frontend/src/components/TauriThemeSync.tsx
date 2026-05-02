"use client";

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Sets the `.dark` class on <html> based on Tauri's native theme detection
// at app startup only. We do not track live changes — neither
// `onThemeChanged` nor polling `window.theme()` reflects KDE-driven theme
// changes (KDE is Qt-based and doesn't emit GTK signals; Tauri's underlying
// detection on Linux caches the value at startup). Restart the app to
// pick up a system theme change.
//
// Default is dark (set on <html> in layout.tsx); we only flip to light if
// Tauri explicitly reports a light system theme.
//
// We sidestep next-themes entirely because its `enableSystem` mode relies
// on `prefers-color-scheme`, which WebKitGTK on Linux doesn't reliably
// wire to the GTK theme.
export function TauriThemeSync() {
  useEffect(() => {
    (async () => {
      const theme = await getCurrentWindow().theme();
      if (theme === "light") {
        document.documentElement.classList.remove("dark");
      }
    })();
  }, []);

  return null;
}
