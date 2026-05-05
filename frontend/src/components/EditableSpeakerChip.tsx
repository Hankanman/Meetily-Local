"use client";

import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { speakerChipClass } from "@/lib/speaker-chip";
import {
  clusterIdFromSpeakerLabel,
  listVoiceProfiles,
  promoteSpeakerToProfile,
  updateVoiceProfile,
} from "@/lib/voice-profiles";

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

  // When the popover opens for a named profile, fetch its current email so
  // the form prefills correctly (the transcript row only carries the label).
  useEffect(() => {
    if (!open) return;
    setName(speaker);
    setError(null);

    if (isNamedProfile) {
      let cancelled = false;
      (async () => {
        try {
          const profiles = await listVoiceProfiles();
          if (cancelled) return;
          const me = profiles.find((p) => p.id === voiceProfileId);
          setEmail(me?.email ?? "");
        } catch {
          if (!cancelled) setEmail("");
        }
      })();
      return () => {
        cancelled = true;
      };
    } else {
      setEmail("");
    }
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

  const canSave = name.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const emailOrNull = trimmedEmail.length > 0 ? trimmedEmail : null;

    try {
      if (isNamedProfile && voiceProfileId) {
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
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
