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
import { recordingService } from "@/services/recordingService";
import { isPostProcessingRef } from "@/hooks/useRecordingStop";

// Watchdog (issue #17 gap): if we've been sitting in a stop-flow status
// (STOPPING / PROCESSING_TRANSCRIPTS / SAVING) for longer than this while
// the backend confirms it's fully idle (`is_recording=false`,
// `is_finalising=false`) and no post-processing is actually running
// locally, assume the frontend missed whatever event was supposed to move
// it out of that status and force it back to IDLE rather than leaving the
// Start button hidden forever. Kept long (30s) and gated on
// `isPostProcessingRef` so it never fires during a legitimate save - the
// full transcription-wait + DB-save flow can itself take tens of seconds,
// but keeps that ref true the whole time.
const WATCHDOG_STUCK_TIMEOUT_MS = 30000;

/**
 * Recording state synchronized with backend
 * This context provides a single source of truth for recording state
 * that automatically syncs with the Rust backend, solving:
 * 1. Page refresh desync (backend recording but UI shows stopped)
 * 2. Pause state visibility across components
 * 3. Comprehensive state for future features (reconnection, etc.)
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
  // finalising (recording_commands::is_stop_in_progress()), independent of
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
  // `is_finalising`. Every start entry point (sidebar toggle, tray toggle,
  // auto-start effect, page.tsx) must honour this (issue #35).
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

export function RecordingStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isPaused: false,
    isActive: false,
    recordingDuration: null,
    activeDuration: null,
    status: RecordingStatus.IDLE, // NEW: Initialize with IDLE status
    statusMessage: undefined, // NEW: No message initially
    isBackendFinalising: false,
  });

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Indirection to break the startPolling <-> syncWithBackend declaration
  // cycle below without forward-referencing either useCallback before it's
  // declared (startPolling schedules ticks by calling through this ref
  // rather than closing over syncWithBackend directly).
  const syncWithBackendRef = useRef<() => Promise<void>>(async () => {});

  // Mirrors state.status for syncWithBackend's watchdog check below, which
  // needs the latest status without taking a `state` dependency (that would
  // recreate syncWithBackend, and therefore the polling interval, on every
  // status change).
  const statusRef = useRef(state.status);
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  // Timestamp of when the watchdog condition (stuck in a stop-flow status
  // while the backend reports fully idle) was first observed; null while
  // not currently stuck. Reset whenever the condition stops holding.
  const watchdogStuckSinceRef = useRef<number | null>(null);

  // NEW: Status setter with logging
  const setStatus = useCallback(
    (status: RecordingStatus, message?: string) => {
      console.log(
        `[RecordingState] Status: ${state.status} → ${status}`,
        message || "",
      );

      setState((prev) => ({
        ...prev,
        status,
        statusMessage: message,
      }));
    },
    [state.status],
  );

  /**
   * Stop polling backend state (called when recording stops)
   */
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      console.log("[RecordingStateContext] Stopping state polling");
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  /**
   * Start polling backend state (called when recording starts)
   */
  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    console.log(
      "[RecordingStateContext] Starting state polling (500ms interval)",
    );
    pollingIntervalRef.current = setInterval(() => {
      syncWithBackendRef.current();
    }, 500);
  }, []);

  /**
   * Sync recording state with backend
   * Called on mount (fixes refresh desync) and periodically while recording
   */
  const syncWithBackend = useCallback(async () => {
    try {
      const backendState = await recordingService.getRecordingState();
      const isFinalising = backendState.is_finalising ?? false;

      // Skip the setState when nothing the backend reports has actually
      // changed - `syncWithBackend` runs every 500ms while a recording/stop
      // is in flight, and re-creating the state object on every tick forces
      // every consumer (page.tsx, the sidebar, the top bar, ...) to
      // re-render for no reason (issue #51).
      setState((prev) => {
        if (
          prev.isRecording === backendState.is_recording &&
          prev.isPaused === backendState.is_paused &&
          prev.isActive === backendState.is_active &&
          prev.recordingDuration === backendState.recording_duration &&
          prev.activeDuration === backendState.active_duration &&
          prev.isBackendFinalising === isFinalising
        ) {
          return prev;
        }
        return {
          ...prev,
          isRecording: backendState.is_recording,
          isPaused: backendState.is_paused,
          isActive: backendState.is_active,
          recordingDuration: backendState.recording_duration,
          activeDuration: backendState.active_duration,
          isBackendFinalising: isFinalising,
        };
      });

      const inStopFlow = [
        RecordingStatus.STOPPING,
        RecordingStatus.PROCESSING_TRANSCRIPTS,
        RecordingStatus.SAVING,
      ].includes(statusRef.current);

      // Keep polling alive through the finalising window even after
      // `recording-stopped` has already fired (backend is_recording flips
      // false ~100ms into a stop, well before the multi-second finalise
      // completes) - and stop it once the backend confirms both recording
      // and finalising have cleared. This is what lets a fresh window/tab
      // that mounts mid-finalise, or this window if it missed the
      // recording-stopped event's stopPolling() race, still observe the
      // window (issue #35). Also keep polling while `status` itself is
      // still in the stop-flow lifecycle even after the backend goes fully
      // idle, so the watchdog below gets the repeated ticks it needs to
      // measure how long it's been stuck (issue #17 gap) - it stops polling
      // itself once it fires.
      if (backendState.is_recording || isFinalising || inStopFlow) {
        if (!pollingIntervalRef.current) {
          startPolling();
        }
      } else {
        stopPolling();
      }

      // Watchdog: the frontend is sitting in a stop-flow status but the
      // backend says recording+finalising are both done, and no
      // post-processing is actually running locally to move it the rest of
      // the way to COMPLETED/IDLE. If that holds for longer than the
      // timeout, assume whatever event was supposed to drive that
      // transition (recording-stop-complete, its fallback, ...) was lost
      // and force IDLE ourselves rather than leaving the Start button
      // hidden forever.
      if (inStopFlow && !backendState.is_recording && !isFinalising && !isPostProcessingRef.current) {
        if (watchdogStuckSinceRef.current === null) {
          watchdogStuckSinceRef.current = Date.now();
        } else if (
          Date.now() - watchdogStuckSinceRef.current >
          WATCHDOG_STUCK_TIMEOUT_MS
        ) {
          console.warn(
            "[RecordingStateContext] Watchdog: stuck in",
            statusRef.current,
            "for over",
            WATCHDOG_STUCK_TIMEOUT_MS,
            "ms while backend reports idle and no post-processing is running - forcing IDLE",
          );
          watchdogStuckSinceRef.current = null;
          setState((prev) => ({
            ...prev,
            status: RecordingStatus.IDLE,
            statusMessage: undefined,
          }));
          toast.error(
            "Recording finished; the transcript may need recovery from the Recoverable meetings dialog",
          );
          stopPolling();
        }
      } else {
        watchdogStuckSinceRef.current = null;
      }

      console.log("[RecordingStateContext] Synced with backend:", backendState);
    } catch (error) {
      console.error(
        "[RecordingStateContext] Failed to sync with backend:",
        error,
      );
      // Don't update state on error - keep current state
    }
  }, [startPolling, stopPolling]);

  useEffect(() => {
    syncWithBackendRef.current = syncWithBackend;
  }, [syncWithBackend]);

  /**
   * Set up event listeners for backend state changes
   */
  useEffect(() => {
    console.log("[RecordingStateContext] Setting up event listeners");
    const unsubscribers: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Recording started
        const unlistenStarted = await recordingService.onRecordingStarted(
          () => {
            console.log("[RecordingStateContext] Recording started event");
            setState((prev) => ({
              ...prev,
              isRecording: true,
              isPaused: false,
              isActive: true,
              status: RecordingStatus.RECORDING, // NEW: Set status to RECORDING
            }));
            startPolling();
          },
        );
        unsubscribers.push(unlistenStarted);

        // Recording stopped
        const unlistenStopped = await recordingService.onRecordingStopped(
          (payload) => {
            console.log(
              "[RecordingStateContext] Recording stopped event:",
              payload,
            );
            setState((prev) => {
              // Set status to STOPPING if not already in stop flow
              // This ensures smooth UI transition for tray/keyboard stops
              const newStatus = [
                RecordingStatus.STOPPING,
                RecordingStatus.PROCESSING_TRANSCRIPTS,
                RecordingStatus.SAVING,
              ].includes(prev.status)
                ? prev.status // Already in stop flow
                : RecordingStatus.STOPPING; // New stop, transition smoothly

              return {
                ...prev,
                status: newStatus,
                statusMessage:
                  newStatus === RecordingStatus.STOPPING
                    ? "Stopping recording..."
                    : prev.statusMessage,
                isRecording: false,
                isPaused: false,
                isActive: false,
                recordingDuration: null,
                activeDuration: null,
              };
            });
            // Deliberately do NOT stop polling here: the backend keeps
            // draining/finalising (transcription flush, audio merge) for
            // seconds after `is_recording` flips false, and `is_finalising`
            // must keep being observed through that window (issue #35).
            // `syncWithBackend`'s own polling tick stops the interval once
            // the backend confirms both recording and finalising are done.
          },
        );
        unsubscribers.push(unlistenStopped);

        // Recording paused
        const unlistenPaused = await recordingService.onRecordingPaused(() => {
          console.log("[RecordingStateContext] Recording paused event");
          setState((prev) => ({
            ...prev,
            isPaused: true,
            isActive: false,
          }));
        });
        unsubscribers.push(unlistenPaused);

        // Recording resumed
        const unlistenResumed = await recordingService.onRecordingResumed(
          () => {
            console.log("[RecordingStateContext] Recording resumed event");
            setState((prev) => ({
              ...prev,
              isPaused: false,
              isActive: true,
            }));
          },
        );
        unsubscribers.push(unlistenResumed);

        console.log(
          "[RecordingStateContext] Event listeners set up successfully",
        );
      } catch (error) {
        console.error(
          "[RecordingStateContext] Failed to set up event listeners:",
          error,
        );
      }
    };

    setupListeners();

    return () => {
      console.log("[RecordingStateContext] Cleaning up event listeners");
      unsubscribers.forEach((unsub) => unsub());
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  /**
   * Initial sync on mount - CRITICAL for fixing refresh desync bug
   * If backend is recording but UI state is false, this will correct it.
   * setState happens after await inside syncWithBackend.
   */
  useEffect(() => {
    console.log("[RecordingStateContext] Initial mount - syncing with backend");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    syncWithBackend();
  }, [syncWithBackend]);

  // NEW: Computed helpers from status
  const contextValue = useMemo(() => {
    const isStopping = state.status === RecordingStatus.STOPPING;
    const isProcessing = state.status === RecordingStatus.PROCESSING_TRANSCRIPTS;
    const isSaving = state.status === RecordingStatus.SAVING;
    return {
      ...state,
      setStatus,
      isStopping,
      isProcessing,
      isSaving,
      // Single source of truth (issue #35): local stop-flow status OR the
      // backend's own `is_finalising` flag, so every start entry point can
      // gate on one value regardless of which window/tab drove the stop.
      isStopFlowActive:
        isStopping || isProcessing || isSaving || state.isBackendFinalising,
    };
  }, [state, setStatus]);

  return (
    <RecordingStateContext.Provider value={contextValue}>
      {children}
    </RecordingStateContext.Provider>
  );
}
