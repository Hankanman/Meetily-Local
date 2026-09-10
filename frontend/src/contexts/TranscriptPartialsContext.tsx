"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { PartialsBySource } from "@/types";

interface TranscriptPartialsContextType {
  /** Ephemeral streaming preview text, keyed by source. Never enters
   *  `transcripts` / IndexedDB / sequence_id ordering — overlay only. */
  partials: PartialsBySource;
  setPartialForSource: (
    source: "mic" | "system",
    value: PartialsBySource["mic"],
  ) => void;
  clearPartials: () => void;
}

const TranscriptPartialsContext = createContext<
  TranscriptPartialsContextType | undefined
>(undefined);

/**
 * Isolated from `TranscriptProvider` on purpose: `partials` updates on
 * every `transcript-partial` event (high frequency, mid-utterance), and
 * only the live-preview UI needs to re-render on those updates. Keeping it
 * out of `TranscriptContext`'s value means the (much larger) set of
 * committed-transcript consumers doesn't re-render every time a partial
 * ticks over.
 */
export function TranscriptPartialsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [partials, setPartials] = useState<PartialsBySource>({});

  const setPartialForSource = useCallback(
    (source: "mic" | "system", value: PartialsBySource["mic"]) => {
      setPartials((prev) => {
        if (prev[source] === value) return prev;
        if (!value && !prev[source]) return prev;
        return { ...prev, [source]: value };
      });
    },
    [],
  );

  const clearPartials = useCallback(() => {
    setPartials((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, []);

  const value = useMemo(
    () => ({ partials, setPartialForSource, clearPartials }),
    [partials, setPartialForSource, clearPartials],
  );

  return (
    <TranscriptPartialsContext.Provider value={value}>
      {children}
    </TranscriptPartialsContext.Provider>
  );
}

export function useTranscriptPartials() {
  const context = useContext(TranscriptPartialsContext);
  if (context === undefined) {
    throw new Error(
      "useTranscriptPartials must be used within a TranscriptPartialsProvider",
    );
  }
  return context;
}
