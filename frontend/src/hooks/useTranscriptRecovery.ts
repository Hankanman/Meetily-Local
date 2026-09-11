/**
 * useTranscriptRecovery Hook
 *
 * Orchestrates recovery of meetings an unclean shutdown interrupted
 * mid-recording. Issue #57 slice 2: "recoverable" is now a database fact
 * (`meetings.status = 'interrupted'`, set by the Rust startup sweep or a
 * fatal-error stop) instead of a scan over an IndexedDB cache the frontend
 * built up itself — recovery is a Rust command, not a client-side
 * reconstruction. IndexedDB remains only a per-viewer write-ahead cache for
 * the live transcript list; it has no say in what's recoverable any more.
 */

import { useState, useCallback } from "react";
import {
  storageService,
  InterruptedMeeting,
  AudioRecoveryStatus,
} from "@/services/storageService";
import { getErrorMessage } from "@/lib/utils";

/** One row from `list_interrupted_meetings`, shaped to match the fields the
 *  recovery dialog UI already renders (mirrors the old IndexedDB
 *  `MeetingMetadata` shape it replaces, so the dialog component didn't need
 *  to change). */
export interface RecoverableMeeting {
  meetingId: string;
  title: string;
  startTime: number;
  lastUpdated: number;
  transcriptCount: number;
  /** Set only when `.checkpoints/` audio still exists on disk for this
   *  meeting — mirrors the old "folderPath present = audio available"
   *  contract the dialog's UI already checks for. */
  folderPath?: string;
}

/** One transcript segment for the dialog's preview panel — the fields of
 *  `MeetingTranscript` (from `api_get_meeting`) the preview UI reads. */
export interface PreviewTranscript {
  id: string;
  text: string;
  timestamp: string;
  audio_start_time?: number;
  audio_end_time?: number;
  duration?: number;
}

export interface UseTranscriptRecoveryReturn {
  recoverableMeetings: RecoverableMeeting[];
  isLoading: boolean;
  isRecovering: boolean;
  checkForRecoverableTranscripts: () => Promise<RecoverableMeeting[]>;
  recoverMeeting: (meetingId: string) => Promise<{
    success: boolean;
    audioRecoveryStatus?: AudioRecoveryStatus | null;
    meetingId?: string;
  }>;
  loadMeetingTranscripts: (meetingId: string) => Promise<PreviewTranscript[]>;
  deleteRecoverableMeeting: (meetingId: string) => Promise<void>;
}

function toRecoverableMeeting(row: InterruptedMeeting): RecoverableMeeting {
  const createdMs = Date.parse(row.created_at);
  return {
    meetingId: row.meeting_id,
    title: row.title,
    startTime: Number.isNaN(createdMs) ? Date.now() : createdMs,
    lastUpdated: Number.isNaN(createdMs) ? Date.now() : createdMs,
    transcriptCount: row.segment_count,
    folderPath:
      row.has_audio_checkpoints && row.folder_path
        ? row.folder_path
        : undefined,
  };
}

export function useTranscriptRecovery(): UseTranscriptRecoveryReturn {
  const [recoverableMeetings, setRecoverableMeetings] = useState<
    RecoverableMeeting[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  /**
   * List meetings the backend considers interrupted.
   */
  const checkForRecoverableTranscripts = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await storageService.listInterruptedMeetings();
      const meetings = rows.map(toRecoverableMeeting);
      setRecoverableMeetings(meetings);
      return meetings;
    } catch (error) {
      console.error("Failed to list interrupted meetings:", error);
      setRecoverableMeetings([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Load transcripts for preview. Interrupted meetings already have their
   * transcript segments in SQLite — they were upserted live, up to
   * whatever was flushed before the interruption (issue #57 slice 2) — so
   * this reads the same way a saved meeting's transcripts do, rather than
   * reading back out of IndexedDB.
   */
  const loadMeetingTranscripts = useCallback(
    async (meetingId: string): Promise<PreviewTranscript[]> => {
      try {
        const meeting = await storageService.getMeeting(meetingId);
        const transcripts = (meeting.transcripts ?? []) as PreviewTranscript[];
        return [...transcripts].sort(
          (a, b) => (a.audio_start_time ?? 0) - (b.audio_start_time ?? 0),
        );
      } catch (error) {
        console.error("Failed to load meeting transcripts:", error);
        return [];
      }
    },
    [],
  );

  /**
   * Recover a meeting: the Rust command merges any `.checkpoints` audio
   * still on disk and marks the row "completed".
   */
  const recoverMeeting = useCallback(async (meetingId: string) => {
    setIsRecovering(true);
    try {
      const result = await storageService.recoverMeeting(meetingId);

      setRecoverableMeetings((prev) =>
        prev.filter((m) => m.meetingId !== meetingId),
      );

      return {
        success: result.success,
        audioRecoveryStatus: result.audio_recovery_status,
        meetingId: result.meeting_id,
      };
    } catch (error) {
      console.error("Failed to recover meeting:", error);
      throw new Error(getErrorMessage(error));
    } finally {
      setIsRecovering(false);
    }
  }, []);

  /**
   * Delete an interrupted meeting outright (the user chose to discard it
   * rather than recover it) — the same command every other "delete a
   * meeting" affordance in the app uses.
   */
  const deleteRecoverableMeeting = useCallback(
    async (meetingId: string): Promise<void> => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("api_delete_meeting", { meetingId });
        setRecoverableMeetings((prev) =>
          prev.filter((m) => m.meetingId !== meetingId),
        );
      } catch (error) {
        console.error("Failed to delete meeting:", error);
        throw error;
      }
    },
    [],
  );

  return {
    recoverableMeetings,
    isLoading,
    isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting,
  };
}
