import { useCallback, useEffect, useMemo, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";

import {
  ACTION_ITEMS_EXTRACTED_EVENT,
  ActionItem,
  ActionItemsExtractedPayload,
  createActionItem,
  deleteActionItem,
  extractActionItems,
  listActionItems,
  setActionItemStatus,
} from "@/lib/actionItems";

interface ActionItemsState {
  /** The meeting `items` belong to. Tracked alongside the data so switching
   *  meetings clears the list during render rather than a frame late — the
   *  same approach `useSpeakersRefined` uses. */
  meetingId: string | null | undefined;
  items: ActionItem[];
  isLoading: boolean;
}

/**
 * Owns the action-item list for one meeting.
 *
 * Items arrive from three directions and this hook reconciles all of them: the
 * initial load, the background extraction pass that fires when a summary
 * completes (via the `action-items-extracted` event), and the user's own edits.
 * Toggling is optimistic — a checkbox that waits for a database round-trip
 * feels broken — and rolls back if the write fails, so the UI can never claim a
 * completion that wasn't persisted.
 */
export function useActionItems(meetingId: string | null | undefined) {
  const [state, setState] = useState<ActionItemsState>({
    meetingId,
    items: [],
    isLoading: !!meetingId,
  });
  // Adjusting state during render on a changed input: see
  // https://react.dev/learn/you-might-not-need-an-effect
  if (state.meetingId !== meetingId) {
    setState({ meetingId, items: [], isLoading: !!meetingId });
  }

  const [isExtracting, setIsExtracting] = useState(false);
  // Bumped to request a refetch. A token rather than a callback that fetches
  // directly, so the fetch stays in one effect with one cancellation guard.
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!meetingId) return;

    let cancelled = false;
    (async () => {
      try {
        const next = await listActionItems(meetingId);
        // The guard covers a slow fetch for a previous meeting landing after
        // the user already switched away.
        if (!cancelled) {
          setState({ meetingId, items: next, isLoading: false });
        }
      } catch (err) {
        console.error("Failed to load action items:", err);
        if (!cancelled) {
          setState({ meetingId, items: [], isLoading: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [meetingId, reloadToken]);

  // Extraction runs in the background after a summary completes, so items can
  // appear while this page is already open.
  useEffect(() => {
    if (!meetingId) return;

    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      const fn = await listen<ActionItemsExtractedPayload>(
        ACTION_ITEMS_EXTRACTED_EVENT,
        (event) => {
          if (event.payload.meeting_id !== meetingId) return;
          reload();
        },
      );
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    };

    void setup();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [meetingId, reload]);

  const toggleStatus = useCallback(async (item: ActionItem) => {
    const nextStatus = item.status === "done" ? "open" : "done";

    setState((s) => ({
      ...s,
      items: s.items.map((i) =>
        i.id === item.id ? { ...i, status: nextStatus } : i,
      ),
    }));

    try {
      const updated = await setActionItemStatus(item.id, nextStatus);
      setState((s) => ({
        ...s,
        items: s.items.map((i) => (i.id === updated.id ? updated : i)),
      }));
    } catch (err) {
      console.error("Failed to update action item:", err);
      // Roll back just this row — anything else the user touched meanwhile
      // stays as they left it.
      setState((s) => ({
        ...s,
        items: s.items.map((i) =>
          i.id === item.id ? { ...i, status: item.status } : i,
        ),
      }));
      toast.error("Failed to update action item");
    }
  }, []);

  const addItem = useCallback(
    async (text: string, assignee?: string, dueHint?: string) => {
      if (!meetingId || !text.trim()) return;
      try {
        const created = await createActionItem(
          meetingId,
          text.trim(),
          assignee?.trim() || null,
          dueHint?.trim() || null,
        );
        setState((s) =>
          s.meetingId === meetingId ? { ...s, items: [...s.items, created] } : s,
        );
      } catch (err) {
        console.error("Failed to add action item:", err);
        toast.error("Failed to add action item");
      }
    },
    [meetingId],
  );

  const removeItem = useCallback(
    async (item: ActionItem) => {
      const index = state.items.findIndex((i) => i.id === item.id);
      setState((s) => ({
        ...s,
        items: s.items.filter((i) => i.id !== item.id),
      }));

      try {
        await deleteActionItem(item.id);
      } catch (err) {
        console.error("Failed to delete action item:", err);
        // Put it back where it was, not at the end — a failed delete should
        // leave no trace.
        setState((s) => {
          const restored = [...s.items];
          restored.splice(index < 0 ? restored.length : index, 0, item);
          return { ...s, items: restored };
        });
        toast.error("Failed to delete action item");
      }
    },
    [state.items],
  );

  /**
   * Run extraction now. The escape hatch for meetings summarized before the
   * automatic pass existed — and for when that pass failed (it's best-effort
   * by design, so a failure is only a log line).
   */
  const runExtraction = useCallback(async () => {
    if (!meetingId || isExtracting) return;
    setIsExtracting(true);
    try {
      const count = await extractActionItems(meetingId);
      // The command emits `action-items-extracted`, which the listener above
      // turns into a refetch — no explicit reload needed here.
      toast.success(
        count > 0
          ? `Found ${count} action item${count === 1 ? "" : "s"}`
          : "No action items found in this summary",
      );
    } catch (err) {
      console.error("Action item extraction failed:", err);
      toast.error(
        typeof err === "string" ? err : "Failed to extract action items",
      );
    } finally {
      setIsExtracting(false);
    }
  }, [meetingId, isExtracting]);

  const openCount = useMemo(
    () => state.items.filter((i) => i.status === "open").length,
    [state.items],
  );

  return {
    items: state.items,
    openCount,
    isLoading: state.isLoading,
    isExtracting,
    addItem,
    removeItem,
    toggleStatus,
    runExtraction,
    reload,
  };
}
