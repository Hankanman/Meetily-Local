// Frontend wrappers for the action-item, meeting-note and export commands.
// Keeps the Tauri command names and DTO shapes in one place — the Rust side
// serializes these structs with their field names as-is (snake_case), so the
// shapes below mirror `database::models::{ActionItem, MeetingNote}` exactly.

import { invoke } from "@tauri-apps/api/core";

export type ActionItemStatus = "open" | "done";

/** Where an item came from. `summary` items are owned by the extraction pass
 *  and get replaced when a summary is regenerated; `manual` and `agent` items
 *  are never touched by it. */
export type ActionItemSource = "summary" | "manual" | "agent";

export interface ActionItem {
  id: string;
  meeting_id: string;
  text: string;
  assignee: string | null;
  due_hint: string | null;
  status: ActionItemStatus;
  source: ActionItemSource;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MeetingNote {
  id: string;
  meeting_id: string;
  body: string;
  source: "manual" | "agent";
  created_at: string;
}

export type ExportFormat = "markdown" | "json";

export interface ExportResult {
  meeting_id: string;
  title: string;
  format: ExportFormat;
  /** Suggested filename, e.g. `weekly-sync-2026-07-15.md`. */
  filename: string;
  content: string;
}

/** Payload of the `action-items-extracted` event, emitted when the background
 *  extraction pass finishes for a meeting. */
export interface ActionItemsExtractedPayload {
  meeting_id: string;
  count: number;
}

export const ACTION_ITEMS_EXTRACTED_EVENT = "action-items-extracted";

/** Items for one meeting, or every item across every meeting when `meetingId`
 *  is omitted. */
export async function listActionItems(meetingId?: string): Promise<ActionItem[]> {
  return invoke<ActionItem[]>("list_action_items", {
    meetingId: meetingId ?? null,
  });
}

/** Open items across every meeting, newest first. */
export async function listOpenActionItems(): Promise<ActionItem[]> {
  return invoke<ActionItem[]>("list_open_action_items");
}

export async function createActionItem(
  meetingId: string,
  text: string,
  assignee?: string | null,
  dueHint?: string | null,
): Promise<ActionItem> {
  return invoke<ActionItem>("create_action_item", {
    meetingId,
    text,
    assignee: assignee ?? null,
    dueHint: dueHint ?? null,
  });
}

export async function setActionItemStatus(
  id: string,
  status: ActionItemStatus,
): Promise<ActionItem> {
  return invoke<ActionItem>("set_action_item_status", { id, status });
}

/** Patch an item. Omitted fields are left unchanged; passing `""` for
 *  `assignee`/`dueHint` clears them. */
export async function updateActionItem(
  id: string,
  fields: { text?: string; assignee?: string; dueHint?: string },
): Promise<ActionItem> {
  return invoke<ActionItem>("update_action_item", {
    id,
    text: fields.text ?? null,
    assignee: fields.assignee ?? null,
    dueHint: fields.dueHint ?? null,
  });
}

export async function deleteActionItem(id: string): Promise<boolean> {
  return invoke<boolean>("delete_action_item", { id });
}

/** Run extraction on demand for a meeting that already has a summary. Resolves
 *  to the number of items stored. Meetings summarized before this feature
 *  existed have no items until this runs (or the summary is regenerated). */
export async function extractActionItems(meetingId: string): Promise<number> {
  return invoke<number>("extract_action_items", { meetingId });
}

export async function listMeetingNotes(meetingId: string): Promise<MeetingNote[]> {
  return invoke<MeetingNote[]>("list_meeting_notes", { meetingId });
}

export async function addMeetingNote(
  meetingId: string,
  body: string,
): Promise<MeetingNote> {
  return invoke<MeetingNote>("add_meeting_note", { meetingId, body });
}

export async function deleteMeetingNote(id: string): Promise<boolean> {
  return invoke<boolean>("delete_meeting_note", { id });
}

/** Build a self-contained export document (summary + action items + full
 *  speaker-attributed transcript) without writing it anywhere. */
export async function exportMeeting(
  meetingId: string,
  format: ExportFormat,
): Promise<ExportResult> {
  return invoke<ExportResult>("export_meeting", { meetingId, format });
}

/** Export and prompt for a save location. Resolves to the written path, or
 *  `null` if the user cancelled the dialog. */
export async function exportMeetingToFile(
  meetingId: string,
  format: ExportFormat,
): Promise<string | null> {
  return invoke<string | null>("export_meeting_to_file", { meetingId, format });
}
