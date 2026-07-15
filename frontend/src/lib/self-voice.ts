// Frontend wrappers for the "Record my voice" self-enrollment commands
// (src-tauri/src/speaker_diarization/enrollment.rs).
//
// Capture happens in Rust on the same PipeWire mic path a real recording uses,
// so there's no MediaRecorder here — the UI just starts/stops the backend
// session and renders the progress events it emits.

import { invoke } from "@tauri-apps/api/core";

export interface SelfVoiceStatus {
  enrolled: boolean;
  profile_id: string | null;
  /** Display name of the stored profile — "Me". */
  name: string | null;
  /** Number of embedding windows behind the stored centroid. */
  sample_count: number | null;
  updated_at: string | null;
  /** False when the speaker model isn't downloaded; enrollment needs it. */
  model_ready: boolean;
}

/** Payload of the `self-voice-enrollment-progress` event, ~10x/second. */
export interface SelfVoiceProgress {
  rms_level: number;
  peak_level: number;
  captured_secs: number;
  /** How long the backend wants us to record for. */
  target_secs: number;
  /** True once enough audio is captured for `finish` to succeed. */
  can_save: boolean;
}

export const SELF_VOICE_PROGRESS_EVENT = "self-voice-enrollment-progress";

export async function getSelfVoiceStatus(): Promise<SelfVoiceStatus> {
  return invoke<SelfVoiceStatus>("self_voice_status");
}

/** `micDevice`: PipeWire node id, or null for the system default source. */
export async function startSelfVoiceEnrollment(
  micDevice: string | null,
): Promise<void> {
  // Tauri v2 maps camelCase keys onto snake_case command params.
  return invoke("start_self_voice_enrollment", { micDevice });
}

export async function cancelSelfVoiceEnrollment(): Promise<void> {
  return invoke("cancel_self_voice_enrollment");
}

/** Stops capture and turns the recording into the self profile, replacing any
 *  previous one. Rejects with a user-facing message if the audio was too
 *  short, too quiet, or had too little speech in it. */
export async function finishSelfVoiceEnrollment(): Promise<SelfVoiceStatus> {
  return invoke<SelfVoiceStatus>("finish_self_voice_enrollment");
}

export async function deleteSelfVoiceProfile(): Promise<boolean> {
  return invoke<boolean>("delete_self_voice_profile");
}
