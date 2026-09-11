"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { toast } from "sonner";
import {
  recordingService,
  RecordingPhase,
  RecordingSnapshot,
  RecordingState as BackendRecordingState,
} from "@/services/recordingService";
import { isPostProcessingRef } from "@/hooks/useRecordingStop";
import { useElapsedTime } from "@/hooks/useElapsedTime";

// Watchdog (issue #17 gap): if we've been sitting in a stop-flow status
// (STOPPING / PROCESSING_TRANSCRIPTS / SAVING) for longer than this while
// the backend's canonical state machine (audio::recording_phase) reports
// Idle and no post-processing is actually running locally, assume the
// frontend missed whatever event was supposed to move it out of that
// status and force it back to IDLE rather than leaving the Start button
// hidden forever. Kept long (30s) and gated on `isPostProcessingRef` so it
// never fires during a legitimate save - the full transcription-wait +
// DB-save flow can itself take tens of seconds, but keeps that ref true
// the whole time.
const WATCHDOG_STUCK_TIMEOUT_MS = 30000;

/**
 * Recording state synchronized with the Rust backend's canonical state
 * machine (`audio::recording_phase::RecordingPhase`, issue #57 slice 1).
 *
 * This context is now event-driven rather than polled: it subscribes to
 * the single `recording-state` event Rust emits on every phase transition
 * (start/stop/pause/resume/error), plus a one-shot `get_recording_state`
 * fetch on mount and on window focus/visibility change to resync a window
 * that missed events while backgrounded or was opened mid-session. There is
 * no periodic poll any more - durations tick client-side from the
 * snapshot's `started_at_ms` via `useElapsedTime`.
 */

// Recording lifecycle status enum
export enum RecordingStatus {
  IDLE = "idle", // Not recording
  STARTING = "starting", // Initiating recording
  RECORDING = "recording", // Active recording
  STOPPING = "stopping", // Stop initiated, waiting for backend
  PROCESSING_TRANSCRIPTS = "processing", // Transcription completion wait
  SAVING = "saving", // Saving to database
  COMPLETED = "completed", // Successfully saved
  ERROR = "error", // Error occurred
}

interface RecordingState {
  isRecording: boolean; // Is a recording session active
  isPaused: boolean; // Is the recording paused
  isActive: boolean; // Is actively recording (recording && !paused)
  recordingDuration: number | null; // Total duration including pauses
  activeDuration: number | null; // Active recording time (excluding pauses)

  // NEW: Lifecycle status
  status: RecordingStatus;
  statusMessage?: string; // Optional message for current status

  // True while the Rust side reports a previous stop is still draining /
  // finalising (recording phase is Stopping or Finalising), independent of
  // this window's own local `status`. Lets a fresh window/tab, or a tray
  // stop that this window never locally transitioned for, still see the
  // stop-in-progress window.
  isBackendFinalising: boolean;
}

interface RecordingStateContextType extends RecordingState {
  // NEW: Setters for status management
  setStatus: (status: RecordingStatus, message?: string) => void;

  // Computed helpers (derived from status)
  isStopping: boolean;
  isProcessing: boolean;
  isSaving: boolean;

  // Single source of truth for "a stop is in flight and must not be
  // interrupted by a new start": true whenever local status is in the
  // STOPPING/PROCESSING_TRANSCRIPTS/SAVING lifecycle, OR the backend reports
  // `isBackendFinalising`. Every start entry point (sidebar toggle, tray
  // toggle, auto-start effect, page.tsx) must honour this (issue #35).
  isStopFlowActive: boolean;
}

const RecordingStateContext = createContext<RecordingStateContextType | null>(
  null,
);

export const useRecordingState = () => {
  const context = useContext(RecordingStateContext);
  if (!context) {
    throw new Error(
      "useRecordingState must be used within a RecordingStateProvider",
    );
  }
  return context;
};

/** Ordering over the local stop-flow lifecycle, used so a phase-derived
 *  status update never regresses past whatever local post-processing has
 *  already reached (e.g. the backend reporting Idle - which happens right
 *  after `recording-stopped`, seconds before local post-processing actually
 *  finishes saving - must not snap the UI back to IDLE mid-save). 0 covers
 *  every status outside the stop flow (IDLE/STARTING/RECORDING/ERROR). */
const STOP_FLOW_RANK: Partial<Record<RecordingStatus, number>> = {
  [RecordingStatus.STOPPING]: 1,
  [RecordingStatus.PROCESSING_TRANSCRIPTS]: 2,
  [RecordingStatus.SAVING]: 3,
  [RecordingStatus.COMPLETED]: 4,
};
function stopFlowRank(status: RecordingStatus): number {
  return STOP_FLOW_RANK[status] ?? 0;
}

/** Builds a full snapshot shape out of `get_recording_state`'s response for
 *  the initial/resync fetch, so it can go through the same `applySnapshot`
 *  path as a live `recording-state` event. `get_recording_state` always
 *  includes the snapshot fields now, but this stays defensive about a
 *  missing field rather than assuming it. */
function snapshotFromBackendState(s: BackendRecordingState): RecordingSnapshot {
  return {
    phase: s.phase ?? (s.is_recording ? (s.is_paused ? "paused" : "recording") : "idle"),
    started_at_ms: s.started_at_ms ?? null,
    active_duration_secs: s.active_duration_secs ?? s.active_duration ?? null,
    total_pause_secs: s.total_pause_secs ?? 0,
    meeting_name: s.meeting_name ?? null,
    folder_path: s.folder_path ?? null,
    meeting_id: s.meeting_id ?? null,
    chunks_in_queue: s.chunks_in_queue ?? 0,
    error: s.error ?? null,
    seq: s.seq ?? 0,
  };
}

export function RecordingStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Canonical fields mirrored straight from the backend's RecordingPhase
  // snapshot.
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [totalPauseSecs, setTotalPauseSecs] = useState(0);

  // Local lifecycle status - richer than `phase` (it also tracks
  // PROCESSING_TRANSCRIPTS/SAVING/COMPLETED, which are driven by
  // useRecordingStop's own post-processing, not by the Rust phase machine).
  const [status, setStatusState] = useState<RecordingStatus>(
    RecordingStatus.IDLE,
  );
  const [statusMessage, setStatusMessage] = useState<string | undefined>(
    undefined,
  );

  // Mirrors `status` for use inside callbacks/timers that must read the
  // latest value without becoming a dependency (which would tear down and
  // re-arm the watchdog timer below on every status change).
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Discards a `recording-state` event or resync fetch that is older than
  // one already applied (e.g. the initial `get_recording_state` resolving
  // after a live event already moved the snapshot forward).
  const lastSeqRef = useRef(-1);

  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Displayed active-recording duration while paused: frozen at the value
  // the backend computed at the instant of pausing (its own
  // `get_active_recording_duration` stops growing the moment a pause
  // starts) rather than continuing to tick. Set directly inside
  // `applySnapshot` below (an event-driven update, not a render-time ref
  // mutation) whenever a `Paused` snapshot arrives, and cleared on any other
  // phase.
  const [frozenActiveDuration, setFrozenActiveDuration] = useState<
    number | null
  >(null);

  // NEW: Status setter with logging
  const setStatus = useCallback((next: RecordingStatus, message?: string) => {
    console.log(
      `[RecordingState] Status: ${statusRef.current} → ${next}`,
      message || "",
    );
    setStatusState(next);
    setStatusMessage(message);
  }, []);

  /**
   * Apply a `RecordingSnapshot` (from a live `recording-state` event or a
   * `get_recording_state` resync) to local state. This is the only place
   * `phase`/`startedAtMs`/`totalPauseSecs`/`status` are derived from the
   * backend.
   */
  const applySnapshot = useCallback((snapshot: RecordingSnapshot) => {
    if (snapshot.seq < lastSeqRef.current) {
      console.log(
        "[RecordingStateContext] Ignoring stale recording-state snapshot (seq",
        snapshot.seq,
        "< last applied",
        lastSeqRef.current,
        ")",
      );
      return;
    }
    lastSeqRef.current = snapshot.seq;

    console.log("[RecordingStateContext] Applying snapshot:", snapshot);

    setPhase(snapshot.phase);
    setStartedAtMs(snapshot.started_at_ms);
    setTotalPauseSecs(snapshot.total_pause_secs);
    setFrozenActiveDuration(
      snapshot.phase === "paused" ? snapshot.active_duration_secs : null,
    );

    setStatusState((prevStatus) => {
      switch (snapshot.phase) {
        case "error":
          return RecordingStatus.ERROR;
        case "starting":
          return RecordingStatus.STARTING;
        case "recording":
        case "paused":
          return RecordingStatus.RECORDING;
        case "stopping":
          return stopFlowRank(prevStatus) < 1
            ? RecordingStatus.STOPPING
            : prevStatus;
        case "finalising":
          // "unless the local post-processing has already moved to SAVING"
          return stopFlowRank(prevStatus) < 2
            ? RecordingStatus.PROCESSING_TRANSCRIPTS
            : prevStatus;
        case "idle":
        default:
          // Only force IDLE when local post-processing hasn't already moved
          // past STOPPING - see the STOP_FLOW_RANK comment above.
          return stopFlowRank(prevStatus) < 1
            ? RecordingStatus.IDLE
            : prevStatus;
      }
    });

    if (snapshot.phase === "error") {
      setStatusMessage(snapshot.error ?? undefined);
    }
  }, []);

  // Ticks elapsed wall time since the session started recording (including
  // any time spent paused) - client-side, from the backend's `started_at_ms`,
  // instead of polling a duration.
  const elapsedMs = useElapsedTime(startedAtMs);
  const recordingDuration = startedAtMs !== null ? elapsedMs / 1000 : null;

  // Active duration excludes pause time; see `frozenActiveDuration` above for
  // the paused case.
  const activeDuration =
    recordingDuration === null
      ? null
      : phase === "paused"
        ? frozenActiveDuration
        : Math.max(0, recordingDuration - totalPauseSecs);

  const isRecording = phase === "recording" || phase === "paused";
  const isPaused = phase === "paused";
  const isActive = phase === "recording";
  const isBackendFinalising = phase === "stopping" || phase === "finalising";

  /**
   * Subscribe to `recording-state`, and resync once on mount plus on every
   * window focus / tab-visible transition (covers a window that was
   * backgrounded through a whole recording, or opened mid-session).
   */
  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let cancelled = false;

    const resync = async () => {
      try {
        const backendState = await recordingService.getRecordingState();
        if (!cancelled) {
          applySnapshot(snapshotFromBackendState(backendState));
        }
      } catch (error) {
        console.error(
          "[RecordingStateContext] Failed to resync recording state:",
          error,
        );
      }
    };

    const setup = async () => {
      try {
        unlistenState = await recordingService.onRecordingState((snapshot) => {
          applySnapshot(snapshot);
        });
        console.log(
          "[RecordingStateContext] Subscribed to recording-state events",
        );
      } catch (error) {
        console.error(
          "[RecordingStateContext] Failed to subscribe to recording-state:",
          error,
        );
      }

      // Initial sync on mount - fixes refresh/new-window desync (backend
      // recording but this window's default state is idle).
      await resync();
    };

    setup();

    const onFocus = () => {
      resync();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resync();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      unlistenState?.();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [applySnapshot]);

  /**
   * Watchdog (issue #17 gap): arm a one-shot timer whenever local `status`
   * is stuck in the stop flow while the backend's phase is already Idle.
   * Re-checks both conditions (plus `isPostProcessingRef`) when it fires,
   * so a status change or a post-processing run that starts in the
   * meantime disarms it without needing its own effect dependency.
   */
  useEffect(() => {
    const rank = stopFlowRank(status);
    const inStopFlow = rank >= 1 && rank <= 3; // STOPPING/PROCESSING/SAVING, not COMPLETED
    const backendIdle = phase === "idle";

    if (inStopFlow && backendIdle && !isPostProcessingRef.current) {
      if (!watchdogTimerRef.current) {
        watchdogTimerRef.current = setTimeout(() => {
          watchdogTimerRef.current = null;
          const stillRank = stopFlowRank(statusRef.current);
          const stillStuck =
            stillRank >= 1 && stillRank <= 3 && !isPostProcessingRef.current;
          if (stillStuck) {
            console.warn(
              "[RecordingStateContext] Watchdog: stuck in",
              statusRef.current,
              "for over",
              WATCHDOG_STUCK_TIMEOUT_MS,
              "ms while backend reports idle and no post-processing is running - forcing IDLE",
            );
            setStatusState(RecordingStatus.IDLE);
            setStatusMessage(undefined);
            toast.error(
              "Recording finished; the transcript may need recovery from the Recoverable meetings dialog",
            );
          }
        }, WATCHDOG_STUCK_TIMEOUT_MS);
      }
    } else if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, [status, phase]);

  // Clear any still-armed watchdog timer on unmount.
  useEffect(() => {
    return () => {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
      }
    };
  }, []);

  // NEW: Computed helpers from status
  const contextValue = useMemo(() => {
    const isStopping = status === RecordingStatus.STOPPING;
    const isProcessing = status === RecordingStatus.PROCESSING_TRANSCRIPTS;
    const isSaving = status === RecordingStatus.SAVING;
    return {
      isRecording,
      isPaused,
      isActive,
      recordingDuration,
      activeDuration,
      status,
      statusMessage,
      isBackendFinalising,
      setStatus,
      isStopping,
      isProcessing,
      isSaving,
      // Single source of truth (issue #35): local stop-flow status OR the
      // backend's own finalising phase, so every start entry point can gate
      // on one value regardless of which window/tab drove the stop.
      isStopFlowActive:
        isStopping || isProcessing || isSaving || isBackendFinalising,
    };
  }, [
    isRecording,
    isPaused,
    isActive,
    recordingDuration,
    activeDuration,
    status,
    statusMessage,
    isBackendFinalising,
    setStatus,
  ]);

  return (
    <RecordingStateContext.Provider value={contextValue}>
      {children}
    </RecordingStateContext.Provider>
  );
}
