// URL validation helper
export function validateOllamaEndpoint(url: string): boolean {
  if (!url.trim()) return true; // Empty is valid (uses default)
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const PROVIDER_MODEL_MAP_KEY = "providerModelMap";

// Per-provider "last selected model" cache, keyed by provider name.
// Used to restore the previously chosen model when switching providers
// or when a provider's model list becomes available asynchronously.
export function readProviderModelMap(): Record<string, string> {
  return JSON.parse(localStorage.getItem(PROVIDER_MODEL_MAP_KEY) || "{}");
}

export function saveProviderModel(provider: string, model: string): void {
  const map = readProviderModelMap();
  map[provider] = model;
  localStorage.setItem(PROVIDER_MODEL_MAP_KEY, JSON.stringify(map));
}
