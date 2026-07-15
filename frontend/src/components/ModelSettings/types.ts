export interface ModelConfig {
  provider:
    | "ollama"
    | "groq"
    | "claude"
    | "openai"
    | "openrouter"
    | "builtin-ai"
    | "custom-openai";
  model: string;
  whisperModel: string;
  apiKey?: string | null;
  ollamaEndpoint?: string | null;
  // Custom OpenAI fields
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  customOpenAIApiKey?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
}

export interface OllamaModel {
  name: string;
  id: string;
  size: string;
  modified: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  prompt_price?: string;
  completion_price?: string;
}

export interface OpenAIModel {
  id: string;
}

export interface AnthropicModel {
  id: string;
  display_name?: string;
}

export interface GroqModel {
  id: string;
  owned_by?: string;
}
