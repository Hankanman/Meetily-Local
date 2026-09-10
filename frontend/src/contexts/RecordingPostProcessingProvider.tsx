"use client";

import React, { useEffect } from "react";
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
  // These are only needed for the hook's local component state management
  const setIsRecording = () => {};
  const setIsRecordingDisabled = () => {};

  const { handleRecordingStop } = useRecordingStop(
    setIsRecording,
    setIsRecordingDisabled,
  );

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
            handleRecordingStop(event.payload);
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
  }, [handleRecordingStop]);

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
