"use client";

import { useCallback, useEffect, useState } from "react";
import { NotebookPen, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MeetingNote,
  addMeetingNote,
  deleteMeetingNote,
  listMeetingNotes,
} from "@/lib/actionItems";
import { toast } from "sonner";

interface MeetingNotesPanelProps {
  meetingId: string;
}

function formatNoteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Free-text notes against a meeting — the user's own observations, kept
 * alongside (not inside) the generated summary so regenerating the summary
 * never destroys them. Notes are append-only: editing is delete + re-add, which
 * keeps each note's timestamp honest.
 *
 * Collapsed to just an "Add note" affordance when there are none, so a meeting
 * nobody annotated doesn't carry a permanently empty section.
 */
export function MeetingNotesPanel({ meetingId }: MeetingNotesPanelProps) {
  const [notes, setNotes] = useState<MeetingNote[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await listMeetingNotes(meetingId);
        if (!cancelled) setNotes(loaded);
      } catch (err) {
        console.error("Failed to load notes:", err);
        if (!cancelled) setNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const handleAdd = useCallback(async () => {
    const body = draft.trim();
    if (!body || isSaving) return;
    setIsSaving(true);
    try {
      const created = await addMeetingNote(meetingId, body);
      setNotes((current) => [...current, created]);
      setDraft("");
      setIsComposing(false);
    } catch (err) {
      console.error("Failed to add note:", err);
      toast.error("Failed to add note");
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, meetingId]);

  const handleDelete = useCallback(async (note: MeetingNote) => {
    const previous = note;
    setNotes((current) => current.filter((n) => n.id !== note.id));
    try {
      await deleteMeetingNote(note.id);
    } catch (err) {
      console.error("Failed to delete note:", err);
      setNotes((current) =>
        [...current, previous].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        ),
      );
      toast.error("Failed to delete note");
    }
  }, []);

  return (
    <section className="mt-3 rounded-lg border border-border bg-muted/30 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <NotebookPen className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Notes</h3>
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {notes.length}
            </span>
          )}
        </div>
        {!isComposing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsComposing(true)}
            className="gap-1.5 text-muted-foreground"
          >
            <Plus className="size-3.5" />
            Add note
          </Button>
        )}
      </header>

      {notes.length > 0 && (
        <ul className="mb-2 space-y-2">
          {notes.map((note) => (
            <li
              key={note.id}
              className="
                group flex items-start gap-2 rounded-md bg-background/60 px-2.5
                py-2
              "
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                <span className="text-[10px] text-muted-foreground">
                  {formatNoteTime(note.created_at)}
                  {note.source === "agent" && " · added by an agent"}
                </span>
              </div>
              <button
                type="button"
                aria-label="Delete note"
                onClick={() => void handleDelete(note)}
                className="
                  shrink-0 text-muted-foreground opacity-0 transition-opacity
                  group-hover:opacity-100
                  hover:text-destructive
                  focus-visible:opacity-100 focus-visible:outline-none
                "
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {isComposing && (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a note…"
            className="min-h-16 text-sm"
            autoFocus
            disabled={isSaving}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsComposing(false);
                setDraft("");
              }}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleAdd()}
              disabled={!draft.trim() || isSaving}
            >
              Save note
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
