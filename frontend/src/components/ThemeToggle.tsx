"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

// Segmented Light / Dark / System control, backed by the ThemeProvider.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={cn(
              `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm
               font-medium transition-colors focus-visible:ring-2
               focus-visible:ring-ring focus-visible:outline-none`,
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
