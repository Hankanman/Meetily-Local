"use client";

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useConfig } from "@/contexts/ConfigContext";
import { useOnboarding } from "@/contexts/OnboardingContext";
import { useImportDialog } from "@/contexts/ImportDialogContext";
import {
  isAudioExtension,
  getAudioFormatsDisplayList,
} from "@/constants/audioFormats";

// Listens to Tauri's drag/drop events and routes them through the
// ImportDialog provider. Quiet during onboarding (no main UI to drop into).
export function FileDropBridge() {
  const { betaFeatures } = useConfig();
  const { completed } = useOnboarding();
  const { openImportDialog, setShowDropOverlay } = useImportDialog();

  useEffect(() => {
    if (!completed) return;

    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    (async () => {
      const drop = (
        event: keyof WindowEventMap | string,
        handler: (payload?: { paths: string[] }) => void,
      ) =>
        listen(event, (e) => handler(e.payload as { paths: string[] }))
          .then((fn) => {
            if (cancelled) fn();
            else unlisteners.push(fn);
          });

      await drop("tauri://drag-enter", () => {
        if (betaFeatures.importAndRetranscribe) setShowDropOverlay(true);
      });

      await drop("tauri://drag-leave", () => {
        setShowDropOverlay(false);
      });

      await drop("tauri://drag-drop", (payload) => {
        setShowDropOverlay(false);
        const paths = payload?.paths ?? [];
        const audioFile = paths.find((p) => {
          const ext = p.split(".").pop()?.toLowerCase();
          return !!ext && isAudioExtension(ext);
        });
        if (audioFile) {
          openImportDialog(audioFile);
        } else if (paths.length > 0) {
          toast.error("Please drop an audio file", {
            description: `Supported formats: ${getAudioFormatsDisplayList()}`,
          });
        }
      });
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [completed, betaFeatures, openImportDialog, setShowDropOverlay]);

  return null;
}
