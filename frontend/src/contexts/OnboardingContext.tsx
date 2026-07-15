"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useModelDownloadEvents } from "@/hooks/useModelDownloads";

// Default local Whisper model downloaded during onboarding. Quantized turbo
// variant — comparable accuracy to large-v3 but ~3x faster on GPU.
const ONBOARDING_WHISPER_MODEL = "large-v3-turbo-q5_0";

interface OnboardingStatus {
  version: string;
  completed: boolean;
  current_step: number;
  model_status: {
    // JSON field name kept as `parakeet` for backward compat with existing
    // on-disk onboarding-status.json files; the Rust side aliases it to
    // `transcription` semantically (now refers to the local Whisper model).
    parakeet: string;
    summary: string;
  };
  last_updated: string;
}

interface SummaryModelProgressInfo {
  percent: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface TranscriptionProgressInfo {
  percent: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
}

interface OnboardingContextType {
  // Onboarding completion status (single source of truth — read by RootLayout
  // to decide between OnboardingFlow and the main app).
  completed: boolean;
  // True until we've finished checking the persisted status. Lets consumers
  // avoid showing a flash of the wrong UI on cold start.
  isStatusLoading: boolean;
  currentStep: number;
  // Local-Whisper download state. Field names kept short ("parakeet*" was
  // the legacy naming when Parakeet was the bundled engine) for minimal
  // call-site churn — they refer to the Whisper transcription model now.
  parakeetDownloaded: boolean;
  parakeetProgress: number;
  parakeetProgressInfo: TranscriptionProgressInfo;
  summaryModelDownloaded: boolean;
  summaryModelProgress: number;
  summaryModelProgressInfo: SummaryModelProgressInfo;
  selectedSummaryModel: string;
  databaseExists: boolean;
  isBackgroundDownloading: boolean;
  // Navigation
  goToStep: (step: number) => void;
  goNext: () => void;
  goPrevious: () => void;
  // Setters
  setParakeetDownloaded: (value: boolean) => void;
  setSummaryModelDownloaded: (value: boolean) => void;
  setSelectedSummaryModel: (value: string) => void;
  setDatabaseExists: (value: boolean) => void;
  completeOnboarding: () => Promise<void>;
  startBackgroundDownloads: (includeGemma: boolean) => Promise<void>;
  retryParakeetDownload: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(
  undefined,
);

export function OnboardingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentStep, setCurrentStep] = useState(1);
  const [completed, setCompleted] = useState(false);
  const [isStatusLoading, setIsStatusLoading] = useState(true);
  const [parakeetDownloaded, setParakeetDownloaded] = useState(false);
  const [parakeetProgress, setParakeetProgress] = useState(0);
  const [parakeetProgressInfo, setParakeetProgressInfo] =
    useState<TranscriptionProgressInfo>({
      percent: 0,
      downloadedMb: 0,
      totalMb: 0,
      speedMbps: 0,
    });
  const [summaryModelDownloaded, setSummaryModelDownloaded] = useState(false);
  const [summaryModelProgress, setSummaryModelProgress] = useState(0);
  const [summaryModelProgressInfo, setSummaryModelProgressInfo] =
    useState<SummaryModelProgressInfo>({
      percent: 0,
      downloadedMb: 0,
      totalMb: 0,
      speedMbps: 0,
    });
  const [selectedSummaryModel, setSelectedSummaryModel] =
    useState<string>("gemma3:1b");
  const [databaseExists, setDatabaseExists] = useState(false);
  const [isBackgroundDownloading, setIsBackgroundDownloading] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout>(undefined);
  const isCompletingRef = useRef(false);

  // Declared before the mount effect so it can reference it without TDZ;
  // wrapped in useCallback so its identity is stable across renders.
  const initializeDatabaseInBackground = useCallback(async () => {
    try {
      console.log(
        "[OnboardingContext] Starting background database initialization",
      );
      const isFirstLaunch = await invoke<boolean>("check_first_launch");

      if (!isFirstLaunch) {
        console.log(
          "[OnboardingContext] Database exists, skipping initialization",
        );
        setDatabaseExists(true);
        return;
      }

      // First launch — initialize a fresh database.
      await invoke("initialize_fresh_database");
      setDatabaseExists(true);
    } catch (error) {
      console.error(
        "[OnboardingContext] Database initialization failed:",
        error,
      );
      // Don't throw - database init failure shouldn't block onboarding
    }
  }, []);

  const checkDatabaseStatus = useCallback(async () => {
    try {
      const isFirstLaunch = await invoke<boolean>("check_first_launch");
      setDatabaseExists(!isFirstLaunch);
      console.log("[OnboardingContext] Database exists:", !isFirstLaunch);
    } catch (error) {
      console.error(
        "[OnboardingContext] Failed to check database status:",
        error,
      );
      setDatabaseExists(false);
    }
  }, []);

  // Verify that models actually exist on disk, not just trust saved JSON
  const verifyModelStatus = useCallback(
    async (savedStatus: OnboardingStatus) => {
      let parakeetDownloaded = false;
      let summaryModelDownloaded = false;

      // Verify the local Whisper transcription model exists on disk.
      try {
        parakeetDownloaded = await invoke<boolean>(
          "whisper_has_available_models",
        );
        console.log(
          "[OnboardingContext] Whisper model verified on disk:",
          parakeetDownloaded,
        );
      } catch (error) {
        console.warn(
          "[OnboardingContext] Failed to verify Whisper model:",
          error,
        );
        parakeetDownloaded = false;
      }

      // Verify Summary model exists on disk - check if ANY model is available
      // Onboarding always uses builtin-ai (local models)
      try {
        const availableModel = await invoke<string | null>(
          "builtin_ai_get_available_summary_model",
        );
        summaryModelDownloaded = !!availableModel;
        console.log(
          "[OnboardingContext] Summary model verified on disk:",
          summaryModelDownloaded,
          "model:",
          availableModel,
        );
      } catch (error) {
        console.warn(
          "[OnboardingContext] Failed to verify Summary model:",
          error,
        );
        summaryModelDownloaded = false;
      }

      // Determine the correct step based on verified status
      // Simplified flow: Step 1: Welcome, Step 2: Setup Overview, Step 3: Download Progress
      let currentStep = savedStatus.current_step;
      const completed = savedStatus.completed;

      // Clamp step to new max (3)
      if (currentStep > 3) {
        currentStep = 3; // Go to download progress step
      }

      // Trust the completed status - don't revert based on model downloads
      // Downloads continue in background; user stays in main app regardless
      return {
        currentStep,
        completed,
        parakeetDownloaded,
        summaryModelDownloaded,
      };
    },
    [],
  );

  // Check if any models are currently downloading (for re-entry)
  const checkActiveDownloads = useCallback(async () => {
    try {
      const models = await invoke<any[]>("whisper_get_available_models");
      const isDownloading = models.some(
        (m) =>
          m.status &&
          (typeof m.status === "object"
            ? "Downloading" in m.status
            : m.status === "Downloading"),
      );

      if (isDownloading) {
        console.log(
          "[OnboardingContext] Detected active Whisper download on mount",
        );
        setIsBackgroundDownloading(true);
      }
    } catch (error) {
      console.warn(
        "[OnboardingContext] Failed to check active downloads:",
        error,
      );
    }
  }, []);

  const loadOnboardingStatus = useCallback(async () => {
    try {
      const status = await invoke<OnboardingStatus | null>(
        "get_onboarding_status",
      );
      if (status) {
        console.log("[OnboardingContext] Loaded saved status:", status);

        // Don't trust saved status - verify actual model status on disk
        const verifiedStatus = await verifyModelStatus(status);

        setCurrentStep(verifiedStatus.currentStep);
        setCompleted(verifiedStatus.completed);
        setParakeetDownloaded(verifiedStatus.parakeetDownloaded);
        setSummaryModelDownloaded(verifiedStatus.summaryModelDownloaded);

        console.log("[OnboardingContext] Verified status:", verifiedStatus);

        // Check if any downloads are active to restore isBackgroundDownloading state
        await checkActiveDownloads();
      }
    } catch (error) {
      console.error(
        "[OnboardingContext] Failed to load onboarding status:",
        error,
      );
    } finally {
      setIsStatusLoading(false);
    }
  }, [verifyModelStatus, checkActiveDownloads]);

  const saveOnboardingStatus = useCallback(async () => {
    // Safety check: if we are in the process of completing, DO NOT save
    // This prevents a race condition where a download completion event triggers a save
    // that overwrites the "completed" status set by completeOnboarding
    if (isCompletingRef.current) {
      console.log(
        "[OnboardingContext] Skipping saveOnboardingStatus because completion is in progress",
      );
      return;
    }

    try {
      await invoke("save_onboarding_status_cmd", {
        status: {
          version: "1.0",
          completed: completed,
          current_step: currentStep,
          model_status: {
            parakeet: parakeetDownloaded ? "downloaded" : "not_downloaded",
            summary: summaryModelDownloaded ? "downloaded" : "not_downloaded",
          },
          last_updated: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(
        "[OnboardingContext] Failed to save onboarding status:",
        error,
      );
    }
  }, [completed, currentStep, parakeetDownloaded, summaryModelDownloaded]);

  // Load status on mount and initialize database. Each helper performs its
  // setState calls after an await; the rule cannot see through async boundaries.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    loadOnboardingStatus();
    checkDatabaseStatus();
    initializeDatabaseInBackground();
    /* eslint-enable react-hooks/set-state-in-effect */

    // Fetch and set recommended model
    const fetchRecommendation = async () => {
      try {
        const recommendedModel = await invoke<string>(
          "builtin_ai_get_recommended_model",
        );
        setSelectedSummaryModel(recommendedModel);
        console.log(
          "[OnboardingContext] Set recommended model:",
          recommendedModel,
        );
      } catch (error) {
        console.error(
          "[OnboardingContext] Failed to get recommended model:",
          error,
        );
        // Keep default gemma3:1b
      }
    };
    fetchRecommendation();
  }, [
    loadOnboardingStatus,
    checkDatabaseStatus,
    initializeDatabaseInBackground,
  ]);

  // Auto-save on state change (debounced)
  useEffect(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    // Don't auto-save if completed (to avoid overwriting completion status)
    // Also don't auto-save if we are currently in the process of completing
    if (completed || isCompletingRef.current) return;

    saveTimeoutRef.current = setTimeout(() => {
      saveOnboardingStatus();
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [
    currentStep,
    parakeetDownloaded,
    summaryModelDownloaded,
    completed,
    saveOnboardingStatus,
  ]);

  // Listen to Whisper + Built-in AI (Gemma) download events via the shared
  // store (frontend/src/lib/modelDownloadStore.ts), which owns the single
  // Tauri listen() registration per backend event. `event.raw` is the
  // untouched payload (same shape the old direct listen() callbacks read),
  // so the filtering/state logic below is unchanged — only the event
  // source moved. `selectedSummaryModel` is read fresh on every call (the
  // hook always dispatches to the latest handler), so no dependency array
  // is needed here.
  useModelDownloadEvents((event) => {
    if (event.kind === "whisper") {
      if (event.raw.modelName !== ONBOARDING_WHISPER_MODEL) return;

      if (event.type === "error") {
        console.error("Whisper download error:", event.raw.error);
        return;
      }

      if (event.type === "complete") {
        setParakeetDownloaded(true);
        setParakeetProgress(100);
        return;
      }

      // progress / cancelled
      const { progress, downloaded_mb, total_mb, speed_mbps, status } = event.raw;
      setParakeetProgress(progress);
      setParakeetProgressInfo({
        percent: progress,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 0,
        speedMbps: speed_mbps ?? 0,
      });
      if (status === "completed" || progress >= 100) {
        setParakeetDownloaded(true);
      }
      return;
    }

    // event.kind === "builtin" — check if this is the selected summary
    // model (gemma3:1b or gemma3:4b)
    const { model, progress, downloaded_mb, total_mb, speed_mbps, status } =
      event.raw;
    if (
      model === selectedSummaryModel ||
      model === "gemma3:1b" ||
      model === "gemma3:4b"
    ) {
      setSummaryModelProgress(progress);
      setSummaryModelProgressInfo({
        percent: progress,
        downloadedMb: downloaded_mb ?? 0,
        totalMb: total_mb ?? 0,
        speedMbps: speed_mbps ?? 0,
      });
      if (status === "completed" || progress >= 100) {
        setSummaryModelDownloaded(true);
      }
    }
  });

  const completeOnboarding = async () => {
    try {
      // Set completion flag to prevent race conditions with auto-save
      isCompletingRef.current = true;

      // Clear any pending auto-saves
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
      }

      // Onboarding always uses builtin-ai with selected model
      await invoke("complete_onboarding", {
        model: selectedSummaryModel,
      });
      setCompleted(true);
      console.log(
        "[OnboardingContext] Onboarding completed with model:",
        selectedSummaryModel,
      );

      // Reset the flag so subsequent state updates can be saved
      isCompletingRef.current = false;
    } catch (error) {
      console.error(
        "[OnboardingContext] Failed to complete onboarding:",
        error,
      );
      isCompletingRef.current = false; // Reset flag on error
      throw error; // Re-throw so the caller (DownloadProgressStep) can handle it
    }
  };

  // Start background downloads for models (parallel - Parakeet first, then Gemma immediately)
  const startBackgroundDownloads = async (includeGemma: boolean) => {
    console.log(
      "[OnboardingContext] Starting background downloads, includeGemma:",
      includeGemma,
    );
    setIsBackgroundDownloading(true);

    try {
      // Start Whisper download first (speech recognition — always required)
      if (!parakeetDownloaded) {
        console.log("[OnboardingContext] Starting Whisper model download");
        invoke("whisper_download_model", {
          modelName: ONBOARDING_WHISPER_MODEL,
        }).catch((err) =>
          console.error("[OnboardingContext] Whisper download failed:", err),
        );
      }

      // Start Gemma download after a delay to prioritize transcription bandwidth
      if (includeGemma && !summaryModelDownloaded) {
        setTimeout(() => {
          console.log(
            "[OnboardingContext] Starting Gemma download (delayed to prioritize Whisper)",
          );
          invoke("builtin_ai_download_model", {
            modelName: selectedSummaryModel || "gemma3:1b",
          }).catch((err) =>
            console.error("[OnboardingContext] Gemma download failed:", err),
          );
        }, 3000); // 3 second delay to give Whisper priority
      }
    } catch (error) {
      console.error(
        "[OnboardingContext] Failed to start background downloads:",
        error,
      );
      setIsBackgroundDownloading(false);
      throw error;
    }
  };

  const retryParakeetDownload = async () => {
    // Whisper has no separate retry command — calling download again is the
    // retry path (the backend resumes / re-fetches as appropriate).
    console.log("[OnboardingContext] Retrying Whisper model download");
    try {
      await invoke("whisper_download_model", {
        modelName: ONBOARDING_WHISPER_MODEL,
      });
    } catch (error) {
      console.error("[OnboardingContext] Retry failed:", error);
      throw error;
    }
  };

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.max(1, Math.min(step, 3)));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((prev: number) => {
      const next = prev + 1;
      // Don't go past step 3
      return Math.min(next, 3);
    });
  }, []);

  const goPrevious = useCallback(() => {
    setCurrentStep((prev: number) => {
      const previous = prev - 1;
      // Don't go below step 1
      return Math.max(previous, 1);
    });
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        currentStep,
        completed,
        isStatusLoading,
        parakeetDownloaded,
        parakeetProgress,
        parakeetProgressInfo,
        summaryModelDownloaded,
        summaryModelProgress,
        summaryModelProgressInfo,
        selectedSummaryModel,
        databaseExists,
        isBackgroundDownloading,
        goToStep,
        goNext,
        goPrevious,
        setParakeetDownloaded,
        setSummaryModelDownloaded,
        setSelectedSummaryModel,
        setDatabaseExists,
        completeOnboarding,
        startBackgroundDownloads,
        retryParakeetDownload,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}
