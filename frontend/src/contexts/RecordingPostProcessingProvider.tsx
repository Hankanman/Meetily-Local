"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  useRecordingStop,
  isStopInProgressRef,
} from "@/hooks/useRecordingStop";
import { recordingService } from "@/services/recordingService";

// How long to wait for `recording-stop-complete` after `recording-stopped`
// before assuming the event was missed and running post-processing anyway
// (issue #17 gap: a stuck STOPPING state when a tray-initiated stop's
// `recording-stop-complete` event never arrives).
const STOP_COMPLETE_FALLBACK_MS = 4000;

/**
 * RecordingPostProcessingProvider
 *
 * This provider handles post-processing when recording stops from any source:
 * - Tray menu stop
 * - Global keyboard shortcut
 * - Overlay stop button
 * - Main UI stop button
 *
 * It listens for the 'recording-stop-complete' event from Rust backend
 * and triggers the full post-processing flow (save to database, navigate, analytics)
 * regardless of which page the user is currently on.
 */
export function RecordingPostProcessingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // No-op functions since the global RecordingStateContext already handles state updates
  // These are only needed for the hook's local component state management.
  // Stabilized with useCallback (issue #36): useRecordingStop's
  // handleRecordingStop takes these as deps, so a fresh identity every
  // render would otherwise cascade into recreating handleRecordingStop below
  // on every render too.
  const setIsRecording = useCallback(() => {}, []);
  const setIsRecordingDisabled = useCallback(() => {}, []);

  const { handleRecordingStop } = useRecordingStop(
    setIsRecording,
    setIsRecordingDisabled,
  );

  // Keep the latest handler in a ref instead of as an effect dependency, so
  // the `listen("recording-stop-complete")` subscription below is set up
  // exactly once per mount. Re-subscribing on every render (which happened
  // here previously, since handleRecordingStop's identity used to change
  // every render — at least every 500ms while recording) opens a real
  // lost-event window: unlisten() runs synchronously on cleanup but the
  // replacement listen() needs an IPC round trip, and a tray stop can emit
  // recording-stop-complete right in that gap, silently skipping the DB
  // save (issue #36).
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  // Guards the fallback timer below against double-running post-processing:
  // true once this stop's post-processing has either been kicked off by the
  // real `recording-stop-complete` event or by the fallback timer itself.
  const completeHandledRef = useRef(true);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let unlistenComplete: (() => void) | undefined;
    let unlistenStopped: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenComplete = await listen<boolean>(
          "recording-stop-complete",
          (event) => {
            console.log(
              "[RecordingPostProcessing] Received recording-stop-complete event:",
              event.payload,
            );

            clearFallbackTimer();
            if (completeHandledRef.current) {
              // Already handled (e.g. the fallback timer beat this event,
              // or a button-initiated stop already ran directly) - don't
              // run post-processing twice.
              return;
            }
            completeHandledRef.current = true;

            // Call the post-processing handler
            // event.payload is the callApi boolean (true for normal stops)
            handleRecordingStopRef.current(event.payload);
          },
        );

        // Arm a fallback: if a stop was initiated somewhere this provider
        // doesn't directly drive (tray, global shortcut) and
        // `recording-stop-complete` never arrives, run post-processing
        // anyway after a short grace period instead of leaving the app
        // stuck in STOPPING forever (issue #17 gap).
        unlistenStopped = await listen("recording-stopped", () => {
          if (isStopInProgressRef.current) {
            // A stop is already being handled locally (e.g. a
            // button-initiated stop that calls handleRecordingStop
            // directly, without waiting for recording-stop-complete at
            // all) - nothing to fall back for.
            return;
          }

          clearFallbackTimer();
          completeHandledRef.current = false;
          fallbackTimerRef.current = setTimeout(() => {
            fallbackTimerRef.current = null;
            if (completeHandledRef.current || isStopInProgressRef.current) {
              return;
            }
            completeHandledRef.current = true;
            console.warn(
              "[RecordingPostProcessing] recording-stop-complete not received within",
              STOP_COMPLETE_FALLBACK_MS,
              "ms of recording-stopped - running post-processing fallback",
            );
            handleRecordingStopRef.current(true);
          }, STOP_COMPLETE_FALLBACK_MS);
        });

        console.log(
          "[RecordingPostProcessing] Event listeners set up successfully",
        );
      } catch (error) {
        console.error(
          "[RecordingPostProcessing] Failed to set up event listeners:",
          error,
        );
      }
    };

    setupListeners();

    return () => {
      clearFallbackTimer();
      if (unlistenComplete) {
        console.log("[RecordingPostProcessing] Cleaning up event listeners");
        unlistenComplete();
      }
      if (unlistenStopped) {
        unlistenStopped();
      }
    };
  }, [clearFallbackTimer]);

  // Surface fatal recording errors (issue #24). The backend auto-stops via
  // the full stop flow when this fires, so the subsequent
  // `recording-stopped` / `recording-stop-complete` events already drive
  // the rest of the UI back to idle — this only needs to show the reason.
  useEffect(() => {
    let unlistenError: (() => void) | undefined;

    const setupErrorListener = async () => {
      try {
        unlistenError = await recordingService.onRecordingError((message) => {
          console.error("[RecordingPostProcessing] recording-error:", message);
          toast.error("Recording stopped due to an error", {
            description: message,
          });
        });
      } catch (error) {
        console.error(
          "[RecordingPostProcessing] Failed to set up recording-error listener:",
          error,
        );
      }
    };

    setupErrorListener();

    let unlistenWarning: (() => void) | undefined;
    const setupWarningListener = async () => {
      try {
        unlistenWarning = await recordingService.onTranscriptionWarning(
          (message) => {
            console.warn("[RecordingPostProcessing] transcription-warning:", message);
            toast.warning(message);
          },
        );
      } catch (error) {
        console.error(
          "[RecordingPostProcessing] Failed to set up transcription-warning listener:",
          error,
        );
      }
    };
    setupWarningListener();

    return () => {
      if (unlistenWarning) {
        unlistenWarning();
      }
      if (unlistenError) {
        unlistenError();
      }
    };
  }, []);

  return <>{children}</>;
}
