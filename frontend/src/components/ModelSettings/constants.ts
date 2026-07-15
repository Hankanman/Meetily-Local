// Fallback models for when API fetch fails or no API key provided
export const OPENAI_FALLBACK_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o1",
  "o1-mini",
  "o3",
  "o3-mini",
];

export const CLAUDE_FALLBACK_MODELS = [
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5-20251101",
  "claude-3-5-sonnet-latest",
];

export const GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];
