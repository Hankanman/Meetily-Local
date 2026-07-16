"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { getMeetingAudioClip } from "@/lib/audio-clip";

interface SegmentAudioValue {
  /** Segment key currently playing, or null. */
  playingKey: string | null;
  /** Segment key whose clip is being fetched/decoded, or null. */
  loadingKey: string | null;
  /** Play `[startSecs, endSecs]` of the meeting's audio for `key`, or stop it
   *  if that key is already the active one. */
  toggle: (
    key: string,
    meetingId: string,
    startSecs: number,
    endSecs: number,
  ) => void;
  stop: () => void;
}

const SegmentAudioContext = createContext<SegmentAudioValue | null>(null);

/**
 * Shares a single Web Audio context and "only one segment plays at a time"
 * state across a transcript's segment rows. Playback uses decoded WAV clips
 * (see `lib/audio-clip`) rather than an <audio> element so it works even where
 * the webview's mp4/GStreamer path is broken.
 */
export function SegmentAudioProvider({ children }: { children: ReactNode }) {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Bumped on every play/stop so a slow decode that resolves after the user
  // moved on doesn't start stale audio or clobber newer state.
  const requestRef = useRef(0);

  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
      } catch {
        // already stopped
      }
      try {
        sourceRef.current.disconnect();
      } catch {
        // already disconnected
      }
      sourceRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    requestRef.current++;
    stopSource();
    setPlayingKey(null);
    setLoadingKey(null);
  }, [stopSource]);

  const play = useCallback(
    async (
      key: string,
      meetingId: string,
      startSecs: number,
      endSecs: number,
    ) => {
      const reqId = ++requestRef.current;
      stopSource();
      setPlayingKey(null);
      setLoadingKey(key);
      try {
        const ctx =
          ctxRef.current ??
          (ctxRef.current = new (window.AudioContext ||
            // Safari/WebKit legacy name
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext)());
        if (ctx.state === "suspended") await ctx.resume();

        const raw = await getMeetingAudioClip(meetingId, startSecs, endSecs);
        const audioBuffer = await ctx.decodeAudioData(raw);
        if (reqId !== requestRef.current) return; // superseded by a newer click

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          if (reqId === requestRef.current) {
            sourceRef.current = null;
            setPlayingKey(null);
          }
        };
        sourceRef.current = source;
        source.start();
        setLoadingKey(null);
        setPlayingKey(key);
      } catch (e) {
        if (reqId === requestRef.current) {
          setLoadingKey(null);
          setPlayingKey(null);
        }
        toast.error(
          typeof e === "string"
            ? e
            : e instanceof Error
              ? e.message
              : "Couldn't play that segment.",
        );
      }
    },
    [stopSource],
  );

  const toggle = useCallback(
    (key: string, meetingId: string, startSecs: number, endSecs: number) => {
      if (playingKey === key || loadingKey === key) {
        stop();
      } else {
        void play(key, meetingId, startSecs, endSecs);
      }
    },
    [playingKey, loadingKey, play, stop],
  );

  const value = useMemo(
    () => ({ playingKey, loadingKey, toggle, stop }),
    [playingKey, loadingKey, toggle, stop],
  );

  return (
    <SegmentAudioContext.Provider value={value}>
      {children}
    </SegmentAudioContext.Provider>
  );
}

/** Returns the segment-audio controls, or null when no provider is mounted
 *  (e.g. the live-recording view, where per-segment playback is disabled). */
export function useSegmentAudio(): SegmentAudioValue | null {
  return useContext(SegmentAudioContext);
}
