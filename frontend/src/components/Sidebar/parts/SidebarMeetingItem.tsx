"use client";

import { Pencil, Trash2 } from "lucide-react";
import type { CurrentMeeting } from "../SidebarProvider";

export interface MeetingMatch {
  /** Snippet of transcript content that matched the search query. */
  matchContext: string;
}

interface SidebarMeetingItemProps {
  meeting: CurrentMeeting;
  isActive: boolean;
  match?: MeetingMatch;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * One meeting row. Title truncates; rename/delete actions are absolute-
 * positioned so they overlay the title's tail on hover instead of pushing
 * it. A matched-transcript snippet hangs below the row when present.
 */
export function SidebarMeetingItem({
  meeting,
  isActive,
  match,
  onClick,
  onRename,
  onDelete,
}: SidebarMeetingItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`
        group relative cursor-pointer rounded-md px-2 py-1.5 text-sm
        transition-colors
        ${isActive
          ? "bg-info/10 text-info"
          : "text-foreground hover:bg-muted"}
      `}
    >
      <div className="flex items-center">
        <span
          title={meeting.title}
          className={`
            min-w-0 flex-1 truncate
            ${isActive ? "font-medium" : ""}
            ${match ? "" : "group-hover:pr-12"}
          `}
        >
          {meeting.title}
        </span>
      </div>

      {match && (
        <p className="
          mt-1 line-clamp-2 rounded-sm border border-warning/30 bg-warning-muted
          px-1.5 py-1 text-xs text-muted-foreground
        ">
          <span className="font-medium text-warning">Match:</span>{" "}
          {match.matchContext}
        </p>
      )}

      <div className="
        pointer-events-none absolute inset-y-0 right-1 flex items-center
        gap-0.5 opacity-0 transition-opacity
        group-hover:pointer-events-auto group-hover:opacity-100
      ">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          className="
            rounded-md p-1 text-muted-foreground
            hover:bg-info/10 hover:text-info
          "
          aria-label={`Rename ${meeting.title}`}
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="
            rounded-md p-1 text-muted-foreground
            hover:bg-destructive/10 hover:text-destructive
          "
          aria-label={`Delete ${meeting.title}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
