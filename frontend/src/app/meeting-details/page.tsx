"use client";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { Transcript, Summary } from "@/types";
import PageContent from "./page-content";
import { useRouter, useSearchParams } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { LoaderIcon } from "lucide-react";
import { useConfig } from "@/contexts/ConfigContext";
import { usePaginatedTranscripts } from "@/hooks/usePaginatedTranscripts";
import { PageLoading } from "@/components/layout/Page";

interface MeetingDetailsResponse {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
  folder_path?: string;
}

function MeetingDetailsContent() {
  const searchParams = useSearchParams();
  const meetingId = searchParams.get("id");
  const source = searchParams.get("source"); // Check if navigated from recording
  const { setCurrentMeeting, refetchMeetings, stopSummaryPolling } =
    useSidebar();
  const { isAutoSummary } = useConfig(); // Get auto-summary toggle state
  const router = useRouter();
  const [meetingSummary, setMeetingSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [shouldAutoGenerate, setShouldAutoGenerate] = useState<boolean>(false);
  const [hasCheckedAutoGen, setHasCheckedAutoGen] = useState<boolean>(false);

  // Use pagination hook for efficient transcript loading
  const {
    metadata,
    segments,
    transcripts,
    isLoading: isLoadingTranscripts,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    refetch,
    error: transcriptError,
  } = usePaginatedTranscripts({ meetingId: meetingId || "" });

  // Derived from the paginated-transcripts hook — was previously mirrored
  // into useState via an effect, which tripped react-hooks/set-state-in-effect
  // and added a useless render cycle. Resets implicitly: when the hook
  // refetches, `metadata` becomes null until the new meeting loads.
  const meetingDetails: MeetingDetailsResponse | null = useMemo(() => {
    if (!metadata || !meetingId || meetingId === "intro-call") return null;
    return {
      id: metadata.id,
      title: metadata.title,
      created_at: metadata.created_at,
      updated_at: metadata.updated_at,
      transcripts: transcripts,
      folder_path: metadata.folder_path,
    };
  }, [metadata, transcripts, meetingId]);

  // `error` is fully derived: invalid meeting id wins, then transcript-load
  // errors. Was previously mirrored via useState + two effects.
  const error: string | null =
    !meetingId || meetingId === "intro-call"
      ? "No meeting selected"
      : (transcriptError ?? null);

  // Check if gemma3:1b model is available in Ollama
  const checkForGemmaModel = useCallback(async (): Promise<boolean> => {
    try {
      const models = (await invoke("get_ollama_models", {
        endpoint: null,
      })) as any[];
      const hasGemma = models.some((m: any) => m.name === "gemma3:1b");
      console.log("🔍 Checked for gemma3:1b:", hasGemma);
      return hasGemma;
    } catch (error) {
      console.error("❌ Failed to check Ollama models:", error);
      return false;
    }
  }, []);

  // Set up auto-generation - respects DB as source of truth
  const setupAutoGeneration = useCallback(async () => {
    if (hasCheckedAutoGen) return; // Only check once

    // Only auto-generate if navigated from recording
    if (source !== "recording") {
      console.log("Not from recording navigation, skipping auto-generation");
      setHasCheckedAutoGen(true);
      return;
    }

    // Respect user's auto-summary toggle preference
    if (!isAutoSummary) {
      console.log("Auto-summary is disabled in settings");
      setHasCheckedAutoGen(true);
      return;
    }

    try {
      // Check what's currently in database
      const currentConfig = (await invoke("api_get_model_config")) as any;

      // If DB already has a model, use it (never override!)
      if (currentConfig && currentConfig.model) {
        console.log("Using existing model from DB:", currentConfig.model);
        setShouldAutoGenerate(true);
        setHasCheckedAutoGen(true);
        return;
      }

      // DB is empty - check if gemma3:1b exists as fallback
      const hasGemma = await checkForGemmaModel();

      if (hasGemma) {
        console.log("💾 DB empty, using gemma3:1b as initial default");

        await invoke("api_save_model_config", {
          provider: "ollama",
          model: "",
          whisperModel: "large-v3",
          apiKey: null,
          ollamaEndpoint: null,
        });

        setShouldAutoGenerate(true);
      } else {
        console.log("⚠️ No model configured and gemma3:1b not found");
      }
    } catch (error) {
      console.error("❌ Failed to setup auto-generation:", error);
    }

    setHasCheckedAutoGen(true);
  }, [hasCheckedAutoGen, checkForGemmaModel, source, isAutoSummary]);

  // Sync meeting title to the sidebar when metadata loads. The
  // `meetingDetails` object is now derived above; this effect only exists to
  // push to an external system (the sidebar context).
  useEffect(() => {
    if (!metadata || !meetingId || meetingId === "intro-call") return;
    setCurrentMeeting({ id: metadata.id, title: metadata.title });
  }, [metadata, meetingId, setCurrentMeeting]);

  // Extract fetchMeetingDetails for use in child components (now refetches via hook)
  const fetchMeetingDetails = useCallback(async () => {
    if (!meetingId || meetingId === "intro-call") {
      return;
    }

    // The usePaginatedTranscripts hook automatically refetches when meetingId changes
    // This function is kept for compatibility with onMeetingUpdated callback
    console.log(
      "fetchMeetingDetails called - pagination hook will handle refetch",
    );
  }, [meetingId]);

  // Reset states when meetingId changes (prevent race conditions).
  // `meetingDetails` and `error` are derived above so they reset implicitly.
  // The setStates here are intentional: we want the loading UI to show
  // immediately on navigation, before the summary fetch even starts.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setMeetingSummary(null);
    setIsLoading(true);
    setHasCheckedAutoGen(false);
    setShouldAutoGenerate(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [meetingId]);

  // Cleanup: Stop polling when navigating away from a meeting
  useEffect(() => {
    return () => {
      if (meetingId) {
        console.log(
          "Cleaning up: Stopping summary polling for meeting:",
          meetingId,
        );
        stopSummaryPolling(meetingId);
      }
    };
  }, [meetingId, stopSummaryPolling]);

  // Loading-state lifecycle (set during fetch, cleared in async finally).
  useEffect(() => {
    console.log("MeetingDetails useEffect triggered - meetingId:", meetingId);

    if (!meetingId || meetingId === "intro-call") {
      console.warn("No valid meeting ID in URL - meetingId:", meetingId);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      return;
    }

    console.log("Valid meeting ID found, fetching details for:", meetingId);

    setMeetingSummary(null);
    setIsLoading(true);

    const fetchMeetingSummary = async () => {
      try {
        const summary = (await invoke("api_get_summary", {
          meetingId: meetingId,
        })) as any;

        console.log("FETCH SUMMARY: Raw response:", summary);

        // Check if the summary request failed with 404 or error status, or if no summary exists yet (idle)
        // Note: 'cancelled' and 'failed' statuses can still have data if backup was restored
        if (
          summary.status === "idle" ||
          (!summary.data && summary.status === "error")
        ) {
          console.warn(
            "Meeting summary not found or no summary generated yet:",
            summary.error || "idle",
          );
          setMeetingSummary(null);
          return;
        }

        const summaryData = summary.data || {};

        // Parse if it's a JSON string (backend may return double-encoded JSON)
        let parsedData = summaryData;
        if (typeof summaryData === "string") {
          try {
            parsedData = JSON.parse(summaryData);
          } catch (e) {
            parsedData = {};
          }
        }

        console.log("🔍 FETCH SUMMARY: Parsed data:", parsedData);

        // Markdown is the canonical format — old saves may also have a
        // `summary_json` field (BlockNote-shaped), but markdown was always
        // saved alongside, so we route everything through it.
        if (parsedData.markdown) {
          setMeetingSummary(parsedData as any);
          return;
        }

        // Legacy format - apply formatting
        console.log(
          "LEGACY FORMAT: Detected legacy format, applying section formatting",
        );

        const { MeetingName, _section_order, ...restSummaryData } = parsedData;

        // Format the summary data with consistent styling - PRESERVE ORDER
        const formattedSummary: Summary = {};

        // Use section order if available to maintain exact order and handle duplicates
        const sectionKeys = _section_order || Object.keys(restSummaryData);

        console.log("LEGACY FORMAT: Processing sections:", sectionKeys);

        for (const key of sectionKeys) {
          try {
            const section = restSummaryData[key];
            // Comprehensive null checks to prevent the error
            if (
              section &&
              typeof section === "object" &&
              "title" in section &&
              "blocks" in section
            ) {
              const typedSection = section as {
                title?: string;
                blocks?: any[];
              };

              // Ensure blocks is an array before mapping
              if (Array.isArray(typedSection.blocks)) {
                formattedSummary[key] = {
                  title: typedSection.title || key,
                  blocks: typedSection.blocks.map((block: any) => ({
                    ...block,
                    // type: 'bullet',
                    color: "default",
                    content: block?.content?.trim() || "",
                  })),
                };
              } else {
                // Handle case where blocks is not an array
                console.warn(
                  `LEGACY FORMAT: Section ${key} has invalid blocks:`,
                  typedSection.blocks,
                );
                formattedSummary[key] = {
                  title: typedSection.title || key,
                  blocks: [],
                };
              }
            } else {
              console.warn(
                `LEGACY FORMAT: Skipping invalid section ${key}:`,
                section,
              );
            }
          } catch (error) {
            console.warn(
              `LEGACY FORMAT: Error processing section ${key}:`,
              error,
            );
            // Continue processing other sections
          }
        }

        console.log("LEGACY FORMAT: Formatted summary:", formattedSummary);
        setMeetingSummary(formattedSummary);
      } catch (error) {
        console.error("FETCH SUMMARY: Error fetching meeting summary:", error);
        // Don't set error state for summary fetch failure, set to null to show generate button
        setMeetingSummary(null);
      }
    };

    const loadData = async () => {
      try {
        await fetchMeetingSummary();
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [meetingId]);

  // Auto-generation check: runs when meeting is loaded with no summary
  useEffect(() => {
    const checkAutoGen = async () => {
      // Only auto-generate if:
      // 1. We have meeting details
      // 2. No summary exists
      // 3. Meeting has transcripts
      // 4. Haven't checked yet
      if (
        meetingDetails &&
        meetingSummary === null &&
        meetingDetails.transcripts &&
        meetingDetails.transcripts.length > 0 &&
        !hasCheckedAutoGen
      ) {
        console.log("No summary found, checking for auto-generation...");
        await setupAutoGeneration();
      }
    };

    checkAutoGen();
  }, [meetingDetails, meetingSummary, hasCheckedAutoGen, setupAutoGeneration]);

  if (error) {
    return (
      <PageLoading>
        <div className="text-center">
          <p className="mb-4 text-red-500">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="
              rounded-sm bg-blue-500 px-4 py-2 text-white
              hover:bg-blue-600
            "
          >
            Go Back
          </button>
        </div>
      </PageLoading>
    );
  }

  // Show loading spinner while initial data loads
  if (isLoading || isLoadingTranscripts || !meetingDetails) {
    return (
      <PageLoading>
        <LoaderIcon className="size-6 animate-spin" />
      </PageLoading>
    );
  }

  return (
    <PageContent
      meeting={meetingDetails}
      summaryData={meetingSummary}
      shouldAutoGenerate={shouldAutoGenerate}
      onAutoGenerateComplete={() => setShouldAutoGenerate(false)}
      onMeetingUpdated={async () => {
        // Refetch meeting details to get updated title from backend
        await fetchMeetingDetails();
        // Refetch meetings list to update sidebar
        await refetchMeetings();
      }}
      onRefetchTranscripts={refetch}
      // Pagination props for efficient transcript loading
      segments={segments}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      totalCount={totalCount}
      loadedCount={loadedCount}
      onLoadMore={loadMore}
    />
  );
}

export default function MeetingDetails() {
  return (
    <Suspense
      fallback={
        <PageLoading>
          <LoaderIcon className="size-6 animate-spin" />
        </PageLoading>
      }
    >
      <MeetingDetailsContent />
    </Suspense>
  );
}
