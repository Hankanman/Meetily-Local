"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Logo from "@/components/Logo";

interface SidebarHeaderProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * Top of the sidebar — brand on the left, collapse toggle on the right.
 * In collapsed mode only the toggle is visible (Logo is rendered separately
 * by `SidebarCollapsedRail`'s About entry).
 */
export function SidebarHeader({
  isCollapsed,
  onToggleCollapse,
}: SidebarHeaderProps) {
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;

  // Toggle stays anchored at the left in both states so its physical
  // position doesn't shift when the panel collapses/expands. The brand
  // renders to the right of it in expanded mode (and is dropped in
  // collapsed mode since the rail is too narrow to hold it).
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
      {!isCollapsed && <Logo isCollapsed={false} />}
    </div>
  );
}
