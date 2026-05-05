// Frontend wrappers for the speaker-diarization voice-profile commands.
// Keeps the Tauri command names and DTO shapes in one place.

import { invoke } from "@tauri-apps/api/core";

export interface VoiceProfile {
  id: string;
  name: string;
  email: string | null;
  embedding_dim: number;
  sample_count: number;
  created_at: string;
  updated_at: string;
}

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  return invoke<VoiceProfile[]>("list_voice_profiles");
}

export async function updateVoiceProfile(
  profileId: string,
  name: string,
  email: string | null,
): Promise<boolean> {
  return invoke<boolean>("update_voice_profile", {
    profileId,
    name,
    email,
  });
}

export async function deleteVoiceProfile(profileId: string): Promise<boolean> {
  return invoke<boolean>("delete_voice_profile", { profileId });
}

export interface PromoteSpeakerArgs {
  cluster_id: number;
  name: string;
  email?: string | null;
}

export async function promoteSpeakerToProfile(
  args: PromoteSpeakerArgs,
): Promise<string> {
  return invoke<string>("promote_speaker_to_profile", { args });
}

/**
 * Parse a "Speaker N" label into a 0-indexed cluster_id, or `null` if the
 * label isn't an unnamed-cluster placeholder. The diarizer assigns
 * "Speaker 1", "Speaker 2", ... in 1-indexed form; cluster_id = N - 1.
 */
export function clusterIdFromSpeakerLabel(label: string): number | null {
  const match = /^Speaker\s+(\d+)$/.exec(label.trim());
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n - 1;
}
