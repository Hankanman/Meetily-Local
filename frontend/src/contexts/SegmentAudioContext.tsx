"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

interface SegmentAudioValue {
  /** Segment key currently playing, or null. */
  playingKey: string | null;
  /** Segment key whose clip is being extracted, or null. */
  loadingKey: string | null;
  /** Play `[startSecs, endSecs]` of the meeting's audio for `key`, or stop it
   *  if that key is already the active one. `source` ("mic" | "system") selects
   *  the matching channel of the stereo recording; omit to play a mono downmix. */
  toggle: (
    key: string,
    meetingId: string,
    startSecs: number,
    endSecs: number,
    source?: string,
  ) => void;
  stop: () => void;
}

const SegmentAudioContext = createContext<SegmentAudioValue | null>(null);

const PLAYBACK_ENDED_EVENT = "segment-playback-ended";

/**
 * Coordinates "only one segment plays at a time" across a transcript's rows.
 * Playback happens natively in Rust (see `audio::playback`) rather than in the
 * webview: the AppImage's bundled WebKit/GStreamer ships no plugins, so every
 * in-webview audio path fails ("element appsink not found"). The Rust side
 * emits `segment-playback-ended` when a clip finishes on its own.
 */
export function SegmentAudioProvider({ children }: { children: ReactNode }) {
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  // Bumped on every play/stop so a slow extraction that resolves after the
  // user moved on doesn't flip stale state.
  const requestRef = useRef(0);

  // A clip that finishes on its own clears the playing state. Playback that's
  // replaced or explicitly stopped doesn't emit this (the backend guards it).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const fn = await listen(PLAYBACK_ENDED_EVENT, () => {
        setPlayingKey(null);
        setLoadingKey(null);
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const stop = useCallback(() => {
    requestRef.current++;
    setPlayingKey(null);
    setLoadingKey(null);
    void invoke("stop_meeting_audio_clip").catch(() => {});
  }, []);

  const play = useCallback(
    async (
      key: string,
      meetingId: string,
      startSecs: number,
      endSecs: number,
      source?: string,
    ) => {
      const reqId = ++requestRef.current;
      setPlayingKey(null);
      setLoadingKey(key);
      try {
        // Resolves once playback *starts* (the clip is extracted, then played
        // natively); the end-event clears `playingKey` when it finishes.
        await invoke("play_meeting_audio_clip", {
          meetingId,
          startSecs,
          endSecs,
          source: source ?? null,
        });
        if (reqId !== requestRef.current) return; // superseded by a newer click
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
    [],
  );

  const toggle = useCallback(
    (
      key: string,
      meetingId: string,
      startSecs: number,
      endSecs: number,
      source?: string,
    ) => {
      if (playingKey === key || loadingKey === key) {
        stop();
      } else {
        void play(key, meetingId, startSecs, endSecs, source);
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
