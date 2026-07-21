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
  /** The displayed label being promoted (e.g. "Speaker 2"). The backend
   *  resolves embeddings by label — post-recording refinement renumbers
   *  labels, so labels (not internal cluster ids) are the stable handle. */
  speaker_label: string;
  name: string;
  email?: string | null;
  /** Meeting whose transcripts should be relabelled. Required because cluster
   *  numbering is per-meeting; "Speaker 1" in different meetings is different
   *  people. */
  meeting_id: string;
}

export interface PromoteSpeakerResult {
  /** New voice-profile id, or `null` when embeddings weren't reachable and
   *  only the displayed labels were rewritten (no future auto-recognition). */
  profile_id: string | null;
  renamed_count: number;
}

export async function promoteSpeakerToProfile(
  args: PromoteSpeakerArgs,
): Promise<PromoteSpeakerResult> {
  return invoke<PromoteSpeakerResult>("promote_speaker_to_profile", { args });
}

export interface MergeResult {
  renamed_count: number;
  /** True when the winner profile's centroid was rebuilt from the merged
   *  samples; false on the degraded relabel-only path. */
  centroid_updated: boolean;
}

export async function mergeVoiceProfiles(
  winnerId: string,
  loserId: string,
): Promise<MergeResult> {
  return invoke<MergeResult>("merge_voice_profiles", {
    args: { winner_id: winnerId, loser_id: loserId },
  });
}

export interface MergeClusterArgs {
  meeting_id: string;
  /** The displayed label being merged (e.g. "Speaker 2"); see
   *  {@link PromoteSpeakerArgs.speaker_label}. */
  speaker_label: string;
  profile_id: string;
}

export async function mergeClusterIntoProfile(
  args: MergeClusterArgs,
): Promise<MergeResult> {
  return invoke<MergeResult>("merge_cluster_into_profile", { args });
}

/**
 * Whether a label is an unnamed-cluster placeholder ("Speaker N") — the only
 * chips that offer the promote / merge-into-profile flow.
 */
export function isUnnamedSpeakerLabel(label: string): boolean {
  return /^Speaker\s+\d+$/.test(label.trim());
}
