"use client";

import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useState, useRef } from "react";
import { Play, Pause, Square, Mic, AlertCircle, X } from "lucide-react";
import { ProcessRequest, SummaryResponse } from "@/types/summary";
import { listen } from "@tauri-apps/api/event";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { getErrorMessage } from "@/lib/utils";

interface RecordingControlsProps {
  isRecording: boolean;
  barHeights: string[];
  onRecordingStop: (callApi?: boolean) => void;
  onRecordingStart: () => void;
  onTranscriptReceived: (summary: SummaryResponse) => void;
  onTranscriptionError?: (message: string) => void;
  onStopInitiated?: () => void; // Called immediately when stop button is clicked
  isRecordingDisabled: boolean;
  isParentProcessing: boolean;
  selectedDevices?: {
    micDevice: string | null;
    systemDevice: string | null;
  };
  meetingName?: string;
}

export const RecordingControls: React.FC<RecordingControlsProps> = ({
  isRecording,
  barHeights,
  onRecordingStop,
  onRecordingStart,
  onTranscriptReceived,
  onTranscriptionError,
  onStopInitiated,
  isRecordingDisabled,
  isParentProcessing,
  selectedDevices,
  meetingName,
}) => {
  // Use global recording state context for pause state (syncs with tray operations)
  const recordingState = useRecordingState();
  const isPaused = recordingState.isPaused;

  const [showPlayback, setShowPlayback] = useState(false);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const MIN_RECORDING_DURATION = 2000; // 2 seconds minimum recording time
  const [transcriptionErrors, setTranscriptionErrors] = useState(0);
  const [isValidatingModel, setIsValidatingModel] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [deviceError, setDeviceError] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const currentTime = 0;
  const duration = 0;
  const isPlaying = false;
  const progress = 0;

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    const checkTauri = async () => {
      try {
        const result = await invoke("is_recording");
        console.log(
          "Tauri is initialized and ready, is_recording result:",
          result,
        );
      } catch (error) {
        console.error("Tauri initialization error:", error);
        alert(
          "Failed to initialize recording. Please check the console for details.",
        );
      }
    };
    checkTauri();
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isStarting || isValidatingModel) return;
    console.log("Starting recording...");
    console.log("Selected devices:", selectedDevices);
    console.log("Meeting name:", meetingName);
    console.log("Current isRecording state:", isRecording);

    setShowPlayback(false);
    setTranscript(""); // Clear any previous transcript
    setSpeechDetected(false); // Reset speech detection on new recording

    try {
      // Call the validation callback which will:
      // 1. Check if model is ready
      // 2. Show appropriate toast/modal
      // 3. Call backend if valid
      // 4. Update UI state
      await onRecordingStart();
    } catch (error) {
      console.error("Failed to start recording:", error);
      const errorMsg = getErrorMessage(error);

      // Check for device-related errors
      if (
        errorMsg.includes("microphone") ||
        errorMsg.includes("mic") ||
        errorMsg.includes("input")
      ) {
        setDeviceError({
          title: "Microphone Not Available",
          message:
            "Unable to access your microphone. Please check that:\n• Your microphone is connected\n• The app has microphone permissions\n• No other app is using the microphone",
        });
      } else if (
        errorMsg.includes("system audio") ||
        errorMsg.includes("speaker") ||
        errorMsg.includes("output")
      ) {
        setDeviceError({
          title: "System Audio Not Available",
          message:
            "Unable to capture system audio. Please check that:\n• A virtual audio device (like BlackHole) is installed\n• The app has screen recording permissions (macOS)\n• System audio is properly configured",
        });
      } else if (errorMsg.includes("permission")) {
        setDeviceError({
          title: "Permission Required",
          message:
            "Recording permissions are required. Please:\n• Grant microphone access in System Settings\n• Grant screen recording access for system audio (macOS)\n• Restart the app after granting permissions",
        });
      } else {
        setDeviceError({
          title: "Recording Failed",
          message:
            "Unable to start recording. Please check your audio device settings and try again.",
        });
      }
    }
  }, [
    onRecordingStart,
    isStarting,
    isValidatingModel,
    selectedDevices,
    meetingName,
    isRecording,
  ]);

  const stopRecordingAction = useCallback(async () => {
    console.log("Executing stop recording...");
    try {
      setIsProcessing(true);
      const dataDir = await appDataDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const savePath = `${dataDir}/recording-${timestamp}.wav`;
      console.log("Saving recording to:", savePath);
      console.log("About to call stop_recording command");
      const result = await invoke("stop_recording", {
        args: {
          save_path: savePath,
        },
      });
      console.log("stop_recording command completed successfully:", result);
      setRecordingPath(savePath);
      // setShowPlayback(true);
      setIsProcessing(false);
      onRecordingStop(true);
    } catch (error) {
      console.error("Failed to stop recording:", error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        if (error.message.includes("No recording in progress")) {
          return;
        }
      } else if (
        typeof error === "string" &&
        error.includes("No recording in progress")
      ) {
        return;
      } else if (error && typeof error === "object" && "toString" in error) {
        if (error.toString().includes("No recording in progress")) {
          return;
        }
      }
      setIsProcessing(false);
      onRecordingStop(false);
    } finally {
      setIsStopping(false);
    }
  }, [onRecordingStop]);

  const handleStopRecording = useCallback(async () => {
    console.log(
      "handleStopRecording called - isRecording:",
      isRecording,
      "isStarting:",
      isStarting,
      "isStopping:",
      isStopping,
    );
    if (!isRecording || isStarting || isStopping) {
      console.log("Early return from handleStopRecording due to state check");
      return;
    }

    console.log("Stopping recording...");

    // Notify parent immediately (for UI state updates)
    onStopInitiated?.();

    setIsStopping(true);

    // Immediately trigger the stop action
    await stopRecordingAction();
  }, [
    isRecording,
    isStarting,
    isStopping,
    stopRecordingAction,
    onStopInitiated,
  ]);

  const handlePauseRecording = useCallback(async () => {
    if (!isRecording || isPaused || isPausing) return;

    console.log("Pausing recording...");
    setIsPausing(true);

    try {
      await invoke("pause_recording");
      // isPaused state now managed by RecordingStateContext via events
      console.log("Recording paused successfully");
    } catch (error) {
      console.error("Failed to pause recording:", error);
      alert("Failed to pause recording. Please check the console for details.");
    } finally {
      setIsPausing(false);
    }
  }, [isRecording, isPaused, isPausing]);

  const handleResumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused || isResuming) return;

    console.log("Resuming recording...");
    setIsResuming(true);

    try {
      await invoke("resume_recording");
      // isPaused state now managed by RecordingStateContext via events
      console.log("Recording resumed successfully");
    } catch (error) {
      console.error("Failed to resume recording:", error);
      alert(
        "Failed to resume recording. Please check the console for details.",
      );
    } finally {
      setIsResuming(false);
    }
  }, [isRecording, isPaused, isResuming]);

  useEffect(() => {
    return () => {
      // Cleanup on unmount if needed
    };
  }, []);

  useEffect(() => {
    console.log("Setting up recording event listeners");
    let unsubscribes: (() => void)[] = [];

    const setupListeners = async () => {
      try {
        // Transcript error listener - handles both regular and actionable errors
        const transcriptErrorUnsubscribe = await listen(
          "transcript-error",
          (event) => {
            console.log("transcript-error event received:", event);
            console.error("Transcription error received:", event.payload);
            const errorMessage = event.payload as string;

            setTranscriptionErrors((prev) => {
              const newCount = prev + 1;
              console.log("Transcription error count incremented:", newCount);
              return newCount;
            });
            setIsProcessing(false);
            console.log(
              "Calling onRecordingStop(false) due to transcript error",
            );
            onRecordingStop(false);
            if (onTranscriptionError) {
              onTranscriptionError(errorMessage);
            }
          },
        );

        // Transcription error listener - handles structured error objects with actionable flag
        const transcriptionErrorUnsubscribe = await listen(
          "transcription-error",
          (event) => {
            console.log("transcription-error event received:", event);
            console.error("Transcription error received:", event.payload);

            let errorMessage: string;
            let isActionable = false;

            if (typeof event.payload === "object" && event.payload !== null) {
              const payload = event.payload as {
                error: string;
                userMessage: string;
                actionable: boolean;
              };
              errorMessage = payload.userMessage || payload.error;
              isActionable = payload.actionable || false;
            } else {
              errorMessage = String(event.payload);
            }

            setTranscriptionErrors((prev) => {
              const newCount = prev + 1;
              console.log("Transcription error count incremented:", newCount);
              return newCount;
            });
            setIsProcessing(false);
            console.log(
              "Calling onRecordingStop(false) due to transcription error",
            );
            onRecordingStop(false);

            // For actionable errors (like model loading failures), the main page will handle showing the model selector
            // For regular errors, they are handled by useModalState global listener which shows a toast
            // We don't want to show a modal (via onTranscriptionError) AND a toast, so we skip the callback here
            /* if (onTranscriptionError && !isActionable) {
            onTranscriptionError(errorMessage);
          } */
          },
        );

        // Pause/Resume events are now handled by RecordingStateContext
        // No need for duplicate listeners here

        // Speech detected listener - for UX feedback when VAD detects speech
        const speechDetectedUnsubscribe = await listen(
          "speech-detected",
          (event) => {
            console.log("speech-detected event received:", event);
            setSpeechDetected(true);
          },
        );

        unsubscribes = [
          transcriptErrorUnsubscribe,
          transcriptionErrorUnsubscribe,
          speechDetectedUnsubscribe,
        ];
        console.log("Recording event listeners set up successfully");
      } catch (error) {
        console.error("Failed to set up recording event listeners:", error);
      }
    };

    setupListeners();

    return () => {
      console.log("Cleaning up recording event listeners");
      unsubscribes.forEach((unsubscribe) => {
        if (unsubscribe && typeof unsubscribe === "function") {
          unsubscribe();
        }
      });
    };
  }, [onRecordingStop, onTranscriptionError]);

  return (
    <TooltipProvider>
      <div className="flex flex-col space-y-2">
        <div className="
          flex items-center space-x-2 rounded-full bg-background px-4 py-2
          shadow-lg
        ">
          {isProcessing && !isParentProcessing ? (
            <div className="flex items-center space-x-2">
              <div className="
                size-5 animate-spin rounded-full border-b-2 border-gray-900
              "></div>
              <span className="text-sm text-muted-foreground">
                Processing recording...
              </span>
            </div>
          ) : (
            <>
              {showPlayback ? (
                <>
                  <button
                    onClick={handleStartRecording}
                    className="
                      flex size-10 items-center justify-center rounded-full
                      bg-red-500 text-white transition-colors
                      hover:bg-red-600
                    "
                  >
                    <Mic size={16} />
                  </button>

                  <div className="mx-1 h-6 w-px bg-muted" />

                  <div className="mx-2 flex items-center space-x-1">
                    <div className="min-w-10 text-sm text-muted-foreground">
                      {formatTime(currentTime)}
                    </div>
                    <div className="relative h-1 w-24 rounded-full bg-muted">
                      <div
                        className="absolute h-full rounded-full bg-blue-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="min-w-10 text-sm text-muted-foreground">
                      {formatTime(duration)}
                    </div>
                  </div>

                  <button
                    className="
                      flex size-10 cursor-not-allowed items-center
                      justify-center rounded-full bg-muted text-white
                    "
                    disabled
                  >
                    <Play size={16} />
                  </button>
                </>
              ) : (
                <>
                  {!isRecording ? (
                    // Start recording button
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleStartRecording}
                          disabled={
                            isStarting ||
                            isProcessing ||
                            isRecordingDisabled ||
                            isValidatingModel
                          }
                          className={`
                            flex size-12 items-center justify-center
                            ${
                            isStarting || isProcessing || isValidatingModel
                              ? "bg-muted"
                              : `
                                bg-red-500
                                hover:bg-red-600
                              `
                          }
                            relative rounded-full text-white transition-colors
                          `}
                        >
                          {isValidatingModel ? (
                            <div className="
                              size-5 animate-spin rounded-full border-b-2
                              border-background
                            "></div>
                          ) : (
                            <Mic size={20} />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Start recording</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    // Recording controls (pause/resume + stop)
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              if (isPaused) {
                                handleResumeRecording();
                              } else {
                                handlePauseRecording();
                              }
                            }}
                            disabled={isPausing || isResuming || isStopping}
                            className={`
                              flex size-10 items-center justify-center
                              ${
                              isPausing || isResuming || isStopping
                                ? `
                                  border-2 border-border bg-muted
                                  text-muted-foreground/70
                                `
                                : `
                                  border-2 border-border bg-background
                                  text-muted-foreground
                                  hover:border-border hover:bg-muted
                                `
                            }
                              relative rounded-full transition-colors
                            `}
                          >
                            {isPaused ? (
                              <Play size={16} />
                            ) : (
                              <Pause size={16} />
                            )}
                            {(isPausing || isResuming) && (
                              <div className="
                                absolute -top-8 text-xs font-medium
                                text-muted-foreground
                              ">
                                {isPausing ? "Pausing..." : "Resuming..."}
                              </div>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {isPaused ? "Resume recording" : "Pause recording"}
                          </p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={handleStopRecording}
                            disabled={isStopping || isPausing || isResuming}
                            className={`
                              flex size-10 items-center justify-center
                              ${
                              isStopping || isPausing || isResuming
                                ? "bg-muted"
                                : `
                                  bg-red-500
                                  hover:bg-red-600
                                `
                            }
                              relative rounded-full text-white transition-colors
                            `}
                          >
                            <Square size={16} />
                            {isStopping && (
                              <div className="
                                absolute -top-8 text-xs font-medium
                                text-muted-foreground
                              ">
                                Stopping...
                              </div>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Stop recording</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}

                  <div className="mx-4 flex items-center space-x-1">
                    {barHeights.map((height, index) => (
                      <div
                        key={index}
                        className={`
                          w-1 rounded-full transition-all duration-200
                          ${
                          isPaused ? "bg-orange-500" : "bg-red-500"
                        }
                        `}
                        style={{
                          height: isRecording && !isPaused ? height : "4px",
                          opacity: isPaused ? 0.6 : 1,
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Show validation status only */}
        {isValidatingModel && (
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Validating speech recognition...
          </div>
        )}

        {/* Device error alert */}
        {deviceError && (
          <Alert
            variant="destructive"
            className="mt-4 border-red-300 bg-red-50"
          >
            <AlertCircle className="size-5 text-red-600" />
            <button
              onClick={() => setDeviceError(null)}
              className="
                absolute top-3 right-3 text-red-600 transition-colors
                hover:text-red-800
              "
              aria-label="Close alert"
            >
              <X className="size-4" />
            </button>
            <AlertTitle className="mb-2 font-semibold text-red-800">
              {deviceError.title}
            </AlertTitle>
            <AlertDescription className="text-red-700">
              {deviceError.message.split("\n").map((line, i) => (
                <div key={i} className={i > 0 ? "ml-2" : ""}>
                  {line}
                </div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* {showPlayback && recordingPath && (
        <div className="text-sm text-muted-foreground px-4">
          Recording saved to: {recordingPath}
        </div>
      )} */}
      </div>
    </TooltipProvider>
  );
};
