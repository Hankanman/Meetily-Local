/**
 * TranscriptRecovery Component
 *
 * Modal dialog for recovering interrupted meetings from IndexedDB.
 * Displays recoverable meetings, allows preview, and enables recovery or deletion.
 */

import React, { useState, useEffect, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MeetingMetadata, StoredTranscript } from "@/services/indexedDBService";
import { cn } from "@/lib/utils";

interface TranscriptRecoveryProps {
  isOpen: boolean;
  onClose: () => void;
  recoverableMeetings: MeetingMetadata[];
  onRecover: (meetingId: string) => Promise<any>;
  onDelete: (meetingId: string) => Promise<void>;
  onLoadPreview: (meetingId: string) => Promise<StoredTranscript[]>;
}

export function TranscriptRecovery({
  isOpen,
  onClose,
  recoverableMeetings,
  onRecover,
  onDelete,
  onLoadPreview,
}: TranscriptRecoveryProps) {
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null,
  );
  const [previewTranscripts, setPreviewTranscripts] = useState<
    StoredTranscript[]
  >([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Declared above its first caller (the auto-select effect) to avoid TDZ.
  const handleMeetingSelect = useCallback(
    async (meetingId: string) => {
      setSelectedMeetingId(meetingId);
      setIsLoadingPreview(true);

      try {
        const transcripts = await onLoadPreview(meetingId);
        // Limit to first 10 for preview
        setPreviewTranscripts(transcripts.slice(0, 10));
      } catch (error) {
        console.error("Failed to load preview:", error);
        setPreviewTranscripts([]);
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [onLoadPreview],
  );

  // Reset selection when dialog opens — genuine reset cascade on prop transition.
  useEffect(() => {
    if (isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setSelectedMeetingId(null);
      setPreviewTranscripts([]);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen]);

  // Auto-select first meeting if available. handleMeetingSelect sets state
  // synchronously before its await, so the rule flags it — but the gate above
  // (selectedMeetingId is null) means this only fires once per dialog open.
  useEffect(() => {
    if (isOpen && recoverableMeetings.length > 0 && !selectedMeetingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleMeetingSelect(recoverableMeetings[0].meetingId);
    }
  }, [isOpen, recoverableMeetings, selectedMeetingId, handleMeetingSelect]);

  const handleRecover = async () => {
    if (!selectedMeetingId) return;

    setIsRecovering(true);
    try {
      const result = await onRecover(selectedMeetingId);
      console.log("Recovery successful:", result);
      onClose();
    } catch (error) {
      console.error("Recovery failed:", error);
      alert("Failed to recover meeting. Please try again.");
    } finally {
      setIsRecovering(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedMeetingId) return;

    if (
      !confirm(
        "Are you sure you want to delete this meeting? This cannot be undone.",
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(selectedMeetingId);
      setSelectedMeetingId(null);
      setPreviewTranscripts([]);
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete meeting. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedMeeting = recoverableMeetings.find(
    (m) => m.meetingId === selectedMeetingId,
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-2xl">
            Recover Interrupted Meetings
          </DialogTitle>
          <DialogDescription>
            We found {recoverableMeetings.length} meeting
            {recoverableMeetings.length !== 1 ? "s" : ""} that{" "}
            {recoverableMeetings.length !== 1 ? "were" : "was"} interrupted.
            Select a meeting to preview and recover it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 gap-4 overflow-hidden px-6 pb-6">
          {/* Meeting List */}
          <div className="flex w-1/3 flex-col">
            <h3 className="mb-2 text-sm font-medium">Interrupted Meetings</h3>
            <ScrollArea className="flex-1 rounded-lg border">
              <div className="space-y-2 p-2">
                {recoverableMeetings.map((meeting) => (
                  <button
                    key={meeting.meetingId}
                    onClick={() => handleMeetingSelect(meeting.meetingId)}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      selectedMeetingId === meeting.meetingId
                        ? "border-primary bg-primary/10"
                        : `
                          border-transparent
                          hover:bg-muted
                        `,
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {meeting.title}
                        </p>
                        <p className="
                          mt-1 flex items-center gap-1 text-sm
                          text-muted-foreground
                        ">
                          <Clock className="size-3" />
                          {formatDistanceToNow(new Date(meeting.lastUpdated), {
                            addSuffix: true,
                          })}
                        </p>
                        <p className="
                          mt-1 flex items-center gap-1 text-sm
                          text-muted-foreground
                        ">
                          <FileText className="size-3" />
                          {meeting.transcriptCount} transcript
                          {meeting.transcriptCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                      {meeting.folderPath ? (
                        <span title="Audio available">
                          <CheckCircle2 className="
                            size-4 shrink-0 text-success
                          " />
                        </span>
                      ) : (
                        <span title="No audio">
                          <AlertCircle className="
                            size-4 shrink-0 text-warning
                          " />
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Preview Panel */}
          <div className="flex flex-1 flex-col">
            <h3 className="mb-2 text-sm font-medium">Preview</h3>
            <div className="
              flex flex-1 flex-col overflow-hidden rounded-lg border
            ">
              {selectedMeeting ? (
                <>
                  {/* Meeting Info */}
                  <div className="border-b bg-muted/50 p-4">
                    <h4 className="font-semibold">{selectedMeeting.title}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Started{" "}
                      {new Date(selectedMeeting.startTime).toLocaleString()}
                    </p>
                    <div className="mt-2 flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1">
                        <FileText className="size-4" />
                        {selectedMeeting.transcriptCount} transcripts
                      </span>
                      {selectedMeeting.folderPath ? (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-4" />
                          Audio available
                        </span>
                      ) : (
                        <span className="
                          flex items-center gap-1 text-warning
                        ">
                          <AlertCircle className="size-4" />
                          No audio
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Transcript Preview */}
                  <ScrollArea className="flex-1 p-4">
                    {isLoadingPreview ? (
                      <div className="
                        flex h-full items-center justify-center
                        text-muted-foreground
                      ">
                        Loading preview...
                      </div>
                    ) : previewTranscripts.length > 0 ? (
                      <div className="space-y-3">
                        <Alert>
                          <AlertDescription>
                            Showing first {previewTranscripts.length} transcript
                            segments (of {selectedMeeting.transcriptCount}{" "}
                            total)
                          </AlertDescription>
                        </Alert>
                        {previewTranscripts.map((transcript, index) => {
                          // Handle different timestamp formats
                          const getTimestamp = () => {
                            if (!transcript.timestamp) return "--:--";
                            try {
                              const date = new Date(transcript.timestamp);
                              if (isNaN(date.getTime())) {
                                // If timestamp is invalid, try audio_start_time
                                if (transcript.audio_start_time !== undefined) {
                                  const totalSecs = Math.floor(
                                    transcript.audio_start_time,
                                  );
                                  const mins = Math.floor(totalSecs / 60);
                                  const secs = totalSecs % 60;
                                  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
                                }
                                return "--:--";
                              }
                              return date.toLocaleTimeString();
                            } catch {
                              return "--:--";
                            }
                          };

                          return (
                            <div key={index} className="text-sm">
                              <span className="text-muted-foreground">
                                [{getTimestamp()}]
                              </span>{" "}
                              <span>{transcript.text}</span>
                            </div>
                          );
                        })}
                        {selectedMeeting.transcriptCount > 10 && (
                          <p className="text-sm text-muted-foreground italic">
                            ... and {selectedMeeting.transcriptCount - 10} more
                            transcript
                            {selectedMeeting.transcriptCount - 10 !== 1
                              ? "s"
                              : ""}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="
                        flex h-full items-center justify-center
                        text-muted-foreground
                      ">
                        No transcripts to preview
                      </div>
                    )}
                  </ScrollArea>
                </>
              ) : (
                <div className="
                  flex h-full items-center justify-center text-muted-foreground
                ">
                  Select a meeting to preview
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 pb-6">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isRecovering || isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!selectedMeetingId || isRecovering || isDeleting}
          >
            {isDeleting ? (
              <>
                <XCircle className="mr-2 size-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 size-4" />
                Delete
              </>
            )}
          </Button>
          <Button
            onClick={handleRecover}
            disabled={!selectedMeetingId || isRecovering || isDeleting}
          >
            {isRecovering ? (
              <>
                <CheckCircle2 className="mr-2 size-4 animate-spin" />
                Recovering...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 size-4" />
                Recover
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
