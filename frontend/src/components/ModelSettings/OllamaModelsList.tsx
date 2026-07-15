import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Heading } from "@/components/ui/typography";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Download, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { OllamaModel } from "./types";

interface OllamaModelsListProps {
  lastFetchedEndpoint: string;
  models: OllamaModel[];
  filteredModels: OllamaModel[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  isLoadingOllama: boolean;
  showOllamaLoading: boolean;
  ollamaNotInstalled: boolean;
  ollamaEndpointChanged: boolean;
  isDownloading: (modelName: string) => boolean;
  getProgress: (modelName: string) => number | undefined;
  onDownloadRecommended: () => void;
  selectedModel: string;
  onSelectModel: (modelName: string) => void;
}

const RECOMMENDED_MODEL = "gemma3:1b";

// Available-Ollama-models panel: search box, "not installed" / "no models
// yet" empty states (with the recommended-model download flow), and the
// scrollable model list with per-row download progress.
export function OllamaModelsList({
  lastFetchedEndpoint,
  models,
  filteredModels,
  searchQuery,
  setSearchQuery,
  isLoadingOllama,
  showOllamaLoading,
  ollamaNotInstalled,
  ollamaEndpointChanged,
  isDownloading,
  getProgress,
  onDownloadRecommended,
  selectedModel,
  onSelectModel,
}: OllamaModelsListProps) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Heading level={3}>Available Ollama Models</Heading>
        {lastFetchedEndpoint && models.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Using:</span>
            <code className="rounded-md bg-muted px-2 py-1 text-sm">
              {lastFetchedEndpoint || "http://localhost:11434"}
            </code>
          </div>
        )}
      </div>
      {models.length > 0 && (
        <div className="mb-4">
          <Input
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>
      )}
      {isLoadingOllama && showOllamaLoading ? (
        <div className="py-8 text-center text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 size-8 animate-spin" />
          Loading models...
        </div>
      ) : isLoadingOllama ? null : models.length === 0 ? (
        <div className="space-y-3">
          {ollamaNotInstalled ? (
            /* Show Ollama download link when not installed */
            <div className="space-y-4">
              <Alert className="border-warning bg-warning-muted">
                <AlertDescription className="text-warning">
                  Ollama is not installed or not running. Please download
                  and install Ollama to use local models.
                </AlertDescription>
              </Alert>
              <Button
                variant="default"
                size="sm"
                onClick={() =>
                  invoke("open_external_url", {
                    url: "https://ollama.com/download",
                  })
                }
                className="
                  w-full bg-info
                  hover:bg-info
                "
              >
                <ExternalLink className="mr-2 size-4" />
                Download Ollama
              </Button>
              <div className="text-center text-sm text-muted-foreground">
                After installing Ollama, restart this application and
                click &quot;Fetch Models&quot; to continue.
              </div>
            </div>
          ) : (
            /* Show model download option when Ollama is installed but no models */
            <>
              <Alert className="mb-4">
                <AlertDescription>
                  {ollamaEndpointChanged
                    ? 'Endpoint changed. Click "Fetch Models" to load models from the new endpoint.'
                    : 'No models found. Download a recommended model or click "Fetch Models" to load available Ollama models.'}
                </AlertDescription>
              </Alert>
              {!ollamaEndpointChanged && (
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDownloadRecommended}
                    disabled={isDownloading(RECOMMENDED_MODEL)}
                    className="w-full"
                  >
                    {isDownloading(RECOMMENDED_MODEL) ? (
                      <>
                        <RefreshCw className="mr-2 size-4 animate-spin" />
                        Downloading gemma3:1b...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 size-4" />
                        Download gemma3:1b (Recommended, ~800MB)
                      </>
                    )}
                  </Button>

                  {/* Show progress for gemma3:1b download */}
                  {isDownloading(RECOMMENDED_MODEL) &&
                    getProgress(RECOMMENDED_MODEL) !== undefined && (
                      <div className="rounded-md border bg-background p-3">
                        <div className="
                          mb-2 flex items-center justify-between
                        ">
                          <span className="
                            text-sm font-medium text-info
                          ">
                            Downloading gemma3:1b
                          </span>
                          <span className="
                            text-sm font-semibold text-info
                          ">
                            {Math.round(getProgress(RECOMMENDED_MODEL)!)}%
                          </span>
                        </div>
                        <div className="
                          h-2 w-full overflow-hidden rounded-full bg-muted
                        ">
                          <div
                            className="
                              h-full rounded-full bg-info transition-all
                              duration-300
                            "
                            style={{
                              width: `${getProgress(RECOMMENDED_MODEL)}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        !ollamaEndpointChanged && (
          <ScrollArea className="
            max-h-[calc(100vh-450px)] overflow-y-auto pr-4
          ">
            {filteredModels.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No models found matching &quot;{searchQuery}&quot;. Try a
                  different search term.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4">
                {filteredModels.map((model) => {
                  const progress = getProgress(model.name);
                  const modelIsDownloading = isDownloading(model.name);

                  return (
                    <div
                      key={model.id}
                      className={cn(
                        "m-0 rounded-md border bg-card p-2",
                        selectedModel === model.name
                          ? `
                            background-blue-100 border-info ring-1
                            ring-info
                          `
                          : "hover:bg-muted",
                        !modelIsDownloading && "cursor-pointer",
                      )}
                      onClick={() => {
                        if (!modelIsDownloading) {
                          onSelectModel(model.name);
                        }
                      }}
                    >
                      <div>
                        <b className="font-bold">{model.name}&nbsp;</b>
                        <span className="text-muted-foreground">
                          with a size of{" "}
                        </span>
                        <span className="font-mono text-sm font-bold">
                          {model.size}
                        </span>
                      </div>

                      {/* Progress bar for downloading models */}
                      {modelIsDownloading && progress !== undefined && (
                        <div className="mt-3 border-t border-border pt-3">
                          <div className="
                            mb-2 flex items-center justify-between
                          ">
                            <span className="
                              text-sm font-medium text-info
                            ">
                              Downloading...
                            </span>
                            <span className="
                              text-sm font-semibold text-info
                            ">
                              {Math.round(progress)}%
                            </span>
                          </div>
                          <div className="
                            h-2 w-full overflow-hidden rounded-full
                            bg-muted
                          ">
                            <div
                              className="
                                h-full rounded-full bg-info transition-all
                                duration-300
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
            )}
          </ScrollArea>
        )
      )}
    </div>
  );
}
