"use client";

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  ActionItem,
  ACTION_ITEMS_EXTRACTED_EVENT,
  deleteActionItem,
  listActionItems,
  setActionItemStatus,
} from "@/lib/actionItems";

/**
 * Every action item across every meeting (open and done) — the data behind the
 * global Action Items page. Unlike {@link useOpenActionItems}, toggling status
 * keeps the item in the list (flipped in place) so the Done filter has content;
 * only an explicit delete removes it. Refreshes when the background extractor
 * emits `action-items-extracted`.
 */
export function useAllActionItems() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setItems(await listActionItems());
    } catch (err) {
      console.error("Failed to load action items:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen(ACTION_ITEMS_EXTRACTED_EVENT, () => {
          void refresh();
        });
      } catch (err) {
        console.error("Failed to subscribe to action-items-extracted:", err);
      }
    })();
    return () => unlisten?.();
  }, [refresh]);

  const toggle = useCallback(
    async (item: ActionItem) => {
      const next = item.status === "done" ? "open" : "done";
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)),
      );
      try {
        await setActionItemStatus(item.id, next);
      } catch (err) {
        console.error("Failed to update action item:", err);
        void refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (item: ActionItem) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await deleteActionItem(item.id);
      } catch (err) {
        console.error("Failed to delete action item:", err);
        void refresh();
      }
    },
    [refresh],
  );

  return { items, isLoading, refresh, toggle, remove };
}
