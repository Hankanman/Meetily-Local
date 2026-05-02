import React from "react";
import { Button } from "@/components/ui/button";

export interface ChunkStatus {
  chunk_id: number;
  status: "pending" | "processing" | "completed" | "failed";
  start_time?: number;
  end_time?: number;
  duration_ms?: number;
  text_preview?: string;
  error_message?: string;
}

export interface ProcessingProgress {
  total_chunks: number;
  completed_chunks: number;
  processing_chunks: number;
  failed_chunks: number;
  estimated_remaining_ms?: number;
  chunks: ChunkStatus[];
}

interface ChunkProgressDisplayProps {
  progress: ProcessingProgress;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  isPaused?: boolean;
  className?: string;
}

export function ChunkProgressDisplay({
  progress,
  onPause,
  onResume,
  onCancel,
  isPaused = false,
  className = "",
}: ChunkProgressDisplayProps) {
  const completionPercentage =
    progress.total_chunks > 0
      ? Math.round((progress.completed_chunks / progress.total_chunks) * 100)
      : 0;

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const formatTimeRemaining = (ms?: number) => {
    if (!ms || ms <= 0) return "Calculating...";
    return formatDuration(ms);
  };

  const getChunkStatusIcon = (status: ChunkStatus["status"]) => {
    switch (status) {
      case "completed":
        return "✅";
      case "processing":
        return "⚡";
      case "failed":
        return "❌";
      case "pending":
      default:
        return "⏳";
    }
  };

  const getChunkStatusColor = (status: ChunkStatus["status"]) => {
    switch (status) {
      case "completed":
        return "text-success bg-success-muted border-success";
      case "processing":
        return "text-info bg-info/10 border-info/30";
      case "failed":
        return "text-destructive bg-destructive/10 border-destructive/30";
      case "pending":
      default:
        return "text-muted-foreground bg-muted border-border";
    }
  };

  return (
    <div
      className={`
        rounded-lg border border-border bg-background p-4
        ${className}
      `}
    >
      {/* Progress Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-foreground">
            Processing Progress
          </h3>
          {isPaused && (
            <span className="
              rounded-full bg-warning-muted px-2 py-1 text-sm font-medium
              text-warning
            ">
              Paused
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {!isPaused ? (
            <Button
              size="sm"
              onClick={onPause}
              className="bg-warning text-white hover:bg-warning/90"
              disabled={
                progress.processing_chunks === 0 &&
                progress.completed_chunks === progress.total_chunks
              }
            >
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onResume}
              className="bg-success text-white hover:bg-success/90"
            >
              Resume
            </Button>
          )}

          <Button
            size="sm"
            variant="destructive"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            {progress.completed_chunks} of {progress.total_chunks} chunks
            completed
          </span>
          <span className="text-sm font-medium text-foreground">
            {completionPercentage}%
          </span>
        </div>

        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="
              h-2 rounded-full bg-info transition-all duration-300 ease-out
            "
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Processing Stats */}
      <div className="mb-4 grid grid-cols-4 gap-4 text-sm">
        <div className="text-center">
          <div className="text-lg font-semibold text-success">
            {progress.completed_chunks}
          </div>
          <div className="text-muted-foreground">Completed</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-info">
            {progress.processing_chunks}
          </div>
          <div className="text-muted-foreground">Processing</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-muted-foreground">
            {progress.total_chunks -
              progress.completed_chunks -
              progress.processing_chunks -
              progress.failed_chunks}
          </div>
          <div className="text-muted-foreground">Pending</div>
        </div>

        <div className="text-center">
          <div className="text-lg font-semibold text-destructive">
            {progress.failed_chunks}
          </div>
          <div className="text-muted-foreground">Failed</div>
        </div>
      </div>

      {/* Time Estimate */}
      {progress.estimated_remaining_ms &&
        progress.estimated_remaining_ms > 0 && (
          <div className="
            mb-4 rounded-lg border border-info/30 bg-info/10 p-3
          ">
            <div className="flex items-center space-x-2">
              <span className="text-info">⏱️</span>
              <span className="text-sm text-info">
                Estimated time remaining:{" "}
                {formatTimeRemaining(progress.estimated_remaining_ms)}
              </span>
            </div>
          </div>
        )}

      {/* Recent Chunks Grid */}
      <div className="space-y-2">
        <h4 className="mb-2 text-sm font-medium text-foreground">
          Recent Chunks ({Math.min(progress.chunks.length, 10)} of{" "}
          {progress.total_chunks})
        </h4>

        <div className="max-h-48 space-y-1 overflow-y-auto">
          {progress.chunks
            .slice(-10) // Show last 10 chunks
            .reverse() // Most recent first
            .map((chunk) => (
              <div
                key={chunk.chunk_id}
                className={`
                  rounded-md border p-2 text-sm
                  ${getChunkStatusColor(chunk.status)}
                `}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span>{getChunkStatusIcon(chunk.status)}</span>
                    <span className="font-medium">Chunk {chunk.chunk_id}</span>
                    {chunk.duration_ms && (
                      <span className="text-muted-foreground">
                        ({formatDuration(chunk.duration_ms)})
                      </span>
                    )}
                  </div>

                  {chunk.status === "processing" && (
                    <div className="flex items-center space-x-1">
                      <div className="
                        size-3 animate-spin rounded-full border border-info
                        border-t-transparent
                      "></div>
                    </div>
                  )}
                </div>

                {chunk.text_preview && (
                  <div className="mt-1 truncate text-sm text-foreground">
                    &quot;{chunk.text_preview}&quot;
                  </div>
                )}

                {chunk.error_message && (
                  <div className="mt-1 text-sm text-destructive">
                    Error: {chunk.error_message}
                  </div>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Processing Complete */}
      {progress.completed_chunks === progress.total_chunks &&
        progress.total_chunks > 0 && (
          <div className="
            mt-4 rounded-lg border border-success bg-success-muted p-3
          ">
            <div className="flex items-center space-x-2">
              <span className="text-success">🎉</span>
              <span className="text-sm font-medium text-success">
                Processing completed! All {progress.total_chunks} chunks have
                been transcribed.
              </span>
            </div>
          </div>
        )}
    </div>
  );
}

// Mini version for sidebar or compact display
export function ChunkProgressMini({
  progress,
  className = "",
}: {
  progress: ProcessingProgress;
  className?: string;
}) {
  const completionPercentage =
    progress.total_chunks > 0
      ? Math.round((progress.completed_chunks / progress.total_chunks) * 100)
      : 0;

  return (
    <div
      className={`
        rounded-lg border border-border bg-muted p-3
        ${className}
      `}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Processing</span>
        <span className="text-sm font-medium text-foreground">
          {completionPercentage}%
        </span>
      </div>

      <div className="mb-2 h-1.5 w-full rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full bg-info transition-all duration-300"
          style={{ width: `${completionPercentage}%` }}
        />
      </div>

      <div className="text-sm text-muted-foreground">
        {progress.completed_chunks} / {progress.total_chunks} chunks
        {progress.processing_chunks > 0 && (
          <span className="ml-2 text-info">
            ({progress.processing_chunks} processing)
          </span>
        )}
      </div>
    </div>
  );
}
