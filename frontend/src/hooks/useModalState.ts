import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { TranscriptModelProps } from "@/components/TranscriptSettings";
import { useModelDownloadEvents } from "@/hooks/useModelDownloads";

export type ModalType =
  | "modelSettings"
  | "deviceSettings"
  | "languageSettings"
  | "modelSelector"
  | "errorAlert"
  | "chunkDropWarning";

interface ModalState {
  modelSettings: boolean;
  deviceSettings: boolean;
  languageSettings: boolean;
  modelSelector: boolean;
  errorAlert: boolean;
  chunkDropWarning: boolean;
}

interface ModalMessages {
  errorAlert: string;
  chunkDropWarning: string;
  modelSelector: string;
}

interface UseModalStateReturn {
  modals: ModalState;
  messages: ModalMessages;
  showModal: (name: ModalType, message?: string) => void;
  hideModal: (name: ModalType) => void;
  hideAllModals: () => void;
}

/**
 * Custom hook for managing all modal state and event listeners.
 * Consolidates 9 useState calls and 3 event listeners from page.tsx.
 *
 * Features:
 * - Unified modal state management
 * - Event listeners for chunk drops, transcription errors, model downloads
 * - Auto-close on model download completion
 */
export function useModalState(
  transcriptModelConfig?: TranscriptModelProps,
): UseModalStateReturn {
  // Modal visibility state
  const [modals, setModals] = useState<ModalState>({
    modelSettings: false,
    deviceSettings: false,
    languageSettings: false,
    modelSelector: false,
    errorAlert: false,
    chunkDropWarning: false,
  });

  // Modal messages
  const [messages, setMessages] = useState<ModalMessages>({
    errorAlert: "",
    chunkDropWarning: "",
    modelSelector: "",
  });

  // Show modal with optional message
  const showModal = useCallback((name: ModalType, message?: string) => {
    setModals((prev) => ({ ...prev, [name]: true }));

    // Set message if provided
    if (
      message &&
      (name === "errorAlert" ||
        name === "chunkDropWarning" ||
        name === "modelSelector")
    ) {
      setMessages((prev) => ({ ...prev, [name]: message }));
    }
  }, []);

  // Hide modal and clear its message
  const hideModal = useCallback((name: ModalType) => {
    setModals((prev) => ({ ...prev, [name]: false }));

    // Clear message when closing
    if (
      name === "errorAlert" ||
      name === "chunkDropWarning" ||
      name === "modelSelector"
    ) {
      setMessages((prev) => ({ ...prev, [name]: "" }));
    }
  }, []);

  // Hide all modals
  const hideAllModals = useCallback(() => {
    setModals({
      modelSettings: false,
      deviceSettings: false,
      languageSettings: false,
      modelSelector: false,
      errorAlert: false,
      chunkDropWarning: false,
    });
    setMessages({
      errorAlert: "",
      chunkDropWarning: "",
      modelSelector: "",
    });
  }, []);

  // Set up chunk drop warning listener
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupChunkDropListener = async () => {
      try {
        console.log("Setting up chunk-drop-warning listener...");
        unlistenFn = await listen<string>("chunk-drop-warning", (event) => {
          console.log("Chunk drop warning received:", event.payload);
          showModal("chunkDropWarning", event.payload);
        });
        console.log("Chunk drop warning listener setup complete");
      } catch (error) {
        console.error("Failed to setup chunk drop warning listener:", error);
      }
    };

    setupChunkDropListener();

    return () => {
      console.log("Cleaning up chunk drop warning listener...");
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [showModal]);

  // Set up transcription error listener for model loading failures
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupTranscriptionErrorListener = async () => {
      try {
        console.log("Setting up transcription-error listener...");
        unlistenFn = await listen<{
          error: string;
          userMessage: string;
          actionable: boolean;
        }>("transcription-error", (event) => {
          console.log("Transcription error received:", event.payload);
          const { userMessage, actionable } = event.payload;

          if (actionable) {
            // This is a model-related error that requires user action
            showModal("modelSelector", userMessage);
          } else {
            // Show toast instead of modal for non-actionable errors (consistent with sidebar)
            toast.error("", {
              description: userMessage,
              duration: 5000,
            });
          }
        });
        console.log("Transcription error listener setup complete");
      } catch (error) {
        console.error("Failed to setup transcription error listener:", error);
      }
    };

    setupTranscriptionErrorListener();

    return () => {
      console.log("Cleaning up transcription error listener...");
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [showModal]);

  // Stable ref for the listener's auto-close logic — the listener
  // captures `transcriptModelConfig` so we'd otherwise need to put it
  // in deps and re-register on every config change. Reading from a
  // ref instead lets the effect run once on mount.
  const transcriptConfigRef = useRef(transcriptModelConfig);
  useEffect(() => {
    transcriptConfigRef.current = transcriptModelConfig;
  }, [transcriptModelConfig]);

  // Listen for model download completion to auto-close modal.
  //
  // This previously had two compounding bugs:
  //  1. The cleanup function was returned from the inner async closure
  //     instead of from the useEffect body, so React never invoked it
  //     on unmount or re-run — listeners accumulated forever.
  //  2. Deps included `transcriptModelConfig`, so every Whisper-model
  //     selection (which writes a new config object reference) re-ran
  //     the effect, registering yet another `model-download-complete`
  //     listener via Tauri IPC. Combined with #1, dozens of listeners
  //     piled up after a few clicks, causing dramatic UI lag on the
  //     transcript settings page.
  //
  // Now: subscribe once via the shared model-download store
  // (frontend/src/lib/modelDownloadStore.ts), which owns the single Tauri
  // listen() registration for "model-download-complete" (shared with every
  // other download-progress consumer). Reads the latest config via a ref,
  // same as before.
  useModelDownloadEvents((event) => {
    if (event.kind !== "whisper" || event.type !== "complete") return;

    const { modelName } = event.raw;
    const cfg = transcriptConfigRef.current;
    if (cfg?.provider === "localWhisper" && cfg?.model === modelName) {
      toast.success("Model ready! Closing window...", {
        duration: 1500,
      });
      setTimeout(() => hideModal("modelSelector"), 1500);
    }
  });

  return {
    modals,
    messages,
    showModal,
    hideModal,
    hideAllModals,
  };
}
