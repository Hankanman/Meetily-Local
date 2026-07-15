"use client";

import { useEffect, useRef } from "react";
import {
  startModelDownloadListeners,
  subscribeModelDownloadEvents,
  type ModelDownloadEvent,
} from "@/lib/modelDownloadStore";

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
