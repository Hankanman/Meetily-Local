"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { Page } from "@/components/layout/Page";
import {
  useRecordingState,
  RecordingStatus,
} from "@/contexts/RecordingStateContext";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useConfig } from "@/contexts/ConfigContext";
import { useModalState } from "@/hooks/useModalState";
import { useRecordingStateSync } from "@/hooks/useRecordingStateSync";
import { useRecordingStart } from "@/hooks/useRecordingStart";
import { useRecordingStop } from "@/hooks/useRecordingStop";
import { useTranscriptRecovery } from "@/hooks/useTranscriptRecovery";
import { TranscriptRecovery } from "@/components/TranscriptRecovery";
import { indexedDBService } from "@/services/indexedDBService";
import { getErrorMessage } from "@/lib/utils";

import { StatusOverlays } from "@/app/_components/StatusOverlays";
import { SettingsModals } from "./_components/SettingsModal";
import { TranscriptPanel } from "./_components/TranscriptPanel";
import { RecordingHero } from "./_components/recording-page/RecordingHero";
import { RecordingTopBar } from "./_components/recording-page/RecordingTopBar";

export default function Home() {
  const router = useRouter();
  const recordingState = useRecordingState();
  const { transcriptModelConfig } = useConfig();
  const { setIsMeetingActive, refetchMeetings } = useSidebar();
  const { modals, messages, showModal, hideModal } =
    useModalState(transcriptModelConfig);

  const { status, isStopping, isProcessing, isSaving } = recordingState;

  // Page-local mirror of `isRecording`. The cross-cutting hook below keeps
  // this in sync with the global recording-state context (the "page only
  // updates after a successful Tauri response" semantic that several
  // call-sites depend on).
  const [isRecording, setIsRecordingState] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const { isRecordingDisabled, setIsRecordingDisabled } = useRecordingStateSync(
    isRecording,
    setIsRecordingState,
    setIsMeetingActive,
  );
  const { handleRecordingStart } = useRecordingStart(
    isRecording,
    setIsRecordingState,
    showModal,
  );
  const { handleRecordingStop, setIsStopping } = useRecordingStop(
    setIsRecordingState,
    setIsRecordingDisabled,
  );

  // Recovery
  const {
    recoverableMeetings,
    isRecovering: _isRecovering,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting,
  } = useTranscriptRecovery();
  void _isRecovering;

  // Startup checks (cleanup + recovery dialog) — same intent as the
  // previous version, just lifted into this composer.
  useEffect(() => {
    (async () => {
      try {
        if (
          recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING
        ) {
          return;
        }
        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (err) {
          console.warn("Failed to clean up old meetings:", err);
        }
        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (err) {
          console.warn("Failed to clean up saved meetings:", err);
        }
        const meetings = await checkForRecoverableTranscripts();
        if (
          meetings.length > 0 &&
          !sessionStorage.getItem("recovery_dialog_shown")
        ) {
          setShowRecoveryDialog(true);
          sessionStorage.setItem("recovery_dialog_shown", "true");
        }
      } catch (err) {
        console.error("Startup checks failed:", err);
      }
    })();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  const handleStartClick = async () => {
    if (isRecordingDisabled || isRecording || isStarting) return;
    setIsStarting(true);
    try {
      await handleRecordingStart();
    } finally {
      setIsStarting(false);
    }
  };

  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);
      if (result.success) {
        toast.success("Meeting recovered successfully!", {
          description:
            result.audioRecoveryStatus?.status === "success"
              ? "Transcripts and audio recovered"
              : "Transcripts recovered (no audio available)",
          action: result.meetingId
            ? {
                label: "View Meeting",
                onClick: () =>
                  router.push(`/meeting-details?id=${result.meetingId}`),
              }
            : undefined,
          duration: 10000,
        });
        await refetchMeetings();
        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem("recovery_dialog_shown");
        }
        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          }, 2000);
        }
      }
    } catch (err) {
      toast.error("Failed to recover meeting", {
        description: getErrorMessage(err),
      });
      throw err;
    }
  };

  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem("recovery_dialog_shown");
    }
  };

  // Surface backend transcription errors as page-level modals — the
  // legacy `RecordingControls` did this internally; we pulled it up here
  // when the new top bar replaced it.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<{ message?: string; error?: string }>(
          "transcript-error",
          (event) => {
            const message =
              event.payload?.message ??
              event.payload?.error ??
              "Transcription error";
            showModal("errorAlert", message);
          },
        );
      } catch (err) {
        console.error("Failed to subscribe to transcript-error:", err);
      }
    })();
    return () => unlisten?.();
  }, [showModal]);

  // Auto-start hook: the sidebar may set this flag right before pushing
  // the user to home, asking us to start a recording immediately on
  // mount. Same protocol as the legacy implementation.
  useEffect(() => {
    if (sessionStorage.getItem("autoStartRecording") === "true") {
      sessionStorage.removeItem("autoStartRecording");
      void handleStartClick();
    }
    const onSidebarStart = () => {
      void handleStartClick();
    };
    window.addEventListener("start-recording-from-sidebar", onSidebarStart);
    return () =>
      window.removeEventListener(
        "start-recording-from-sidebar",
        onSidebarStart,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isProcessingStop =
    status === RecordingStatus.PROCESSING_TRANSCRIPTS || isProcessing;
  const isFinalising =
    status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
    status === RecordingStatus.SAVING ||
    isSaving;

  return (
    <Page>
      <SettingsModals modals={modals} messages={messages} onClose={hideModal} />

      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {!isRecording && !isFinalising ? (
            <motion.div
              key="hero"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="flex min-h-0 flex-1 overflow-y-auto"
            >
              <RecordingHero
                onStart={handleStartClick}
                isStarting={isStarting || isRecordingDisabled}
              />
            </motion.div>
          ) : (
            <motion.div
              key="recording"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              {isRecording && (
                <RecordingTopBar
                  isStopping={isStopping}
                  onStop={(callApi = true) => handleRecordingStop(callApi)}
                  onStopInitiated={() => setIsStopping(true)}
                />
              )}
              <TranscriptPanel
                isProcessingStop={isProcessingStop}
                isStopping={isStopping}
                showModal={showModal}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <StatusOverlays
        isProcessing={
          status === RecordingStatus.PROCESSING_TRANSCRIPTS &&
          !recordingState.isRecording
        }
        isSaving={status === RecordingStatus.SAVING}
      />
    </Page>
  );
}
