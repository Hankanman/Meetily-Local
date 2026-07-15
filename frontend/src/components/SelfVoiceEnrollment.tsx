"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, Mic, Trash2 } from "lucide-react";

import { Button } from "./ui/button";
import { AudioLevelMeter } from "./AudioLevelMeter";
import {
  cancelSelfVoiceEnrollment,
  deleteSelfVoiceProfile,
  finishSelfVoiceEnrollment,
  getSelfVoiceStatus,
  SELF_VOICE_PROGRESS_EVENT,
  startSelfVoiceEnrollment,
  type SelfVoiceProgress,
  type SelfVoiceStatus,
} from "@/lib/self-voice";

type Mode = "idle" | "recording" | "saving";

/// A passage to read aloud while enrolling. This is the opening of the public-
/// domain "Rainbow Passage", long used in speech work because it's phonetically
/// balanced — reading it exercises a broad range of sounds, which gives the
/// speaker-embedding model a fuller picture of the voice than a few off-the-cuff
/// words would. It also just gives the user something to say for ~20s so they
/// don't trail off into silence (which is what "no speech detected" used to be).
const READING_PASSAGE =
  "When the sunlight strikes raindrops in the air, they act as a prism and " +
  "form a rainbow. The rainbow is a division of white light into many " +
  "beautiful colors. These take the shape of a long round arch, with its path " +
  "high above, and its two ends apparently beyond the horizon.";

interface SelfVoiceEnrollmentProps {
  /** Fires whenever the stored profile changes, so the parent can keep the
   *  saved-speakers list (which the self profile is excluded from) in sync. */
  onChange?: (status: SelfVoiceStatus) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SelfVoiceEnrollment({ onChange }: SelfVoiceEnrollmentProps) {
  const [status, setStatus] = useState<SelfVoiceStatus | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [progress, setProgress] = useState<SelfVoiceProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in refs, not state: the progress listener fires ~10x/second and must
  // read the current values without re-subscribing on every tick.
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const finishingRef = useRef(false);

  const detach = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const applyStatus = useCallback(
    (next: SelfVoiceStatus) => {
      setStatus(next);
      onChange?.(next);
    },
    [onChange],
  );

  const refresh = useCallback(async () => {
    try {
      applyStatus(await getSelfVoiceStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [applyStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Never leave a capture stream running behind a closed settings screen.
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
      void cancelSelfVoiceEnrollment().catch(() => {});
    };
  }, []);

  const save = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    detach();
    setMode("saving");
    try {
      applyStatus(await finishSelfVoiceEnrollment());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      finishingRef.current = false;
      setProgress(null);
      setMode("idle");
    }
  }, [applyStatus, detach]);

  async function record() {
    setError(null);
    setProgress(null);

    // Enroll through whichever mic the user records meetings with — a profile
    // built on a different device generalises worse.
    let micDevice: string | null = null;
    try {
      const prefs = await invoke<{ preferred_mic_device: string | null }>(
        "get_recording_preferences",
      );
      micDevice = prefs.preferred_mic_device ?? null;
    } catch {
      // No preference saved yet — the backend falls back to the default source.
    }

    try {
      await startSelfVoiceEnrollment(micDevice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setMode("recording");
    finishingRef.current = false;
    try {
      unlistenRef.current = await listen<SelfVoiceProgress>(
        SELF_VOICE_PROGRESS_EVENT,
        (event) => {
          setProgress(event.payload);
          // Stop on our own once they've talked long enough, so the happy path
          // needs one click, not two.
          if (event.payload.captured_secs >= event.payload.target_secs) {
            void save();
          }
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await cancelSelfVoiceEnrollment().catch(() => {});
      setMode("idle");
    }
  }

  async function cancel() {
    detach();
    setMode("idle");
    setProgress(null);
    try {
      await cancelSelfVoiceEnrollment();
    } catch {
      // Nothing running — the user gets the idle UI either way.
    }
  }

  async function remove() {
    setError(null);
    try {
      await deleteSelfVoiceProfile();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const remaining = progress
    ? Math.max(0, Math.ceil(progress.target_secs - progress.captured_secs))
    : null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Your voice</h3>
        <p className="text-xs text-muted-foreground">
          Record a short sample of yourself speaking and we&apos;ll label you as
          &quot;Me&quot; in meetings instead of grouping you in with everyone
          else the microphone picks up. Optional — skip it and nothing changes.
        </p>
      </div>

      <div className="rounded-md border border-border p-4">
        {mode === "recording" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium">
                Read this aloud until the timer runs out
              </p>
              <span className="
                shrink-0 font-mono text-sm tabular-nums text-muted-foreground
              ">
                {remaining ?? 0}s
              </span>
            </div>
            <blockquote className="
              rounded-md border-l-2 border-primary bg-muted/50 px-3 py-2
              text-sm leading-relaxed text-foreground
            ">
              {READING_PASSAGE}
            </blockquote>
            <p className="text-xs text-muted-foreground">
              Speak at a normal, steady pace. Anything works if you&apos;d
              rather not read — just keep talking.
            </p>
            <AudioLevelMeter
              rmsLevel={progress?.rms_level ?? 0}
              peakLevel={progress?.peak_level ?? 0}
              isActive={(progress?.rms_level ?? 0) > 0.001}
              deviceName="Microphone"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={!progress?.can_save}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              {!progress?.can_save && (
                <span className="text-xs text-muted-foreground">
                  Keep going — we need a few more seconds.
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              {status?.enrolled ? (
                <>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Check className="size-4 text-success" />
                    Enrolled
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {status.sample_count ?? 0} sample
                    {status.sample_count === 1 ? "" : "s"}
                    {status.updated_at
                      ? ` · recorded ${formatDate(status.updated_at)}`
                      : null}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Not enrolled</p>
                  <p className="text-xs text-muted-foreground">
                    {status && !status.model_ready
                      ? "Download the speaker model first — it's what recognises voices."
                      : "Takes about 20 seconds."}
                  </p>
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant={status?.enrolled ? "outline" : "default"}
                onClick={record}
                disabled={mode === "saving" || (status ? !status.model_ready : true)}
              >
                <Mic className="size-4" />
                {mode === "saving"
                  ? "Saving…"
                  : status?.enrolled
                    ? "Re-record"
                    : "Record my voice"}
              </Button>
              {status?.enrolled && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove your voice profile"
                  onClick={remove}
                  disabled={mode === "saving"}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
