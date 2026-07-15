import { useEffect, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type MeetingRefinedStatus = "idle" | "refining" | "refined" | "failed";

interface MeetingRefiningPayload {
  meeting_id: string;
}

interface MeetingRefinedPayload {
  meeting_id: string;
  segments_count: number;
}

interface MeetingRefineFailedPayload {
  meeting_id: string;
  error: string;
}

/**
 * Tracks the post-meeting auto-refine pass (see
 * `audio::retranscription::spawn_auto_refine` on the Rust side) for a single
 * meeting, purely from live Tauri events. Unlike `RetranscribeDialog`'s
 * manual-retranscription listeners, this is meant to be mounted
 * unconditionally (not gated behind a dialog being open) so a "Refining
 * transcript…" -> "Transcript refined" indicator can show up passively
 * while the meeting-details view happens to be open.
 *
 * This is intentionally session-only state, not a durable field re-read on
 * page reload — the background pass typically finishes within a minute or
 * two of the recording stopping, so the realistic window for showing it is
 * "user is still on (or returns to) this meeting's details page shortly
 * after recording". On success, `onRefined` is called so the caller can
 * refetch the (now-upgraded) transcript.
 */
export function useMeetingRefinedStatus(
  meetingId: string | null | undefined,
  onRefined?: () => void | Promise<void>,
): MeetingRefinedStatus {
  const [status, setStatus] = useState<MeetingRefinedStatus>("idle");
  const onRefinedRef = useRef(onRefined);
  useEffect(() => {
    onRefinedRef.current = onRefined;
  }, [onRefined]);

  useEffect(() => {
    if (!meetingId) return;

    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      const unlistenRefining = await listen<MeetingRefiningPayload>(
        "meeting-refining",
        (event) => {
          if (event.payload.meeting_id === meetingId) {
            setStatus("refining");
          }
        },
      );
      if (cancelled) {
        unlistenRefining();
        return;
      }
      unlisteners.push(unlistenRefining);

      const unlistenRefined = await listen<MeetingRefinedPayload>(
        "meeting-refined",
        (event) => {
          if (event.payload.meeting_id === meetingId) {
            setStatus("refined");
            void onRefinedRef.current?.();
          }
        },
      );
      if (cancelled) {
        unlistenRefined();
        return;
      }
      unlisteners.push(unlistenRefined);

      const unlistenFailed = await listen<MeetingRefineFailedPayload>(
        "meeting-refine-failed",
        (event) => {
          if (event.payload.meeting_id === meetingId) {
            setStatus("failed");
          }
        },
      );
      if (cancelled) {
        unlistenFailed();
        return;
      }
      unlisteners.push(unlistenFailed);
    };

    setStatus("idle");
    setup();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [meetingId]);

  return status;
}
