"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Spinner } from "@/components/ui/spinner";
import { Copy, FolderOpen, RefreshCw, Sparkles, Users } from "lucide-react";
import { RetranscribeDialog } from "./RetranscribeDialog";
import { useConfig } from "@/contexts/ConfigContext";
import { useMeetingRefinedStatus } from "@/hooks/meeting-details/useMeetingRefinedStatus";
import { useSpeakersRefined } from "@/hooks/meeting-details/useSpeakersRefined";

interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  onOpenMeetingFolder,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptButtonGroupProps) {
  const { betaFeatures } = useConfig();
  const [showRetranscribeDialog, setShowRetranscribeDialog] = useState(false);

  const handleRetranscribeComplete = useCallback(async () => {
    // Refetch transcripts to show the updated data
    if (onRefetchTranscripts) {
      await onRefetchTranscripts();
    }
  }, [onRefetchTranscripts]);

  // Passive post-meeting auto-refine indicator: tracks the background
  // high-accuracy re-pass (see spawn_auto_refine on the Rust side) without
  // any user action. On completion, silently refetch so the upgraded
  // transcript replaces the fast live one.
  const refinedStatus = useMeetingRefinedStatus(meetingId, onRefetchTranscripts);

  // Passive post-meeting speaker-refinement indicator: the offline
  // re-clustering pass (see refine_and_persist on the Rust side) rewrites
  // speaker labels in the saved transcript, so reload to pick them up.
  // Only fires when rows actually changed.
  const speakersRefinedCount = useSpeakersRefined(
    meetingId,
    onRefetchTranscripts,
  );

  return (
    <div className="flex w-full items-center justify-center gap-2">
      {speakersRefinedCount > 0 && (
        <span
          className="
            inline-flex shrink-0 items-center gap-1 rounded-full border
            border-border bg-background px-2 py-0.5 text-xs
            text-muted-foreground
          "
          title={`Speaker grouping improved across ${speakersRefinedCount} ${
            speakersRefinedCount === 1 ? "segment" : "segments"
          } after recording`}
        >
          <Users className="size-3" />
          <span className="hidden lg:inline">Speakers refined</span>
        </span>
      )}
      {refinedStatus === "refining" && (
        <span
          className="
            inline-flex shrink-0 items-center gap-1 rounded-full border
            border-border bg-background px-2 py-0.5 text-xs
            text-muted-foreground
          "
          title="Re-processing this meeting's audio with a higher-accuracy model"
        >
          <Spinner size="sm" />
          <span className="hidden lg:inline">Refining transcript…</span>
        </span>
      )}
      {refinedStatus === "refined" && (
        <span
          className="
            inline-flex shrink-0 items-center gap-1 rounded-full border
            border-info/30 bg-linear-to-r from-blue-600/10 to-purple-600/10
            px-2 py-0.5 text-xs text-foreground
          "
          title="Automatically upgraded to a higher-accuracy transcript after recording"
        >
          <Sparkles className="size-3 text-info" />
          <span className="hidden lg:inline">Refined</span>
        </span>
      )}
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          onClick={onCopyTranscript}
          disabled={transcriptCount === 0}
          title={
            transcriptCount === 0
              ? "No transcript available"
              : "Copy Transcript"
          }
        >
          <Copy />
          <span className="
            hidden
            lg:inline
          ">Copy</span>
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="xl:px-4"
          onClick={onOpenMeetingFolder}
          title="Open Recording Folder"
        >
          <FolderOpen className="xl:mr-2" size={18} />
          <span className="
            hidden
            lg:inline
          ">Recording</span>
        </Button>

        {betaFeatures.importAndRetranscribe &&
          meetingId &&
          meetingFolderPath && (
            <Button
              size="sm"
              variant="outline"
              className="
                border-info/30 bg-linear-to-r from-blue-600/10
                to-purple-600/10
                hover:from-blue-600/20 hover:to-purple-600/20
                xl:px-4
              "
              onClick={() => setShowRetranscribeDialog(true)}
              title="Retranscribe to enhance your recorded audio"
            >
              <RefreshCw className="xl:mr-2" size={18} />
              <span className="
                hidden
                lg:inline
              ">Enhance</span>
            </Button>
          )}
      </ButtonGroup>

      {betaFeatures.importAndRetranscribe && meetingId && meetingFolderPath && (
        <RetranscribeDialog
          open={showRetranscribeDialog}
          onOpenChange={setShowRetranscribeDialog}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onComplete={handleRetranscribeComplete}
        />
      )}
    </div>
  );
}
