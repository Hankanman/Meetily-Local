"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useRecordingStop } from "@/hooks/useRecordingStop";
import { recordingService } from "@/services/recordingService";

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

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      try {
        // Listen for recording-stop-complete event from Rust
        unlistenFn = await listen<boolean>(
          "recording-stop-complete",
          (event) => {
            console.log(
              "[RecordingPostProcessing] Received recording-stop-complete event:",
              event.payload,
            );

            // Call the post-processing handler
            // event.payload is the callApi boolean (true for normal stops)
            handleRecordingStopRef.current(event.payload);
          },
        );

        console.log(
          "[RecordingPostProcessing] Event listener set up successfully",
        );
      } catch (error) {
        console.error(
          "[RecordingPostProcessing] Failed to set up event listener:",
          error,
        );
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) {
        console.log("[RecordingPostProcessing] Cleaning up event listener");
        unlistenFn();
      }
    };
  }, []);

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

    return () => {
      if (unlistenError) {
        unlistenError();
      }
    };
  }, []);

  return <>{children}</>;
}
