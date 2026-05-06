"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useTranscripts } from "@/contexts/TranscriptContext";

/**
 * Auto-fill the meeting name with today's date if the user hasn't typed
 * anything; switch to a free-text input on focus or pencil click.
 *
 * The TranscriptContext is the source of truth for the name (so the
 * eventual `start_recording` call gets it for free).
 */
export function MeetingNameInput() {
  const { meetingTitle, setMeetingTitle } = useTranscripts();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);

  // Default to today's date — only when the user hasn't written anything
  // (empty) and isn't on the legacy "+ New Call" placeholder string.
  // Once they edit, we don't clobber.
  useEffect(() => {
    const trimmed = meetingTitle.trim();
    if (trimmed.length > 0 && trimmed !== "+ New Call") return;
    const now = new Date();
    const date = now.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    setMeetingTitle(`Meeting · ${date}`);
  }, [meetingTitle, setMeetingTitle]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={meetingTitle}
        onChange={(e) => setMeetingTitle(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        autoFocus
        placeholder="Meeting name"
        className="
          w-full max-w-sm border-b-2 border-info bg-transparent px-2 py-1
          text-center text-xl font-medium text-foreground
          focus:outline-none
        "
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="
        group inline-flex items-center gap-2 rounded-md px-2 py-1 text-xl
        font-medium text-foreground transition-colors
        hover:bg-muted
      "
    >
      <span className="max-w-sm truncate">
        {meetingTitle || "Untitled meeting"}
      </span>
      <Pencil className="
        size-4 text-muted-foreground/60 opacity-0 transition-opacity
        group-hover:opacity-100
      " />
    </button>
  );
}
