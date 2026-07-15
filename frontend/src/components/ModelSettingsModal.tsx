import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { useOllamaDownload } from "@/contexts/OllamaDownloadContext";
import { BuiltInModelManager } from "@/components/BuiltInModelManager";
import { Label } from "@/components/ui/label";
import { Heading } from "@/components/ui/typography";
import { useConfig } from "@/contexts/ConfigContext";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { Switch } from "@/components/ui/switch";
import { cn, isOllamaNotInstalledError } from "@/lib/utils";
import { toast } from "sonner";
import {
  ModelConfig,
  OllamaModel,
  OpenRouterModel,
  OpenAIModel,
  AnthropicModel,
  GroqModel,
} from "./ModelSettings/types";
import {
  OPENAI_FALLBACK_MODELS,
  CLAUDE_FALLBACK_MODELS,
  GROQ_FALLBACK_MODELS,
} from "./ModelSettings/constants";
import {
  validateOllamaEndpoint,
  readProviderModelMap,
  saveProviderModel,
} from "./ModelSettings/utils/helpers";
import { ProviderModelPicker } from "./ModelSettings/ProviderModelPicker";
import { CustomOpenAISection } from "./ModelSettings/CustomOpenAISection";
import { ApiKeyField } from "./ModelSettings/ApiKeyField";
import { OllamaEndpointConfig } from "./ModelSettings/OllamaEndpointConfig";
import { OllamaModelsList } from "./ModelSettings/OllamaModelsList";

export type { ModelConfig };

interface ModelSettingsModalProps {
  modelConfig: ModelConfig;
  setModelConfig: (
    config: ModelConfig | ((prev: ModelConfig) => ModelConfig),
  ) => void;
  onSave: (config: ModelConfig) => void;
  skipInitialFetch?: boolean; // Optional: skip fetching config from backend if parent manages it
}

export function ModelSettingsModal({
  modelConfig: propsModelConfig,
  setModelConfig: propsSetModelConfig,
  onSave,
  skipInitialFetch = false,
}: ModelSettingsModalProps) {
  // Use ConfigContext if available, fallback to props for backward compatibility
  const configContext = useConfig();
  const modelConfig = configContext?.modelConfig || propsModelConfig;
  const setModelConfig = configContext?.setModelConfig || propsSetModelConfig;
  const providerApiKeys = configContext?.providerApiKeys;
  const updateProviderApiKey = configContext?.updateProviderApiKey;

  const [models, setModels] = useState<OllamaModel[]>([]);
  const [error, setError] = useState<string>("");
  const [apiKey, setApiKey] = useState<string | null>(
    modelConfig.apiKey || null,
  );
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isApiKeyLocked, setIsApiKeyLocked] = useState<boolean>(
    !!modelConfig.apiKey?.trim(),
  );
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>(
    [],
  );
  const [openRouterError, setOpenRouterError] = useState<string>("");
  const [isLoadingOpenRouter, setIsLoadingOpenRouter] =
    useState<boolean>(false);
  const [ollamaEndpoint, setOllamaEndpoint] = useState<string>(
    modelConfig.ollamaEndpoint || "",
  );
  const [isLoadingOllama, setIsLoadingOllama] = useState<boolean>(false);
  const [lastFetchedEndpoint, setLastFetchedEndpoint] = useState<string>(
    modelConfig.ollamaEndpoint || "",
  );
  const [endpointValidationState, setEndpointValidationState] = useState<
    "valid" | "invalid" | "none"
  >("none");
  const [hasAutoFetched, setHasAutoFetched] = useState<boolean>(false);
  const hasSyncedFromParent = useRef<boolean>(false);
  const hasLoadedInitialConfig = useRef<boolean>(false);
  // The auto-generate toggle UI is currently commented out (see below);
  // Rust backing commands `api_get_auto_generate_setting` /
  // `api_save_auto_generate_setting` were removed too. Re-add both ends
  // together if reintroducing the feature.
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isEndpointSectionCollapsed, setIsEndpointSectionCollapsed] =
    useState<boolean>(true); // Collapsed by default
  const [ollamaNotInstalled, setOllamaNotInstalled] = useState<boolean>(false); // Track if Ollama is not installed

  // Custom OpenAI state
  const [customOpenAIEndpoint, setCustomOpenAIEndpoint] = useState<string>(
    modelConfig.customOpenAIEndpoint || "",
  );
  const [customOpenAIModel, setCustomOpenAIModel] = useState<string>(
    modelConfig.customOpenAIModel || "",
  );
  const [customOpenAIApiKey, setCustomOpenAIApiKey] = useState<string>(
    modelConfig.customOpenAIApiKey || "",
  );
  const [customMaxTokens, setCustomMaxTokens] = useState<string>(
    modelConfig.maxTokens?.toString() || "",
  );
  const [customTemperature, setCustomTemperature] = useState<string>(
    modelConfig.temperature?.toString() || "",
  );
  const [customTopP, setCustomTopP] = useState<string>(
    modelConfig.topP?.toString() || "",
  );
  const [isCustomOpenAIAdvancedOpen, setIsCustomOpenAIAdvancedOpen] =
    useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] =
    useState<boolean>(false);

  // Combobox state
  const [modelComboboxOpen, setModelComboboxOpen] = useState<boolean>(false);

  // Dynamic model fetching state for OpenAI, Claude, and Groq
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [claudeModels, setClaudeModels] = useState<string[]>([]);
  const [groqModels, setGroqModels] = useState<string[]>([]);
  const [isLoadingOpenAI, setIsLoadingOpenAI] = useState<boolean>(false);
  const [isLoadingClaude, setIsLoadingClaude] = useState<boolean>(false);
  const [isLoadingGroq, setIsLoadingGroq] = useState<boolean>(false);

  // Use global download context instead of local state
  const { isDownloading, getProgress, downloadingModels } = useOllamaDownload();

  // Built-in AI models state
  const [builtinAiModels, setBuiltinAiModels] = useState<any[]>([]);

  // Cache models by endpoint to avoid refetching when reverting endpoint changes
  const modelsCache = useRef<Map<string, OllamaModel[]>>(new Map());

  // Debounced URL validation with visual feedback
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = ollamaEndpoint.trim();

      if (!trimmed) {
        setEndpointValidationState("none");
      } else if (validateOllamaEndpoint(trimmed)) {
        setEndpointValidationState("valid");
      } else {
        setEndpointValidationState("invalid");
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [ollamaEndpoint]);

  const fetchApiKey = async (provider: string) => {
    try {
      const data = (await invoke("api_get_api_key", {
        provider,
      })) as string;
      setApiKey(data || "");
    } catch (err) {
      console.error("Error fetching API key:", err);
      setApiKey(null);
    }
  };

  // Auto-unlock when API key becomes empty. The lock state is also user-toggleable,
  // so it can't be purely derived from apiKey — we need to react to the empty case.
  useEffect(() => {
    const hasContent = !!apiKey?.trim();
    if (!hasContent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsApiKeyLocked(false);
    }
  }, [apiKey]);

  const modelOptions: Record<string, string[]> = useMemo(
    () => ({
      ollama: models.map((model) => model.name),
      claude: claudeModels.length > 0 ? claudeModels : CLAUDE_FALLBACK_MODELS,
      groq: groqModels.length > 0 ? groqModels : GROQ_FALLBACK_MODELS,
      openai: openaiModels.length > 0 ? openaiModels : OPENAI_FALLBACK_MODELS,
      openrouter: openRouterModels.map((m) => m.id),
      "builtin-ai": builtinAiModels.map((m) => m.name),
      "custom-openai": customOpenAIModel ? [customOpenAIModel] : [], // User specifies model manually
    }),
    [
      models,
      claudeModels,
      groqModels,
      openaiModels,
      openRouterModels,
      builtinAiModels,
      customOpenAIModel,
    ],
  );

  const requiresApiKey =
    modelConfig.provider === "claude" ||
    modelConfig.provider === "groq" ||
    modelConfig.provider === "openai" ||
    modelConfig.provider === "openrouter";

  // Check if Ollama endpoint has changed but models haven't been fetched yet
  const ollamaEndpointChanged =
    modelConfig.provider === "ollama" &&
    ollamaEndpoint.trim() !== lastFetchedEndpoint.trim();

  // Custom OpenAI validation
  const isCustomOpenAIInvalid =
    modelConfig.provider === "custom-openai" &&
    (!customOpenAIEndpoint.trim() || !customOpenAIModel.trim());

  const isDoneDisabled =
    (requiresApiKey &&
      (!apiKey || (typeof apiKey === "string" && !apiKey.trim()))) ||
    (modelConfig.provider === "ollama" && ollamaEndpointChanged) ||
    isCustomOpenAIInvalid;

  // Delayed loading flags — the model-list fetches typically resolve in
  // < 200ms, which would otherwise flash a "Loading models…" spinner
  // briefly before swapping to the real list. Skip the spinner unless
  // the load is actually slow.
  const isCloudLoading =
    (modelConfig.provider === "openrouter" && isLoadingOpenRouter) ||
    (modelConfig.provider === "openai" && isLoadingOpenAI) ||
    (modelConfig.provider === "claude" && isLoadingClaude) ||
    (modelConfig.provider === "groq" && isLoadingGroq);
  const showCloudLoading = useDelayedFlag(isCloudLoading, 250);
  const showOllamaLoading = useDelayedFlag(isLoadingOllama, 250);

  useEffect(() => {
    const fetchModelConfig = async () => {
      // If parent component manages config, skip fetch and just mark as loaded
      if (skipInitialFetch) {
        hasLoadedInitialConfig.current = true;
        return;
      }

      try {
        const data = (await invoke("api_get_model_config")) as any;
        if (data && data.provider !== null) {
          setModelConfig(data);

          // Fetch API key if not included in response and provider requires it
          if (data.provider !== "ollama" && !data.apiKey) {
            try {
              const apiKeyData = (await invoke("api_get_api_key", {
                provider: data.provider,
              })) as string;
              data.apiKey = apiKeyData;
              setApiKey(apiKeyData);
            } catch (err) {
              console.error("Failed to fetch API key:", err);
            }
          }

          // Sync ollamaEndpoint state with fetched config
          if (data.ollamaEndpoint) {
            setOllamaEndpoint(data.ollamaEndpoint);
            // Don't set lastFetchedEndpoint here - it will be set after successful model fetch
          }
          hasLoadedInitialConfig.current = true; // Mark that initial config is loaded

          // Fetch Custom OpenAI config if that's the active provider
          if (data.provider === "custom-openai") {
            try {
              const customConfig = (await invoke(
                "api_get_custom_openai_config",
              )) as any;
              if (customConfig) {
                setCustomOpenAIEndpoint(customConfig.endpoint || "");
                setCustomOpenAIModel(customConfig.model || "");
                setCustomOpenAIApiKey(customConfig.apiKey || "");
                setCustomMaxTokens(customConfig.maxTokens?.toString() || "");
                setCustomTemperature(
                  customConfig.temperature?.toString() || "",
                );
                setCustomTopP(customConfig.topP?.toString() || "");
              }
            } catch (err) {
              console.error("Failed to fetch custom OpenAI config:", err);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch model config:", error);
        hasLoadedInitialConfig.current = true; // Mark as loaded even on error
      }
    };

    fetchModelConfig();
  }, [skipInitialFetch, setModelConfig]);

  // Sync ollamaEndpoint state when modelConfig.ollamaEndpoint changes from parent.
  // ollamaEndpoint is mutable local state (user can type into the input), so it cannot
  // be purely derived; we compare against the prop and only update on parent-driven change.
  useEffect(() => {
    const endpoint = modelConfig.ollamaEndpoint || "";
    if (endpoint !== ollamaEndpoint) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOllamaEndpoint(endpoint);
      // Don't set lastFetchedEndpoint here - only after successful model fetch
    }
    // Only mark as synced if we have a valid provider (prevents race conditions during init)
    if (modelConfig.provider) {
      hasSyncedFromParent.current = true; // Mark that we've received prop value
    }
    // ollamaEndpoint intentionally excluded — it's the comparison target, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelConfig.ollamaEndpoint, modelConfig.provider]);

  // Sync custom OpenAI state from modelConfig (context or props).
  // Local state mirrors the modelConfig prop fields so the UI inputs are editable;
  // when the upstream config changes (provider switch, restore from disk) we resync.
  useEffect(() => {
    if (modelConfig.provider === "custom-openai") {
      console.log("Syncing custom OpenAI fields from ConfigContext:", {
        endpoint: modelConfig.customOpenAIEndpoint,
        model: modelConfig.customOpenAIModel,
        hasApiKey: !!modelConfig.customOpenAIApiKey,
      });

      // Always sync from modelConfig (which comes from context if available)
      /* eslint-disable react-hooks/set-state-in-effect */
      setCustomOpenAIEndpoint(modelConfig.customOpenAIEndpoint || "");
      setCustomOpenAIModel(modelConfig.customOpenAIModel || "");
      setCustomOpenAIApiKey(modelConfig.customOpenAIApiKey || "");
      setCustomMaxTokens(modelConfig.maxTokens?.toString() || "");
      setCustomTemperature(modelConfig.temperature?.toString() || "");
      setCustomTopP(modelConfig.topP?.toString() || "");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [
    modelConfig.provider,
    modelConfig.customOpenAIEndpoint,
    modelConfig.customOpenAIModel,
    modelConfig.customOpenAIApiKey,
    modelConfig.maxTokens,
    modelConfig.temperature,
    modelConfig.topP,
  ]);

  // Reset hasAutoFetched flag and clear models when switching away from Ollama.
  // Genuine reset cascade on prop change.
  useEffect(() => {
    if (modelConfig.provider !== "ollama") {
      /* eslint-disable react-hooks/set-state-in-effect */
      setHasAutoFetched(false); // Reset flag so it can auto-fetch again if user switches back
      setModels([]); // Clear models list
      setError(""); // Clear any error state
      setOllamaNotInstalled(false); // Reset installation status
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [modelConfig.provider]);

  // Handle endpoint changes - restore cached models or clear
  useEffect(() => {
    if (
      modelConfig.provider === "ollama" &&
      ollamaEndpoint.trim() !== lastFetchedEndpoint.trim()
    ) {
      // Check if we have cached models for this endpoint (including empty endpoint = default)
      const cachedModels = modelsCache.current.get(ollamaEndpoint.trim());

      if (cachedModels && cachedModels.length > 0) {
        // Restore cached models and update tracking
        setModels(cachedModels);
        setLastFetchedEndpoint(ollamaEndpoint.trim());
        setError("");
      } else {
        // No cache - clear models and allow refetch
        setHasAutoFetched(false);
        setModels([]);
        setError("");
      }
    }
  }, [ollamaEndpoint, lastFetchedEndpoint, modelConfig.provider]);

  // Sync local apiKey state when provider changes.
  // apiKey is mutable local state (typed by user); we resync only when the upstream
  // provider/keys change and the cached value differs.
  useEffect(() => {
    if (
      providerApiKeys &&
      requiresApiKey &&
      modelConfig.provider !== "custom-openai"
    ) {
      const correctKey =
        providerApiKeys[modelConfig.provider as keyof typeof providerApiKeys];
      if (correctKey !== apiKey) {
        /* eslint-disable react-hooks/set-state-in-effect */
        setApiKey(correctKey || "");
        setIsApiKeyLocked(!!correctKey?.trim());
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    }
    // apiKey intentionally excluded — it's the comparison target, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelConfig.provider, providerApiKeys, requiresApiKey]);

  // Manual fetch function for Ollama models
  const fetchOllamaModels = useCallback(async (silent = false) => {
    const trimmedEndpoint = ollamaEndpoint.trim();

    // Validate URL if provided
    if (trimmedEndpoint && !validateOllamaEndpoint(trimmedEndpoint)) {
      const errorMsg =
        "Invalid Ollama endpoint URL. Must start with http:// or https://";
      setError(errorMsg);
      if (!silent) {
        toast.error(errorMsg);
      }
      return;
    }

    setIsLoadingOllama(true);
    setError(""); // Clear previous errors

    try {
      const endpoint = trimmedEndpoint || null;
      const modelList = (await invoke("get_ollama_models", {
        endpoint,
      })) as OllamaModel[];
      setModels(modelList);
      setLastFetchedEndpoint(trimmedEndpoint); // Track successful fetch

      // Cache the fetched models for this endpoint
      modelsCache.current.set(trimmedEndpoint, modelList);

      // Successfully fetched models, Ollama is installed
      setOllamaNotInstalled(false);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to load Ollama models";
      setError(errorMsg);

      // Check if error indicates Ollama is not installed
      if (isOllamaNotInstalledError(errorMsg)) {
        setOllamaNotInstalled(true);
      } else {
        setOllamaNotInstalled(false);
      }

      if (!silent) {
        toast.error(errorMsg);
      }
      console.error("Error loading models:", err);
    } finally {
      setIsLoadingOllama(false);
    }
  }, [ollamaEndpoint]);

  // Auto-fetch models on initial load only (not on endpoint changes)
  useEffect(() => {
    let mounted = true;

    const initialLoad = async () => {
      // Only auto-fetch on initial load if:
      // 1. Provider is ollama
      // 2. Haven't fetched yet
      // 3. Component is still mounted
      // If skipInitialFetch is true, fetch silently (no error toasts)
      if (modelConfig.provider === "ollama" && !hasAutoFetched && mounted) {
        await fetchOllamaModels(skipInitialFetch); // Silent if skipInitialFetch=true
        setHasAutoFetched(true);
      }
    };

    initialLoad();

    return () => {
      mounted = false;
    };
    // Only react to provider changes — re-fetching whenever fetchOllamaModels (closure
    // over endpoint) or hasAutoFetched changes would defeat the purpose of the guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelConfig.provider]);

  const loadOpenRouterModels = async () => {
    if (openRouterModels.length > 0) return; // Already loaded

    try {
      setIsLoadingOpenRouter(true);
      setOpenRouterError("");
      const data = (await invoke("get_openrouter_models")) as OpenRouterModel[];
      setOpenRouterModels(data);
    } catch (err) {
      console.error("Error loading OpenRouter models:", err);
      setOpenRouterError(
        err instanceof Error ? err.message : "Failed to load OpenRouter models",
      );
    } finally {
      setIsLoadingOpenRouter(false);
    }
  };

  const loadBuiltinAiModels = async () => {
    if (builtinAiModels.length > 0) return; // Already loaded

    try {
      const data = (await invoke("builtin_ai_list_models")) as any[];
      setBuiltinAiModels(data);

      // Auto-select first available model if none selected
      if (data.length > 0 && !modelConfig.model) {
        const firstAvailable = data.find(
          (m: any) => m.status?.type === "available",
        );
        if (firstAvailable) {
          setModelConfig((prev: ModelConfig) => ({
            ...prev,
            model: firstAvailable.name,
          }));
        }
      }
    } catch (err) {
      console.error("Error loading Built-in AI models:", err);
      toast.error("Failed to load Built-in AI models");
    }
  };

  // Fetch OpenAI models from API
  const loadOpenAIModels = useCallback(async (key: string | null) => {
    if (!key?.trim()) {
      setOpenaiModels([]); // Will use fallback via modelOptions
      return;
    }
    setIsLoadingOpenAI(true);
    try {
      const data = (await invoke("get_openai_models", {
        apiKey: key,
      })) as OpenAIModel[];
      setOpenaiModels(data.map((m) => m.id));
    } catch (err) {
      console.error("Error loading OpenAI models:", err);
      setOpenaiModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingOpenAI(false);
    }
  }, []);

  // Fetch Anthropic (Claude) models from API
  const loadClaudeModels = useCallback(async (key: string | null) => {
    if (!key?.trim()) {
      setClaudeModels([]); // Will use fallback via modelOptions
      return;
    }
    setIsLoadingClaude(true);
    try {
      const data = (await invoke("get_anthropic_models", {
        apiKey: key,
      })) as AnthropicModel[];
      setClaudeModels(data.map((m) => m.id));
    } catch (err) {
      console.error("Error loading Claude models:", err);
      setClaudeModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingClaude(false);
    }
  }, []);

  // Fetch Groq models from API
  const loadGroqModels = useCallback(async (key: string | null) => {
    if (!key?.trim()) {
      setGroqModels([]); // Will use fallback via modelOptions
      return;
    }
    setIsLoadingGroq(true);
    try {
      const data = (await invoke("get_groq_models", {
        apiKey: key,
      })) as GroqModel[];
      setGroqModels(data.map((m) => m.id));
    } catch (err) {
      console.error("Error loading Groq models:", err);
      setGroqModels([]); // Will use fallback via modelOptions
    } finally {
      setIsLoadingGroq(false);
    }
  }, []);

  // Auto-fetch OpenAI models when provider is openai and we have an API key.
  // load*Models sets a loading flag synchronously then awaits — the rule cannot
  // distinguish that from a sync setState, so we suppress.
  useEffect(() => {
    if (modelConfig.provider === "openai" && apiKey?.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadOpenAIModels(apiKey);
    }
  }, [modelConfig.provider, apiKey, loadOpenAIModels]);

  // Auto-fetch Claude models when provider is claude and we have an API key
  useEffect(() => {
    if (modelConfig.provider === "claude" && apiKey?.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadClaudeModels(apiKey);
    }
  }, [modelConfig.provider, apiKey, loadClaudeModels]);

  // Auto-fetch Groq models when provider is groq and we have an API key
  useEffect(() => {
    if (modelConfig.provider === "groq" && apiKey?.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadGroqModels(apiKey);
    }
  }, [modelConfig.provider, apiKey, loadGroqModels]);

  // Restore cached model when async model lists become available.
  // Only setState when the current model is invalid AND a cached one is recoverable —
  // gated cascade, not a feedback loop.
  useEffect(() => {
    const providerModels = modelOptions[modelConfig.provider];
    if (!providerModels || providerModels.length === 0) return;

    // If current model is already valid, nothing to do
    if (modelConfig.model && providerModels.includes(modelConfig.model)) return;

    // Try to restore from localStorage cache
    const cachedModel = readProviderModelMap()[modelConfig.provider];
    if (cachedModel && providerModels.includes(cachedModel)) {
      setModelConfig((prev: ModelConfig) => ({ ...prev, model: cachedModel }));
    }
  }, [
    models,
    openRouterModels,
    builtinAiModels,
    openaiModels,
    claudeModels,
    groqModels,
    modelConfig.provider,
    modelConfig.model,
    modelOptions,
    setModelConfig,
  ]);

  const handleSave = async () => {
    // For custom-openai provider, save the custom config first
    if (modelConfig.provider === "custom-openai") {
      try {
        await invoke("api_save_custom_openai_config", {
          endpoint: customOpenAIEndpoint.trim(),
          apiKey: customOpenAIApiKey.trim() || null,
          model: customOpenAIModel.trim(),
          maxTokens: customMaxTokens ? parseInt(customMaxTokens, 10) : null,
          temperature: customTemperature ? parseFloat(customTemperature) : null,
          topP: customTopP ? parseFloat(customTopP) : null,
        });
        console.log("Custom OpenAI config saved successfully");
      } catch (err) {
        console.error("Failed to save custom OpenAI config:", err);
        toast.error("Failed to save custom OpenAI configuration");
        return;
      }
    }

    const updatedConfig = {
      ...modelConfig,
      apiKey: typeof apiKey === "string" ? apiKey.trim() || null : null,
      ollamaEndpoint:
        modelConfig.provider === "ollama"
          ? ollamaEndpoint.trim() || null
          : modelConfig.ollamaEndpoint || null,
      // Include custom OpenAI fields
      customOpenAIEndpoint:
        modelConfig.provider === "custom-openai"
          ? customOpenAIEndpoint.trim()
          : null,
      customOpenAIModel:
        modelConfig.provider === "custom-openai"
          ? customOpenAIModel.trim()
          : null,
      customOpenAIApiKey:
        modelConfig.provider === "custom-openai" && customOpenAIApiKey.trim()
          ? customOpenAIApiKey.trim()
          : null,
      maxTokens:
        modelConfig.provider === "custom-openai" && customMaxTokens
          ? parseInt(customMaxTokens, 10)
          : null,
      temperature:
        modelConfig.provider === "custom-openai" && customTemperature
          ? parseFloat(customTemperature)
          : null,
      topP:
        modelConfig.provider === "custom-openai" && customTopP
          ? parseFloat(customTopP)
          : null,
      // For custom-openai, use the customOpenAIModel as the model field
      model:
        modelConfig.provider === "custom-openai"
          ? customOpenAIModel.trim()
          : modelConfig.model,
    };
    setModelConfig(updatedConfig);
    console.log(
      "ModelSettingsModal - handleSave - Updated ModelConfig:",
      updatedConfig,
    );

    // Persist confirmed model choice to per-provider cache
    if (updatedConfig.model) {
      saveProviderModel(updatedConfig.provider, updatedConfig.model);
    }

    // Update provider-specific key in context
    if (
      updateProviderApiKey &&
      updatedConfig.apiKey &&
      updatedConfig.provider !== "custom-openai"
    ) {
      updateProviderApiKey(updatedConfig.provider, updatedConfig.apiKey);
    }

    onSave(updatedConfig);
  };

  // Test custom OpenAI connection
  const testCustomOpenAIConnection = async () => {
    if (!customOpenAIEndpoint.trim() || !customOpenAIModel.trim()) {
      toast.error("Please enter endpoint URL and model name first");
      return;
    }

    setIsTestingConnection(true);
    try {
      const result = await invoke<{ status: string; message: string }>(
        "api_test_custom_openai_connection",
        {
          endpoint: customOpenAIEndpoint.trim(),
          apiKey: customOpenAIApiKey.trim() || null,
          model: customOpenAIModel.trim(),
        },
      );
      toast.success(result.message || "Connection successful!");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.error(errorMsg);
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Function to download recommended model
  const downloadRecommendedModel = async () => {
    const recommendedModel = "gemma3:1b";

    // Prevent duplicate downloads (defense in depth - backend also checks)
    if (isDownloading(recommendedModel)) {
      toast.info(`${recommendedModel} is already downloading`, {
        description: `Progress: ${Math.round(getProgress(recommendedModel) || 0)}%`,
      });
      return;
    }

    try {
      const endpoint = ollamaEndpoint.trim() || null;

      // The download will be tracked by the global context via events
      // Progress toasts are shown automatically by OllamaDownloadContext
      await invoke("pull_ollama_model", {
        modelName: recommendedModel,
        endpoint,
      });

      // Refresh the models list after successful download
      await fetchOllamaModels(true);

      // Note: Model is NOT auto-selected - user must explicitly choose it
      // This respects the database as the single source of truth
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to download model";
      console.error("Error downloading model:", err);

      // Check if Ollama is not installed and show appropriate error
      if (isOllamaNotInstalledError(errorMsg)) {
        toast.error("Ollama is not installed", {
          description:
            "Please download and install Ollama before downloading models.",
          duration: 7000,
          action: {
            label: "Download",
            onClick: () =>
              invoke("open_external_url", {
                url: "https://ollama.com/download",
              }),
          },
        });
        // Update the installation status flag
        setOllamaNotInstalled(true);
      }
      // Other errors are handled by the context
    }
  };

  // Function to delete Ollama model
  const deleteOllamaModel = async (modelName: string) => {
    try {
      const endpoint = ollamaEndpoint.trim() || null;
      await invoke("delete_ollama_model", {
        modelName,
        endpoint,
      });

      toast.success(`Model ${modelName} deleted`);
      await fetchOllamaModels(true); // Refresh list
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Failed to delete model";
      toast.error(errorMsg);
      console.error("Error deleting model:", err);
    }
  };

  // Track previous downloading models to detect completions
  const previousDownloadingRef = useRef<Set<string>>(new Set());

  // Refresh models list when download completes
  useEffect(() => {
    const current = downloadingModels;
    const previous = previousDownloadingRef.current;

    // Check if any downloads completed (were in previous, not in current)
    for (const modelName of previous) {
      if (!current.has(modelName)) {
        // Download completed, refresh models list
        console.log(
          `[ModelSettingsModal] Download completed for ${modelName}, refreshing list`,
        );
        fetchOllamaModels(true);
        break; // Only refresh once even if multiple completed
      }
    }

    // Update ref for next comparison
    previousDownloadingRef.current = new Set(current);
  }, [downloadingModels, fetchOllamaModels]);

  // Filter Ollama models based on search query
  const filteredModels = models.filter((model) => {
    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    const isLoaded = modelConfig.model === model.name;
    const loadedText = isLoaded ? "loaded" : "";

    return (
      model.name.toLowerCase().includes(query) ||
      model.size.toLowerCase().includes(query) ||
      loadedText.includes(query)
    );
  });

  // Provider select handler: persists the outgoing provider's model choice,
  // restores the incoming provider's cached model (falling back to its
  // first available option), and kicks off that provider's model fetch.
  const handleProviderChange = (provider: ModelConfig["provider"]) => {
    // Clear error state when switching providers
    setError("");

    // Save current provider's model to localStorage before switching
    if (modelConfig.model) {
      saveProviderModel(modelConfig.provider, modelConfig.model);
    }

    // Try to restore cached model for the new provider
    const savedModel = readProviderModelMap()[provider];
    const providerModels = modelOptions[provider];
    const defaultModel =
      providerModels && providerModels.length > 0 ? providerModels[0] : "";
    const model =
      savedModel && providerModels?.includes(savedModel)
        ? savedModel
        : defaultModel;

    setModelConfig({
      ...modelConfig,
      provider,
      model,
    });
    // API key is now synced automatically via useEffect watching providerApiKeys

    // Load OpenRouter models only when OpenRouter is selected
    if (provider === "openrouter") {
      loadOpenRouterModels();
    }

    // Load Built-in AI models when selected
    if (provider === "builtin-ai") {
      loadBuiltinAiModels();
    }

    // Load custom OpenAI config when selected
    if (provider === "custom-openai") {
      invoke<any>("api_get_custom_openai_config")
        .then((config) => {
          if (config) {
            setCustomOpenAIEndpoint(config.endpoint || "");
            setCustomOpenAIModel(config.model || "");
            setCustomOpenAIApiKey(config.apiKey || "");
            setCustomMaxTokens(config.maxTokens?.toString() || "");
            setCustomTemperature(config.temperature?.toString() || "");
            setCustomTopP(config.topP?.toString() || "");
          }
        })
        .catch((err) => {
          console.error("Failed to load custom OpenAI config:", err);
        });
    }
  };

  // Ollama endpoint input handler: updates the endpoint and clears any
  // stale model list/error as soon as the value diverges from what was
  // last successfully fetched.
  const handleOllamaEndpointChange = (value: string) => {
    setOllamaEndpoint(value);
    if (value.trim() !== lastFetchedEndpoint.trim()) {
      setModels([]);
      setError("");
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <Heading level={2}>Model Settings</Heading>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Summarization Model</Label>
          <ProviderModelPicker
            provider={modelConfig.provider}
            model={modelConfig.model}
            modelOptions={modelOptions}
            onProviderChange={handleProviderChange}
            setModelConfig={setModelConfig}
            modelComboboxOpen={modelComboboxOpen}
            setModelComboboxOpen={setModelComboboxOpen}
            isCloudLoading={isCloudLoading}
            showCloudLoading={showCloudLoading}
          />
        </div>

        {/* Custom OpenAI Configuration Section */}
        {modelConfig.provider === "custom-openai" && (
          <CustomOpenAISection
            customOpenAIEndpoint={customOpenAIEndpoint}
            setCustomOpenAIEndpoint={setCustomOpenAIEndpoint}
            customOpenAIModel={customOpenAIModel}
            setCustomOpenAIModel={setCustomOpenAIModel}
            customOpenAIApiKey={customOpenAIApiKey}
            setCustomOpenAIApiKey={setCustomOpenAIApiKey}
            customMaxTokens={customMaxTokens}
            setCustomMaxTokens={setCustomMaxTokens}
            customTemperature={customTemperature}
            setCustomTemperature={setCustomTemperature}
            customTopP={customTopP}
            setCustomTopP={setCustomTopP}
            isAdvancedOpen={isCustomOpenAIAdvancedOpen}
            setIsAdvancedOpen={setIsCustomOpenAIAdvancedOpen}
            isTestingConnection={isTestingConnection}
            onTestConnection={testCustomOpenAIConnection}
          />
        )}

        {requiresApiKey && (
          <ApiKeyField
            apiKey={apiKey}
            setApiKey={setApiKey}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            isApiKeyLocked={isApiKeyLocked}
            setIsApiKeyLocked={setIsApiKeyLocked}
          />
        )}

        {modelConfig.provider === "ollama" && (
          <OllamaEndpointConfig
            isCollapsed={isEndpointSectionCollapsed}
            onToggleCollapsed={() =>
              setIsEndpointSectionCollapsed(!isEndpointSectionCollapsed)
            }
            ollamaEndpoint={ollamaEndpoint}
            onEndpointChange={handleOllamaEndpointChange}
            endpointValidationState={endpointValidationState}
            onFetchModels={() => fetchOllamaModels()}
            isLoadingOllama={isLoadingOllama}
            ollamaEndpointChanged={ollamaEndpointChanged}
            error={error}
          />
        )}

        {modelConfig.provider === "ollama" && (
          <OllamaModelsList
            lastFetchedEndpoint={lastFetchedEndpoint}
            models={models}
            filteredModels={filteredModels}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isLoadingOllama={isLoadingOllama}
            showOllamaLoading={showOllamaLoading}
            ollamaNotInstalled={ollamaNotInstalled}
            ollamaEndpointChanged={ollamaEndpointChanged}
            isDownloading={isDownloading}
            getProgress={getProgress}
            onDownloadRecommended={downloadRecommendedModel}
            selectedModel={modelConfig.model}
            onSelectModel={(model) =>
              setModelConfig((prev: ModelConfig) => ({ ...prev, model }))
            }
          />
        )}

        {/* Built-in AI Models Section */}
        {modelConfig.provider === "builtin-ai" && (
          <div className="mt-6">
            <BuiltInModelManager
              selectedModel={modelConfig.model}
              onModelSelect={(model) =>
                setModelConfig((prev: ModelConfig) => ({ ...prev, model }))
              }
            />
          </div>
        )}
      </div>

      {/* Auto-generate summaries toggle */}
      {/* <div className="mt-6 pt-6 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <Label htmlFor="auto-generate" className="text-sm font-medium">
              Auto-generate summaries
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Automatically generate summary when opening meetings without one
            </p>
          </div>
          <Switch
            id="auto-generate"
            checked={autoGenerateEnabled}
            onCheckedChange={setAutoGenerateEnabled}
          />
        </div>
      </div> */}

      <div className="mt-6 flex justify-end">
        <Button
          className={cn(
            `
              rounded-md px-4 text-sm font-medium text-white
              focus:ring-2 focus:ring-info focus:ring-offset-2
              focus:outline-none
            `,
            isDoneDisabled
              ? "cursor-not-allowed bg-muted"
              : `
                bg-info
                hover:bg-info
              `,
          )}
          onClick={handleSave}
          disabled={isDoneDisabled}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
