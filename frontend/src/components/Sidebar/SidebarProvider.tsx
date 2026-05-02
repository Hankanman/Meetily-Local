"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { getErrorMessage } from "@/lib/utils";

interface SidebarItem {
  id: string;
  title: string;
  type: "folder" | "file";
  children?: SidebarItem[];
}

export interface CurrentMeeting {
  id: string;
  title: string;
}

// Search result type for transcript search
interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
}

interface SidebarContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  sidebarItems: SidebarItem[];
  isCollapsed: boolean;
  toggleCollapse: () => void;
  meetings: CurrentMeeting[];
  setMeetings: (meetings: CurrentMeeting[]) => void;
  isMeetingActive: boolean;
  setIsMeetingActive: (active: boolean) => void;
  handleRecordingToggle: () => void;
  searchTranscripts: (query: string) => Promise<void>;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  transcriptServerAddress: string;
  setTranscriptServerAddress: (address: string) => void;
  // Summary polling management
  activeSummaryPolls: Map<string, NodeJS.Timeout>;
  startSummaryPolling: (
    meetingId: string,
    processId: string,
    onUpdate: (result: any) => void,
  ) => void;
  stopSummaryPolling: (meetingId: string) => void;
  // Refetch meetings from backend
  refetchMeetings: () => Promise<void>;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>({
    id: "intro-call",
    title: "+ New Call",
  });
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [transcriptServerAddress, setTranscriptServerAddress] = useState(
    "http://127.0.0.1:8178/stream",
  );
  const [activeSummaryPolls, setActiveSummaryPolls] = useState<
    Map<string, NodeJS.Timeout>
  >(new Map());

  // Use recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();

  const pathname = usePathname();
  const router = useRouter();

  const fetchMeetings = React.useCallback(async () => {
    try {
      const meetings = (await invoke("api_get_meetings")) as Array<{
        id: string;
        title: string;
      }>;
      const transformedMeetings = meetings.map((meeting: any) => ({
        id: meeting.id,
        title: meeting.title,
      }));
      setMeetings(transformedMeetings);
    } catch (error) {
      console.error("Error fetching meetings:", error);
      setMeetings([]);
    }
  }, []);

  useEffect(() => {
    // setMeetings happens after await inside fetchMeetings; rule cannot see through async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMeetings();
  }, [fetchMeetings]);

  // sidebarItems is purely derived from meetings — compute it instead of mirroring
  // through state (avoids two redundant set-state-in-effect cascades).
  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      {
        id: "meetings",
        title: "Meeting Notes",
        type: "folder" as const,
        children: meetings.map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          type: "file" as const,
        })),
      },
    ],
    [meetings],
  );

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Reset current meeting when navigating to home page (genuine pathname-driven reset)
  useEffect(() => {
    if (pathname === "/") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentMeeting({ id: "intro-call", title: "+ New Call" });
    }
  }, [pathname]);

  // Function to handle recording toggle from sidebar
  const handleRecordingToggle = () => {
    if (!isRecording) {
      // Check if already on home page
      if (pathname === "/") {
        // Already on home - trigger recording directly via custom event
        console.log("Triggering recording from sidebar (already on home page)");
        window.dispatchEvent(new CustomEvent("start-recording-from-sidebar"));
      } else {
        // Not on home - navigate and use auto-start mechanism
        console.log("Navigating to home page with auto-start flag");
        sessionStorage.setItem("autoStartRecording", "true");
        router.push("/");
      }
    }
    // The actual recording start/stop is handled in the Home component
  };

  // Function to search through meeting transcripts
  const searchTranscripts = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setIsSearching(true);

      const results = (await invoke("api_search_transcripts", {
        query,
      })) as TranscriptSearchResult[];
      setSearchResults(results);
    } catch (error) {
      console.error("Error searching transcripts:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Summary polling management
  const startSummaryPolling = React.useCallback(
    (meetingId: string, processId: string, onUpdate: (result: any) => void) => {
      // Stop existing poll for this meeting if any
      if (activeSummaryPolls.has(meetingId)) {
        clearInterval(activeSummaryPolls.get(meetingId)!);
      }

      let pollCount = 0;
      const MAX_POLLS = 200; // ~16.5 minutes at 5-second intervals (slightly longer than backend's 15-min timeout to avoid race conditions)

      const pollInterval = setInterval(async () => {
        pollCount++;

        // Timeout safety: Stop after 10 minutes
        if (pollCount >= MAX_POLLS) {
          console.warn(
            `Polling timeout for ${meetingId} after ${MAX_POLLS} iterations`,
          );
          clearInterval(pollInterval);
          setActiveSummaryPolls((prev) => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
          onUpdate({
            status: "error",
            error:
              "Summary generation timed out after 15 minutes. Please try again or check your model configuration.",
          });
          return;
        }
        try {
          const result = (await invoke("api_get_summary", {
            meetingId: meetingId,
          })) as any;

          // Call the update callback with result
          onUpdate(result);

          // Stop polling if completed, error, failed, cancelled, or idle (after initial processing)
          if (
            result.status === "completed" ||
            result.status === "error" ||
            result.status === "failed" ||
            result.status === "cancelled"
          ) {
            clearInterval(pollInterval);
            setActiveSummaryPolls((prev) => {
              const next = new Map(prev);
              next.delete(meetingId);
              return next;
            });
          } else if (result.status === "idle" && pollCount > 1) {
            // If we get 'idle' after polling started, process completed/disappeared
            clearInterval(pollInterval);
            setActiveSummaryPolls((prev) => {
              const next = new Map(prev);
              next.delete(meetingId);
              return next;
            });
          }
        } catch (error) {
          console.error(`Polling error for ${meetingId}:`, error);
          // Report error to callback
          onUpdate({
            status: "error",
            error: getErrorMessage(error),
          });
          clearInterval(pollInterval);
          setActiveSummaryPolls((prev) => {
            const next = new Map(prev);
            next.delete(meetingId);
            return next;
          });
        }
      }, 5000); // Poll every 5 seconds

      setActiveSummaryPolls((prev) =>
        new Map(prev).set(meetingId, pollInterval),
      );
    },
    [activeSummaryPolls],
  );

  const stopSummaryPolling = React.useCallback(
    (meetingId: string) => {
      const pollInterval = activeSummaryPolls.get(meetingId);
      if (pollInterval) {
        clearInterval(pollInterval);
        setActiveSummaryPolls((prev) => {
          const next = new Map(prev);
          next.delete(meetingId);
          return next;
        });
      }
    },
    [activeSummaryPolls],
  );

  // Cleanup all polling intervals on unmount
  useEffect(() => {
    return () => {
      activeSummaryPolls.forEach((interval) => clearInterval(interval));
    };
  }, [activeSummaryPolls]);

  return (
    <SidebarContext.Provider
      value={{
        currentMeeting,
        setCurrentMeeting,
        sidebarItems,
        isCollapsed,
        toggleCollapse,
        meetings,
        setMeetings,
        isMeetingActive,
        setIsMeetingActive,
        handleRecordingToggle,
        searchTranscripts,
        searchResults,
        isSearching,
        transcriptServerAddress,
        setTranscriptServerAddress,
        activeSummaryPolls,
        startSummaryPolling,
        stopSummaryPolling,
        refetchMeetings: fetchMeetings,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}
