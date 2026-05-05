"use client";

import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { speakerChipClass } from "@/lib/speaker-chip";
import {
  clusterIdFromSpeakerLabel,
  listVoiceProfiles,
  mergeClusterIntoProfile,
  promoteSpeakerToProfile,
  updateVoiceProfile,
  VoiceProfile,
} from "@/lib/voice-profiles";

const MERGE_NEW_VALUE = "__new__";

interface EditableSpeakerChipProps {
  speaker: string;
  /** When set, this segment is already linked to a stored profile — editing
   *  routes through `update_voice_profile`. When `undefined`, the chip is an
   *  unnamed cluster ("Speaker N") and editing routes through
   *  `promote_speaker_to_profile`. */
  voiceProfileId?: string;
  /** Required when promoting an unnamed cluster — backends scopes the
   *  rename of "Speaker N" → name to this meeting only. If omitted, the
   *  chip falls back to a static (non-editable) span for unnamed clusters. */
  meetingId?: string;
  /** Called after a successful save so the parent can refresh the transcript
   *  list (every row carrying the same speaker label / profile id should
   *  pick up the new name). */
  onSaved?: () => void;
}

/**
 * "Me" is a fixed local-user label that doesn't correspond to a stored
 * profile. We render it as a static chip — clicking it does nothing.
 */
const ME_LABEL = "Me";

export function EditableSpeakerChip({
  speaker,
  voiceProfileId,
  meetingId,
  onSaved,
}: EditableSpeakerChipProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(speaker);
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // For unnamed-cluster chips: list of stored profiles the user can merge
  // into instead of creating a new one. `MERGE_NEW_VALUE` ("create new")
  // means "fall through to the name/email inputs".
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState<string>(MERGE_NEW_VALUE);

  const isMe = speaker === ME_LABEL;
  const parsedClusterId = voiceProfileId
    ? null
    : clusterIdFromSpeakerLabel(speaker);
  // Promoting an unnamed cluster needs both a parsed cluster id AND a
  // meetingId scope. Without the latter the backend rejects the call (the
  // rename of "Speaker N" → name has to be scoped per-meeting), so we fall
  // back to a static chip.
  const canPromoteCluster = parsedClusterId !== null && !!meetingId;
  const clusterId = canPromoteCluster ? parsedClusterId : null;
  const isUnnamedCluster = clusterId !== null;
  const isNamedProfile = !!voiceProfileId;
  const mergeTarget =
    mergeTargetId !== MERGE_NEW_VALUE
      ? profiles.find((p) => p.id === mergeTargetId) ?? null
      : null;

  // When the popover opens, fetch the profile list. Used in two ways:
  //  - Named profile: pluck this profile's email to prefill the form
  //  - Unnamed cluster: populate the "merge into existing" select
  useEffect(() => {
    if (!open) return;
    setName(speaker);
    setError(null);
    setMergeTargetId(MERGE_NEW_VALUE);

    let cancelled = false;
    (async () => {
      try {
        const list = await listVoiceProfiles();
        if (cancelled) return;
        setProfiles(list);
        if (isNamedProfile) {
          const me = list.find((p) => p.id === voiceProfileId);
          setEmail(me?.email ?? "");
        } else {
          setEmail("");
        }
      } catch {
        if (!cancelled) {
          setProfiles([]);
          setEmail("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, speaker, voiceProfileId, isNamedProfile]);

  const chipClass = `
    mb-1 mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium
    ${speakerChipClass(speaker)}
  `;

  if (isMe) {
    // No editing flow for "Me" in this slice.
    return <span className={chipClass}>{speaker}</span>;
  }

  // Anything that isn't a named profile or an unnamed Speaker N cluster
  // (e.g. a stray label from older data) renders as a plain chip too.
  if (!isNamedProfile && !isUnnamedCluster) {
    return <span className={chipClass}>{speaker}</span>;
  }

  // When merging into an existing profile, no new name/email input is
  // required — we use the target profile's existing values.
  const canSave = saving
    ? false
    : mergeTarget
    ? true
    : name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const emailOrNull = trimmedEmail.length > 0 ? trimmedEmail : null;

    try {
      if (mergeTarget && clusterId !== null && meetingId) {
        // Merge unnamed cluster into an existing stored profile.
        await mergeClusterIntoProfile({
          meeting_id: meetingId,
          cluster_id: clusterId,
          profile_id: mergeTarget.id,
        });
      } else if (isNamedProfile && voiceProfileId) {
        await updateVoiceProfile(voiceProfileId, trimmedName, emailOrNull);
      } else if (clusterId !== null && meetingId) {
        await promoteSpeakerToProfile({
          cluster_id: clusterId,
          name: trimmedName,
          email: emailOrNull,
          meeting_id: meetingId,
        });
      }
      setOpen(false);
      onSaved?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`${chipClass} cursor-pointer transition hover:brightness-110`}
          aria-label={`Edit speaker ${speaker}`}
        >
          {speaker}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">
              {isNamedProfile ? "Edit speaker" : "Name this speaker"}
            </h4>
            <p className="text-xs text-muted-foreground">
              {isNamedProfile
                ? "Updates this voice profile across all meetings."
                : "Save a voice profile so future meetings auto-tag this person."}
            </p>
          </div>

          {isUnnamedCluster && profiles.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="speaker-merge-target">Existing speaker</Label>
              <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                <SelectTrigger id="speaker-merge-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MERGE_NEW_VALUE}>
                    Create new speaker…
                  </SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.email ? (
                        <span className="text-muted-foreground"> · {p.email}</span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!mergeTarget && (
            <>
              <div className="space-y-1">
                <Label htmlFor="speaker-name">Name</Label>
                <Input
                  id="speaker-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alice Smith"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="speaker-email">Email (optional)</Label>
                <Input
                  id="speaker-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@example.com"
                />
              </div>
            </>
          )}

          {mergeTarget && (
            <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              This cluster&apos;s samples will be folded into{" "}
              <span className="font-medium text-foreground">
                {mergeTarget.name}
              </span>
              {mergeTarget.email ? ` (${mergeTarget.email})` : ""}, and every
              transcript from this meeting will be relabelled.
            </p>
          )}

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving
                ? mergeTarget
                  ? "Merging…"
                  : "Saving…"
                : mergeTarget
                ? `Merge into ${mergeTarget.name}`
                : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
