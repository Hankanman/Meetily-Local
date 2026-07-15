"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  Link2,
  Link2Off,
  MapPin,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getEventForMeeting,
  linkMeetingToCalendarEvent,
  type CalendarEvent,
} from "@/lib/calendar";
import { CalendarEventPicker } from "./CalendarEventPicker";

interface CalendarEventPanelProps {
  meetingId: string;
  /** ISO-8601 timestamp the recording started. Used by the picker as the
   *  anchor for "events around the same time as the transcript was
   *  captured" instead of falling back to "now". */
  meetingCreatedAt: string;
}

function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const dateFmt = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (sameDay) {
    return `${dateFmt} · ${startTime} – ${endTime}`;
  }
  return `${dateFmt} ${startTime} – ${end.toLocaleString()}`;
}

export function CalendarEventPanel({
  meetingId,
  meetingCreatedAt,
}: CalendarEventPanelProps) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const e = await getEventForMeeting(meetingId);
      setEvent(e);
    } catch (err) {
      console.warn("getEventForMeeting failed:", err);
      setEvent(null);
    } finally {
      setIsLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleUnlink = async () => {
    setIsMutating(true);
    try {
      await linkMeetingToCalendarEvent(meetingId, null);
      setEvent(null);
    } catch (err) {
      console.error("Failed to unlink:", err);
    } finally {
      setIsMutating(false);
    }
  };

  const handlePickEvent = async (eventId: string | null) => {
    setIsMutating(true);
    try {
      await linkMeetingToCalendarEvent(meetingId, eventId);
      setIsPickerOpen(false);
      await reload();
    } catch (err) {
      console.error("Failed to link calendar event:", err);
    } finally {
      setIsMutating(false);
    }
  };

  if (isLoading) {
    return null;
  }

  if (!event) {
    return (
      <>
        <div
          className="
            flex items-center justify-between gap-3 rounded-md border
            border-dashed border-border px-3 py-2 text-sm
          "
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarIcon className="size-4" />
            <span>Not linked to a calendar event.</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsPickerOpen(true)}
            className="gap-1.5"
          >
            <Link2 className="size-3.5" />
            Link event
          </Button>
        </div>
        {isPickerOpen && (
          <CalendarEventPicker
            onClose={() => setIsPickerOpen(false)}
            onPick={handlePickEvent}
            isSaving={isMutating}
            anchorIso={meetingCreatedAt}
          />
        )}
      </>
    );
  }

  const attendeeCount = event.attendees.length;

  return (
    <>
      <div
        className="
          flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3
          text-sm sm:flex-row sm:items-start sm:justify-between
        "
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">
              {event.summary || "(untitled event)"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {formatTimeRange(event.startAt, event.endAt)}
          </div>
          {event.location && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
          {attendeeCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3" />
              <span>
                {attendeeCount} attendee{attendeeCount === 1 ? "" : "s"}
                {event.organizerName ? ` · organized by ${event.organizerName}` : ""}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsPickerOpen(true)}
            disabled={isMutating}
          >
            Change
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleUnlink()}
            disabled={isMutating}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Link2Off className="size-3.5" />
            Unlink
          </Button>
        </div>
      </div>

      {attendeeCount > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {event.attendees.map((a, idx) => {
            const label = a.name?.trim() || a.email || "Unknown";
            return (
              <li
                key={`${a.email ?? "noemail"}-${idx}`}
                className="
                  inline-flex items-center gap-1 rounded-full border border-border
                  bg-background px-2 py-0.5 text-xs text-foreground
                "
                title={a.email ?? undefined}
              >
                <span className="truncate max-w-48">{label}</span>
                {a.status && (
                  <span
                    className="text-[10px] uppercase tracking-wide text-muted-foreground"
                    title={`Response: ${a.status}`}
                  >
                    · {a.status.toLowerCase()}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {isPickerOpen && (
        <CalendarEventPicker
          onClose={() => setIsPickerOpen(false)}
          onPick={handlePickEvent}
          isSaving={isMutating}
          currentEventId={event.id}
          anchorIso={meetingCreatedAt}
        />
      )}
    </>
  );
}
