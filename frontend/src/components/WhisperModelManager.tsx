import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useModelDownloadEvents } from "@/hooks/useModelDownloads";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ModelInfo,
  ModelStatus,
  getModelIcon,
  formatFileSize,
  getModelPerformanceBadge,
  isQuantizedModel,
  getModelTagline,
  WhisperAPI,
} from "../lib/whisper";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

interface ModelManagerProps {
  selectedModel?: string;
  onModelSelect?: (modelName: string) => void;
  className?: string;
  autoSave?: boolean;
}

export function ModelManager({
  selectedModel,
  onModelSelect,
  className = "",
  autoSave = false,
}: ModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(
    new Set(),
  );
  const [hasUserSelection, setHasUserSelection] = useState(false);

  // Refs for stable callbacks. Mirroring props/state into refs lets the
  // (heavy) listener-setup effect below run exactly once on mount
  // without capturing stale values.
  const onModelSelectRef = useRef(onModelSelect);
  const autoSaveRef = useRef(autoSave);
  const modelsRef = useRef<ModelInfo[]>([]);

  // Progress throttle map to prevent rapid updates
  const progressThrottleRef = useRef<
    Map<string, { progress: number; timestamp: number }>
  >(new Map());

  // Update refs when props change
  useEffect(() => {
    onModelSelectRef.current = onModelSelect;
    autoSaveRef.current = autoSave;
  }, [onModelSelect, autoSave]);

  // Mirror the `models` state into a ref so the listener closures can
  // read the current array without forcing the listener-setup effect
  // to re-run (and tear-down + re-register three Tauri listeners) every
  // time progress fires.
  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  // Same trick for `downloadModel`, which itself is recreated whenever
  // `downloadingModels` changes (start of a download). The "Retry"
  // toast inside the download-error listener needs to call the latest
  // version, but we don't want listener re-registration whenever
  // the callback's identity flips.
  const downloadModelRef = useRef<(name: string) => Promise<void>>(async () => {});

  // Load persisted downloading state from localStorage
  const getPersistedDownloadingModels = (): Set<string> => {
    try {
      const saved = localStorage.getItem("downloading-models");
      return saved
        ? new Set<string>(JSON.parse(saved) as string[])
        : new Set<string>();
    } catch {
      return new Set<string>();
    }
  };

  // Persist downloading state to localStorage
  const updateDownloadingModels = (
    updater: (prev: Set<string>) => Set<string>,
  ) => {
    setDownloadingModels((prev) => {
      const newSet = updater(prev);
      localStorage.setItem(
        "downloading-models",
        JSON.stringify(Array.from(newSet)),
      );
      return newSet;
    });
  };

  // Initialize models
  useEffect(() => {
    if (initialized) return;

    const initializeModels = async () => {
      try {
        setLoading(true);
        await WhisperAPI.init();
        const modelList = await WhisperAPI.getAvailableModels();

        // Apply persisted downloading states
        const persistedDownloading = getPersistedDownloadingModels();
        const modelsWithDownloadState = modelList.map((model) => {
          if (
            persistedDownloading.has(model.name) &&
            model.status !== "Available"
          ) {
            if (
              typeof model.status === "object" &&
              "Corrupted" in model.status
            ) {
              updateDownloadingModels((prev) => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else if (model.status === "Missing") {
              updateDownloadingModels((prev) => {
                const newSet = new Set(prev);
                newSet.delete(model.name);
                return newSet;
              });
              return model;
            } else {
              return { ...model, status: { Downloading: 0 } as ModelStatus };
            }
          }
          return model;
        });

        setModels(modelsWithDownloadState);
        setInitialized(true);
      } catch (err) {
        console.error("Failed to initialize Whisper:", err);
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
    // Only `initialized` is meaningful as a dep — `selectedModel` and
    // `onModelSelect` previously made this effect re-run on every
    // parent render (the parent created a new onModelSelect ref each
    // render). The body short-circuits with `if (initialized) return`
    // so re-runs were "harmless" but allocated a closure each click.
  }, [initialized]);

  // getDisplayName, saveModelSelection, and downloadModel are declared before the
  // listener-setup effect so its closures can reference them without TDZ issues.
  const getDisplayName = useCallback((modelName: string): string => {
    const modelNameMapping: { [key: string]: string } = {
      small: "Small",
      "medium-q5_0": "Medium",
      "large-v3-turbo-q5_0": "Large V3 Turbo Compressed",
      "large-v3-q5_0": "Large V3 Compressed",
      "large-v3-turbo": "Large V3 Turbo",
      "large-v3": "Large V3",
    };

    const basicModelNames = [
      "small",
      "medium-q5_0",
      "large-v3-turbo-q5_0",
      "large-v3-q5_0",
      "large-v3-turbo",
      "large-v3",
    ];
    if (basicModelNames.includes(modelName)) {
      return modelNameMapping[modelName] || modelName;
    }
    return `Whisper ${modelName}`;
  }, []);

  const saveModelSelection = useCallback(async (modelName: string) => {
    try {
      await invoke("api_save_transcript_config", {
        provider: "localWhisper",
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

      const displayName = getDisplayName(modelName);

      try {
        updateDownloadingModels((prev) => new Set([...prev, modelName]));

        setModels((prevModels) =>
          prevModels.map((model) =>
            model.name === modelName
              ? { ...model, status: { Downloading: 0 } as ModelStatus }
              : model,
          ),
        );

        toast.info(`Downloading ${displayName}...`, {
          description: "This may take a few minutes",
          duration: 5000,
        });

        await WhisperAPI.downloadModel(modelName);
      } catch (err) {
        console.error("Download failed:", err);
        updateDownloadingModels((prev) => {
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
    [downloadingModels, getDisplayName],
  );

  // Keep the ref in sync with the latest downloadModel callback.
  useEffect(() => {
    downloadModelRef.current = downloadModel;
  }, [downloadModel]);

  // Listen to Whisper download events via the shared store
  // (frontend/src/lib/modelDownloadStore.ts), which owns the single Tauri
  // listen() registration per backend event. `event.raw` is the untouched
  // payload, so the throttling/state logic below is unchanged from the
  // original direct-listen() bodies — only the event source moved. The
  // handler reads fresh values via `modelsRef`, `downloadModelRef`,
  // `onModelSelectRef`, `autoSaveRef`, same as before.
  useModelDownloadEvents((event) => {
    if (event.kind !== "whisper") return;

    if (event.type === "complete") {
      const { modelName } = event.raw;
      const model = modelsRef.current.find((m) => m.name === modelName);
      const displayName = getDisplayName(modelName);

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

      toast.success(
        `${getModelIcon(model?.accuracy || "Good")} ${displayName} ready!`,
        {
          description: "Model downloaded and ready to use",
          duration: 4000,
        },
      );

      // Auto-select after download using stable refs
      if (onModelSelectRef.current) {
        onModelSelectRef.current(modelName);
        if (autoSaveRef.current) {
          saveModelSelection(modelName);
        }
      }
      return;
    }

    if (event.type === "error") {
      const { modelName, error } = event.raw;
      const displayName = getDisplayName(modelName);

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
          onClick: () => downloadModelRef.current(modelName),
        },
      });
      return;
    }

    // Download progress with throttling
    const { modelName, progress } = event.raw;
    const now = Date.now();
    const throttleData = progressThrottleRef.current.get(modelName);

    // Throttle: only update if 300ms passed OR progress jumped by 5%+
    const shouldUpdate =
      !throttleData ||
      now - throttleData.timestamp > 300 ||
      Math.abs(progress - throttleData.progress) >= 5;

    if (shouldUpdate) {
      console.log(
        `[ModelManager] Progress update for ${modelName}: ${progress}%`,
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
  });

  const cancelDownload = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.cancelDownload(modelName);

      updateDownloadingModels((prev) => {
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
    setHasUserSelection(true);

    if (onModelSelect) {
      onModelSelect(modelName);
    }

    if (autoSave) {
      await saveModelSelection(modelName);
    }

    const displayName = getDisplayName(modelName);
    toast.success(`Switched to ${displayName}`, {
      duration: 3000,
    });
  };

  const deleteModel = async (modelName: string) => {
    const displayName = getDisplayName(modelName);

    try {
      await WhisperAPI.deleteCorruptedModel(modelName);

      // Refresh models list
      const modelList = await WhisperAPI.getAvailableModels();
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

  // Delayed skeleton: only render the loading placeholder if the fetch
  // takes longer than ~250ms. The Tauri `WhisperAPI.init` + model-list
  // call typically completes in < 100ms on a warm cache, which made the
  // skeleton flash briefly then vanish — perceived as a "flash". With
  // the delay, fast loads render nothing → content; slow loads still
  // show the skeleton.
  const showSkeleton = useDelayedFlag(loading, 250);
  if (loading) {
    if (!showSkeleton) {
      return <div className={className} />;
    }
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-lg bg-muted"></div>
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
          rounded-lg border border-destructive/30 bg-destructive/10 p-4
          ${className}
        `}
      >
        <p className="text-sm text-destructive">Failed to load models</p>
        <p className="mt-1 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const basicModelNames = [
    "small",
    "medium-q5_0",
    "large-v3-turbo-q5_0",
    "large-v3-q5_0",
    "large-v3-turbo",
    "large-v3",
  ];
  const basicModels = models
    .filter((m) => basicModelNames.includes(m.name))
    .sort(
      (a, b) =>
        basicModelNames.indexOf(a.name) - basicModelNames.indexOf(b.name),
    );
  const advancedModels = models.filter(
    (m) => !basicModelNames.includes(m.name),
  );

  return (
    <div className={`
      space-y-3
      ${className}
    `}>
      {/* Basic Models */}
      <div className="space-y-3">
        {basicModels.map((model) => {
          // "medium-q5_0" is the app's default recommended model (see
          // getRecommendedModel()'s no-specs fallback in lib/whisper.ts)
          // and, unlike "base", is actually present in basicModelNames
          // above — so this badge can actually render.
          // Quantized turbo: near-large-v3 accuracy, faster than medium on
          // GPU, and a quarter of large-v3's download size.
          const isRecommended = model.name === "large-v3-turbo-q5_0";
          return (
            <ModelCard
              key={model.name}
              model={model}
              isSelected={selectedModel === model.name}
              isRecommended={isRecommended}
              onSelect={() => {
                if (model.status === "Available") {
                  selectModel(model.name);
                }
              }}
              onDownload={() => downloadModel(model.name)}
              onCancel={() => cancelDownload(model.name)}
              onDelete={() => deleteModel(model.name)}
              isDownloading={downloadingModels.has(model.name)}
              displayName={getDisplayName(model.name)}
            />
          );
        })}
      </div>

      {/* Advanced Models */}
      {advancedModels.length > 0 && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="advanced-models">
            <AccordionTrigger>
              <span className="text-lg">Advanced Models</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pt-4">
                {advancedModels.map((model) => (
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
                    displayName={getDisplayName(model.name)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Helper text */}
      {selectedModel && (
        <div className="pt-2 text-center text-sm text-muted-foreground">
          Using {getDisplayName(selectedModel)} for transcription
        </div>
      )}
    </div>
  );
}

// Model Card Component
interface ModelCardProps {
  model: ModelInfo;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isDownloading: boolean;
  displayName: string;
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
  displayName,
}: ModelCardProps) {
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
    // Plain <div>, not motion.div. We previously kept motion.div with
    // `initial={false}` because a nested <AnimatePresence> needed
    // framer-motion's parent context. That AnimatePresence has since
    // been replaced with pure CSS `group-hover` (no nested motion.*
    // children remain that need the context), so the wrapper itself
    // can drop framer-motion overhead — measurable per-render cost
    // when the page renders ~10 cards. The lone <motion.span> for
    // the ✓ checkmark on the selected card works standalone.
    <div
      className={`
        group relative cursor-pointer rounded-lg border-2
        ${
          isSelected && isAvailable
            ? "border-info bg-info/10"
            : isAvailable
              ? "border-border bg-background"
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
          absolute -top-2 -right-2 rounded-full bg-info px-2 py-0.5 text-sm
          font-medium text-white
        ">
          Recommended
        </div>
      )}

      <div className="p-3">
        <div className="mb-2 flex items-start justify-between">
          <div className="flex-1">
            {/* Model Name and Tagline */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-2xl">{getModelIcon(model.accuracy)}</span>
              <h3 className="font-semibold text-foreground">{displayName}</h3>
              <span className="text-sm text-muted-foreground">•</span>
              <span className="text-sm text-muted-foreground">
                {getModelTagline(model.name, model.speed, model.accuracy)}
              </span>
              {isSelected && isAvailable && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="
                    flex items-center gap-1 rounded-full bg-info px-2 py-0.5
                    text-sm font-medium text-white
                  "
                >
                  ✓
                </motion.span>
              )}
              {isQuantizedModel(model.name) && (
                <span
                  className={`
                    rounded-full px-2 py-0.5 text-sm
                    ${
                    getModelPerformanceBadge(model.name).color === "green"
                      ? "bg-success-muted text-success"
                      : getModelPerformanceBadge(model.name).color === "orange"
                        ? "bg-warning-muted text-warning"
                        : "bg-muted text-foreground"
                  }
                  `}
                >
                  {getModelPerformanceBadge(model.name).label}
                </span>
              )}
            </div>

            {/* Model Specs */}
            <div className="
              mt-1.5 ml-9 flex items-center space-x-4 text-sm
              text-muted-foreground
            ">
              <span className="flex items-center space-x-1">
                <span>📦</span>
                <span>{formatFileSize(model.size_mb)}</span>
              </span>
              <span className="flex items-center space-x-1">
                <span>🎯</span>
                <span>{model.accuracy} accuracy</span>
              </span>
              <span className="flex items-center space-x-1">
                <span>⚡</span>
                <span>{model.speed} processing</span>
              </span>
            </div>
          </div>

          {/* Status/Action */}
          <div className="ml-4 flex items-center gap-2">
            {isAvailable && (
              <>
                <div className="flex items-center gap-1.5 text-success">
                  <div className="size-2 rounded-full bg-success"></div>
                  <span className="text-sm font-medium">Ready</span>
                </div>
                {/* Hover-revealed delete. Always rendered; visibility
                    flips via `group-hover:opacity-100` on the parent
                    motion.div. Pure CSS — no React state, no
                    AnimatePresence mount/unmount per hover. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="
                    pointer-events-none p-1 text-muted-foreground/70 opacity-0
                    hover:text-destructive
                    group-hover:pointer-events-auto group-hover:opacity-100
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
                </button>
              </>
            )}

            {isMissing && (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                className="bg-info text-white hover:bg-info/90"
              >
                Download
              </Button>
            )}

            {downloadProgress === null && isError && (
              <Button
                size="sm"
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
              >
                Retry
              </Button>
            )}

            {isCorrupted && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="bg-warning text-white hover:bg-warning/90"
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload();
                  }}
                  className="bg-info text-white hover:bg-info/90"
                >
                  Re-download
                </Button>
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
                <span className="text-sm font-medium text-info">
                  Downloading...
                </span>
                <span className="text-sm font-semibold text-info">
                  {Math.round(downloadProgress)}%
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title="Cancel download"
              >
                Cancel
              </Button>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className="
                  h-full rounded-full bg-info
"
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
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
    </div>
  );
}
