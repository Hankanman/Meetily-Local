"use client";

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { useOnboarding } from "@/contexts/OnboardingContext";

// Bridges the Rust tray's "request-recording-toggle" event to the in-app
// recording flow. If onboarding isn't complete, surfaces a toast instead.
// Otherwise dispatches a window event the Home page picks up via
// useRecordingStart.
export function TrayRecordingBridge() {
  const { completed } = useOnboarding();

  useEffect(() => {
    const unlisten = listen("request-recording-toggle", () => {
      if (!completed) {
        toast.error("Please complete setup first", {
          description:
            "You need to finish onboarding before you can start recording.",
        });
        return;
      }
      window.dispatchEvent(new CustomEvent("start-recording-from-sidebar"));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [completed]);

  return null;
}
