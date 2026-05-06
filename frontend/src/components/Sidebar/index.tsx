"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { useRecordingState } from "@/contexts/RecordingStateContext";
import { useImportDialog } from "@/contexts/ImportDialogContext";
import { useConfig } from "@/contexts/ConfigContext";
import { getErrorMessage } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useSidebar } from "./SidebarProvider";
import type { CurrentMeeting } from "./SidebarProvider";
import { SidebarHeader } from "./parts/SidebarHeader";
import { SidebarRecordingButton } from "./parts/SidebarRecordingButton";
import { SidebarSearch } from "./parts/SidebarSearch";
import { SidebarMeetingsList } from "./parts/SidebarMeetingsList";
import { SidebarFooter } from "./parts/SidebarFooter";
import { SidebarCollapsedRail } from "./parts/SidebarCollapsedRail";

const APP_VERSION = "v0.4.0";

type SearchHit = { id: string; matchContext: string };

const Sidebar: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    currentMeeting,
    setCurrentMeeting,
  } = useSidebar();
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();

  const [searchQuery, setSearchQuery] = useState("");
  const [renaming, setRenaming] = useState<CurrentMeeting | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Active meeting id is tracked from the URL — `?id=…` on the meeting
  // details page. Falling back to the provider's `currentMeeting.id` would
  // misfire on the home page where currentMeeting is the synthetic intro.
  const activeMeetingId = searchParams?.get("id") ?? null;

  // Expose a hook for the Rust tray to open the settings page. The legacy
  // implementation set unrendered modal state — replacing it with a route
  // push gives the tray button an actually visible effect.
  useEffect(() => {
    (window as Window & { openSettings?: () => void }).openSettings = () => {
      router.push("/settings");
    };
    return () => {
      delete (window as Window & { openSettings?: () => void }).openSettings;
    };
  }, [router]);

  // Search dispatches the transcript-content RPC; the title-only filter
  // happens locally in `SidebarMeetingsList`.
  const handleSearchChange = useCallback(
    async (next: string) => {
      setSearchQuery(next);
      if (!next.trim()) return;
      try {
        await searchTranscripts(next);
      } catch (e) {
        console.error("Transcript search failed:", e);
      }
    },
    [searchTranscripts],
  );

  const handleSelectMeeting = useCallback(
    (meeting: CurrentMeeting) => {
      setCurrentMeeting({ id: meeting.id, title: meeting.title });
      router.push(`/meeting-details?id=${meeting.id}`);
    },
    [router, setCurrentMeeting],
  );

  const handleRenameStart = useCallback((meeting: CurrentMeeting) => {
    setRenaming(meeting);
    setRenameDraft(meeting.title);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renaming) return;
    const title = renameDraft.trim();
    if (!title) {
      toast.error("Meeting title cannot be empty");
      return;
    }
    try {
      await invoke("api_save_meeting_title", {
        meetingId: renaming.id,
        title,
      });
      setMeetings(
        meetings.map((m) =>
          m.id === renaming.id ? { ...m, title } : m,
        ),
      );
      if (currentMeeting?.id === renaming.id) {
        setCurrentMeeting({ ...currentMeeting, title });
      }
      toast.success("Meeting title updated");
      setRenaming(null);
      setRenameDraft("");
    } catch (error) {
      console.error("Failed to update meeting title:", error);
      toast.error("Failed to update meeting title", {
        description: getErrorMessage(error),
      });
    }
  }, [
    renaming,
    renameDraft,
    meetings,
    setMeetings,
    currentMeeting,
    setCurrentMeeting,
  ]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await invoke("api_delete_meeting", { meetingId: id });
      setMeetings(meetings.filter((m) => m.id !== id));
      toast.success("Meeting deleted", {
        description: "All associated data has been removed",
      });
      if (activeMeetingId === id) router.push("/");
    } catch (error) {
      console.error("Failed to delete meeting:", error);
      toast.error("Failed to delete meeting", {
        description: getErrorMessage(error),
      });
    }
  }, [pendingDeleteId, meetings, setMeetings, activeMeetingId, router]);

  const formattedSearchHits = useMemo<SearchHit[]>(
    () =>
      (searchResults as SearchHit[]).map((r) => ({
        id: r.id,
        matchContext: r.matchContext,
      })),
    [searchResults],
  );

  return (
    <div
      className={`
        flex h-full shrink-0 flex-col border-r border-border bg-background
        ${isCollapsed ? "w-14" : "w-64"}
      `}
    >
      <SidebarHeader
        isCollapsed={isCollapsed}
        onToggleCollapse={toggleCollapse}
        onHome={() => router.push("/")}
      />

      {isCollapsed ? (
        <SidebarCollapsedRail
          isRecording={isRecording}
          showImport={betaFeatures.importAndRetranscribe}
          onHome={() => router.push("/")}
          onStartRecording={handleRecordingToggle}
          onMeetings={toggleCollapse}
          onImport={() => openImportDialog()}
          onSettings={() => router.push("/settings")}
        />
      ) : (
        <>
          <div className="space-y-3 p-3">
            <SidebarRecordingButton
              isRecording={isRecording}
              onStart={handleRecordingToggle}
            />
            <SidebarSearch
              value={searchQuery}
              onChange={handleSearchChange}
              isSearching={isSearching}
            />
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <SidebarMeetingsList
              meetings={meetings}
              activeMeetingId={activeMeetingId}
              searchQuery={searchQuery}
              searchResults={formattedSearchHits}
              onSelect={handleSelectMeeting}
              onRename={handleRenameStart}
              onDelete={(id) => setPendingDeleteId(id)}
            />
          </div>
          <SidebarFooter
            showImport={betaFeatures.importAndRetranscribe}
            onImport={() => openImportDialog()}
            onSettings={() => router.push("/settings")}
            versionLabel={APP_VERSION}
          />
        </>
      )}

      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null);
            setRenameDraft("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename meeting</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleRenameConfirm();
              }
            }}
            placeholder="Meeting title"
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRenaming(null);
                setRenameDraft("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRenameConfirm}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete meeting?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the meeting, its transcripts, and any generated
            summary. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDeleteId(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
