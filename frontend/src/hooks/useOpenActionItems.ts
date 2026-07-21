"use client";

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  ActionItem,
  ACTION_ITEMS_EXTRACTED_EVENT,
  listOpenActionItems,
  setActionItemStatus,
} from "@/lib/actionItems";

/**
 * Open action items across every meeting (newest first) — the data behind the
 * home-screen "Outstanding action items" summary. Refreshes when the background
 * extractor emits `action-items-extracted`, and completing an item drops it
 * from the list (optimistically, reverting on failure).
 */
export function useOpenActionItems() {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setItems(await listOpenActionItems());
    } catch (err) {
      console.error("Failed to load open action items:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch — refresh() only setStates after its awaited call, so this
    // is a subscribe-and-load, not a synchronous cascading render.
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

  const complete = useCallback(
    async (item: ActionItem) => {
      // Optimistic: an "open items" list, so completing removes the row.
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await setActionItemStatus(item.id, "done");
      } catch (err) {
        console.error("Failed to complete action item:", err);
        void refresh();
      }
    },
    [refresh],
  );

  return { items, isLoading, complete, refresh };
}
