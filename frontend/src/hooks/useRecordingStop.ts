import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import {
  useRecordingState,
  RecordingStatus,
} from "@/contexts/RecordingStateContext";
import { storageService } from "@/services/storageService";
import { transcriptService } from "@/services/transcriptService";
import { getErrorMessage } from "@/lib/utils";
import { linkMeetingToCalendarEvent } from "@/lib/calendar";
import { consumePendingCalendarEventId } from "@/lib/recordingCalendarLink";

type SummaryStatus =
  | "idle"
  | "processing"
  | "summarizing"
  | "regenerating"
  | "completed"
  | "error";

interface UseRecordingStopReturn {
  handleRecordingStop: (callApi: boolean) => Promise<void>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

/**
 * Shared across every `useRecordingStop()` call site (e.g. `page.tsx`'s
 * button-driven instance and the app-wide `RecordingPostProcessingProvider`
 * instance) so that a stop already being handled by one instance is visible
 * to the others — in particular, so the provider's tray-stop fallback timer
 * (issue #17 gap) can tell a button-initiated stop, which calls
 * `handleRecordingStop` directly and never waits for
 * `recording-stop-complete`, apart from a tray/global-shortcut stop that
 * only the provider's `recording-stop-complete` listener (or its fallback)
 * will handle. A plain module-scoped mutable object (rather than a
 * `useRef` local to each hook call) keeps this one flag instead of each
 * instance tracking its own, which would let them race each other.
 */
export const isStopInProgressRef: { current: boolean } = { current: false };

/**
 * Set for the duration of `handleRecordingStop`'s execution (across every
 * `useRecordingStop()` instance, for the same reason as
 * `isStopInProgressRef` above). Lets `RecordingStateContext`'s watchdog
 * (issue #17 gap) tell "post-processing is legitimately still running" apart
 * from "post-processing never ran and the UI is stuck" without needing its
 * own reference to whichever hook instance is doing the work.
 */
export const isPostProcessingRef: { current: boolean } = { current: false };

/**
 * Custom hook for managing recording stop lifecycle.
 * Handles the complex stop sequence: transcription wait → buffer flush → SQLite save → navigation.
 *
 * Features:
 * - Transcription completion polling (60s max, 500ms interval)
 * - Transcript buffer flush coordination
 * - SQLite meeting save with folder_path from sessionStorage
 * - Comprehensive analytics tracking (duration, word count, activation)
 * - Auto-navigation to meeting details
 * - Toast notifications for success/error
 * - Window exposure for Rust callbacks
 */
export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
  setIsRecordingDisabled: (value: boolean) => void,
): UseRecordingStopReturn {
  // USE global state instead
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript,
  } = recordingState;

  const {
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
  } = useSidebar();

  const router = useRouter();

  // Guard to prevent duplicate/concurrent stop calls (e.g., from UI and tray
  // simultaneously, or a button-initiated stop racing the provider's
  // tray-stop fallback timer). Module-scoped and shared across instances —
  // see `isStopInProgressRef` above.
  const stopInProgressRef = isStopInProgressRef;

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupRecordingStoppedListener = async () => {
      try {
        console.log("Setting up recording-stopped listener for navigation...");
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
          meeting_id?: string;
        }>("recording-stopped", async (event) => {
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name, meeting_id } = event.payload;

            // Store folder_path, meeting_name and meeting_id for later use
            // in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem("last_recording_folder_path", folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem(
                "last_recording_meeting_name",
                meeting_name,
              );
            }
            // meeting_id is the `meetings` row Rust already created and
            // finalised for this session (issue #57 slice 2). Its absence
            // means an older backend build — handleRecordingStop falls back
            // to the pre-#57 create-and-bulk-insert path in that case.
            if (meeting_id) {
              sessionStorage.setItem("last_recording_meeting_id", meeting_id);
            } else {
              sessionStorage.removeItem("last_recording_meeting_id");
            }
          })();
        });
        console.log("Recording stopped listener setup complete");
      } catch (error) {
        console.error("Failed to setup recording stopped listener:", error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      console.log("Cleaning up recording stopped listener...");
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler
  const handleRecordingStop = useCallback(
    async (isCallApi: boolean) => {
      // Snapshot the transcripts accumulated so far, before this function's
      // first await. The various start entry points now gate on
      // isStopFlowActive so a new recording shouldn't be able to start (and
      // call clearTranscripts()) while this stop is still in flight, but this
      // snapshot is the defense-in-depth backstop: if transcriptsRef.current
      // is ever found emptied out from under this flow by the time we reach
      // the save below, we still have what was here when the stop began
      // instead of saving the old meeting with zero transcripts (issue #35).
      const transcriptsSnapshot = transcriptsRef.current;

      if (recordingStoppedDataRef.current) {
        await recordingStoppedDataRef.current;
      }

      // Guard: prevent duplicate/concurrent stop calls
      if (stopInProgressRef.current) {
        return;
      }
      stopInProgressRef.current = true;
      isPostProcessingRef.current = true;

      // Set status to STOPPING immediately
      setStatus(RecordingStatus.STOPPING);
      setIsRecording(false);
      setIsRecordingDisabled(true);
      const stopStartTime = Date.now();

      try {
        console.log("Post-stop processing (new implementation)...", {
          stop_initiated_at: new Date(stopStartTime).toISOString(),
          current_transcript_count: transcriptsRef.current.length,
        });

        // Note: stop_recording is already called by RecordingControls.stopRecordingAction
        // This function only handles post-stop processing (transcription wait, API call, navigation)
        console.log(
          "Recording already stopped by RecordingControls, processing transcription...",
        );

        // Wait for transcription to complete
        setStatus(
          RecordingStatus.PROCESSING_TRANSCRIPTS,
          "Waiting for transcription...",
        );
        console.log("Waiting for transcription to complete...");

        const MAX_WAIT_TIME = 60000; // 60 seconds maximum wait (increased for longer processing)
        const POLL_INTERVAL = 500; // Check every 500ms
        let elapsedTime = 0;
        let transcriptionComplete = false;

        // Listen for transcription-complete event
        const unlistenComplete = await listen("transcription-complete", () => {
          console.log("Received transcription-complete event");
          transcriptionComplete = true;
        });

        // Poll for transcription status
        while (elapsedTime < MAX_WAIT_TIME && !transcriptionComplete) {
          try {
            const status = await transcriptService.getTranscriptionStatus();
            console.log("Transcription status:", status);

            // Check if transcription is complete
            if (!status.is_processing && status.chunks_in_queue === 0) {
              console.log(
                "Transcription complete - no active processing and no chunks in queue",
              );
              transcriptionComplete = true;
              break;
            }

            // If no activity for more than 8 seconds and no chunks in queue, consider it done (increased from 5s to 8s)
            if (
              status.last_activity_ms > 8000 &&
              status.chunks_in_queue === 0
            ) {
              console.log(
                "Transcription likely complete - no recent activity and empty queue",
              );
              transcriptionComplete = true;
              break;
            }

            // Update user with current status
            if (status.chunks_in_queue > 0) {
              console.log(
                `Processing ${status.chunks_in_queue} remaining audio chunks...`,
              );
              setStatus(
                RecordingStatus.PROCESSING_TRANSCRIPTS,
                `Processing ${status.chunks_in_queue} remaining chunks...`,
              );
            }

            // Wait before next check
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
            elapsedTime += POLL_INTERVAL;
          } catch (error) {
            console.error("Error checking transcription status:", error);
            break;
          }
        }

        // Clean up listener
        console.log("🧹 CLEANUP: Cleaning up transcription-complete listener");
        unlistenComplete();

        if (!transcriptionComplete && elapsedTime >= MAX_WAIT_TIME) {
          console.warn(
            "⏰ Transcription wait timeout reached after",
            elapsedTime,
            "ms",
          );
        } else {
          console.log("✅ Transcription completed after", elapsedTime, "ms");
          // Wait longer for any late transcript segments (increased from 1s to 4s)
          console.log("⏳ Waiting for late transcript segments...");
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }

        // Final buffer flush: process ALL remaining transcripts regardless of timing
        const flushStartTime = Date.now();
        console.log(
          "🔄 Final buffer flush: forcing processing of any remaining transcripts...",
          {
            flush_started_at: new Date(flushStartTime).toISOString(),
            time_since_stop: flushStartTime - stopStartTime,
            current_transcript_count: transcriptsRef.current.length,
          },
        );
        setStatus(
          RecordingStatus.PROCESSING_TRANSCRIPTS,
          "Flushing transcript buffer...",
        );
        flushBuffer();
        const flushEndTime = Date.now();
        console.log("✅ Final buffer flush completed", {
          flush_duration: flushEndTime - flushStartTime,
          total_time_since_stop: flushEndTime - stopStartTime,
          final_transcript_count: transcriptsRef.current.length,
        });

        // NOTE: Status remains PROCESSING_TRANSCRIPTS until we start saving

        // Wait a bit more to ensure all transcript state updates have been processed
        console.log("Waiting for transcript state updates to complete...");
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Save to SQLite
        // NOTE: enabled to save COMPLETE transcripts after frontend receives all updates
        // This ensures user sees all transcripts streaming in before database save
        if (isCallApi && transcriptionComplete == true) {
          setStatus(RecordingStatus.SAVING, "Saving meeting to database...");

          // Get fresh transcript state (ALL transcripts including late ones).
          // Prefer the live ref, since it captures segments that arrived
          // during the transcription wait/flush above - but never fall below
          // the pre-await snapshot's count, which would mean something
          // cleared transcriptsRef.current out from under this flow.
          const freshTranscripts =
            transcriptsRef.current.length >= transcriptsSnapshot.length
              ? [...transcriptsRef.current]
              : transcriptsSnapshot;

          // Get folder_path and meeting_name from recording-stopped event
          const folderPath = sessionStorage.getItem(
            "last_recording_folder_path",
          );
          const savedMeetingName = sessionStorage.getItem(
            "last_recording_meeting_name",
          );

          console.log("💾 Saving COMPLETE transcripts to database...", {
            transcript_count: freshTranscripts.length,
            meeting_name: savedMeetingName || meetingTitle,
            folder_path: folderPath,
            sample_text:
              freshTranscripts.length > 0
                ? freshTranscripts[0].text.substring(0, 50) + "..."
                : "none",
            last_transcript:
              freshTranscripts.length > 0
                ? freshTranscripts[freshTranscripts.length - 1].text.substring(
                    0,
                    30,
                  ) + "..."
                : "none",
          });

          // Rust already created and finalised the meeting row (status,
          // transcripts, folder_path, audio) by the time `recording-stopped`
          // fired (issue #57 slice 2) — its id came along in that payload.
          // The frontend's post-stop save is now an update to the one field
          // it still owns (the title, which the live-recording view may
          // have let the user edit to something other than what recording
          // started with), not a create-and-bulk-insert. A missing
          // meeting_id means an older backend build without slice 2 — fall
          // back to the original create-and-bulk-insert path so nothing
          // breaks mid-migration.
          const meetingIdFromStop = sessionStorage.getItem(
            "last_recording_meeting_id",
          );

          try {
            const finalTitle =
              savedMeetingName || meetingTitle || "New Meeting";
            let meetingId: string;

            if (meetingIdFromStop) {
              meetingId = meetingIdFromStop;
              try {
                await storageService.finalizeMeetingTitle(
                  meetingId,
                  finalTitle,
                );
              } catch (titleError) {
                // Non-fatal: the meeting row already exists with whatever
                // title Rust set at recording start; worst case the user
                // re-titles it from the meeting detail page.
                console.warn(
                  "Failed to finalize meeting title (meeting is still saved):",
                  titleError,
                );
              }
              console.log(
                "✅ Meeting already saved by the backend; finalized title for ID:",
                meetingId,
              );
            } else {
              console.log(
                "No meeting_id in recording-stopped payload (older backend) — falling back to bulk transcript save",
              );
              const responseData = await storageService.saveMeeting(
                finalTitle,
                freshTranscripts,
                folderPath,
              );
              if (!responseData.meeting_id) {
                console.error("No meeting_id in response:", responseData);
                throw new Error("No meeting ID received from save operation");
              }
              meetingId = responseData.meeting_id;
              console.log(
                "✅ Successfully saved COMPLETE meeting with ID:",
                meetingId,
              );
            }
            console.log("   Transcripts:", freshTranscripts.length);
            console.log("   folder_path:", folderPath);

            // Fire-and-forget: kick off the post-meeting auto-refine pass
            // now that a meeting_id and folder_path both exist. Runs
            // entirely in the background on the Rust side (its own tokio
            // task) — never awaited here, and any failure to even start it
            // is non-fatal since the live transcript above is already saved.
            if (folderPath) {
              invoke("trigger_post_meeting_refine", {
                meetingId,
                meetingFolderPath: folderPath,
              }).catch((err) => {
                console.warn(
                  "Failed to start post-meeting auto-refine:",
                  err,
                );
              });
            }

            // If a calendar event was matched at recording start, link the
            // saved meeting to it now that we have a meeting_id. Failure is
            // non-fatal — the user can still link manually from the meeting
            // detail page.
            const pendingEventId = consumePendingCalendarEventId();
            if (pendingEventId) {
              try {
                await linkMeetingToCalendarEvent(meetingId, pendingEventId);
                console.log(
                  "📅 Linked meeting",
                  meetingId,
                  "to calendar event",
                  pendingEventId,
                );
              } catch (err) {
                console.warn("Failed to link meeting to calendar event:", err);
              }
            }

            // Mark meeting as saved in IndexedDB (for recovery system)
            await markMeetingAsSaved();

            // Clean up session storage
            sessionStorage.removeItem("last_recording_folder_path");
            sessionStorage.removeItem("last_recording_meeting_name");
            sessionStorage.removeItem("last_recording_meeting_id");
            // Clean up IndexedDB meeting ID (redundant with markMeetingAsSaved cleanup, but ensures cleanup)
            sessionStorage.removeItem("indexeddb_current_meeting_id");

            // Refetch meetings and set current meeting
            await refetchMeetings();

            try {
              const meetingData = await storageService.getMeeting(meetingId);
              if (meetingData) {
                setCurrentMeeting({
                  id: meetingId,
                  title: meetingData.title,
                });
                console.log("✅ Current meeting set:", meetingData.title);
              }
            } catch (error) {
              console.warn(
                "Could not fetch meeting details, using ID only:",
                error,
              );
              setCurrentMeeting({
                id: meetingId,
                title: savedMeetingName || meetingTitle || "New Meeting",
              });
            }

            // Mark as completed
            setStatus(RecordingStatus.COMPLETED);

            // Show success toast with navigation option
            toast.success("Recording saved successfully!", {
              description: `${freshTranscripts.length} transcript segments saved.`,
              action: {
                label: "View Meeting",
                onClick: () => {
                  router.push(`/meeting-details?id=${meetingId}`);
                },
              },
              duration: 10000,
            });

            // Auto-navigate after a short delay with source parameter
            setTimeout(() => {
              router.push(`/meeting-details?id=${meetingId}&source=recording`);
              clearTranscripts();

              // Reset to IDLE after navigation
              setStatus(RecordingStatus.IDLE);
            }, 2000);
          } catch (saveError) {
            console.error("Failed to save meeting to database:", saveError);
            setStatus(
              RecordingStatus.ERROR,
              saveError instanceof Error ? saveError.message : "Unknown error",
            );
            toast.error("Failed to save meeting", {
              description:
                saveError instanceof Error
                  ? saveError.message
                  : "Unknown error",
            });
            throw saveError;
          }
        } else {
          // No save needed, go back to IDLE
          setStatus(RecordingStatus.IDLE);
        }

        setIsMeetingActive(false);
        // isRecording already set to false at function start
        setIsRecordingDisabled(false);
      } catch (error) {
        console.error("Error in handleRecordingStop:", error);
        setStatus(RecordingStatus.ERROR, getErrorMessage(error));
        // isRecording already set to false at function start
        setIsRecordingDisabled(false);
      } finally {
        // Always reset the guard flags when done
        stopInProgressRef.current = false;
        isPostProcessingRef.current = false;
      }
    },
    [
      setIsRecording,
      setIsRecordingDisabled,
      setStatus,
      stopInProgressRef,
      transcriptsRef,
      flushBuffer,
      clearTranscripts,
      meetingTitle,
      markMeetingAsSaved,
      refetchMeetings,
      setCurrentMeeting,
      setIsMeetingActive,
      router,
    ],
  );

  // Expose handleRecordingStop function to window for Rust callbacks
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    (window as any).handleRecordingStop = (callApi: boolean = true) => {
      handleRecordingStopRef.current(callApi);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).handleRecordingStop;
    };
  }, []);

  // Derive summaryStatus from RecordingStatus for backward compatibility
  const summaryStatus: SummaryStatus =
    status === RecordingStatus.PROCESSING_TRANSCRIPTS ? "processing" : "idle";

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
