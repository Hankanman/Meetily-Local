"use client";

import { useMemo, useState } from "react";
import { Search, X, type LucideIcon } from "lucide-react";

export interface SettingsCategory {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface SettingsSidebarProps {
  categories: readonly SettingsCategory[];
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Left rail of the settings page. Categories with icons + labels, with
 * a search filter at the top that narrows the visible list (matches
 * label and description). Active row gets a left accent + subtle bg.
 */
export function SettingsSidebar({
  categories,
  activeId,
  onSelect,
}: SettingsSidebarProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [categories, query]);

  return (
    <nav
      aria-label="Settings categories"
      // Solid `bg-muted` (not `bg-muted/30`) — translucent backgrounds
      // force the compositor to recomposite the rail every time anything
      // beneath the layer changes (hover effects on the page sidebar to
      // the left, content updates in the panel to the right). With a
      // page that has frequent hovers, that recomposite cost shows up as
      // wide paint frames on the WebKit timeline.
      className="
        flex w-56 shrink-0 flex-col border-r border-border bg-muted py-4
      "
    >
      <div className="relative px-3 pb-3">
        <Search className="
          pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2
          text-muted-foreground
        " />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings…"
          className="
            h-9 w-full rounded-md border border-border bg-background px-8 
            text-sm placeholder:text-muted-foreground/70
            focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none
          "
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="
              absolute top-1/2 right-5 -translate-y-1/2 rounded-sm p-0.5
              text-muted-foreground transition-colors
              hover:bg-muted hover:text-foreground
            "
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No settings match &quot;{query}&quot;.
          </p>
        ) : (
          filtered.map((c) => {
            const Icon = c.icon;
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={isActive ? "page" : undefined}
                // No hover transition on the rail rows — the rail has
                // ~7 category buttons stacked vertically, and scrubbing
                // the cursor down the list fires a transition-start +
                // transition-end pair for every boundary crossing. Even
                // cheap color transitions stack into perceptible paint
                // storms (~16ms paint per row, multiplied by adjacent
                // rows whose hover state was changing). Snap-on hover
                // is fast and visually fine here.
                className={`
                  group relative flex w-full items-center gap-2 rounded-md
                  px-2 py-1.5 text-left text-sm
                  ${isActive
                    ? "bg-brand-muted font-medium text-brand-strong"
                    : "text-foreground hover:bg-muted"}
                `}
              >
                {/* Left accent bar in the active state. Absolute so it
                    doesn't shift the row's content when toggling. */}
                {isActive && (
                  <span className="
                    absolute inset-y-1.5  left-0 w-0.5 rounded-r-full
                    bg-brand
                  " />
                )}
                <Icon className={`
                  size-4 shrink-0
                  ${isActive ? "text-brand-strong" : "text-muted-foreground"}
                `} />
                <span className="truncate">{c.label}</span>
              </button>
            );
          })
        )}
      </div>
    </nav>
  );
}
