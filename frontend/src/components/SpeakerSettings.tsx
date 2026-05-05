"use client";

import { useCallback, useEffect, useState } from "react";
import { GitMerge, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  deleteVoiceProfile,
  listVoiceProfiles,
  mergeVoiceProfiles,
  updateVoiceProfile,
  VoiceProfile,
} from "@/lib/voice-profiles";

type EditingState =
  | { kind: "idle" }
  | { kind: "edit"; profile: VoiceProfile }
  | { kind: "delete"; profile: VoiceProfile }
  | { kind: "merge"; loser: VoiceProfile };

function formatRelative(iso: string): string {
  // Best-effort relative date — falls back to the raw ISO string on parse fail.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SpeakerSettings() {
  const [profiles, setProfiles] = useState<VoiceProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState>({ kind: "idle" });

  const refresh = useCallback(async () => {
    try {
      const list = await listVoiceProfiles();
      setProfiles(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-6 pt-6">
      <div>
        <h2 className="text-lg font-semibold">Speakers</h2>
        <p className="text-sm text-muted-foreground">
          People you&apos;ve named on a transcript. Future meetings will
          auto-tag the same voice when it&apos;s recognised.
        </p>
      </div>

      {error && (
        <div className="
          rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm
          text-destructive
        ">
          {error}
        </div>
      )}

      {profiles === null && !error && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {profiles && profiles.length === 0 && (
        <div className="
          flex flex-col items-center gap-2 rounded-md border border-dashed
          border-border p-10 text-center
        ">
          <Users className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">No saved speakers yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Click any &quot;Speaker N&quot; chip on a transcript and give them a
            name to save a voice profile here.
          </p>
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 text-right font-medium">Samples</th>
                <th className="px-4 py-2 font-medium">Updated</th>
                <th className="w-24 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.email ?? (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {p.sample_count}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatRelative(p.updated_at)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${p.name}`}
                        onClick={() => setEditing({ kind: "edit", profile: p })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Merge ${p.name} into another speaker`}
                        disabled={profiles.length < 2}
                        onClick={() => setEditing({ kind: "merge", loser: p })}
                      >
                        <GitMerge className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${p.name}`}
                        onClick={() =>
                          setEditing({ kind: "delete", profile: p })
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing.kind === "edit" && (
        <EditDialog
          profile={editing.profile}
          onClose={() => setEditing({ kind: "idle" })}
          onSaved={() => {
            setEditing({ kind: "idle" });
            void refresh();
          }}
        />
      )}

      {editing.kind === "delete" && (
        <DeleteDialog
          profile={editing.profile}
          onClose={() => setEditing({ kind: "idle" })}
          onDeleted={() => {
            setEditing({ kind: "idle" });
            void refresh();
          }}
        />
      )}

      {editing.kind === "merge" && profiles && (
        <MergeDialog
          loser={editing.loser}
          candidates={profiles.filter((p) => p.id !== editing.loser.id)}
          onClose={() => setEditing({ kind: "idle" })}
          onMerged={() => {
            setEditing({ kind: "idle" });
            void refresh();
          }}
        />
      )}
    </div>
  );
}

interface EditDialogProps {
  profile: VoiceProfile;
  onClose: () => void;
  onSaved: () => void;
}

function EditDialog({ profile, onClose, onSaved }: EditDialogProps) {
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    const trimmedEmail = email.trim();
    const emailOrNull = trimmedEmail.length > 0 ? trimmedEmail : null;
    try {
      await updateVoiceProfile(profile.id, name.trim(), emailOrNull);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit speaker</DialogTitle>
          <DialogDescription>
            Updates this voice profile across all meetings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="edit-speaker-name">Name</Label>
            <Input
              id="edit-speaker-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-speaker-email">Email (optional)</Label>
            <Input
              id="edit-speaker-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@example.com"
            />
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteDialogProps {
  profile: VoiceProfile;
  onClose: () => void;
  onDeleted: () => void;
}

interface MergeDialogProps {
  loser: VoiceProfile;
  candidates: VoiceProfile[];
  onClose: () => void;
  onMerged: () => void;
}

function MergeDialog({
  loser,
  candidates,
  onClose,
  onMerged,
}: MergeDialogProps) {
  const [winnerId, setWinnerId] = useState<string>("");
  const [merging, setMerging] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const winner = candidates.find((c) => c.id === winnerId) ?? null;
  const canMerge = !!winner && !merging;

  async function handleMerge() {
    if (!winner) return;
    setMerging(true);
    setErr(null);
    try {
      await mergeVoiceProfiles(winner.id, loser.id);
      onMerged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge speaker</DialogTitle>
          <DialogDescription>
            Folds &quot;{loser.name}&quot; into another speaker. The chosen
            speaker keeps its name and email; samples from both profiles are
            combined and every transcript currently linked to{" "}
            &quot;{loser.name}&quot; is re-pointed at the chosen speaker.
            This profile is then deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="merge-target">Merge into</Label>
            <Select value={winnerId} onValueChange={setWinnerId}>
              <SelectTrigger id="merge-target">
                <SelectValue placeholder="Choose a speaker..." />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? (
                      <span className="text-muted-foreground"> · {c.email}</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={merging}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={!canMerge}>
            {merging ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ profile, onClose, onDeleted }: DeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setErr(null);
    try {
      await deleteVoiceProfile(profile.id);
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete speaker</DialogTitle>
          <DialogDescription>
            Removes the voice profile for &quot;{profile.name}&quot;. Past
            transcripts keep the displayed name but stop being linked to a
            profile, and future meetings won&apos;t auto-tag this voice.
          </DialogDescription>
        </DialogHeader>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
