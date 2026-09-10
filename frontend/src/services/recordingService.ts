/**
 * Recording Service
 *
 * Handles all recording lifecycle Tauri backend calls and events.
 * Pure 1-to-1 wrapper - no error handling changes, exact same behavior as direct invoke/listen calls.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Canonical recording lifecycle phase, owned entirely by the Rust side
 * (`audio::recording_phase::RecordingPhase`). Mirrors its `serde`
 * `snake_case` representation exactly.
 */
export type RecordingPhase =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "finalising"
  | "error";

/**
 * Payload of the `recording-state` event, and the shape `get_recording_state`
 * now returns alongside its legacy keys. See `audio::recording_phase::RecordingSnapshot`.
 */
export interface RecordingSnapshot {
  phase: RecordingPhase;
  /** Unix ms the current session started recording (null once idle). */
  started_at_ms: number | null;
  active_duration_secs: number | null;
  total_pause_secs: number;
  meeting_name: string | null;
  folder_path: string | null;
  chunks_in_queue: number;
  error: string | null;
  /** Monotonically increasing per emitted snapshot. */
  seq: number;
}

export interface RecordingState extends Partial<RecordingSnapshot> {
  is_recording: boolean;
  is_paused: boolean;
  is_active: boolean;
  recording_duration: number | null;
  active_duration: number | null;
  /** True while a previous stop is still draining/finalising on the Rust
   *  side (transcription flush, audio merge) even though `is_recording` has
   *  already gone false. See `recording_commands::is_stop_in_progress()`. */
  is_finalising?: boolean;
}

export interface RecordingStoppedPayload {
  message: string;
  folder_path?: string;
  meeting_name?: string;
}

/**
 * Recording Service
 * Singleton service for managing recording lifecycle operations
 */
class RecordingService {
  /**
   * Check if recording is currently active
   * @returns Promise<boolean>
   */
  async isRecording(): Promise<boolean> {
    return invoke<boolean>("is_recording");
  }

  /**
   * Get comprehensive recording state (includes durations)
   * @returns Promise with full recording state
   */
  async getRecordingState(): Promise<RecordingState> {
    return invoke<RecordingState>("get_recording_state");
  }

  /**
   * Get current meeting name
   * @returns Promise<string | null>
   */
  async getRecordingMeetingName(): Promise<string | null> {
    return invoke<string | null>("get_recording_meeting_name");
  }

  /**
   * Start recording with device configuration and meeting name
   * @param micDeviceName - Microphone device name (null for default)
   * @param systemDeviceName - System audio device name (null for none)
   * @param meetingName - Meeting name/title
   * @returns Promise<void>
   */
  async startRecordingWithDevices(
    micDeviceName: string | null,
    systemDeviceName: string | null,
    meetingName: string,
  ): Promise<void> {
    // Tauri v2 maps camelCase JS keys to snake_case Rust params; the
    // previous snake_case keys silently deserialized every param as None.
    return invoke("start_recording_with_devices_and_meeting", {
      micDeviceName,
      systemDeviceName,
      meetingName,
    });
  }

  // Event Listeners

  /**
   * Listen for the canonical `recording-state` event, emitted by the Rust
   * state machine (`audio::recording_phase`) on every phase transition
   * (start/stop/pause/resume/error) — the single source of truth this
   * context syncs from instead of polling `get_recording_state`.
   * @param callback - Function to call with the new snapshot
   * @returns Promise that resolves to unlisten function
   */
  async onRecordingState(
    callback: (snapshot: RecordingSnapshot) => void,
  ): Promise<UnlistenFn> {
    return listen<RecordingSnapshot>("recording-state", (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for recording-started event
   * @param callback - Function to call when recording starts
   * @returns Promise that resolves to unlisten function
   */
  async onRecordingStarted(callback: () => void): Promise<UnlistenFn> {
    return listen("recording-started", callback);
  }

  /**
   * Listen for recording-stopped event (with metadata)
   * @param callback - Function to call when recording stops
   * @returns Promise that resolves to unlisten function
   */
  async onRecordingStopped(
    callback: (payload: RecordingStoppedPayload) => void,
  ): Promise<UnlistenFn> {
    return listen<RecordingStoppedPayload>("recording-stopped", (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for recording-paused event
   * @param callback - Function to call when recording is paused
   * @returns Promise that resolves to unlisten function
   */
  async onRecordingPaused(callback: () => void): Promise<UnlistenFn> {
    return listen("recording-paused", callback);
  }

  /**
   * Listen for recording-resumed event
   * @param callback - Function to call when recording resumes
   * @returns Promise that resolves to unlisten function
   */
  async onRecordingResumed(callback: () => void): Promise<UnlistenFn> {
    return listen("recording-resumed", callback);
  }

  /**
   * Listen for recording-error event.
   *
   * Emitted by the Rust side when `RecordingState::report_error` hits a
   * fatal error (see recording_state.rs / recording_commands.rs). The
   * backend follows this up by running the full stop flow itself, which
   * emits `recording-stopped` shortly after — this listener only needs to
   * surface the reason to the user.
   * @param callback - Function to call with the user-facing error message
   * @returns Promise that resolves to unlisten function
   */
  async onRecordingError(
    callback: (message: string) => void,
  ): Promise<UnlistenFn> {
    return listen<string>("recording-error", (event) => {
      callback(event.payload);
    });
  }

  /**
   * Listen for transcription-warning events: non-fatal conditions the
   * backend wants surfaced (a skipped segment, FFmpeg missing at start).
   * The payload is a plain string.
   * @param callback - Function to call with the warning message
   * @returns Promise that resolves to unlisten function
   */
  async onTranscriptionWarning(
    callback: (message: string) => void,
  ): Promise<UnlistenFn> {
    return listen<string>("transcription-warning", (event) => {
      callback(String(event.payload));
    });
  }
}

// Export singleton instance
export const recordingService = new RecordingService();
