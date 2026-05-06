"use client";

import { Info as InfoIcon, Settings, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { About } from "@/components/About";

interface SidebarFooterProps {
  showImport: boolean;
  onImport: () => void;
  onSettings: () => void;
  /** App version label rendered next to the About row. Pass `undefined`
   *  to hide it. */
  versionLabel?: string;
}

/**
 * Bottom of the sidebar: secondary actions and meta. Each row uses the
 * same icon + label pattern. About opens an inline dialog rather than
 * routing — same `About` content as the existing `Info` component.
 */
export function SidebarFooter({
  showImport,
  onImport,
  onSettings,
  versionLabel,
}: SidebarFooterProps) {
  const rowClass = `
    flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm
    text-foreground transition-colors
    hover:bg-muted
  `;

  return (
    <div className="space-y-0.5 border-t border-border p-2">
      {showImport && (
        <button type="button" onClick={onImport} className={rowClass}>
          <Upload className="size-4 text-muted-foreground" />
          <span>Import audio</span>
        </button>
      )}
      <button type="button" onClick={onSettings} className={rowClass}>
        <Settings className="size-4 text-muted-foreground" />
        <span>Settings</span>
      </button>
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" className={rowClass}>
            <InfoIcon className="size-4 text-muted-foreground" />
            <span>About</span>
            {versionLabel && (
              <span className="ml-auto text-xs text-muted-foreground/70">
                {versionLabel}
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent>
          <VisuallyHidden>
            <DialogTitle>About Meetily</DialogTitle>
          </VisuallyHidden>
          <About />
        </DialogContent>
      </Dialog>
    </div>
  );
}
