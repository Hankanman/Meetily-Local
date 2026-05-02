"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Download, RefreshCw, BadgeAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ModelInfo {
  name: string;
  display_name: string;
  status: {
    type:
      | "not_downloaded"
      | "downloading"
      | "available"
      | "corrupted"
      | "error";
    progress?: number;
  };
  size_mb: number;
  context_size: number;
  description: string;
  gguf_file: string;
}

interface DownloadProgressInfo {
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface BuiltInModelManagerProps {
  selectedModel: string;
  onModelSelect: (model: string) => void;
}

export function BuiltInModelManager({
  selectedModel,
  onModelSelect,
}: BuiltInModelManagerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasFetched, setHasFetched] = useState<boolean>(false);
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, number>
  >({});
  const [downloadProgressInfo, setDownloadProgressInfo] = useState<
    Record<string, DownloadProgressInfo>
  >({});
  const [downloadingModels, setDownloadingModels] = useState<Set<string>>(
    new Set(),
  );

  const fetchModels = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = (await invoke("builtin_ai_list_models")) as ModelInfo[];
      setModels(data);

      // Auto-select first available model if none selected
      if (data.length > 0 && !selectedModel) {
        const firstAvailable = data.find((m) => m.status.type === "available");
        if (firstAvailable) {
          onModelSelect(firstAvailable.name);
        }
      }
    } catch (error) {
      console.error("Failed to fetch built-in AI models:", error);
      toast.error("Failed to load models");
    } finally {
      setIsLoading(false);
      setHasFetched(true);
    }
  }, [selectedModel, onModelSelect]);

  // Fetch models on mount. The setState calls inside fetchModels happen
  // after an `await`, but the lint rule can't see through the async
  // boundary so we suppress it here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchModels();
  }, [fetchModels]);

  // Listen for download progress events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen("builtin-ai-download-progress", (event: any) => {
        const { model, progress, downloaded_mb, total_mb, speed_mbps, status } =
          event.payload;

        // Update percentage progress
        setDownloadProgress((prev) => ({
          ...prev,
          [model]: progress,
        }));

        // Update detailed progress info (MB, speed)
        setDownloadProgressInfo((prev) => ({
          ...prev,
          [model]: {
            downloadedMb: downloaded_mb ?? 0,
            totalMb: total_mb ?? 0,
            speedMbps: speed_mbps ?? 0,
          },
        }));

        // Handle downloading status - restore downloadingModels state on modal reopen
        if (status === "downloading") {
          setDownloadingModels((prev) => {
            if (!prev.has(model)) {
              const newSet = new Set(prev);
              newSet.add(model);
              return newSet;
            }
            return prev;
          });
        }

        // Handle completed status
        if (status === "completed") {
          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(model);
            return newSet;
          });
          // Clean up progress state
          setDownloadProgress((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          setDownloadProgressInfo((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          // Refresh models list
          fetchModels();
          toast.success(`Model ${model} downloaded successfully`);
        }

        // Handle cancelled status
        if (status === "cancelled") {
          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(model);
            return newSet;
          });
          // Clean up progress state
          setDownloadProgress((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          setDownloadProgressInfo((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          // Refresh models list
          fetchModels();
        }

        // Handle error status
        if (status === "error") {
          setDownloadingModels((prev) => {
            const newSet = new Set(prev);
            newSet.delete(model);
            return newSet;
          });
          // Clean up progress state
          setDownloadProgress((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });
          setDownloadProgressInfo((prev) => {
            const { [model]: _, ...rest } = prev;
            return rest;
          });

          // Update model status to error locally instead of fetching from backend
          // Backend doesn't persist error status, so fetchModels() would return not_downloaded
          setModels((prevModels) =>
            prevModels.map((m) =>
              m.name === model
                ? {
                    ...m,
                    status: {
                      type: "error",
                      progress: 0,
                    } as any,
                  }
                : m,
            ),
          );

          // Don't show error toast here - DownloadProgressToast already handles it
          // Don't call fetchModels() - it would overwrite error status with not_downloaded
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [fetchModels]);

  const downloadModel = async (modelName: string) => {
    try {
      // Optimistically add to downloadingModels for immediate UI feedback
      setDownloadingModels((prev) => new Set([...prev, modelName]));

      await invoke("builtin_ai_download_model", { modelName });
    } catch (error) {
      console.error("Failed to download model:", error);

      // Check if this is a cancellation error (starts with "CANCELLED:")
      const errorMsg = String(error);
      if (errorMsg.startsWith("CANCELLED:")) {
        // Cancel handler already removed from downloadingModels
        // Don't show error toast for cancellations - cancel function already shows info toast
        return;
      }

      // For real errors, show toast and remove from downloading
      toast.error(`Failed to download ${modelName}`);

      setDownloadingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });

      // Refresh model list to get updated Error status from backend
      fetchModels();
    }
  };

  const cancelDownload = async (modelName: string) => {
    try {
      await invoke("builtin_ai_cancel_download", { modelName });
      toast.info(`Download of ${modelName} cancelled`);
      setDownloadingModels((prev) => {
        const newSet = new Set(prev);
        newSet.delete(modelName);
        return newSet;
      });
    } catch (error) {
      console.error("Failed to cancel download:", error);
    }
  };

  const deleteModel = async (modelName: string) => {
    try {
      await invoke("builtin_ai_delete_model", { modelName });
      toast.success(`Model ${modelName} deleted`);
      fetchModels();
    } catch (error) {
      console.error("Failed to delete model:", error);
      toast.error(`Failed to delete ${modelName}`);
    }
  };

  // Don't show loading spinner if we have downloads in progress - show the model list instead
  if (isLoading && downloadingModels.size === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        <RefreshCw className="mx-auto mb-2 size-8 animate-spin" />
        Loading models...
      </div>
    );
  }

  // Only show "no models" message after fetch has completed
  if (hasFetched && models.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No models found. Download a model to get started with Built-in AI.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-sm font-bold">Built-in AI Models</h4>
      </div>

      <div className="grid gap-4">
        {models.map((model) => {
          const progress = downloadProgress[model.name];
          const progressInfo = downloadProgressInfo[model.name];
          const modelIsDownloading = downloadingModels.has(model.name);
          const isAvailable = model.status.type === "available";
          const isNotDownloaded = model.status.type === "not_downloaded";
          const isCorrupted = model.status.type === "corrupted";
          const isError = model.status.type === "error";

          return (
            <div
              key={model.name}
              className={cn(
                "rounded-lg border p-4 transition-colors",
                modelIsDownloading ? "border-border bg-background" : "bg-card",
                selectedModel === model.name
                  ? "border-foreground ring-2 ring-foreground"
                  : `
                    border-border
                    hover:border-border
                  `,
                isAvailable && !modelIsDownloading && "cursor-pointer",
              )}
              onClick={() => {
                if (isAvailable && !modelIsDownloading) {
                  onModelSelect(model.name);
                }
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">
                      {model.display_name || model.name}
                    </span>
                    {isAvailable && (
                      <>
                        <span className="
                          flex items-center gap-1 text-sm font-medium
                          text-success
                        ">
                          <span className="size-2 rounded-full bg-success"></span>
                          Ready
                        </span>
                        {selectedModel === model.name && (
                          <span className="
                            rounded-md bg-info/15 px-2 py-0.5 text-sm
                            font-medium text-info
                          ">
                            Selected
                          </span>
                        )}
                      </>
                    )}
                    {isCorrupted && (
                      <span className="
                        flex items-center gap-1 rounded-md bg-destructive/10 px-2
                        py-0.5 text-sm font-medium text-destructive
                      ">
                        <BadgeAlert className="size-3" />
                        Corrupted
                      </span>
                    )}
                    {isError && (
                      <span className="
                        rounded-md bg-destructive/10 px-2 py-0.5 text-sm font-medium
                        text-destructive
                      ">
                        Error
                      </span>
                    )}
                    {isNotDownloaded && !modelIsDownloading && (
                      <span className="
                        text-sm font-medium text-muted-foreground
                      ">
                        Not Downloaded
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {model.description && (
                      <p className="mb-1">{model.description}</p>
                    )}
                    {(isError || isCorrupted) && (
                      <p className="mb-1 text-sm text-destructive">
                        {isError &&
                        typeof model.status === "object" &&
                        "Error" in model.status
                          ? (model.status as any).Error
                          : isCorrupted
                            ? "File is corrupted. Retry download or delete."
                            : "An error occurred"}
                      </p>
                    )}
                    <div className="text-sm text-muted-foreground">
                      <span>
                        {model.size_mb}MB • {model.context_size} tokens
                      </span>
                    </div>
                  </div>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  {/* Not Downloaded - Show Download button */}
                  {isNotDownloaded && !modelIsDownloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-25"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadModel(model.name);
                      }}
                    >
                      <Download className="mr-2 size-4" />
                      Download
                    </Button>
                  )}

                  {/* Downloading - Show Cancel button */}
                  {modelIsDownloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-25"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelDownload(model.name);
                      }}
                    >
                      Cancel
                    </Button>
                  )}

                  {/* Error - Show Retry button */}
                  {isError && !modelIsDownloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-w-25"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadModel(model.name);
                      }}
                    >
                      <RefreshCw className="mr-2 size-4" />
                      Retry
                    </Button>
                  )}

                  {/* Corrupted - Show both Retry and Delete buttons */}
                  {isCorrupted && !modelIsDownloading && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadModel(model.name);
                        }}
                      >
                        <RefreshCw className="mr-2 size-4" />
                        Retry
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteModel(model.name);
                        }}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Delete
                      </Button>
                    </>
                  )}

                  {/* Available - Show small trash icon (only if not currently selected) */}
                  {isAvailable &&
                    !modelIsDownloading &&
                    selectedModel !== model.name && (
                      <button
                        className="
                          rounded-md p-2 text-muted-foreground transition-colors
                          hover:bg-muted hover:text-destructive
                        "
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteModel(model.name);
                        }}
                        title="Delete model"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                </div>
              </div>

              {/* Download progress bar */}
              {modelIsDownloading && progress !== undefined && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      Downloading...
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <div className="mb-2 text-sm text-muted-foreground">
                    {progressInfo?.totalMb > 0 ? (
                      <>
                        {progressInfo.downloadedMb.toFixed(1)} MB /{" "}
                        {progressInfo.totalMb.toFixed(1)} MB
                        {progressInfo.speedMbps > 0 && (
                          <span className="ml-2 text-muted-foreground">
                            ({progressInfo.speedMbps.toFixed(1)} MB/s)
                          </span>
                        )}
                      </>
                    ) : (
                      <span>{model.size_mb} MB</span>
                    )}
                  </div>
                  <div className="
                    h-2.5 w-full overflow-hidden rounded-full bg-muted
                  ">
                    <div
                      className="
                        h-full rounded-full bg-linear-to-r from-gray-800
                        to-gray-900 transition-all duration-300
                      "
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
