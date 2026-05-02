"use client";

import { motion } from "framer-motion";
import { useRecordingState } from "@/contexts/RecordingStateContext";

interface RecordingStatusBarProps {
  isPaused?: boolean;
}

export const RecordingStatusBar: React.FC<RecordingStatusBarProps> = ({
  isPaused = false,
}) => {
  // Get recording duration from backend-synced context (in seconds)
  // Backend polls every 500ms, providing smooth updates
  const { activeDuration, isRecording } = useRecordingState();

  // Derived directly — was previously mirrored into state via an effect.
  const displaySeconds = activeDuration !== null ? Math.floor(activeDuration) : 0;

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2"
    >
      <div
        className={`
          size-2 rounded-full
          ${isPaused ? "bg-orange-500" : `animate-pulse bg-red-500`}
        `}
      />
      <span
        className={`
          text-sm
          ${isPaused ? "text-orange-700" : "text-foreground"}
        `}
      >
        {isPaused ? "Paused" : "Recording"} • {formatDuration(displaySeconds)}
      </span>
    </motion.div>
  );
};
