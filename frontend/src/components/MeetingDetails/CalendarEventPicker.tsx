"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { listCalendarEvents, type CalendarEvent } from "@/lib/calendar";

interface CalendarEventPickerProps {
  onClose: () => void;
  onPick: (eventId: string | null) => Promise<void> | void;
  isSaving: boolean;
  currentEventId?: string;
  /** Timestamp the meeting was recorded. The picker centers its event
   *  window on this and sorts results by proximity so the most likely
   *  matches surface first. Defaults to "now" when omitted. */
  anchorIso?: string;
}

/** ±N days around the anchor when fetching events. Wide enough to cover
 *  rescheduled meetings or recordings started slightly before/after the
 *  scheduled slot, narrow enough that the list stays scannable. */
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

function formatStart(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatOffset(eventStartMs: number, anchorMs: number): string {
  const diff = eventStartMs - anchorMs;
  const abs = Math.abs(diff);
  if (abs < 60 * 1000) return "at recording time";
  const sign = diff < 0 ? "before" : "after";
  if (abs < 3600 * 1000) {
    return `${Math.round(abs / 60_000)}m ${sign}`;
  }
  if (abs < DAY_MS) {
    return `${Math.round(abs / 3_600_000)}h ${sign}`;
  }
  return `${Math.round(abs / DAY_MS)}d ${sign}`;
}

/**
 * Modal that lists calendar events near the meeting's recording time
 * (default ±7 days centered on `anchorIso`, falling back to "now") and
 * lets the user pick one to link the meeting to. Results are sorted by
 * proximity to the anchor so the most likely matches surface first.
 */
export function CalendarEventPicker({
  onClose,
  onPick,
  isSaving,
  currentEventId,
  anchorIso,
}: CalendarEventPickerProps) {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const anchorMs = useMemo(() => {
    if (!anchorIso) return Date.now();
    const ts = Date.parse(anchorIso);
    return Number.isFinite(ts) ? ts : Date.now();
  }, [anchorIso]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const from = new Date(anchorMs - WINDOW_DAYS * DAY_MS);
        const to = new Date(anchorMs + WINDOW_DAYS * DAY_MS);
        const list = await listCalendarEvents(from.toISOString(), to.toISOString());
        if (!cancelled) setEvents(list);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anchorMs]);

  const filtered = useMemo(() => {
    if (!events) return null;
    const q = query.trim().toLowerCase();
    const base = q
      ? events.filter((e) => {
          const summary = e.summary?.toLowerCase() ?? "";
          const loc = e.location?.toLowerCase() ?? "";
          return summary.includes(q) || loc.includes(q);
        })
      : events;
    // Sort by absolute distance from the anchor so the closest match
    // (i.e. the meeting that overlapped the recording) is at the top.
    return [...base].sort((a, b) => {
      const da = Math.abs(Date.parse(a.startAt) - anchorMs);
      const db = Math.abs(Date.parse(b.startAt) - anchorMs);
      return da - db;
    });
  }, [events, query, anchorMs]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a calendar event"
      className="
        fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4
      "
      onClick={onClose}
    >
      <div
        className="
          flex w-full max-w-xl flex-col overflow-hidden rounded-lg border
          border-border bg-background shadow-xl
        "
        style={{ maxHeight: "min(80vh, 640px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Link calendar event</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="
              pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2
              text-muted-foreground
            " />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events…"
              className="
                h-9 w-full rounded-md border border-border bg-background px-8
                text-sm placeholder:text-muted-foreground/70
                focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none
              "
              autoFocus
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && (
            <p className="px-3 py-2 text-sm text-destructive">{error}</p>
          )}
          {!error && filtered === null && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>
          )}
          {!error && filtered && filtered.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No events within ±{WINDOW_DAYS} days of the recording. Try
              refreshing your calendar in Settings → Calendar.
            </p>
          )}
          {filtered && filtered.length > 0 && (
            <ul className="space-y-1">
              {filtered.map((e) => {
                const isCurrent = e.id === currentEventId;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void onPick(e.id)}
                      className={`
                        flex w-full items-start gap-2 rounded-md px-2 py-2
                        text-left text-sm
                        ${isCurrent
                          ? "bg-info/10 text-info"
                          : "text-foreground hover:bg-muted"}
                      `}
                    >
                      <CalendarIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {e.summary || "(untitled event)"}
                          {isCurrent && (
                            <span className="ml-2 text-xs text-info">
                              currently linked
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatStart(e.startAt)}
                          {" · "}
                          {formatOffset(Date.parse(e.startAt), anchorMs)}
                          {e.location ? ` · ${e.location}` : ""}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
