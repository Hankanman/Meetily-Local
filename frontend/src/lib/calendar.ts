// Frontend wrappers for the calendar/ICS Tauri commands. Keeps command
// names and DTO shapes in one place — the Rust side serializes events
// using camelCase via `#[serde(rename = ...)]` so the TS shapes match
// directly.

import { invoke } from "@tauri-apps/api/core";

export interface CalendarSource {
  id: string;
  url: string;
  label: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarAttendee {
  name: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
  isOrganizer: boolean;
}

export interface CalendarEvent {
  id: string;
  sourceId: string;
  icsUid: string;
  recurrenceId: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  /** ISO-8601 UTC string. */
  startAt: string;
  /** ISO-8601 UTC string. */
  endAt: string;
  isAllDay: boolean;
  attendees: CalendarAttendee[];
}

export interface CalendarRefreshResult {
  sourceId: string;
  eventCount: number;
}

export async function listCalendarSources(): Promise<CalendarSource[]> {
  return invoke<CalendarSource[]>("calendar_list_sources");
}

export async function addCalendarSource(
  url: string,
  label?: string | null,
): Promise<CalendarSource> {
  return invoke<CalendarSource>("calendar_add_source", {
    url,
    label: label ?? null,
  });
}

export async function removeCalendarSource(sourceId: string): Promise<boolean> {
  return invoke<boolean>("calendar_remove_source", { sourceId });
}

export async function refreshCalendarSource(
  sourceId: string,
): Promise<CalendarRefreshResult> {
  return invoke<CalendarRefreshResult>("calendar_refresh_source", { sourceId });
}

export async function listCalendarEvents(
  fromIso: string,
  toIso: string,
): Promise<CalendarEvent[]> {
  return invoke<CalendarEvent[]>("calendar_list_events", {
    request: { from: fromIso, to: toIso },
  });
}

export async function findCalendarEventForNow(): Promise<CalendarEvent | null> {
  return invoke<CalendarEvent | null>("calendar_find_event_for_now");
}

export async function linkMeetingToCalendarEvent(
  meetingId: string,
  eventId: string | null,
): Promise<boolean> {
  return invoke<boolean>("calendar_link_meeting", {
    meetingId,
    eventId,
  });
}

export async function getEventForMeeting(
  meetingId: string,
): Promise<CalendarEvent | null> {
  return invoke<CalendarEvent | null>("calendar_get_event_for_meeting", {
    meetingId,
  });
}
