import { useEffect, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface SpeakersRefinedPayload {
  meeting_id: string;
  changed_count: number;
}

/**
 * Tracks the post-meeting speaker-refinement pass (see
 * `speaker_diarization::commands::refine_and_persist` on the Rust side) for a
 * single meeting, purely from live Tauri events.
 *
 * The pass re-clusters the recording's speaker embeddings offline — seeing
 * every embedding at once instead of the live path's greedy left-to-right
 * pass — and rewrites the saved transcripts' speaker labels where the
 * grouping improved. It runs right after the meeting is saved, so the
 * realistic window for showing anything is "user is still on (or returns to)
 * this meeting's details page shortly after recording". Session-only state,
 * mirroring `useMeetingRefinedStatus`.
 *
 * Returns the number of relabeled rows, or 0 when nothing changed (the
 * common case for a clean recording — the live labels were already right).
 * `onRefined` fires only when rows actually changed, so the caller doesn't
 * refetch for a no-op pass.
 */
export function useSpeakersRefined(
  meetingId: string | null | undefined,
  onRefined?: () => void | Promise<void>,
): number {
  // Count is tracked alongside the meeting it belongs to so switching
  // meetings resets it during render, rather than via a setState in the
  // listener effect (which would land a frame late — briefly showing the
  // previous meeting's count — and trip react-hooks/set-state-in-effect).
  // See https://react.dev/learn/you-might-not-need-an-effect
  const [refined, setRefined] = useState<{
    meetingId: string | null | undefined;
    count: number;
  }>({ meetingId, count: 0 });
  if (refined.meetingId !== meetingId) {
    setRefined({ meetingId, count: 0 });
  }

  const onRefinedRef = useRef(onRefined);
  useEffect(() => {
    onRefinedRef.current = onRefined;
  }, [onRefined]);

  useEffect(() => {
    if (!meetingId) return;

    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const setup = async () => {
      const fn = await listen<SpeakersRefinedPayload>(
        "speakers-refined",
        (event) => {
          if (event.payload.meeting_id !== meetingId) return;
          if (event.payload.changed_count <= 0) return;
          setRefined({ meetingId, count: event.payload.changed_count });
          void onRefinedRef.current?.();
        },
      );
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    };

    setup();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [meetingId]);

  return refined.meetingId === meetingId ? refined.count : 0;
}
