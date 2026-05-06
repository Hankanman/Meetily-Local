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

  if (isCollapsed) {
    return (
      <div className="flex h-12 items-center justify-center border-b border-border">
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={onToggleCollapse}
          className="
            flex size-8 items-center justify-center rounded-md
            text-muted-foreground transition-colors
            hover:bg-muted hover:text-foreground
          "
        >
          <Icon className="size-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-12 items-center justify-between border-b border-border px-3">
      <Logo isCollapsed={false} />
      <button
        type="button"
        aria-label="Collapse sidebar"
        onClick={onToggleCollapse}
        className="
          flex size-8 items-center justify-center rounded-md
          text-muted-foreground transition-colors
          hover:bg-muted hover:text-foreground
        "
      >
        <Icon className="size-5" />
      </button>
    </div>
  );
}
