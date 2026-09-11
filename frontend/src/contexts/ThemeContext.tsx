"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// Theme preference persisted across launches. "system" follows the OS.
export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "meetily-theme";
// The last theme we actually resolved to (never "system"). Read by the
// pre-paint script in layout.tsx as its best guess for "system" before this
// provider has had a chance to run — see resolveSystemTheme below for why a
// stale cached value beats a live prefers-color-scheme read on Linux.
export const THEME_RESOLVED_STORAGE_KEY = "meetily-theme-resolved";

interface ThemeContextValue {
  /** The user's stored choice. */
  theme: ThemePreference;
  /** The theme actually applied right now ("system" resolved to one). */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyResolved(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  // Native form controls / scrollbars follow this.
  root.style.colorScheme = resolved;
  // Cache it so the pre-paint script has a real last-known value instead of
  // guessing "dark" on the next launch (see THEME_RESOLVED_STORAGE_KEY).
  try {
    localStorage.setItem(THEME_RESOLVED_STORAGE_KEY, resolved);
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

// Resolve "system" to a concrete theme.
//
// Linux note: WebKitGTK (the webview Tauri uses on Linux) does not reliably
// wire `prefers-color-scheme` to the GTK/KDE theme — see the removed
// TauriThemeSync component's history for background. So on Linux (and any
// other Tauri target) we trust Tauri's native `getCurrentWindow().theme()`
// unconditionally once we know we're running under Tauri, and never fall
// back to the media query in that case, even if the native call resolves to
// something other than "light"/"dark". The media query is only meaningful
// as a fallback when we are *not* under Tauri at all (e.g. `next dev` in a
// plain browser preview).
async function resolveSystemTheme(): Promise<ResolvedTheme> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const native = await getCurrentWindow().theme();
    return native === "light" ? "light" : "dark";
  } catch {
    // Not running under Tauri — the import/call itself threw. Fall through
    // to the media query, which is trustworthy in a plain browser.
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  // Hydrate the stored preference once on mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const stored = (typeof localStorage !== "undefined" &&
      localStorage.getItem(THEME_STORAGE_KEY)) as ThemePreference | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setThemeState(stored);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Apply the theme whenever the preference changes, and — for "system" —
  // track live OS changes. `prefers-color-scheme` covers macOS/Windows.
  // Linux/WebKitGTK doesn't reliably emit it for GTK/KDE theme changes, so
  // we also re-resolve via Tauri's native theme detection whenever the
  // window regains focus — cheap, and the only way a KDE-driven theme
  // change is picked up without restarting the app.
  useEffect(() => {
    let cancelled = false;

    const applyAndPersist = (resolved: ResolvedTheme) => {
      if (cancelled) return;
      setResolvedTheme(resolved);
      applyResolved(resolved);
    };

    (async () => {
      const resolved = theme === "system" ? await resolveSystemTheme() : theme;
      applyAndPersist(resolved);
    })();

    if (theme !== "system") {
      return () => {
        cancelled = true;
      };
    }

    const mq =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    const onMediaChange = () => {
      if (!mq) return;
      applyAndPersist(mq.matches ? "dark" : "light");
    };
    mq?.addEventListener?.("change", onMediaChange);

    const onFocus = () => {
      resolveSystemTheme().then(applyAndPersist);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      cancelled = true;
      mq?.removeEventListener?.("change", onMediaChange);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode, etc.) — in-memory still works.
    }
    setThemeState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
