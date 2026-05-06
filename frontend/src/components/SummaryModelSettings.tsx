"use client";

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  ModelConfig,
  ModelSettingsModal,
} from "@/components/ModelSettingsModal";
import { Switch } from "./ui/switch";
import { useConfig } from "@/contexts/ConfigContext";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import {
  SettingsCard,
  SettingsRow,
} from "@/app/settings/parts/SettingsCard";

interface SummaryModelSettingsProps {
  refetchTrigger?: number; // Change this to trigger refetch
}

export function SummaryModelSettings({
  refetchTrigger,
}: SummaryModelSettingsProps) {
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: "ollama",
    model: "llama3.2:latest",
    whisperModel: "large-v3",
    apiKey: null,
    ollamaEndpoint: null,
  });
  // Don't render the ModelSettingsModal until the initial fetch
  // completes — otherwise the modal mounts with the placeholder
  // defaults above (provider: "ollama", model: "llama3.2:latest"),
  // renders one frame of "ollama" UI, then the fetch resolves with the
  // real provider (e.g. "builtin-ai") and the UI swaps. Perceived as a
  // content-flash separate from the fetch skeleton.
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  const { isAutoSummary, toggleIsAutoSummary } = useConfig();

  // Reusable fetch function
  const fetchModelConfig = useCallback(async () => {
    try {
      const data = (await invoke("api_get_model_config")) as any;
      if (data && data.provider !== null) {
        // Fetch API key if not included and provider requires it
        if (
          data.provider !== "ollama" &&
          data.provider !== "builtin-ai" &&
          !data.apiKey
        ) {
          try {
            const apiKeyData = (await invoke("api_get_api_key", {
              provider: data.provider,
            })) as string;
            data.apiKey = apiKeyData;
          } catch (err) {
            console.error("Failed to fetch API key:", err);
          }
        }
        // Fetch Custom OpenAI config if that's the active provider
        if (data.provider === "custom-openai") {
          try {
            const customConfig = (await invoke(
              "api_get_custom_openai_config",
            )) as any;
            if (customConfig) {
              data.customOpenAIDisplayName = customConfig.displayName || null;
              data.customOpenAIEndpoint = customConfig.endpoint || null;
              data.customOpenAIModel = customConfig.model || null;
              data.customOpenAIApiKey = customConfig.apiKey || null;
              data.maxTokens = customConfig.maxTokens || null;
              data.temperature = customConfig.temperature || null;
              data.topP = customConfig.topP || null;
              // For custom-openai, model field should match customOpenAIModel
              data.model = customConfig.model || data.model;
            }
          } catch (err) {
            console.error("Failed to fetch custom OpenAI config:", err);
          }
        }
        setModelConfig(data);
      }
    } catch (error) {
      console.error("Failed to fetch model config:", error);
      toast.error("Failed to load model settings");
    } finally {
      setInitialFetchDone(true);
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    // setModelConfig happens after await inside fetchModelConfig.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchModelConfig();
  }, [fetchModelConfig]);

  // Refetch when trigger changes (optional external control)
  useEffect(() => {
    if (refetchTrigger !== undefined && refetchTrigger > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchModelConfig();
    }
  }, [refetchTrigger, fetchModelConfig]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<ModelConfig>(
        "model-config-updated",
        (event) => {
          console.log(
            "SummaryModelSettings received model-config-updated event:",
            event.payload,
          );
          setModelConfig(event.payload);
        },
      );

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then((fn) => (cleanup = fn));

    return () => {
      cleanup?.();
    };
  }, []);

  // Save handler
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke("api_save_model_config", {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);

      // Emit event to sync other components
      const { emit } = await import("@tauri-apps/api/event");
      await emit("model-config-updated", config);

      toast.success("Model settings saved successfully");
    } catch (error) {
      console.error("Error saving model config:", error);
      toast.error("Failed to save model settings");
    }
  };

  // Show the loading placeholder only if the initial fetch takes longer
  // than ~250ms. Fast loads (the typical case) skip the placeholder
  // entirely; slow loads still show feedback so the panel doesn't look
  // dead.
  const showLoadingFallback = useDelayedFlag(!initialFetchDone, 250);

  return (
    <div className="space-y-4">
      <SettingsCard>
        <SettingsRow
          label="Auto-summary"
          description="Generate a summary automatically when a meeting recording stops."
        >
          <Switch
            checked={isAutoSummary}
            onCheckedChange={toggleIsAutoSummary}
          />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard
        title="Summary model"
        description="The AI engine + model used to write meeting summaries."
      >
        {!initialFetchDone ? (
          showLoadingFallback ? (
            <div className="h-32 animate-pulse rounded-md bg-muted/40" />
          ) : null
        ) : (
          <ModelSettingsModal
            modelConfig={modelConfig}
            setModelConfig={setModelConfig}
            onSave={handleSaveModelConfig}
            skipInitialFetch={true}
          />
        )}
      </SettingsCard>
    </div>
  );
}
