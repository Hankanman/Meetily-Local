"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { useConfig } from "@/contexts/ConfigContext";

/** A provisional action item surfaced during a recording. Not persisted — the
 *  authoritative list is produced from the full transcript on summary. */
export interface LiveActionItem {
  text: string;
  assignee: string | null;
  due_hint: string | null;
  start_secs: number | null;
  end_secs: number | null;
}

const LIVE_EVENT = "live-action-items";

function key(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
}

/**
 * Drives the beta live action-item extractor during a recording: starts/stops
 * the backend loop as recording toggles and accumulates the provisional items
 * it emits. Returns `{ items, enabled }`; `enabled` is false unless the Beta
 * feature is on, in which case the caller should render nothing.
 */
export function useLiveActionItems(isRecording: boolean): {
  items: LiveActionItem[];
  enabled: boolean;
} {
  const { betaFeatures } = useConfig();
  const enabled = betaFeatures.liveActionItems;
  const [items, setItems] = useState<LiveActionItem[]>([]);

  // Subscribe to emitted items while the feature is on.
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const fn = await listen<{ items: LiveActionItem[] }>(LIVE_EVENT, (e) => {
        setItems((prev) => {
          const seen = new Set(prev.map((i) => key(i.text)));
          const fresh = e.payload.items.filter((i) => !seen.has(key(i.text)));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  // Start/stop the backend loop as recording toggles.
  useEffect(() => {
    if (!enabled) return;
    if (isRecording) {
      setItems([]);
      void invoke("start_live_action_extraction").catch(() => {
        // Best-effort: a missing model config just means no live items.
      });
    } else {
      void invoke("stop_live_action_extraction").catch(() => {});
    }
  }, [enabled, isRecording]);

  return { items: enabled ? items : [], enabled };
}
