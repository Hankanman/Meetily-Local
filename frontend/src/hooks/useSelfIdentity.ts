"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { getSelfVoiceStatus } from "@/lib/self-voice";

// First-person labels the extractor uses for the local user when it hasn't
// resolved a real name — the transcript tags the user's own voice "Me", and
// summaries often phrase their tasks as "you"/"I".
const SELF_ALIASES = ["me", "you", "i", "myself"];

/**
 * Who "me" is, for filtering action items to the current user. Identity is the
 * enrolled self-voice profile's display name (the same label shown for the
 * user's voice in transcripts) plus the built-in first-person aliases. Returns
 * `isMine(assignee)` for a case-insensitive match.
 */
export function useSelfIdentity() {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getSelfVoiceStatus();
        if (!cancelled) setDisplayName(status?.name ?? null);
      } catch {
        if (!cancelled) setDisplayName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const aliases = useMemo(() => {
    const set = new Set(SELF_ALIASES);
    const name = displayName?.trim().toLowerCase();
    if (name) set.add(name);
    return set;
  }, [displayName]);

  const isMine = useCallback(
    (assignee: string | null | undefined) =>
      !!assignee && aliases.has(assignee.trim().toLowerCase()),
    [aliases],
  );

  return { displayName, isMine };
}
