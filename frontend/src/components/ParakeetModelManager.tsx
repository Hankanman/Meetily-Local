import React, { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ParakeetModelInfo,
  ModelStatus,
  ParakeetAPI,
  getModelDisplayInfo,
  getModelDisplayName,
  formatFileSize,
} from "../lib/parakeet";

interface ParakeetModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ParakeetModelManager({
  selectedModel,
  onModelSelect,
  className = "",
  autoSave = false,
}: ParakeetModelManagerProps) {
  const [models, setModels] = useState<ParakeetModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(
    new Set(),
  );

  // Refs for stable callbacks
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<
    Map<string, { progress: number; timestamp: number }>
  >(new Map());

  // Update refs when props change
  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  // Initialize and load models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await ParakeetAPI.init();
        const modelList = await ParakeetAPI.getAvailableModels();
        setModels(modelList);

        setInitialized(true);
      } catch (err) {
        console.error("Failed to initialize Parakeet:", err);
        setError(err instanceof Error ? err.message : "Failed to load models");
        toast.error("Failed to load transcription models", {
          description: err instanceof Error ? err.message : "Unknown error",
          duration: 5000,
        });
      } finally {
        setLoading(false);
      }
    };

    initializeModels();
  }, [initialized, selectedModel, onModelSelect]);

  // saveModelSelection and downloadModel are declared before the listener-setup
  // effect so the cleanup closure can reference them without TDZ issues.
  const saveModelSelection = useCallback(async (modelName: string) => {
    try {
      await invoke("api_save_transcript_config", {
        provider: "parakeet",
        model: modelName,
        apiKey: null,
      });
    } catch (error) {
      console.error("Failed to save model selection:", error);
    }
  }, []);

  const downloadModel = useCallback(
    async (modelName: string) => {
      if (downloadingModels.has(modelName)) return;

      const displayInfo = getModelDisplayInfo(modelName);
      const displayName = displayInfo?.friendlyName || modelName;

      try {
        setDownloadingModels((prev) => new Set([...prev, modelName]));

        setModels((prevModels) =>
          prevModels.map((model) =>
            model.name === modelName
              ? { ...model, status: { Downloading: 0 } as ModelStatus }
              : model,
          ),
        );

        toast.info(`Downloading ${displayName}...`, {
          description: "This may take a few minutes",
          duration: 5000, // Auto-dismiss after 5 seconds
        });

        await ParakeetAPI.downloadModel(modelName);
      } catch (err) {
        console.error("Download failed:", err);
        setDownloadingModels((prev) => {
          const newSet = new Set(prev);
          newSet.delete(modelName);
          return newSet;
        });

        const errorMessage =
          err instanceof Error ? err.message : "Download failed";
        setModels((prev) =>
          prev.map((model) =>
            model.name === modelName
              ? { ...model, status: { Error: errorMessage } }
              : model,
          ),
        );
      }
    },
    [downloadingModels],
  );

  // Set up event listeners for download progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const setupListeners = async () => {
      console.log("[ParakeetModelManager] Setting up event listeners...");

      // Download progress with throttling
      unlistenProgress = await listen<{ modelName: string; progress: number }>(
        "parakeet-model-download-progress",
        (event) => {
          const { modelName, progress } = event.payload;
          const now = Date.now();
          const throttleData = progressThrottleRef.current.get(modelName);

          // Throttle: only update if 300ms passed OR progress jumped by 5%+
          const shouldUpdate =
            !throttleData ||
            now - throttleData.timestamp > 300 ||
            Math.abs(progress - throttleData.progress) >= 5;

          if (shouldUpdate) {
            console.log(
              `[ParakeetModelManager] Progress update for ${modelName}: ${progress}%`,
            );
            progressThrottleRef.current.set(modelName, {
              progress,
              timestamp: now,
            });

            setModels((prevModels) =>
              prevModels.map((model) =>
                model.name === modelName
                  ? {
                      ...model,
                      status: { Downloading: progress } as ModelStatus,
                    }
                  : model,
              ),
            );
          }
        },
      );

      // Download complete
      unlistenComplete = await listen<{ modelName: string }>(
        "parakeet-model-download-complete",
        (event) => {
          const { modelName } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels((prevModels) =>
            prevModels.map((model) =>
              model.name === modelName
                ? { ...model, status: "Available" as ModelStatus }
                : model,
            ),
          );

          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.success(`${displayInfo?.icon || "✓"} ${displayName} ready!`, {
            description: "Model downloaded and ready to use",
            duration: 4000,
          });

          // Auto-select after download using stable refs
          if (onModelSelectRef.current) {
            onModelSelectRef.current(modelName);
            if (autoSaveRef.current) {
              saveModelSelection(modelName);
            }
          }
        },
      );

      // Download error
      unlistenError = await listen<{ modelName: string; error: string }>(
        "parakeet-model-download-error",
        (event) => {
          const { modelName, error } = event.payload;
          const displayInfo = getModelDisplayInfo(modelName);
          const displayName = displayInfo?.friendlyName || modelName;

          setModels((prevModels) =>
            prevModels.map((model) =>
              model.name === modelName
                ? { ...model, status: { Error: error } as ModelStatus }
                : model,
            ),
          );

          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(modelName);
            return newSet;
          });

          // Clean up throttle data
          progressThrottleRef.current.delete(modelName);

          toast.error(`Failed to download ${displayName}`, {
            description: error,
            duration: 6000,
            action: {
              label: "Retry",
              onClick: () => downloadModel(modelName),
            },
          });
        },
      );
    };

    setupListeners();

    return () => {
      console.log("[ParakeetModelManager] Cleaning up event listeners...");
      if (unlistenProgress) unlistenProgress();
      if (unlistenComplete) unlistenComplete();
      if (unlistenError) unlistenError();
    };
  }, [saveModelSelection, downloadModel]);

  const cancelDownload = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.cancelDownload(modelName);

      setDownloadingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      setModels((prevModels) =>
        prevModels.map((model) =>
          model.name === modelName
            ? { ...model, status: "Missing" as ModelStatus }
            : model,
        ),
      );

      // Clean up throttle data
      progressThrottleRef.current.delete(modelName);

      toast.info(`${displayName} download cancelled`, {
        duration: 3000,
      });
    } catch (err) {
      console.error("Failed to cancel download:", err);
      toast.error("Failed to cancel download", {
        description: err instanceof Error ? err.message : "Unknown error",
        duration: 4000,
      });
    }
  };

  const selectModel = async (modelName: string) => {
    if (onModelSelect) {
      onModelSelect(modelName);
    }

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;
    toast.success(`Switched to ${displayName}`, {
      duration: 3000,
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayInfo = getModelDisplayInfo(modelName);
    const displayName = displayInfo?.friendlyName || modelName;

    try {
      await ParakeetAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await ParakeetAPI.getAvailableModels();
      setModels(modelList);

      toast.success(`${displayName} deleted`, {
        description: "Model removed to free up space",
        duration: 3000,
      });

      // If deleted model was selected, clear selection
      if (selectedModel === modelName && onModelSelect) {
        onModelSelect("");
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
      toast.error(`Failed to delete ${displayName}`, {
        description: err instanceof Error ? err.message : "Delete failed",
        duration: 4000,
      });
    }
  };

  if (loading) {
    return (
      <div className={`
        space-y-3
        ${className}
      `}>
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-lg bg-muted"></div>
          <div className="h-20 rounded-lg bg-muted"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`
          rounded-lg border border-red-200 bg-red-50 p-4
          ${className}
        `}
      >
        <p className="text-sm text-red-800">Failed to load models</p>
        <p className="mt-1 text-xs text-red-600">{error}</p>
      </div>
    );
  }

  const recommendedModel = models.find(
    (m) => m.name === "parakeet-tdt-0.6b-v3-int8",
  );
  const otherModels = models.filter(
    (m) => m.name !== "parakeet-tdt-0.6b-v3-int8",
  );

  return (
    <div className={`
      space-y-3
      ${className}
    `}>
      {/* Recommended Model */}
      {recommendedModel && (
        <ModelCard
          model={recommendedModel}
          isSelected={selectedModel === recommendedModel.name}
          isRecommended={true}
          onSelect={() => {
            if (recommendedModel.status === "Available") {
              selectModel(recommendedModel.name);
            }
          }}
          onDownload={() => downloadModel(recommendedModel.name)}
          onCancel={() => cancelDownload(recommendedModel.name)}
          onDelete={() => deleteModel(recommendedModel.name)}
          isDownloading={downloadingModels.has(recommendedModel.name)}
        />
      )}

      {/* Other Models */}
      {otherModels.length > 0 && (
        <div className="space-y-3">
          {otherModels.map((model) => (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={false}
              onSelect={() => {
                if (model.status === "Available") {
                  selectModel(model.name);
                }
              }}
              onDownload={() => downloadModel(model.name)}
              onCancel={() => cancelDownload(model.name)}
              onDelete={() => deleteModel(model.name)}
              isDownloading={downloadingModels.has(model.name)}
            />
          ))}
        </div>
      )}

      {/* Helper text */}
      {selectedModel && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="pt-2 text-center text-xs text-muted-foreground"
        >
          Using {getModelDisplayName(selectedModel)} for transcription
        </motion.div>
      )}
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ParakeetModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
}

function ModelCard({
  model,
  isSelected,
  isRecommended,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  isDownloading,
}: ModelCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const displayInfo = getModelDisplayInfo(model.name);
  const displayName = displayInfo?.friendlyName || model.name;
  const icon = displayInfo?.icon || "📦";
  const tagline = displayInfo?.tagline || model.description || "";

  const isAvailable = model.status === "Available";
  const isMissing = model.status === "Missing";
  const isError = typeof model.status === "object" && "Error" in model.status;
  const isCorrupted =
    typeof model.status === "object" && "Corrupted" in model.status;
  const downloadProgress =
    typeof model.status === "object" && "Downloading" in model.status
      ? model.status.Downloading
      : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative cursor-pointer rounded-lg border-2 transition-all
        ${
          isSelected && isAvailable
            ? "border-blue-500 bg-blue-600/10"
            : isAvailable
              ? `
                border-border bg-background
                hover:border-border
              `
              : "border-border bg-muted"
        }
        ${isAvailable ? "" : "cursor-default"}
      `}
      onClick={() => {
        if (isAvailable) onSelect();
      }}
    >
      {/* Recommended Badge */}
      {isRecommended && (
        <div className="
          absolute -top-2 -right-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs
          font-medium text-white
        ">
          Recommended
        </div>
      )}

      <div className="p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex-1">
            {/* Model Name */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-2xl">{icon}</span>
              <h3 className="font-semibold text-foreground">{displayName}</h3>
              {isSelected && isAvailable && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="
                    flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5
                    text-xs font-medium text-white
                  "
                >
                  ✓
                </motion.span>
              )}
            </div>

            {/* Tagline */}
            <p className="ml-9 text-sm text-muted-foreground">{tagline}</p>
          </div>

          {/* Status/Action */}
          <div className="ml-4 flex items-center gap-2">
            {isAvailable && (
              <>
                <div className="flex items-center gap-1.5 text-green-600">
                  <div className="size-2 rounded-full bg-green-500"></div>
                  <span className="text-xs font-medium">Ready</span>
                </div>
                <AnimatePresence>
                  {isHovered && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                      className="
                        p-1 text-muted-foreground/70 transition-colors
                        hover:text-red-600
                      "
                      title="Delete model to free up space"
                    >
                      <svg
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </motion.button>
                  )}
                </AnimatePresence>
              </>
            )}

            {isMissing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="
                  rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium
                  text-white transition-colors
                  hover:bg-blue-700
                "
              >
                Download
              </button>
            )}

            {downloadProgress === null && isError && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="
                  rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium
                  text-white transition-colors
                  hover:bg-red-700
                "
              >
                Retry
              </button>
            )}

            {isCorrupted && (
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="
                    rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium
                    text-white transition-colors
                    hover:bg-orange-700
                  "
                >
                  Delete
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload();
                  }}
                  className="
                    rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium
                    text-white transition-colors
                    hover:bg-blue-700
                  "
                >
                  Re-download
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Full-width Download Progress Bar - PROMINENT */}
        {downloadProgress !== null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 border-t border-border pt-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-blue-600">
                  Downloading...
                </span>
                <span className="text-sm font-semibold text-blue-600">
                  {Math.round(downloadProgress)}%
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="
                  rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground
                  transition-colors
                  hover:bg-red-50 hover:text-red-600
                "
                title="Cancel download"
              >
                Cancel
              </button>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="
                  h-full rounded-full bg-linear-to-r from-blue-500 to-blue-600
                "
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {model.size_mb ? (
                <>
                  {formatFileSize((model.size_mb * downloadProgress) / 100)} /{" "}
                  {formatFileSize(model.size_mb)}
                </>
              ) : (
                "Downloading..."
              )}
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
