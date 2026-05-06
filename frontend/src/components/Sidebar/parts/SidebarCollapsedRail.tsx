"use client";

import {
  NotebookPen,
  Settings as SettingsIcon,
  Upload,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Info from "@/components/Info";
import { SidebarRecordingButton } from "./SidebarRecordingButton";

interface SidebarCollapsedRailProps {
  isRecording: boolean;
  showImport: boolean;
  onStartRecording: () => void;
  onMeetings: () => void;
  onImport: () => void;
  onSettings: () => void;
}

/**
 * 56px-wide icon rail shown when the sidebar is collapsed. Renders the
 * primary actions (record, meetings list, import, settings, about). All
 * targets have right-side tooltips so the icons remain self-explanatory.
 */
export function SidebarCollapsedRail({
  isRecording,
  showImport,
  onStartRecording,
  onMeetings,
  onImport,
  onSettings,
}: SidebarCollapsedRailProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col items-center gap-3 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <SidebarRecordingButton
                isRecording={isRecording}
                onStart={onStartRecording}
                collapsed
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isRecording ? "Recording in progress" : "Start recording"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onMeetings}
              className="
                flex size-9 items-center justify-center rounded-md
                text-muted-foreground transition-colors
                hover:bg-muted hover:text-foreground
              "
              aria-label="Meetings"
            >
              <NotebookPen className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Meetings</TooltipContent>
        </Tooltip>

        {showImport && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onImport}
                className="
                  flex size-9 items-center justify-center rounded-md
                  text-muted-foreground transition-colors
                  hover:bg-muted hover:text-foreground
                "
                aria-label="Import audio"
              >
                <Upload className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Import audio</TooltipContent>
          </Tooltip>
        )}

        <div className="mt-auto flex flex-col items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onSettings}
                className="
                  flex size-9 items-center justify-center rounded-md
                  text-muted-foreground transition-colors
                  hover:bg-muted hover:text-foreground
                "
                aria-label="Settings"
              >
                <SettingsIcon className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
          <Info isCollapsed />
        </div>
      </div>
    </TooltipProvider>
  );
}
