import { listen } from "@tauri-apps/api/event";

/**
 * Single source of truth for Whisper + built-in-AI (Gemma) model download
 * events.
 *
 * Backend contract (frozen this wave — see src-tauri/src/whisper_engine/commands.rs
 * and src-tauri/src/summary/summary_engine/commands.rs):
 *  - "model-download-progress"      { modelName, progress }                     (Whisper — no size/speed fields are ever sent)
 *  - "model-download-complete"      { modelName }                               (Whisper)
 *  - "model-download-error"         { modelName, error }                        (Whisper)
 *  - "builtin-ai-download-progress" { model, progress, downloaded_mb?, total_mb?,
 *                                     speed_mbps?, status, error? }              (built-in AI / Gemma — the ONLY
 *                                     event for this subsystem; `status` carries
 *                                     "downloading" | "completed" | "error" | "cancelled")
 *
 * Previously five-plus components each called `listen()` directly against these
 * events and re-derived state independently (DownloadProgressToast, OnboardingContext,
 * DownloadProgressStep, WhisperModelManager, BuiltInModelManager, useModalState).
 * This module registers exactly ONE Tauri listener per event and fans data out
 * via a raw, edge-triggered event stream (`subscribeModelDownloadEvents`) carrying
 * the untouched backend payload (`event.raw`) alongside the normalized state
 * (`event.state`), so consumers can keep their original per-event handling logic
 * verbatim and only swap the event source.
 */

export type ModelDownloadKind = "whisper" | "builtin";
export type ModelDownloadStatus =
  | "downloading"
  | "completed"
  | "error"
  | "cancelled";

export interface ModelDownloadState {
  modelName: string;
  kind: ModelDownloadKind;
  progress: number;
  downloadedMb?: number;
  totalMb?: number;
  speedMbps?: number;
  status: ModelDownloadStatus;
  error?: string;
}

export interface WhisperDownloadProgressPayload {
  modelName: string;
  progress: number;
  downloaded_mb?: number;
  total_mb?: number;
  speed_mbps?: number;
  status?: string;
}
export interface WhisperDownloadCompletePayload {
  modelName: string;
}
export interface WhisperDownloadErrorPayload {
  modelName: string;
  error: string;
}
export interface BuiltinDownloadProgressPayload {
  model: string;
  progress: number;
  downloaded_mb?: number;
  total_mb?: number;
  speed_mbps?: number;
  status: string;
  error?: string;
}

// Each member's `type` is a single literal (not a union) so TS can narrow
// `event.raw` correctly through `if (event.type === "x" || event.type === "y")`
// checks — a union-valued discriminant on one member defeats that narrowing.
export type ModelDownloadEvent =
  | {
      kind: "whisper";
      type: "progress";
      modelName: string;
      state: ModelDownloadState;
      raw: WhisperDownloadProgressPayload;
    }
  | {
      kind: "whisper";
      type: "cancelled";
      modelName: string;
      state: ModelDownloadState;
      raw: WhisperDownloadProgressPayload;
    }
  | {
      kind: "whisper";
      type: "complete";
      modelName: string;
      state: ModelDownloadState;
      raw: WhisperDownloadCompletePayload;
    }
  | {
      kind: "whisper";
      type: "error";
      modelName: string;
      state: ModelDownloadState;
      raw: WhisperDownloadErrorPayload;
    }
  | {
      kind: "builtin";
      type: "progress" | "complete" | "error" | "cancelled";
      modelName: string;
      state: ModelDownloadState;
      raw: BuiltinDownloadProgressPayload;
    };

function resolveStatus(
  rawStatus: string | undefined,
  progress: number,
): ModelDownloadStatus {
  if (rawStatus === "cancelled") return "cancelled";
  if (rawStatus === "error") return "error";
  if (rawStatus === "completed" || progress >= 100) return "completed";
  return "downloading";
}

function eventTypeForStatus(
  status: ModelDownloadStatus,
): "progress" | "complete" | "error" | "cancelled" {
  switch (status) {
    case "completed":
      return "complete";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "progress";
  }
}

const eventListeners = new Set<(event: ModelDownloadEvent) => void>();

function emit(event: ModelDownloadEvent): void {
  eventListeners.forEach((listener) => listener(event));
}

/**
 * Subscribe to the raw, edge-triggered event stream — one call per backend
 * event, mirroring what a direct `listen()` callback would have received.
 * Use for one-shot side effects (toasts, auto-select, auto-close) instead of
 * diffing snapshots.
 */
export function subscribeModelDownloadEvents(
  listener: (event: ModelDownloadEvent) => void,
): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

let started = false;

/**
 * Registers the singleton Tauri listeners for all model-download events.
 * Idempotent — safe to call from every consumer's mount effect; only the
 * first call actually subscribes.
 */
export async function startModelDownloadListeners(): Promise<void> {
  if (started) return;
  started = true;

  await listen<WhisperDownloadProgressPayload>(
    "model-download-progress",
    (event) => {
      const {
        modelName,
        progress,
        downloaded_mb,
        total_mb,
        speed_mbps,
        status,
      } = event.payload;
      const resolved = resolveStatus(status, progress);
      const state: ModelDownloadState = {
        modelName,
        kind: "whisper",
        progress,
        downloadedMb: downloaded_mb,
        totalMb: total_mb,
        speedMbps: speed_mbps,
        status: resolved,
      };
      emit({
        kind: "whisper",
        type: resolved === "cancelled" ? "cancelled" : "progress",
        modelName,
        state,
        raw: event.payload,
      });
    },
  );

  await listen<WhisperDownloadCompletePayload>(
    "model-download-complete",
    (event) => {
      const { modelName } = event.payload;
      const state: ModelDownloadState = {
        modelName,
        kind: "whisper",
        progress: 100,
        status: "completed",
      };
      emit({
        kind: "whisper",
        type: "complete",
        modelName,
        state,
        raw: event.payload,
      });
    },
  );

  await listen<WhisperDownloadErrorPayload>(
    "model-download-error",
    (event) => {
      const { modelName, error } = event.payload;
      const state: ModelDownloadState = {
        modelName,
        kind: "whisper",
        progress: 0,
        status: "error",
        error,
      };
      emit({
        kind: "whisper",
        type: "error",
        modelName,
        state,
        raw: event.payload,
      });
    },
  );

  await listen<BuiltinDownloadProgressPayload>(
    "builtin-ai-download-progress",
    (event) => {
      const { model, progress, downloaded_mb, total_mb, speed_mbps, status, error } =
        event.payload;
      const resolved = resolveStatus(status, progress);
      const state: ModelDownloadState = {
        modelName: model,
        kind: "builtin",
        progress: progress ?? 0,
        downloadedMb: downloaded_mb,
        totalMb: total_mb,
        speedMbps: speed_mbps,
        status: resolved,
        error: resolved === "error" ? error : undefined,
      };
      emit({
        kind: "builtin",
        type: eventTypeForStatus(resolved),
        modelName: model,
        state,
        raw: event.payload,
      });
    },
  );
}
