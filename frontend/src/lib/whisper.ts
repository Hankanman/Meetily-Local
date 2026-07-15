// Types for whisper-rs integration
export interface ModelInfo {
  name: string;
  path: string;
  size_mb: number;
  accuracy: ModelAccuracy;
  speed: ProcessingSpeed;
  status: ModelStatus;
  description?: string;
}

export type ModelAccuracy = "High" | "Good" | "Decent";
export type ProcessingSpeed = "Slow" | "Medium" | "Fast" | "Very Fast";

export type ModelStatus =
  | "Available"
  | "Missing"
  | { Downloading: number }
  | { Error: string }
  | { Corrupted: { file_size: number; expected_min_size: number } };

// Helper functions
export function getModelIcon(accuracy: ModelAccuracy): string {
  switch (accuracy) {
    case "High":
      return "🔥";
    case "Good":
      return "⚡";
    case "Decent":
      return "🚀";
    default:
      return "📊";
  }
}

export function formatFileSize(sizeMb: number): string {
  if (sizeMb >= 1000) {
    return `${(sizeMb / 1000).toFixed(1)}GB`;
  }
  return `${sizeMb}MB`;
}

// Helper function to get model type (f16, q5_1, q5_0, q4_0)
function getModelType(modelName: string): "f16" | "q5_1" | "q5_0" | "q4_0" {
  if (modelName.includes("-q5_1")) return "q5_1";
  if (modelName.includes("-q5_0")) return "q5_0";
  if (modelName.includes("-q4_0")) return "q4_0";
  return "f16";
}

// Helper function to get model base name (without quantization suffix)
function getModelBaseName(modelName: string): string {
  return modelName.replace(/-q[45]_[01]$/, "");
}

// Helper function to check if model is quantized
export function isQuantizedModel(modelName: string): boolean {
  return modelName.includes("-q");
}

// Helper function to get model performance badge
export function getModelPerformanceBadge(modelName: string): {
  label: string;
  color: string;
} {
  const type = getModelType(modelName);
  switch (type) {
    case "f16":
      return { label: "Full Precision", color: "blue" };
    case "q5_1":
      return { label: "Balanced+", color: "green" };
    case "q5_0":
      return { label: "Balanced", color: "green" };
    case "q4_0":
      return { label: "Fast", color: "orange" };
    default:
      return { label: "Standard", color: "gray" };
  }
}

// Helper function to get a concise tagline for a Whisper model (used in UI badges).
export function getModelTagline(
  modelName: string,
  speed: ProcessingSpeed,
  accuracy: ModelAccuracy,
): string {
  const isQuantized = isQuantizedModel(modelName);
  const baseName = getModelBaseName(modelName);

  // Speed prefix
  let speedText = "";
  switch (speed) {
    case "Very Fast":
      speedText = "Real time";
      break;
    case "Fast":
      speedText = "Fast processing";
      break;
    case "Medium":
      speedText = "Moderate speed";
      break;
    case "Slow":
      speedText = "Slower processing";
      break;
  }

  // Key feature based on model and accuracy
  let featureText = "";
  if (baseName === "large-v3") {
    featureText = "Most accurate";
  } else if (baseName === "large-v3-turbo") {
    featureText = "Best accuracy with speed";
  } else if (baseName === "medium") {
    featureText =
      accuracy === "High" ? "Professional quality" : "Balanced quality";
  } else if (baseName === "small") {
    featureText = "Good accuracy";
  } else if (baseName === "base") {
    featureText = "Balanced quality";
  } else if (baseName === "tiny") {
    featureText = "Fastest option";
  }

  // Add quantization note if applicable
  if (isQuantized) {
    const quantType = getModelType(modelName);
    if (quantType === "q5_0") {
      featureText += ", optimized";
    } else if (quantType === "q4_0") {
      featureText += ", ultra fast";
    }
  }

  return `${speedText} • ${featureText}`;
}

// Tauri command wrappers for whisper-rs backend
import { invoke } from "@tauri-apps/api/core";

export class WhisperAPI {
  static async init(): Promise<void> {
    await invoke("whisper_init");
  }

  static async getAvailableModels(): Promise<ModelInfo[]> {
    return await invoke("whisper_get_available_models");
  }

  static async loadModel(modelName: string): Promise<void> {
    await invoke("whisper_load_model", { modelName });
  }

  static async getCurrentModel(): Promise<string | null> {
    return await invoke("whisper_get_current_model");
  }

  static async isModelLoaded(): Promise<boolean> {
    return await invoke("whisper_is_model_loaded");
  }

  static async transcribeAudio(audioData: number[]): Promise<string> {
    return await invoke("whisper_transcribe_audio", { audioData });
  }

  static async getModelsDirectory(): Promise<string> {
    return await invoke("whisper_get_models_directory");
  }

  static async downloadModel(modelName: string): Promise<void> {
    await invoke("whisper_download_model", { modelName });
  }

  static async cancelDownload(modelName: string): Promise<void> {
    await invoke("whisper_cancel_download", { modelName });
  }

  static async deleteCorruptedModel(modelName: string): Promise<string> {
    return await invoke("whisper_delete_corrupted_model", { modelName });
  }

  static async hasAvailableModels(): Promise<boolean> {
    return await invoke("whisper_has_available_models");
  }

  static async validateModelReady(): Promise<string> {
    return await invoke("whisper_validate_model_ready");
  }

  static async openModelsFolder(): Promise<void> {
    await invoke("open_models_folder");
  }
}
