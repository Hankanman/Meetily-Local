"use client";

import {
  useCallback,
  useRef,
  useReducer,
  startTransition,
  useEffect,
  useState,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData } from "@/types";
import { formatRecordingTime } from "@/lib/utils";
import { speakerChipClass } from "@/lib/speaker-chip";

export interface VirtualizedTranscriptViewProps {
  /** Transcript segments to display */
  segments: TranscriptSegmentData[];
  /** Whether recording is in progress */
  isRecording?: boolean;
  /** Whether recording is paused */
  isPaused?: boolean;
  /** Whether processing/finalizing transcription */
  isProcessing?: boolean;
  /** Whether stopping */
  isStopping?: boolean;
  /** Enable streaming effect for latest segment */
  enableStreaming?: boolean;
  /** Show confidence indicators */
  showConfidence?: boolean;
  /** Completely disable auto-scroll behavior (for meeting details page) */
  disableAutoScroll?: boolean;

  // Pagination props (infinite scroll)
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to remove filler words and repetitions
function cleanStopWords(text: string): string {
  const stopWords = ["uh", "um", "er", "ah", "hmm", "hm", "eh", "oh"];

  let cleanedText = text;
  stopWords.forEach((word) => {
    const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, "gi");
    cleanedText = cleanedText.replace(pattern, " ");
  });

  return cleanedText.replace(/\s+/g, " ").trim();
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
  id,
  timestamp,
  text,
  confidence,
  speaker,
  isStreaming,
  showConfidence,
}: {
  id: string;
  timestamp: number;
  text: string;
  confidence?: number;
  speaker?: string;
  isStreaming: boolean;
  showConfidence: boolean;
}) {
  const displayText =
    cleanStopWords(text) || (text.trim() === "" ? "[Silence]" : text);

  return (
    <div id={`segment-${id}`} className="mb-3">
      <div className="flex items-start gap-2">
        <Tooltip>
          <TooltipTrigger>
            <span className="
              mt-1 min-w-12.5 shrink-0 text-sm text-muted-foreground/70
            ">
              {formatRecordingTime(timestamp)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {confidence !== undefined && showConfidence && (
              <ConfidenceIndicator
                confidence={confidence}
                showIndicator={showConfidence}
              />
            )}
          </TooltipContent>
        </Tooltip>
        <div className="flex-1">
          {speaker && (
            <span
              className={`
                mb-1 mr-2 inline-block rounded-full px-2 py-0.5 text-xs
                font-medium
                ${speakerChipClass(speaker)}
              `}
            >
              {speaker}
            </span>
          )}
          {isStreaming ? (
            <div className="rounded-lg border border-border bg-muted px-3 py-2">
              <p className="text-sm/relaxed text-foreground">
                {displayText}
              </p>
            </div>
          ) : (
            <p className="text-sm/relaxed text-foreground">
              {displayText}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

export const VirtualizedTranscriptView: React.FC<
  VirtualizedTranscriptViewProps
> = ({
  segments,
  isRecording = false,
  isPaused = false,
  isProcessing = false,
  isStopping = false,
  enableStreaming = false,
  showConfidence = true,
  disableAutoScroll = false,
  hasMore = false,
  isLoadingMore = false,
  totalCount = 0,
  loadedCount = 0,
  onLoadMore,
}) => {
  // Create scroll ref first - shared between virtualizer and auto-scroll hook
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ref for infinite scroll trigger element
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  // Force re-render without flushSync (avoids React warning)
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  // Setup virtualizer for efficient rendering of large lists.
  // React Compiler bails out of memoizing callers that close over the
  // virtualizer's returned methods (they're intentionally unstable).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60, // Estimated height per segment
    overscan: 10, // Render extra items above/below viewport
    onChange: () => {
      startTransition(() => {
        rerender();
      });
    },
  });

  // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
  useAutoScroll({
    scrollRef,
    segments,
    isRecording,
    isPaused,
    virtualizer,
    virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
    disableAutoScroll,
  });

  // Streaming text effect hook (typewriter animation for new transcripts)
  const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
    segments,
    isRecording,
    enableStreaming,
  );

  // Infinite scroll: IntersectionObserver to trigger loading more
  useEffect(() => {
    if (
      !onLoadMore ||
      !hasMore ||
      isLoadingMore ||
      isRecording ||
      segments.length === 0
    ) {
      return;
    }

    const triggerElement = loadMoreTriggerRef.current;
    if (!triggerElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          onLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "100px",
        threshold: 0,
      },
    );

    observer.observe(triggerElement);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

  // Scroll-based fallback for fast scrolling
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking || isLoadingMore || !hasMore) return;

      ticking = true;
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = scrollElement;
        const scrollBottom = scrollHeight - scrollTop - clientHeight;

        // Trigger load when within 200px of bottom
        if (scrollBottom < 200 && hasMore && !isLoadingMore) {
          onLoadMore();
        }
        ticking = false;
      });
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

  // Use simple rendering for small lists, virtualization for large lists
  const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col overflow-y-auto px-4 py-2"
    >
      {/* Recording Status Bar - Sticky at top, always visible when recording */}
      <AnimatePresence>
        {isRecording && (
          <div className="sticky top-0 z-10 bg-background pb-2">
            <RecordingStatusBar isPaused={isPaused} />
          </div>
        )}
      </AnimatePresence>

      {/* Content - add padding when recording to prevent overlap */}
      <div className={isRecording ? "pt-2" : ""}>
        {segments.length === 0 ? (
          // Empty state
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8 text-center text-muted-foreground"
          >
            {isRecording ? (
              <>
                <div className="mb-3 flex items-center justify-center">
                  <div
                    className={`
                      size-3 rounded-full
                      ${isPaused ? `bg-orange-500` : "animate-pulse bg-info"}
                    `}
                  ></div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {isPaused ? "Recording paused" : "Listening for speech..."}
                </p>
                <p className="mt-1 text-sm text-muted-foreground/70">
                  {isPaused
                    ? "Click resume to continue recording"
                    : "Speak to see live transcription"}
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">Welcome to meetily!</p>
                <p className="mt-1 text-sm">
                  Start recording to see live transcription
                </p>
              </>
            )}
          </motion.div>
        ) : useVirtualization ? (
          // Virtualized rendering for large lists
          <>
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const segment = segments[virtualRow.index];
                const isStreaming = streamingSegmentId === segment.id;

                return (
                  <div
                    key={segment.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <TranscriptSegment
                      id={segment.id}
                      timestamp={segment.timestamp}
                      text={getDisplayText(segment)}
                      confidence={segment.confidence}
                      speaker={segment.speaker}
                      isStreaming={isStreaming}
                      showConfidence={showConfidence}
                    />
                  </div>
                );
              })}
            </div>

            {/* Infinite scroll trigger and loading indicator */}
            {(hasMore || isLoadingMore) &&
              !isRecording &&
              segments.length > 0 && (
                <div
                  ref={loadMoreTriggerRef}
                  className="mt-2 flex items-center justify-center py-4"
                >
                  {isLoadingMore ? (
                    <div className="
                      flex items-center gap-2 text-muted-foreground
                    ">
                      <Spinner size="sm" />
                      <span className="text-sm">Loading more...</span>
                    </div>
                  ) : hasMore && totalCount > 0 ? (
                    <span className="text-sm text-muted-foreground/70">
                      Showing {loadedCount} of {totalCount} segments
                    </span>
                  ) : null}
                </div>
              )}

            {/* Listening indicator when recording */}
            {!isStopping &&
              isRecording &&
              !isPaused &&
              !isProcessing &&
              segments.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 flex items-center gap-2 text-muted-foreground"
                >
                  <div className="size-2 animate-pulse rounded-full bg-info"></div>
                  <span className="text-sm">Listening...</span>
                </motion.div>
              )}
          </>
        ) : (
          // Simple rendering for small lists (better animations)
          <>
            <div className="space-y-1">
              {segments.map((segment) => {
                const isStreaming = streamingSegmentId === segment.id;

                return (
                  <motion.div
                    key={segment.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TranscriptSegment
                      id={segment.id}
                      timestamp={segment.timestamp}
                      text={getDisplayText(segment)}
                      confidence={segment.confidence}
                      speaker={segment.speaker}
                      isStreaming={isStreaming}
                      showConfidence={showConfidence}
                    />
                  </motion.div>
                );
              })}
            </div>

            {/* Infinite scroll trigger (for small lists that grow) */}
            {(hasMore || isLoadingMore) &&
              !isRecording &&
              segments.length > 0 && (
                <div
                  ref={loadMoreTriggerRef}
                  className="mt-2 flex items-center justify-center py-4"
                >
                  {isLoadingMore ? (
                    <div className="
                      flex items-center gap-2 text-muted-foreground
                    ">
                      <Spinner size="sm" />
                      <span className="text-sm">Loading more...</span>
                    </div>
                  ) : hasMore && totalCount > 0 ? (
                    <span className="text-sm text-muted-foreground/70">
                      Showing {loadedCount} of {totalCount} segments
                    </span>
                  ) : null}
                </div>
              )}

            {/* Listening indicator when recording */}
            {!isStopping &&
              isRecording &&
              !isPaused &&
              !isProcessing &&
              segments.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 flex items-center gap-2 text-muted-foreground"
                >
                  <div className="size-2 animate-pulse rounded-full bg-info"></div>
                  <span className="text-sm">Listening...</span>
                </motion.div>
              )}
          </>
        )}
      </div>
    </div>
  );
};
