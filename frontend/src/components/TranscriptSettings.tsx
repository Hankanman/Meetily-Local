import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { ModelManager } from "./WhisperModelManager";
import { SettingsCard } from "@/app/settings/parts/SettingsCard";

export interface TranscriptModelProps {
  provider:
    | "localWhisper"
    | "deepgram"
    | "elevenLabs"
    | "groq"
    | "openai";
  model: string;
  apiKey?: string | null;
}

export interface TranscriptSettingsProps {
  transcriptModelConfig: TranscriptModelProps;
  setTranscriptModelConfig: (config: TranscriptModelProps) => void;
  onModelSelect?: () => void;
}

export function TranscriptSettings({
  transcriptModelConfig,
  setTranscriptModelConfig,
  onModelSelect,
}: TranscriptSettingsProps) {
  const [apiKey, setApiKey] = useState<string | null>(
    transcriptModelConfig.apiKey || null,
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(true);
  const [isLockButtonVibrating, setIsLockButtonVibrating] =
    useState<boolean>(false);
  const [uiProvider, setUiProvider] = useState<
    TranscriptModelProps["provider"]
  >(transcriptModelConfig.provider);

  // Sync uiProvider when backend config changes (e.g., after model selection or initial load).
  // uiProvider is mutable local state (changes when user picks a provider in the UI),
  // so it cannot be purely derived from the prop.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUiProvider(transcriptModelConfig.provider);
  }, [transcriptModelConfig.provider]);

  // Clear API key when switching to a provider that doesn't use one
  useEffect(() => {
    if (transcriptModelConfig.provider === "localWhisper") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApiKey(null);
    }
  }, [transcriptModelConfig.provider]);

  const fetchApiKey = async (provider: string) => {
    try {
      const data = (await invoke("api_get_transcript_api_key", {
        provider,
      })) as string;

      setApiKey(data || "");
    } catch (err) {
      console.error("Error fetching API key:", err);
      setApiKey(null);
    }
  };
  const modelOptions = {
    localWhisper: [], // Model selection handled by ModelManager component
    deepgram: ["nova-2-phonecall"],
    elevenLabs: ["eleven_multilingual_v2"],
    groq: ["llama-3.3-70b-versatile"],
    openai: ["gpt-4o"],
  };
  const requiresApiKey =
    transcriptModelConfig.provider === "deepgram" ||
    transcriptModelConfig.provider === "elevenLabs" ||
    transcriptModelConfig.provider === "openai" ||
    transcriptModelConfig.provider === "groq";

  const handleInputClick = () => {
    if (isApiKeyLocked) {
      setIsLockButtonVibrating(true);
      setTimeout(() => setIsLockButtonVibrating(false), 500);
    }
  };

  const handleWhisperModelSelect = (modelName: string) => {
    // Always update config when model is selected, regardless of current provider
    // This ensures the model is set when user switches back
    setTranscriptModelConfig({
      ...transcriptModelConfig,
      provider: "localWhisper", // Ensure provider is set correctly
      model: modelName,
    });
    // Close modal after selection
    if (onModelSelect) {
      onModelSelect();
    }
  };

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Transcription provider"
        description="Local Whisper runs on your machine; cloud providers send audio to a third-party API."
      >
        <div className="flex flex-wrap gap-2">
          <Select
            value={uiProvider}
            onValueChange={(value) => {
              const provider = value as TranscriptModelProps["provider"];
              setUiProvider(provider);
              if (provider !== "localWhisper") {
                fetchApiKey(provider);
              }
            }}
          >
            <SelectTrigger className="
              w-full max-w-xs
              focus:border-info focus:ring-1 focus:ring-info
            ">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="localWhisper">
                🏠 Local Whisper (High Accuracy)
              </SelectItem>
              {/* Cloud providers can be re-enabled here once their flows are
                  wired:
                  <SelectItem value="deepgram">☁️ Deepgram</SelectItem>
                  <SelectItem value="elevenLabs">☁️ ElevenLabs</SelectItem>
                  <SelectItem value="groq">☁️ Groq</SelectItem>
                  <SelectItem value="openai">☁️ OpenAI</SelectItem> */}
            </SelectContent>
          </Select>

          {uiProvider !== "localWhisper" && (
            <Select
              value={transcriptModelConfig.model}
              onValueChange={(value) => {
                const model = value as TranscriptModelProps["model"];
                setTranscriptModelConfig({
                  ...transcriptModelConfig,
                  provider: uiProvider,
                  model,
                });
              }}
            >
              <SelectTrigger className="
                w-full max-w-xs
                focus:border-info focus:ring-1 focus:ring-info
              ">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions[uiProvider].map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </SettingsCard>

      {uiProvider === "localWhisper" && (
        <SettingsCard
          title="Whisper model"
          description="Larger models are slower but more accurate. Pick one that fits your hardware."
        >
          <ModelManager
            selectedModel={
              transcriptModelConfig.provider === "localWhisper"
                ? transcriptModelConfig.model
                : undefined
            }
            onModelSelect={handleWhisperModelSelect}
            autoSave={true}
          />
        </SettingsCard>
      )}

      {requiresApiKey && (
        <SettingsCard
          title="API key"
          description="Required for the selected cloud provider. The key is stored locally."
        >
          <div className="relative">
            <Input
              type={showApiKey ? "text" : "password"}
              className={`
                pr-24
                focus:border-info focus:ring-1 focus:ring-info
                ${isApiKeyLocked ? "cursor-not-allowed bg-muted" : ""}
              `}
              value={apiKey || ""}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={isApiKeyLocked}
              onClick={handleInputClick}
              placeholder="Enter your API key"
            />
            {isApiKeyLocked && (
              <div
                onClick={handleInputClick}
                className="
                  absolute inset-0 flex cursor-not-allowed items-center
                  justify-center rounded-md bg-muted/50
                "
              />
            )}
            <div className="absolute inset-y-0 right-0 flex items-center pr-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsApiKeyLocked(!isApiKeyLocked)}
                className={`
                  transition-colors duration-200
                  ${isLockButtonVibrating
                    ? "animate-vibrate text-destructive"
                    : ""}
                `}
                title={
                  isApiKeyLocked ? "Unlock to edit" : "Lock to prevent editing"
                }
              >
                {isApiKeyLocked ? (
                  <Lock className="size-4" />
                ) : (
                  <Unlock className="size-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
