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
}

// Resolve "system" to a concrete theme. Prefer Tauri's native detection
// (reliable where WebKitGTK's prefers-color-scheme isn't), fall back to the
// CSS media query on macOS/Windows.
async function resolveSystemTheme(): Promise<ResolvedTheme> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const native = await getCurrentWindow().theme();
    if (native === "light" || native === "dark") return native;
  } catch {
    // Not running under Tauri (e.g. browser preview) — fall through.
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
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    const stored = (typeof localStorage !== "undefined" &&
      localStorage.getItem(THEME_STORAGE_KEY)) as ThemePreference | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setThemeState(stored);
    }
  }, []);

  // Apply the theme whenever the preference changes, and — for "system" —
  // track live OS changes (macOS/Windows emit these; Linux needs a restart).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const resolved = theme === "system" ? await resolveSystemTheme() : theme;
      if (cancelled) return;
      setResolvedTheme(resolved);
      applyResolved(resolved);
    })();

    if (theme === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        const resolved: ResolvedTheme = mq.matches ? "dark" : "light";
        setResolvedTheme(resolved);
        applyResolved(resolved);
      };
      mq.addEventListener?.("change", onChange);
      return () => {
        cancelled = true;
        mq.removeEventListener?.("change", onChange);
      };
    }

    return () => {
      cancelled = true;
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
