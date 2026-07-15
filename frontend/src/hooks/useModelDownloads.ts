"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getModelDownloadsSnapshot,
  startModelDownloadListeners,
  subscribeModelDownloadEvents,
  subscribeModelDownloads,
  type ModelDownloadEvent,
  type ModelDownloadKind,
  type ModelDownloadState,
} from "@/lib/modelDownloadStore";

const EMPTY_MAP: Map<string, ModelDownloadState> = new Map();

function snapshotFor(
  kind: ModelDownloadKind,
  modelName: string | undefined | null,
): ModelDownloadState | undefined {
  if (!modelName) return undefined;
  return getModelDownloadsSnapshot().get(`${kind}:${modelName}`);
}

/**
 * Full snapshot of every known download, keyed by `${kind}:${modelName}`.
 * Re-renders on ANY download update (Whisper or built-in) — use for
 * global UI that cares about "is anything downloading" (e.g. the toast).
 */
export function useModelDownloadsMap(): Map<string, ModelDownloadState> {
  useModelDownloadListeners();
  return useSyncExternalStore(
    subscribeModelDownloads,
    getModelDownloadsSnapshot,
    () => EMPTY_MAP,
  );
}

/** Latest normalized state for a single model, or undefined if no event has been seen for it yet. */
export function useModelDownload(
  kind: ModelDownloadKind,
  modelName: string | undefined | null,
): ModelDownloadState | undefined {
  useModelDownloadListeners();
  return useSyncExternalStore(
    subscribeModelDownloads,
    () => snapshotFor(kind, modelName),
    () => undefined,
  );
}

/**
 * Edge-triggered subscription — fires once per raw backend event (progress
 * tick / complete / error / cancelled), exactly mirroring what a direct
 * `listen()` call would have delivered (see `event.raw`). Use for one-shot
 * side effects (toasts, auto-select, auto-close, step progression) that
 * shouldn't re-fire on every re-render. The handler is always the latest
 * one passed in — no need to memoize it or list it as a dependency
 * elsewhere; the subscription itself is registered once.
 */
export function useModelDownloadEvents(
  handler: (event: ModelDownloadEvent) => void,
): void {
  useModelDownloadListeners();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(
    () => subscribeModelDownloadEvents((event) => handlerRef.current(event)),
    [],
  );
}

// Idempotent — every hook above calls this on mount so the singleton Tauri
// listeners exist regardless of which consumer happens to mount first.
function useModelDownloadListeners(): void {
  useEffect(() => {
    startModelDownloadListeners();
  }, []);
}
