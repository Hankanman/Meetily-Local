import { ModelConfig } from "@/components/ModelSettingsModal";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { DeviceSelection } from "@/components/DeviceSelection";
import { LanguageSelection } from "@/components/LanguageSelection";
import { TranscriptSettings } from "@/components/TranscriptSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";

type modalType =
  | "modelSettings"
  | "deviceSettings"
  | "languageSettings"
  | "modelSelector"
  | "errorAlert"
  | "chunkDropWarning";

/**
 * SettingsModals Component
 *
 * All settings modals consolidated into a single component.
 * Uses ConfigContext and RecordingStateContext internally - no prop drilling needed!
 */

interface SettingsModalsProps {
  modals: {
    modelSettings: boolean;
    deviceSettings: boolean;
    languageSettings: boolean;
    modelSelector: boolean;
    errorAlert: boolean;
    chunkDropWarning: boolean;
  };
  messages: {
    errorAlert: string;
    chunkDropWarning: string;
    modelSelector: string;
  };
  onClose: (name: modalType) => void;
}

export function SettingsModals({
  modals,
  messages,
  onClose,
}: SettingsModalsProps) {
  // Contexts
  const {
    modelConfig,
    setModelConfig,
    models,
    modelOptions,
    error,
    selectedDevices,
    setSelectedDevices,
    selectedLanguage,
    setSelectedLanguage,
    transcriptModelConfig,
    setTranscriptModelConfig,
    showConfidenceIndicator,
    toggleConfidenceIndicator,
  } = useConfig();

  const { isRecording } = useRecordingState();

  return (
    <>
      {/* Legacy Settings Modal */}
      <Dialog
        open={modals.modelSettings}
        onOpenChange={(open) => {
          if (!open) onClose("modelSettings");
        }}
      >
        <DialogContent className="
          flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0
        ">
          <DialogHeader className="border-b p-6">
            <DialogTitle>Preferences</DialogTitle>
          </DialogHeader>

          {/* Content - Scrollable */}
          <div className="flex-1 space-y-8 overflow-y-auto p-6">
            {/* General Preferences Section */}
            <PreferenceSettings />

            {/* Divider */}
            <div className="border-t pt-8">
              <h4 className="mb-4 text-lg font-semibold text-foreground">
                AI Model Configuration
              </h4>
              <div className="space-y-4">
                <div>
                  <label
                    className="
                    mb-1 block text-sm font-medium text-foreground
                  "
                  >
                    Summarization Model
                  </label>
                  <div className="flex space-x-2">
                    <select
                      className="
                        rounded-md border border-border bg-background px-3
                        py-2 text-sm shadow-sm
                        focus:border-info focus:ring-1 focus:ring-info
                        focus:outline-none
                      "
                      value={modelConfig.provider}
                      onChange={(e) => {
                        const provider = e.target
                          .value as ModelConfig["provider"];
                        setModelConfig({
                          ...modelConfig,
                          provider,
                          model: modelOptions[provider][0],
                        });
                      }}
                    >
                      <option value="builtin-ai">Built-in AI</option>
                      <option value="claude">Claude</option>
                      <option value="groq">Groq</option>
                      <option value="ollama">Ollama</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="openai">OpenAI</option>
                    </select>

                    <select
                      className="
                        flex-1 rounded-md border border-border bg-background
                        px-3 py-2 text-sm shadow-sm
                        focus:border-info focus:ring-1 focus:ring-info
                        focus:outline-none
                      "
                      value={modelConfig.model}
                      onChange={(e) =>
                        setModelConfig((prev: ModelConfig) => ({
                          ...prev,
                          model: e.target.value,
                        }))
                      }
                    >
                      {modelOptions[modelConfig.provider].map(
                        (model: string) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>
                {modelConfig.provider === "ollama" && (
                  <div>
                    <h4 className="mb-4 text-lg font-bold">
                      Available Ollama Models
                    </h4>
                    {error && (
                      <div
                        className="
                        mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4
                        py-3 text-destructive
                      "
                      >
                        {error}
                      </div>
                    )}
                    <div
                      className="
                      grid max-h-100 gap-4 overflow-y-auto pr-2
                    "
                    >
                      {models.map((model) => (
                        <div
                          key={model.id}
                          className={`
                            cursor-pointer rounded-lg bg-background p-4
                            shadow-sm transition-colors
                            ${
                              modelConfig.model === model.name
                                ? "bg-info/10 ring-2 ring-info"
                                : "hover:bg-muted"
                            }
                          `}
                          onClick={() =>
                            setModelConfig((prev: ModelConfig) => ({
                              ...prev,
                              model: model.name,
                            }))
                          }
                        >
                          <h3 className="font-bold">{model.name}</h3>
                          <p className="text-muted-foreground">
                            Size: {model.size}
                          </p>
                          <p className="text-muted-foreground">
                            Modified: {model.modified}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t p-6">
            <Button onClick={() => onClose("modelSettings")}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Device Settings Modal */}
      <Dialog
        open={modals.deviceSettings}
        onOpenChange={(open) => {
          if (!open) onClose("deviceSettings");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Audio Device Settings</DialogTitle>
          </DialogHeader>

          <DeviceSelection
            selectedDevices={selectedDevices}
            onDeviceChange={setSelectedDevices}
            disabled={isRecording}
          />

          <DialogFooter>
            <Button
              onClick={() => {
                const micDevice = selectedDevices.micDevice || "Default";
                const systemDevice =
                  selectedDevices.systemDevice || "Default";
                toast.success("Devices selected", {
                  description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`,
                });
                onClose("deviceSettings");
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Language Settings Modal */}
      <Dialog
        open={modals.languageSettings}
        onOpenChange={(open) => {
          if (!open) onClose("languageSettings");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Language Settings</DialogTitle>
          </DialogHeader>

          <LanguageSelection
            selectedLanguage={selectedLanguage}
            onLanguageChange={setSelectedLanguage}
            disabled={isRecording}
            provider={transcriptModelConfig.provider}
          />

          <DialogFooter>
            <Button onClick={() => onClose("languageSettings")}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model Selection Modal */}
      <Dialog
        open={modals.modelSelector}
        onOpenChange={(open) => {
          if (!open) onClose("modelSelector");
        }}
      >
        <DialogContent className="
          flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0
        ">
          <DialogHeader className="border-b border-border p-6 pb-4">
            <DialogTitle>
              {messages.modelSelector
                ? "Speech Recognition Setup Required"
                : "Transcription Model Settings"}
            </DialogTitle>
          </DialogHeader>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-4">
            <TranscriptSettings
              transcriptModelConfig={transcriptModelConfig}
              setTranscriptModelConfig={setTranscriptModelConfig}
              onModelSelect={() => onClose("modelSelector")}
            />
          </div>

          {/* Fixed Footer */}
          <div
            className="
            flex items-center justify-between border-t border-border p-6 pt-4
          "
          >
            {/* Confidence Indicator Toggle */}
            <div className="flex items-center gap-3">
              <label
                className="
                relative inline-flex cursor-pointer items-center
              "
              >
                <input
                  type="checkbox"
                  checked={showConfidenceIndicator}
                  onChange={(e) =>
                    toggleConfidenceIndicator(e.target.checked)
                  }
                  className="peer sr-only"
                />
                <div
                  className="
                  peer h-6 w-11 rounded-full bg-muted
                  peer-checked:bg-info
                  peer-focus:ring-2 peer-focus:ring-info
                  peer-focus:outline-none
                  after:absolute after:inset-s-0.5 after:top-0.5
                  after:size-5 after:rounded-full after:border
                  after:border-border after:bg-background after:transition-all
                  after:content-['']
                  peer-checked:after:translate-x-full
                  peer-checked:after:border-background
                  rtl:peer-checked:after:-translate-x-full
                "
                ></div>
              </label>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Show Confidence Indicators
                </p>
                <p className="text-sm text-muted-foreground">
                  Display colored dots showing transcription confidence
                  quality
                </p>
              </div>
            </div>

            <Button
              variant="secondary"
              onClick={() => onClose("modelSelector")}
            >
              {messages.modelSelector ? "Cancel" : "Done"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error Alert Modal */}
      <Dialog
        open={modals.errorAlert}
        onOpenChange={(open) => {
          if (!open) onClose("errorAlert");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Recording Stopped
            </DialogTitle>
            <DialogDescription className="text-destructive">
              {messages.errorAlert}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => onClose("errorAlert")}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chunk Drop Warning Modal */}
      <Dialog
        open={modals.chunkDropWarning}
        onOpenChange={(open) => {
          if (!open) onClose("chunkDropWarning");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-warning">
              Transcription Performance Warning
            </DialogTitle>
            <DialogDescription className="text-warning">
              {messages.chunkDropWarning}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onClose("chunkDropWarning")}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
