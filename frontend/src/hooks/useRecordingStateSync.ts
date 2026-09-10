import { useEffect, useState } from "react";
import { useRecordingState } from "@/contexts/RecordingStateContext";

interface UseRecordingStateSyncReturn {
  isBackendRecording: boolean;
  isRecordingDisabled: boolean;
  setIsRecordingDisabled: (value: boolean) => void;
}

/**
 * Thin adapter between page.tsx's page-local `isRecording` mirror and
 * RecordingStateContext's `isRecording` (the single source of truth, kept in
 * sync with the backend's canonical recording-state machine via the
 * `recording-state` event plus a one-shot resync on mount/focus - see
 * `contexts/RecordingStateContext.tsx`. Issue #57 slice 1 removed the
 * previous 500ms poll entirely).
 *
 * Previously this hook ran its own unconditional 1-second backend poll for
 * the entire lifetime of the home page, duplicating the context's polling
 * (issue #51). It now just reacts to the context's already-synced value -
 * no interval of its own.
 */
export function useRecordingStateSync(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  setIsMeetingActive: (value: boolean) => void,
): UseRecordingStateSyncReturn {
  const { isRecording: backendIsRecording } = useRecordingState();
  const [isRecordingDisabled, setIsRecordingDisabled] = useState(false);

  useEffect(() => {
    if (backendIsRecording && !isRecording) {
      setIsRecording(true);
      setIsMeetingActive(true);
    } else if (!backendIsRecording && isRecording) {
      setIsRecording(false);
    }
  }, [backendIsRecording, isRecording, setIsRecording, setIsMeetingActive]);

  return {
    isBackendRecording: isRecording,
    isRecordingDisabled,
    setIsRecordingDisabled,
  };
}
