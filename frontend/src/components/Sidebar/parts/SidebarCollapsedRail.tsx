"use client";

import {
  Home,
  ListChecks,
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
  onHome: () => void;
  onStartRecording: () => void;
  /** Click while recording → navigate back to the recording page so the
   *  user can hit stop. Without this, anyone who's collapsed the sidebar
   *  and navigated away mid-recording is stuck. */
  onResumeRecordingView: () => void;
  onMeetings: () => void;
  onActionItems: () => void;
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
  onHome,
  onStartRecording,
  onResumeRecordingView,
  onMeetings,
  onActionItems,
  onImport,
  onSettings,
}: SidebarCollapsedRailProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-1 flex-col items-center gap-3 py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onHome}
              className="
                flex size-9 items-center justify-center rounded-md
                text-muted-foreground transition-colors
                hover:bg-muted hover:text-foreground
              "
              aria-label="Go to recording page"
            >
              <Home className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Recording page</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <SidebarRecordingButton
                isRecording={isRecording}
                onStart={onStartRecording}
                onResumeView={onResumeRecordingView}
                collapsed
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isRecording ? "Recording — click to view" : "Start recording"}
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

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onActionItems}
              className="
                flex size-9 items-center justify-center rounded-md
                text-muted-foreground transition-colors
                hover:bg-muted hover:text-foreground
              "
              aria-label="Action items"
            >
              <ListChecks className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Action items</TooltipContent>
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
