import { ModelConfig } from "@/components/ModelSettingsModal";
import { PreferenceSettings } from "@/components/PreferenceSettings";
import { DeviceSelection } from "@/components/DeviceSelection";
import { LanguageSelection } from "@/components/LanguageSelection";
import { TranscriptSettings } from "@/components/TranscriptSettings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
      {modals.modelSettings && (
        <div
          className="
          bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
          bg-foreground p-4
        "
        >
          <div
            className="
            flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden
            rounded-lg bg-background shadow-xl
          "
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b p-6">
              <h3 className="text-xl font-semibold text-foreground">
                Preferences
              </h3>
              <button
                onClick={() => onClose("modelSettings")}
                className="
                  text-muted-foreground
                  hover:text-foreground
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

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
                          focus:border-blue-500 focus:ring-1 focus:ring-blue-500
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
                          focus:border-blue-500 focus:ring-1 focus:ring-blue-500
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
                          mb-4 rounded-sm border border-red-400 bg-red-100 px-4
                          py-3 text-red-700
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
                                  ? "bg-blue-600/10 ring-2 ring-blue-500"
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

            {/* Footer */}
            <div className="flex justify-end border-t p-6">
              <button
                onClick={() => onClose("modelSettings")}
                className="
                  rounded-md bg-blue-600 px-4 py-2 text-sm font-medium
                  text-white
                  hover:bg-blue-700
                  focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  focus:outline-none
                "
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Settings Modal */}
      {modals.deviceSettings && (
        <div
          className="
          bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
          bg-foreground
        "
        >
          <div
            className="
            mx-4 w-full max-w-md rounded-lg bg-background p-6 shadow-xl
          "
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                Audio Device Settings
              </h3>
              <button
                onClick={() => onClose("deviceSettings")}
                className="
                  text-muted-foreground
                  hover:text-foreground
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <DeviceSelection
              selectedDevices={selectedDevices}
              onDeviceChange={setSelectedDevices}
              disabled={isRecording}
            />

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  const micDevice = selectedDevices.micDevice || "Default";
                  const systemDevice =
                    selectedDevices.systemDevice || "Default";
                  toast.success("Devices selected", {
                    description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`,
                  });
                  onClose("deviceSettings");
                }}
                className="
                  rounded-md bg-blue-600 px-4 py-2 text-sm font-medium
                  text-white
                  hover:bg-blue-700
                  focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  focus:outline-none
                "
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Language Settings Modal */}
      {modals.languageSettings && (
        <div
          className="
          bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
          bg-foreground
        "
        >
          <div
            className="
            mx-4 w-full max-w-md rounded-lg bg-background p-6 shadow-xl
          "
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">
                Language Settings
              </h3>
              <button
                onClick={() => onClose("languageSettings")}
                className="
                  text-muted-foreground
                  hover:text-foreground
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <LanguageSelection
              selectedLanguage={selectedLanguage}
              onLanguageChange={setSelectedLanguage}
              disabled={isRecording}
              provider={transcriptModelConfig.provider}
            />

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => onClose("languageSettings")}
                className="
                  rounded-md bg-blue-600 px-4 py-2 text-sm font-medium
                  text-white
                  hover:bg-blue-700
                  focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  focus:outline-none
                "
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Model Selection Modal */}
      {modals.modelSelector && (
        <div
          className="
          bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
          bg-foreground
        "
        >
          <div
            className="
            mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg
            bg-background shadow-xl
          "
          >
            {/* Fixed Header */}
            <div
              className="
              flex items-center justify-between border-b border-border p-6 pb-4
            "
            >
              <h3 className="text-lg font-semibold text-foreground">
                {messages.modelSelector
                  ? "Speech Recognition Setup Required"
                  : "Transcription Model Settings"}
              </h3>
              <button
                onClick={() => onClose("modelSelector")}
                className="
                  text-muted-foreground
                  hover:text-foreground
                "
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="size-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

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
                    peer-checked:bg-blue-600
                    peer-focus:ring-2 peer-focus:ring-blue-300
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
                  <p className="text-xs text-muted-foreground">
                    Display colored dots showing transcription confidence
                    quality
                  </p>
                </div>
              </div>

              <button
                onClick={() => onClose("modelSelector")}
                className="
                  rounded-md bg-muted px-4 py-2 text-sm font-medium
                  text-foreground
                  hover:bg-muted
                  focus:ring-2 focus:ring-ring focus:ring-offset-2
                  focus:outline-none
                "
              >
                {messages.modelSelector ? "Cancel" : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Alert Modal */}
      {modals.errorAlert && (
        <div
          className="
          bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
          bg-foreground
        "
        >
          <Alert
            className="
            mx-4 max-w-md border-red-200 bg-background shadow-xl
          "
          >
            <AlertTitle className="text-red-800">Recording Stopped</AlertTitle>
            <AlertDescription className="text-red-700">
              {messages.errorAlert}
              <button
                onClick={() => onClose("errorAlert")}
                className="
                  ml-2 text-red-600 underline
                  hover:text-red-800
                "
              >
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Chunk Drop Warning Modal */}
      {modals.chunkDropWarning && (
        <div
          className="
          bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center
          bg-foreground
        "
        >
          <Alert
            className="
            mx-4 max-w-lg border-yellow-200 bg-background shadow-xl
          "
          >
            <AlertTitle className="text-yellow-800">
              Transcription Performance Warning
            </AlertTitle>
            <AlertDescription className="text-yellow-700">
              {messages.chunkDropWarning}
              <button
                onClick={() => onClose("chunkDropWarning")}
                className="
                  ml-2 text-yellow-600 underline
                  hover:text-yellow-800
                "
              >
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
