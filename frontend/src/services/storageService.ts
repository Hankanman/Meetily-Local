/**
 * Storage Service
 *
 * Handles all meeting storage and retrieval Tauri backend calls (SQLite persistence).
 * Pure 1-to-1 wrapper - no error handling changes, exact same behavior as direct invoke calls.
 */

import { invoke } from "@tauri-apps/api/core";
import { Transcript } from "@/types";

export interface SaveMeetingResponse {
  meeting_id: string;
}

export interface Meeting {
  id: string;
  title: string;
  [key: string]: any; // Allow additional properties from backend
}

/**
 * Storage Service
 * Singleton service for managing meeting storage operations
 */
class StorageService {
  /**
   * Save meeting transcript to SQLite database
   * @param meetingTitle - Title of the meeting
   * @param transcripts - Array of transcript segments
   * @param folderPath - Optional folder path for audio file
   * @returns Promise with { meeting_id: string }
   */
  async saveMeeting(
    meetingTitle: string,
    transcripts: Transcript[],
    folderPath: string | null,
  ): Promise<SaveMeetingResponse> {
    return invoke<SaveMeetingResponse>("api_save_transcript", {
      meetingTitle,
      transcripts,
      folderPath,
    });
  }

  /**
   * Get meeting details by ID
   * @param meetingId - ID of the meeting to fetch
   * @returns Promise with meeting details
   */
  async getMeeting(meetingId: string): Promise<Meeting> {
    return invoke<Meeting>("api_get_meeting", { meetingId });
  }

  /**
   * Update the title of a meeting Rust already created and finalised
   * (issue #57 slice 2 — the meeting row and its transcripts are Rust's;
   * this is the one field the frontend still owns post-stop, e.g. a title
   * the user edited live that differs from the name recording started
   * with).
   * @param meetingId - ID of the already-existing meeting row
   * @param title - The final title to set
   */
  async finalizeMeetingTitle(meetingId: string, title: string): Promise<void> {
    await invoke("api_save_meeting_title", { meetingId, title });
  }

  /**
   * List meetings an unclean shutdown left "interrupted" (issue #57 slice
   * 2), most recent first.
   */
  async listInterruptedMeetings(): Promise<InterruptedMeeting[]> {
    return invoke<InterruptedMeeting[]>("list_interrupted_meetings");
  }

  /**
   * Recover one interrupted meeting: merges any `.checkpoints` audio still
   * on disk and marks the row "completed". Its transcripts need no recovery
   * work — they were already persisted live, up to whatever was flushed
   * before the interruption.
   */
  async recoverMeeting(meetingId: string): Promise<RecoverMeetingResult> {
    return invoke<RecoverMeetingResult>("recover_meeting", { meetingId });
  }
}

export interface InterruptedMeeting {
  meeting_id: string;
  title: string;
  folder_path?: string | null;
  created_at: string;
  segment_count: number;
  has_audio_checkpoints: boolean;
}

export interface AudioRecoveryStatus {
  status: string; // "success" | "partial" | "failed" | "none"
  chunk_count: number;
  estimated_duration_seconds: number;
  audio_file_path?: string | null;
  message: string;
}

export interface RecoverMeetingResult {
  success: boolean;
  meeting_id: string;
  audio_recovery_status?: AudioRecoveryStatus | null;
}

// Export singleton instance
export const storageService = new StorageService();
