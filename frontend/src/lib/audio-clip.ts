// Fetches a single transcript segment's audio as a WAV clip so it can be
// played back in the meeting-details view (to verify who's speaking).
//
// The Rust `get_meeting_audio_clip` command extracts the [start, end] slice of
// the meeting's recording with the bundled ffmpeg and returns it base64-encoded
// — we decode it to an ArrayBuffer and hand it to the Web Audio API, which
// plays PCM WAV reliably even where the webview's mp4/GStreamer path can't.

import { invoke } from "@tauri-apps/api/core";

/** Returns the segment clip as a decoded ArrayBuffer (16 kHz mono PCM WAV). */
export async function getMeetingAudioClip(
  meetingId: string,
  startSecs: number,
  endSecs: number,
): Promise<ArrayBuffer> {
  const base64 = await invoke<string>("get_meeting_audio_clip", {
    meetingId,
    startSecs,
    endSecs,
  });
  return base64ToArrayBuffer(base64);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
