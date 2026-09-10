"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  ReactNode,
  MutableRefObject,
} from "react";
import { Transcript, TranscriptUpdate, TranscriptPartialUpdate } from "@/types";
import { toast } from "sonner";
import { useRecordingState } from "./RecordingStateContext";
import { transcriptService } from "@/services/transcriptService";
import { recordingService } from "@/services/recordingService";
import { indexedDBService } from "@/services/indexedDBService";
import { upsertSorted } from "@/lib/transcriptOrder";
import { debugLog } from "@/lib/debugLog";
import {
  TranscriptPartialsProvider,
  useTranscriptPartials,
} from "./TranscriptPartialsContext";

interface TranscriptContextType {
  transcripts: Transcript[];
  transcriptsRef: MutableRefObject<Transcript[]>;
  addTranscript: (update: TranscriptUpdate) => void;
  copyTranscript: () => void;
  flushBuffer: () => void;
  transcriptContainerRef: React.RefObject<HTMLDivElement | null>;
  meetingTitle: string;
  setMeetingTitle: (title: string) => void;
  clearTranscripts: () => void;
  currentMeetingId: string | null;
  markMeetingAsSaved: () => Promise<void>;
}

const TranscriptContext = createContext<TranscriptContextType | undefined>(
  undefined,
);

// Batch IndexedDB writes for finalised segments: queue them and flush every
// ~1s or once 20 accumulate, instead of one transaction per segment.
const SAVE_BATCH_SIZE = 20;
const SAVE_BATCH_INTERVAL_MS = 1000;

export function TranscriptProvider({ children }: { children: ReactNode }) {
  return (
    <TranscriptPartialsProvider>
      <TranscriptProviderInner>{children}</TranscriptProviderInner>
    </TranscriptPartialsProvider>
  );
}

function TranscriptProviderInner({ children }: { children: ReactNode }) {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [meetingTitle, setMeetingTitle] = useState("+ New Call");
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);

  // Ephemeral streaming preview overlay (transcript-partial events) now
  // lives in its own context so its high-frequency updates don't re-render
  // committed-transcript consumers of this context.
  const { setPartialForSource, clearPartials } = useTranscriptPartials();

  // Recording state context - provides backend-synced state
  const recordingState = useRecordingState();

  // Refs for transcript management
  const transcriptsRef = useRef<Transcript[]>(transcripts);
  const isUserAtBottomRef = useRef<boolean>(true);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const finalFlushRef = useRef<(() => void) | null>(null);
  // Flushes any queued (not-yet-persisted) IndexedDB segment batch.
  // Populated by the main listener effect; called from the
  // recording-started/stopped effect and on unmount.
  const flushSaveQueueRef = useRef<(() => void) | null>(null);

  // Keep ref updated with current transcripts
  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  // Smart auto-scroll: Track user scroll position
  useEffect(() => {
    const handleScroll = () => {
      const container = transcriptContainerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px tolerance
      isUserAtBottomRef.current = isAtBottom;
    };

    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, []);

  // Auto-scroll when transcripts change (only if user is at bottom)
  useEffect(() => {
    // Only auto-scroll if user was at the bottom before new content
    if (isUserAtBottomRef.current && transcriptContainerRef.current) {
      // Wait for Framer Motion animation to complete (150ms) before scrolling
      // This ensures scrollHeight includes the full rendered height of the new transcript
      const scrollTimeout = setTimeout(() => {
        const container = transcriptContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 150); // Match Framer Motion transition duration

      return () => clearTimeout(scrollTimeout);
    }
  }, [transcripts]);

  // Initialize IndexedDB and listen for recording-started/stopped events
  useEffect(() => {
    let unlistenRecordingStarted: (() => void) | undefined;
    let unlistenRecordingStopped: (() => void) | undefined;

    const setupRecordingListeners = async () => {
      try {
        // Initialize IndexedDB
        await indexedDBService.init();

        // Listen for recording-started event. Rust now creates the
        // `meetings` row itself at recording start (issue #57 slice 2) and
        // hands back its id in the payload — use that directly as the key
        // for the IndexedDB write-ahead cache below instead of minting a
        // separate IndexedDB-only id and duplicating meeting metadata
        // (title/folder_path/status) that SQLite already owns.
        unlistenRecordingStarted = await recordingService.onRecordingStarted(
          async (payload) => {
            try {
              // Talking to an older backend build with no meeting_id in the
              // payload falls back to a local-only cache key so the
              // write-ahead cache below still works, just unkeyed to a real
              // meeting row.
              const meetingId = payload.meeting_id ?? `meeting-${Date.now()}`;
              setCurrentMeetingId(meetingId);
              // Fallback for markMeetingAsSaved if this provider instance
              // unmounts/remounts mid-recording.
              sessionStorage.setItem("indexeddb_current_meeting_id", meetingId);

              // Get meeting name
              const meetingName =
                await recordingService.getRecordingMeetingName();

              // Use a better fallback that matches the backend's naming pattern
              const effectiveTitle =
                meetingName ||
                `Meeting ${new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-")}`;

              // Synchronize meeting title to state (fixes tray stop title issue)
              setMeetingTitle(effectiveTitle);

              // A slim metadata row, kept only so the periodic janitors
              // below (deleteOldMeetings/deleteSavedMeetings) have
              // something to key their pruning off of — SQLite (via
              // `payload.meeting_id`'s row) is the source of truth for
              // everything else about this meeting now, so this no longer
              // round-trips to fetch/store folder_path or track
              // savedToSQLite for recovery purposes.
              await indexedDBService.saveMeetingMetadata({
                meetingId,
                title: effectiveTitle,
                startTime: Date.now(),
                lastUpdated: Date.now(),
                transcriptCount: 0,
                savedToSQLite: false,
              });
            } catch (error) {
              console.error(
                "Failed to initialize meeting state on recording-started:",
                error,
              );
            }
          },
        );

        // Listen for recording-stopped event
        unlistenRecordingStopped = await recordingService.onRecordingStopped(
          async () => {
            // Recording has ended - there is no "finishing" utterance left
            // to preview, so drop any in-flight partial previews.
            clearPartials();

            // Nothing left to accumulate - flush anything still queued so
            // it isn't lost before the meeting gets marked saved. Rust
            // already owns folder_path/status on the meeting row itself
            // (issue #57 slice 2), so there's no IndexedDB metadata to
            // reconcile here any more.
            flushSaveQueueRef.current?.();
          },
        );
      } catch (error) {
        console.error("Failed to setup recording listeners:", error);
      }
    };

    setupRecordingListeners();

    return () => {
      if (unlistenRecordingStarted) {
        unlistenRecordingStarted();
        console.log("🧹 Recording started listener cleaned up");
      }
      if (unlistenRecordingStopped) {
        unlistenRecordingStopped();
        console.log("🧹 Recording stopped listener cleaned up");
      }
    };
  }, [currentMeetingId, clearPartials]);

  // Main transcript buffering logic with sequence_id ordering
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let transcriptCounter = 0;
    const transcriptBuffer = new Map<number, Transcript>();
    let lastProcessedSequence = 0;
    let processingTimer: NodeJS.Timeout | undefined;

    // Queue of finalised segments awaiting a batched IndexedDB write.
    let saveQueue: TranscriptUpdate[] = [];
    let saveFlushTimer: NodeJS.Timeout | undefined;

    const flushSaveQueue = () => {
      if (saveFlushTimer) {
        clearTimeout(saveFlushTimer);
        saveFlushTimer = undefined;
      }
      if (saveQueue.length === 0 || !currentMeetingId) return;
      const batch = saveQueue;
      saveQueue = [];
      indexedDBService
        .saveTranscripts(currentMeetingId, batch)
        .catch((err) => console.warn("IndexedDB batch save failed:", err));
    };
    flushSaveQueueRef.current = flushSaveQueue;

    const queueForSave = (update: TranscriptUpdate) => {
      saveQueue.push(update);
      if (saveQueue.length >= SAVE_BATCH_SIZE) {
        flushSaveQueue();
        return;
      }
      if (!saveFlushTimer) {
        saveFlushTimer = setTimeout(flushSaveQueue, SAVE_BATCH_INTERVAL_MS);
      }
    };

    const processBufferedTranscripts = (forceFlush = false) => {
      const sortedTranscripts: Transcript[] = [];

      // Process all available sequential transcripts
      let nextSequence = lastProcessedSequence + 1;
      while (transcriptBuffer.has(nextSequence)) {
        const bufferedTranscript = transcriptBuffer.get(nextSequence)!;
        sortedTranscripts.push(bufferedTranscript);
        transcriptBuffer.delete(nextSequence);
        lastProcessedSequence = nextSequence;
        nextSequence++;
      }

      // Add any buffered transcripts that might be out of order
      const now = Date.now();
      const staleThreshold = 100; // 100ms safety net only (serial workers = sequential order)
      const recentThreshold = 0; // Show immediately - no delay needed with serial processing
      const staleTranscripts: Transcript[] = [];
      const recentTranscripts: Transcript[] = [];
      const forceFlushTranscripts: Transcript[] = [];

      for (const [sequenceId, transcript] of transcriptBuffer.entries()) {
        if (forceFlush) {
          // Force flush mode: process ALL remaining transcripts regardless of timing
          forceFlushTranscripts.push(transcript);
          transcriptBuffer.delete(sequenceId);
          debugLog(
            `Force flush: processing transcript with sequence_id ${sequenceId}`,
          );
        } else {
          const transcriptAge = now - parseInt(transcript.id.split("-")[0]);
          if (transcriptAge > staleThreshold) {
            // Process stale transcripts (>100ms old - safety net)
            staleTranscripts.push(transcript);
            transcriptBuffer.delete(sequenceId);
          } else if (transcriptAge >= recentThreshold) {
            // Process immediately (0ms threshold with serial workers)
            recentTranscripts.push(transcript);
            transcriptBuffer.delete(sequenceId);
            debugLog(
              `Processing transcript with sequence_id ${sequenceId}, age: ${transcriptAge}ms`,
            );
          }
        }
      }

      // Order within each bucket doesn't matter here — each item is
      // individually inserted into the already-sorted `transcripts` array
      // below via binary search (see transcriptOrder.ts), rather than
      // re-sorting the whole combined array.
      const allNewTranscripts = [
        ...sortedTranscripts,
        ...recentTranscripts,
        ...staleTranscripts,
        ...forceFlushTranscripts,
      ];

      if (allNewTranscripts.length > 0) {
        setTranscripts((prev) => {
          // Create a set of existing sequence_ids for deduplication
          const existingSequenceIds = new Set(
            prev.map((t) => t.sequence_id).filter((id) => id !== undefined),
          );

          // Filter out any new transcripts that already exist
          const uniqueNewTranscripts = allNewTranscripts.filter(
            (transcript) =>
              transcript.sequence_id !== undefined &&
              !existingSequenceIds.has(transcript.sequence_id),
          );

          // Only combine if we have unique new transcripts
          if (uniqueNewTranscripts.length === 0) {
            debugLog("No unique transcripts to add - all were duplicates");
            return prev; // No new unique transcripts to add
          }

          debugLog(
            `Adding ${uniqueNewTranscripts.length} unique transcripts out of ${allNewTranscripts.length} received`,
          );

          // Insert each into the already-sorted array via binary search
          // (audio_start_time, falling back to chunk_start_time, then
          // sequence_id) instead of re-sorting the whole array.
          let result = prev;
          for (const transcript of uniqueNewTranscripts) {
            result = upsertSorted(result, transcript);
          }
          return result;
        });

        // Log the processing summary
        const logMessage = forceFlush
          ? `Force flush processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${forceFlushTranscripts.length} forced)`
          : `Processed ${allNewTranscripts.length} transcripts (${sortedTranscripts.length} sequential, ${recentTranscripts.length} recent, ${staleTranscripts.length} stale)`;
        debugLog(logMessage);
      }
    };

    // Assign final flush function to ref for external access
    finalFlushRef.current = () => processBufferedTranscripts(true);

    const setupListener = async () => {
      try {
        debugLog(
          "🔥 Setting up MAIN transcript listener during component initialization...",
        );
        unlistenFn = await transcriptService.onTranscriptUpdate((update) => {
          const now = Date.now();
          debugLog("🎯 MAIN LISTENER: Received transcript update:", {
            sequence_id: update.sequence_id,
            text: update.text.substring(0, 50) + "...",
            timestamp: update.timestamp,
            is_partial: update.is_partial,
            received_at: new Date(now).toISOString(),
            buffer_size_before: transcriptBuffer.size,
          });

          // The final for this source has arrived - it's the authoritative
          // handoff, so drop that source's in-progress preview immediately
          // (regardless of dedup/buffering below - the preview is stale
          // either way once a final for the same source shows up).
          const finalSource = update.source === "mic" || update.source === "system"
            ? update.source
            : undefined;
          if (finalSource) {
            setPartialForSource(finalSource, undefined);
          }

          // Check for duplicate sequence_id before processing
          if (transcriptBuffer.has(update.sequence_id)) {
            debugLog(
              "🚫 MAIN LISTENER: Duplicate sequence_id, skipping buffer:",
              update.sequence_id,
            );
            return;
          }

          // Create transcript for buffer with NEW timestamp fields
          const newTranscript: Transcript = {
            id: `${Date.now()}-${transcriptCounter++}`,
            text: update.text,
            timestamp: update.timestamp,
            sequence_id: update.sequence_id,
            chunk_start_time: update.chunk_start_time,
            is_partial: update.is_partial,
            confidence: update.confidence,
            // Recording-relative timestamps for playback sync
            audio_start_time: update.audio_start_time,
            audio_end_time: update.audio_end_time,
            duration: update.duration,
            // Speaker attribution from source-tagged VAD pipeline / diarizer
            speaker: update.speaker,
            voice_profile_id: update.voice_profile_id,
          };

          // Add to buffer
          transcriptBuffer.set(update.sequence_id, newTranscript);
          debugLog(
            `✅ MAIN LISTENER: Buffered transcript with sequence_id ${update.sequence_id}. Buffer size: ${transcriptBuffer.size}, Last processed: ${lastProcessedSequence}`,
          );

          // Queue for a batched IndexedDB write (non-blocking)
          if (currentMeetingId) {
            queueForSave(update);
          }

          // Clear any existing timer and set a new one
          if (processingTimer) {
            clearTimeout(processingTimer);
          }

          // Process buffer with minimal delay for immediate UI updates (serial workers = sequential order)
          processingTimer = setTimeout(processBufferedTranscripts, 10);
        });
        debugLog("✅ MAIN transcript listener setup complete");
      } catch (error) {
        console.error("❌ Failed to setup MAIN transcript listener:", error);
        toast.error(
          "Failed to start live transcription. Try restarting the recording.",
        );
      }
    };

    setupListener();
    debugLog("Started enhanced listener setup");

    return () => {
      debugLog("🧹 CLEANUP: Cleaning up MAIN transcript listener...");
      if (processingTimer) {
        clearTimeout(processingTimer);
        debugLog("🧹 CLEANUP: Cleared processing timer");
      }
      // Flush anything still queued so nothing is lost on unmount / when
      // currentMeetingId changes and this effect re-runs.
      flushSaveQueue();
      if (unlistenFn) {
        unlistenFn();
        debugLog("🧹 CLEANUP: MAIN transcript listener cleaned up");
      }
    };
  }, [currentMeetingId, setPartialForSource]); // Add currentMeetingId dependency

  // Streaming partial-transcription preview listener. Single registration,
  // cleaned up on unmount. This is a pure overlay: it never writes to
  // `transcripts`, IndexedDB, or the sequence_id buffer above - only to the
  // ephemeral partials context.
  useEffect(() => {
    let unlistenPartial: (() => void) | undefined;

    const setupPartialListener = async () => {
      try {
        unlistenPartial = await transcriptService.onTranscriptPartial(
          (update: TranscriptPartialUpdate) => {
            const source =
              update.source === "mic" || update.source === "system"
                ? update.source
                : undefined;
            if (!source) return;

            // Empty text clears the source's partial (explicit clear, or
            // a new utterance that hasn't produced stabilized text yet).
            if (!update.text) {
              setPartialForSource(source, undefined);
              return;
            }
            setPartialForSource(source, {
              text: update.text,
              utterance_id: update.utterance_id,
            });
          },
        );
      } catch (error) {
        console.error("Failed to setup transcript-partial listener:", error);
      }
    };

    setupPartialListener();

    return () => {
      if (unlistenPartial) {
        unlistenPartial();
      }
    };
  }, [setPartialForSource]);

  // Sync transcript history and meeting name from backend on reload
  // This fixes the issue where reloading during active recording causes state desync
  useEffect(() => {
    const syncFromBackend = async () => {
      // If recording is active and we have no local transcripts, sync from backend
      if (recordingState.isRecording && transcripts.length === 0) {
        try {
          console.log(
            "[Reload Sync] Recording active after reload, syncing transcript history...",
          );

          // Fetch transcript history from backend
          const history = await transcriptService.getTranscriptHistory();
          console.log(
            `[Reload Sync] Retrieved ${history.length} transcript segments from backend`,
          );

          // Convert backend format to frontend Transcript format
          const formattedTranscripts: Transcript[] = history.map(
            (segment: any) => ({
              id: segment.id,
              text: segment.text,
              timestamp: segment.display_time, // Use display_time for UI
              sequence_id: segment.sequence_id,
              chunk_start_time: segment.audio_start_time,
              is_partial: false, // History segments are always final
              confidence: segment.confidence,
              audio_start_time: segment.audio_start_time,
              audio_end_time: segment.audio_end_time,
              duration: segment.duration,
              speaker: segment.speaker,
              voice_profile_id: segment.voice_profile_id,
            }),
          );

          setTranscripts(formattedTranscripts);
          console.log(
            "[Reload Sync] ✅ Transcript history synced successfully",
          );

          // Fetch meeting name from backend
          const meetingName = await recordingService.getRecordingMeetingName();
          if (meetingName) {
            console.log("[Reload Sync] Retrieved meeting name:", meetingName);
            setMeetingTitle(meetingName);
            console.log("[Reload Sync] ✅ Meeting title synced successfully");
          }
        } catch (error) {
          console.error("[Reload Sync] Failed to sync from backend:", error);
        }
      }
    };

    syncFromBackend();
    // We intentionally don't depend on transcripts.length: this effect should
    // only re-run when recording state flips, not whenever we receive a transcript
    // (which would re-sync mid-recording and clobber local state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingState.isRecording]);

  // Flush any queued IndexedDB writes on unmount so nothing is lost.
  useEffect(() => {
    return () => {
      flushSaveQueueRef.current?.();
    };
  }, []);

  // Manual transcript update handler (for RecordingControls component)
  const addTranscript = useCallback((update: TranscriptUpdate) => {
    debugLog("🎯 addTranscript called with:", {
      sequence_id: update.sequence_id,
      text: update.text.substring(0, 50) + "...",
      timestamp: update.timestamp,
      is_partial: update.is_partial,
    });

    const newTranscript: Transcript = {
      id: update.sequence_id
        ? update.sequence_id.toString()
        : Date.now().toString(),
      text: update.text,
      timestamp: update.timestamp,
      sequence_id: update.sequence_id || 0,
      chunk_start_time: update.chunk_start_time,
      is_partial: update.is_partial,
      confidence: update.confidence,
      audio_start_time: update.audio_start_time,
      audio_end_time: update.audio_end_time,
      duration: update.duration,
      speaker: update.speaker,
      voice_profile_id: update.voice_profile_id,
    };

    setTranscripts((prev) => {
      debugLog("📊 Current transcripts count before update:", prev.length);

      // Check if this transcript already exists
      const exists = prev.some(
        (t) => t.text === update.text && t.timestamp === update.timestamp,
      );
      if (exists) {
        debugLog(
          "🚫 Duplicate transcript detected, skipping:",
          update.text.substring(0, 30) + "...",
        );
        return prev;
      }

      // Insert into the already-sorted array via binary search
      // (audio_start_time, falling back to chunk_start_time, then
      // sequence_id) to maintain chronological order.
      const sorted = upsertSorted(prev, newTranscript);

      debugLog("✅ Added new transcript. New count:", sorted.length);
      debugLog("📝 Latest transcript:", {
        id: newTranscript.id,
        text: newTranscript.text.substring(0, 30) + "...",
        sequence_id: newTranscript.sequence_id,
      });

      return sorted;
    });
  }, []);

  // Copy transcript to clipboard with recording-relative timestamps
  const copyTranscript = useCallback(() => {
    // Format timestamps as recording-relative [MM:SS] instead of wall-clock time
    const formatTime = (seconds: number | undefined): string => {
      if (seconds === undefined) return "[--:--]";
      const totalSecs = Math.floor(seconds);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `[${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
    };

    const fullTranscript = transcripts
      .map((t) => `${formatTime(t.audio_start_time)} ${t.text}`)
      .join("\n");
    navigator.clipboard.writeText(fullTranscript);

    toast.success("Transcript copied to clipboard");
  }, [transcripts]);

  // Force flush buffer (for final transcript processing)
  const flushBuffer = useCallback(() => {
    if (finalFlushRef.current) {
      console.log("🔄 Flushing transcript buffer...");
      finalFlushRef.current();
    }
  }, []);

  // Clear transcripts (used when starting new recording)
  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    // Don't clear currentMeetingId here - it will be set by recording-started event
  }, []);

  // Mark current meeting as saved in IndexedDB
  const markMeetingAsSaved = useCallback(async () => {
    // Try context state first, fallback to sessionStorage
    const meetingId =
      currentMeetingId ||
      sessionStorage.getItem("indexeddb_current_meeting_id");

    if (!meetingId) {
      console.error(
        "[IndexedDB] ❌ Cannot mark meeting as saved: No meeting ID available!",
      );
      console.error("[IndexedDB] currentMeetingId:", currentMeetingId);
      console.error(
        "[IndexedDB] sessionStorage:",
        sessionStorage.getItem("indexeddb_current_meeting_id"),
      );
      return;
    }

    try {
      await indexedDBService.markMeetingSaved(meetingId);

      // Clear both sources
      setCurrentMeetingId(null);
      sessionStorage.removeItem("indexeddb_current_meeting_id");
    } catch (error) {
      console.error("[IndexedDB] ❌ Failed to mark meeting as saved:", error);
    }
  }, [currentMeetingId]);

  const value: TranscriptContextType = useMemo(
    () => ({
      transcripts,
      transcriptsRef,
      addTranscript,
      copyTranscript,
      flushBuffer,
      transcriptContainerRef,
      meetingTitle,
      setMeetingTitle,
      clearTranscripts,
      currentMeetingId,
      markMeetingAsSaved,
    }),
    [
      transcripts,
      addTranscript,
      copyTranscript,
      flushBuffer,
      meetingTitle,
      clearTranscripts,
      currentMeetingId,
      markMeetingAsSaved,
    ],
  );

  return (
    <TranscriptContext.Provider value={value}>
      {children}
    </TranscriptContext.Provider>
  );
}

export function useTranscripts() {
  const context = useContext(TranscriptContext);
  if (context === undefined) {
    throw new Error("useTranscripts must be used within a TranscriptProvider");
  }
  return context;
}
