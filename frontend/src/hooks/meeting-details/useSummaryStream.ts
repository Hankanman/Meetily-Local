import { useEffect, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface SummaryStreamPayload {
  meeting_id: string;
  delta: string;
}

/**
 * Live token stream of an in-flight summary generation for one meeting.
 *
 * The backend emits `summary-stream` events (see
 * `SummaryService::process_transcript_background`) carrying incremental text
 * from the final report pass — currently produced by the built-in AI engine,
 * which streams tokens as it generates. Accumulates deltas while `active`;
 * resets whenever generation ends or the meeting changes, since the streamed
 * text is only a preview and the stored summary is authoritative.
 *
 * Returns the accumulated markdown-so-far, or "" before the first delta
 * (also "" for providers that don't stream — the caller keeps its spinner).
 */
export function useSummaryStream(
  meetingId: string | null | undefined,
  active: boolean,
): string {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!meetingId || !active) return;

    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    (async () => {
      const fn = await listen<SummaryStreamPayload>("summary-stream", (event) => {
        if (event.payload.meeting_id !== meetingId) return;
        setText((prev) => prev + event.payload.delta);
      });
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      // Generation over (or meeting switched): the preview is stale.
      setText("");
    };
  }, [meetingId, active]);

  return text;
}
