// Glue between the recording lifecycle and the calendar feature.
//
// The Tauri side only inserts the meeting row when the transcript is saved
// (after the recording stops), so we can't pass a calendar_event_id at
// `start_recording_with_devices_and_meeting` time. Instead the start path
// resolves "what event is happening right now?" from the calendar
// repository and stashes the event id; the stop path reads it back after
// `api_save_transcript` returns a `meeting_id` and creates the link.
//
// sessionStorage is sufficient because the recording lifecycle is single-
// tab and the value's only consumer is the stop hook in the same tab.

import {
  findCalendarEventForNow,
  type CalendarEvent,
} from "./calendar";

const PENDING_EVENT_KEY = "calendar:pendingEventId";
const PENDING_EVENT_SUMMARY_KEY = "calendar:pendingEventSummary";

export interface RecordingMetadata {
  meetingTitle: string;
  calendarEvent: CalendarEvent | null;
}

function timestampTitle(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `Meeting ${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
}

/**
 * Resolve the meeting title + matching calendar event for a recording that
 * is about to start. Prefers the calendar event's summary as the title
 * when an event is currently active; falls back to a timestamp-based
 * title otherwise. Stashes the event id (if any) so the stop hook can
 * link the freshly-saved meeting to it.
 */
export async function prepareRecordingMetadata(): Promise<RecordingMetadata> {
  let event: CalendarEvent | null = null;
  try {
    event = await findCalendarEventForNow();
  } catch (err) {
    console.warn("calendar lookup for current event failed:", err);
  }

  const summary = event?.summary?.trim();
  const title = summary || timestampTitle();

  if (typeof window !== "undefined") {
    if (event) {
      sessionStorage.setItem(PENDING_EVENT_KEY, event.id);
      sessionStorage.setItem(PENDING_EVENT_SUMMARY_KEY, summary || "");
    } else {
      sessionStorage.removeItem(PENDING_EVENT_KEY);
      sessionStorage.removeItem(PENDING_EVENT_SUMMARY_KEY);
    }
  }

  return { meetingTitle: title, calendarEvent: event };
}

/** Read + clear the pending calendar event id stashed at recording start. */
export function consumePendingCalendarEventId(): string | null {
  if (typeof window === "undefined") return null;
  const id = sessionStorage.getItem(PENDING_EVENT_KEY);
  sessionStorage.removeItem(PENDING_EVENT_KEY);
  sessionStorage.removeItem(PENDING_EVENT_SUMMARY_KEY);
  return id;
}
