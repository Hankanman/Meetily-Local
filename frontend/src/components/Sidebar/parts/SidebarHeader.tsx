"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

interface SidebarHeaderProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** Click on the brand → navigate home (the recording page) without
   *  auto-starting a recording. Required because the big "Start
   *  recording" CTA now starts immediately. */
  onHome: () => void;
}

/**
 * Top of the sidebar — brand on the left, collapse toggle on the right.
 * In collapsed mode only the toggle is visible (Logo is rendered separately
 * by `SidebarCollapsedRail`'s About entry).
 */
export function SidebarHeader({
  isCollapsed,
  onToggleCollapse,
  onHome,
}: SidebarHeaderProps) {
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  // Toggle stays anchored at the left in both states so its physical
  // position doesn't shift when the panel collapses/expands. The brand
  // renders to the right of it in expanded mode and is a button that
  // navigates home (the recording page) — the conventional "click logo
  // to go home" pattern, since the big "Start recording" CTA now starts
  // immediately and we still need a way to just visit the page.
  return (
    <div className="flex h-12 items-center gap-2 border-b border-border px-3">
      <button
        type="button"
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapse}
        className="
          flex size-8 shrink-0 items-center justify-center rounded-md
          text-muted-foreground transition-colors
          hover:bg-muted hover:text-foreground
        "
      >
        <Icon className="size-5" />
      </button>
      {!isCollapsed && (
        <button
          type="button"
          onClick={onHome}
          aria-label="Go to recording page"
          title="Go to recording page"
          className="
            min-w-0 truncate rounded-md px-2 py-1 text-base font-semibold
            text-foreground transition-colors
            hover:bg-muted
          "
        >
          Meetily
        </button>
      )}
    </div>
  );
}
