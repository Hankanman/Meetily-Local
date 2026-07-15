import { VirtualizedTranscriptView } from "@/components/VirtualizedTranscriptView";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Copy, GlobeIcon } from "lucide-react";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { ModalType } from "@/hooks/useModalState";
import { useMemo } from "react";

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal,
}: TranscriptPanelProps) {
  // Contexts
  const {
    transcripts,
    transcriptContainerRef,
    copyTranscript,
    currentMeetingId,
    partials,
  } = useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(
    () =>
      transcripts.map((t) => ({
        id: t.id,
        timestamp: t.audio_start_time ?? 0,
        endTime: t.audio_end_time,
        text: t.text,
        confidence: t.confidence,
      })),
    [transcripts],
  );

  return (
    <div
      ref={transcriptContainerRef}
      className="
        flex w-full flex-col overflow-y-auto border-r border-border
        bg-background
      "
    >
      {/* Title area - Sticky header */}
      <div className="sticky top-0 z-10 border-border bg-background p-4">
        <div className="flex flex-col space-y-3">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-center space-x-2">
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="Copy Transcript"
                  >
                    <Copy />
                    <span
                      className="
                      hidden
                      md:inline
                    "
                    >
                      Copy
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal("languageSettings")}
                    title="Language"
                  >
                    <GlobeIcon />
                    <span
                      className="
                      hidden
                      md:inline
                    "
                    >
                      Language
                    </span>
                  </Button>
                )}
              </ButtonGroup>
            </div>
          </div>
        </div>
      </div>

      {/* Transcript content */}
      <div className="pb-20">
        <div className="flex justify-center">
          <div className="w-2/3 max-w-187.5">
            <VirtualizedTranscriptView
              segments={segments}
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessingStop}
              isStopping={isStopping}
              enableStreaming={isRecording}
              showConfidence={true}
              meetingId={currentMeetingId ?? undefined}
              partials={partials}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
