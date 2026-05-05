"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Calendar,
  StickyNote,
  Home,
  Trash2,
  Mic,
  Square,
  Plus,
  Search,
  Pencil,
  NotebookPen,
  SearchIcon,
  X,
  Upload,
} from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useSidebar } from "./SidebarProvider";
import type { CurrentMeeting } from "@/components/Sidebar/SidebarProvider";
import { ConfirmationModal } from "../ConfirmationModel/confirmation-modal";
import { ModelConfig } from "@/components/ModelSettingsModal";
import { SettingTabs } from "../SettingTabs";
import { TranscriptModelProps } from "@/components/TranscriptSettings";
import { invoke } from "@tauri-apps/api/core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { useImportDialog } from "@/contexts/ImportDialogContext";
import { useConfig } from "@/contexts/ConfigContext";
import { getErrorMessage } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";

import { MessageToast } from "../MessageToast";
import Logo from "../Logo";
import Info from "../Info";
import { ComplianceNotification } from "../ComplianceNotification";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group";

interface SidebarItem {
  id: string;
  title: string;
  type: "folder" | "file";
  children?: SidebarItem[];
}

// Single chevron-y toggle that lives inside the sidebar header. The icon
// always points in the direction it would move the panel: left (collapse)
// when expanded, right (expand) when collapsed.
function SidebarToggleButton({
  isCollapsed,
  onClick,
}: {
  isCollapsed: boolean;
  onClick: () => void;
}) {
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      onClick={onClick}
      className="
        flex size-8 items-center justify-center rounded-md text-muted-foreground
        transition-colors
        hover:bg-muted hover:text-foreground
      "
    >
      <Icon className="size-5" />
    </button>
  );
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["meetings"]),
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: "ollama",
    model: "",
    whisperModel: "",
    apiKey: null,
    ollamaEndpoint: null,
  });
  const [transcriptModelConfig, setTranscriptModelConfig] =
    useState<TranscriptModelProps>({
      provider: "localWhisper",
      model: "large-v3-turbo",
    });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<
    boolean | null
  >(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{
    isOpen: boolean;
    meetingId: string | null;
    currentTitle: string;
  }>({
    isOpen: false,
    meetingId: null,
    currentTitle: "",
  });
  const [editingTitle, setEditingTitle] = useState<string>("");

  // 'meetings' folder is initialized as expanded via useState default above.
  // The previous "always re-expand" effect created a re-render loop and was
  // semantically wrong — if the user collapses it explicitly, we should not fight them.

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);

  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    itemId: string | null;
  }>({ isOpen: false, itemId: null });

  useEffect(() => {
    const fetchModelConfig = async () => {
      try {
        const data = (await invoke("api_get_model_config")) as any;
        if (data && data.provider !== null) {
          if (data.provider !== "ollama" && !data.apiKey) {
            try {
              const apiKeyData = (await invoke("api_get_api_key", {
                provider: data.provider,
              })) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error("Failed to fetch API key:", err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error("Failed to fetch model config:", error);
      }
    };
    fetchModelConfig();
  }, []);

  useEffect(() => {
    const fetchTranscriptSettings = async () => {
      try {
        const data = (await invoke("api_get_transcript_config")) as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error("Failed to fetch transcript settings:", error);
      }
    };
    fetchTranscriptSettings();
  }, []);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<ModelConfig>(
        "model-config-updated",
        (event) => {
          console.log(
            "Sidebar received model-config-updated event:",
            event.payload,
          );
          setModelConfig(event.payload);
        },
      );

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then((fn) => (cleanup = fn));

    return () => {
      cleanup?.();
    };
  }, []);

  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke("api_save_model_config", {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log("Model config saved successfully");
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import("@tauri-apps/api/event");
      await emit("model-config-updated", config);
    } catch (error) {
      console.error("Error saving model config:", error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (
    updatedConfig?: TranscriptModelProps,
  ) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null,
      };
      console.log("Saving transcript config with payload:", payload);

      await invoke("api_save_transcript_config", {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });

      setSettingsSaveSuccess(true);
    } catch (error) {
      console.error("Failed to save transcript config:", error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes
  const handleSearchChange = useCallback(
    async (value: string) => {
      setSearchQuery(value);

      // If search query is empty, just return to normal view
      if (!value.trim()) return;

      // Search through transcripts
      await searchTranscripts(value);

      // Make sure the meetings folder is expanded when searching
      if (!expandedFolders.has("meetings")) {
        const newExpanded = new Set(expandedFolders);
        newExpanded.add("meetings");
        setExpandedFolders(newExpanded);
      }
    },
    [expandedFolders, searchTranscripts],
  );

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(
        searchResults.map((result) => result.id),
      );

      return sidebarItems
        .map((folder) => {
          // Always include folders in the results
          if (folder.type === "folder") {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter((item) => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title
                .toLowerCase()
                .includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren,
            };
          }

          // For non-folder items, check if they match the search
          return matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase())
            ? folder
            : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map((folder) => {
          // Always include folders in the results
          if (folder.type === "folder") {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter((item) =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase()),
            );

            return {
              ...folder,
              children: filteredChildren,
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase())
            ? folder
            : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults]);

  const handleDelete = async (itemId: string) => {
    console.log("Deleting item:", itemId);
    const payload = {
      meetingId: itemId,
    };

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("api_delete_meeting", {
        meetingId: itemId,
      });
      console.log("Meeting deleted successfully");
      const updatedMeetings = meetings.filter(
        (m: CurrentMeeting) => m.id !== itemId,
      );
      setMeetings(updatedMeetings);

      // Show success toast
      toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed",
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: "intro-call", title: "+ New Call" });
        router.push("/");
      }
    } catch (error) {
      console.error("Failed to delete meeting:", error);
      toast.error("Failed to delete meeting", {
        description: getErrorMessage(error),
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle,
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke("api_save_meeting_title", {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m,
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      toast.success("Meeting title updated successfully");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: "" });
      setEditingTitle("");
    } catch (error) {
      console.error("Failed to update meeting title:", error);
      toast.error("Failed to update meeting title", {
        description: getErrorMessage(error),
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: "" });
    setEditingTitle("");
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  const renderCollapsedIcons = () => {
    if (!isCollapsed) return null;

    const isHomePage = pathname === "/";
    const isMeetingPage = pathname?.includes("/meeting-details");
    const isSettingsPage = pathname === "/settings";

    return (
      <TooltipProvider>
        <div className="mt-4 flex flex-col items-center space-y-4">
          {/* About-dialog logo intentionally omitted here — the Info button
              at the bottom of the collapsed sidebar already opens the same
              dialog. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push("/")}
                className={`
                  rounded-lg p-2 transition-colors duration-150
                  ${
                  isHomePage ? "bg-muted" : "hover:bg-muted"
                }
                `}
              >
                <Home className="size-5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Home</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRecordingToggle}
                disabled={isRecording}
                className={`
                  p-2
                  ${isRecording ? "cursor-not-allowed bg-destructive" : `
                    bg-destructive
                    hover:bg-destructive
                  `}
                  rounded-full shadow-sm transition-colors duration-150
                `}
              >
                {isRecording ? (
                  <Square className="size-5 text-white" />
                ) : (
                  <Mic className="size-5 text-white" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>
                {isRecording ? "Recording in progress..." : "Start Recording"}
              </p>
            </TooltipContent>
          </Tooltip>

          {betaFeatures.importAndRetranscribe && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openImportDialog()}
                  className="
                    rounded-lg bg-info/10 p-2 transition-colors duration-150
                    hover:bg-info/15
                  "
                >
                  <Upload className="size-5 text-info" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Import Audio</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  if (isCollapsed) toggleCollapse();
                  toggleFolder("meetings");
                }}
                className={`
                  rounded-lg p-2 transition-colors duration-150
                  ${
                  isMeetingPage ? "bg-muted" : "hover:bg-muted"
                }
                `}
              >
                <NotebookPen className="size-5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Meeting Notes</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push("/settings")}
                className={`
                  rounded-lg p-2 transition-colors duration-150
                  ${
                  isSettingsPage ? "bg-muted" : "hover:bg-muted"
                }
                `}
              >
                <Settings className="size-5 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>

          <Info isCollapsed={isCollapsed} />
        </div>
      </TooltipProvider>
    );
  };

  // Find matching transcript snippet for a meeting item
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find((result) => result.id === itemId);
  };

  const renderItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    // Tighter than before — meetings are always depth 1, so this evaluates to
    // 8px of indent inside the row (plus the row's own px-2 = 16px from edge).
    const paddingLeft = `${depth * 8}px`;
    const isActive = item.type === "file" && currentMeeting?.id === item.id;
    const isMeetingItem =
      item.id.includes("-") && !item.id.startsWith("intro-call");

    // Check if this item has a matching transcript snippet
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    if (isCollapsed) return null;

    return (
      <div key={item.id}>
        <div
          className={`
            group flex items-center transition-all duration-150
            ${
            item.type === "folder" && depth === 0
              ? "mx-3 mt-3 h-10 rounded-lg p-3 text-sm font-semibold"
              : `
                my-0.5 rounded-md px-3 py-2 text-sm
                ${
                  isActive
                    ? "bg-info/15 font-medium text-info"
                    : hasTranscriptMatch
                      ? "bg-warning-muted"
                      : "hover:bg-muted"
                }
                cursor-pointer
              `
          }
          `}
          style={item.type === "folder" && depth === 0 ? {} : { paddingLeft }}
          onClick={() => {
            if (item.type === "folder") {
              toggleFolder(item.id);
            } else {
              setCurrentMeeting({ id: item.id, title: item.title });
              const basePath = item.id.startsWith("intro-call")
                ? "/"
                : `/meeting-details?id=${item.id}`;
              router.push(basePath);
            }
          }}
        >
          {item.type === "folder" ? (
            <>
              {item.id === "meetings" ? (
                <Calendar className="mr-2 size-4" />
              ) : item.id === "notes" ? (
                <Calendar className="mr-2 size-4" />
              ) : null}
              <span className={depth === 0 ? "" : "font-medium"}>
                {item.title}
              </span>
              <div className="ml-auto">
                {isExpanded ? (
                  <ChevronDown className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" />
                )}
              </div>
              {searchQuery && item.id === "meetings" && isSearching && (
                <span className="ml-2 animate-pulse text-sm text-info">
                  Searching...
                </span>
              )}
            </>
          ) : (
            // `relative` anchors the absolute hover-action overlay below.
            // `min-w-0` is required so the title can truncate inside flex.
            <div className="relative flex w-full min-w-0 flex-col">
              <div className="flex w-full min-w-0 items-center">
                {!isMeetingItem && (
                  <div className="
                    mr-2 flex size-5 shrink-0 items-center justify-center
                    rounded-full bg-info/15
                  ">
                    <Plus className="size-3 text-info" />
                  </div>
                )}
                {/* `min-w-0` + `truncate` so long titles ellipsize instead of
                    forcing a horizontal scrollbar. The right padding leaves
                    room for the (absolutely-positioned) hover actions to sit
                    over the title's tail without overlapping its text. */}
                <span
                  className={`min-w-0 flex-1 truncate ${
                    isMeetingItem ? "pr-12 group-hover:pr-12" : ""
                  }`}
                  title={item.title}
                >
                  {item.title}
                </span>
              </div>

              {/* Hover-only edit/delete actions. Absolute so they don't reserve
                  space in the row's flex flow when hidden — the title can use
                  the full width otherwise. */}
              {isMeetingItem && (
                <div className="
                  pointer-events-none absolute inset-y-0 right-0 flex
                  items-center gap-0.5 pr-1 opacity-0 transition-opacity
                  duration-150
                  group-hover:pointer-events-auto group-hover:opacity-100
                ">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditStart(item.id, item.title);
                    }}
                    className="
                      rounded-md p-1
                      hover:bg-info/10 hover:text-info
                    "
                    aria-label="Edit meeting title"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteModalState({ isOpen: true, itemId: item.id });
                    }}
                    className="
                      rounded-md p-1
                      hover:bg-destructive/10 hover:text-destructive
                    "
                    aria-label="Delete meeting"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              )}

              {/* Show transcript match snippet if available */}
              {hasTranscriptMatch && (
                <div className="
                  mt-1 line-clamp-2 rounded-md border border-warning/30
                  bg-warning-muted p-1.5 text-sm text-muted-foreground
                ">
                  <span className="font-medium text-warning">Match:</span>{" "}
                  {matchingResult.matchContext}
                </div>
              )}
            </div>
          )}
        </div>
        {item.type === "folder" && isExpanded && item.children && (
          <div className="ml-1">
            {item.children.map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    // Normal flex item in AppShell — no `fixed` positioning. Width snaps
    // between w-16 and w-64 (no transition; the user found the animation
    // distracting). The main region grows to fill the remainder automatically.
    <div
      className={`
        flex h-full shrink-0 flex-col border-r bg-background shadow-sm
        ${isCollapsed ? "w-16" : "w-64"}
      `}
    >
      {/* Header. Same `p-3` padding in both states so the toggle button
          sits at the same vertical position whether collapsed or expanded.
          Horizontal anchor is the left edge in expanded mode and centered
          in collapsed mode. */}
      <div className="shrink-0 p-3">
        <div
          className={`flex items-center gap-2 ${
            isCollapsed ? "justify-center" : ""
          }`}
        >
          <SidebarToggleButton
            isCollapsed={isCollapsed}
            onClick={toggleCollapse}
          />
          {!isCollapsed && <Logo isCollapsed={isCollapsed} />}
        </div>
        {!isCollapsed && (
          <div className="relative mt-2 mb-1">
            <InputGroup>
              <InputGroupInput
                placeholder="Search meeting content..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              {searchQuery && (
                <InputGroupAddon align={"inline-end"}>
                  <InputGroupButton onClick={() => handleSearchChange("")}>
                    <X />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
        )}
      </div>

        {/* Main content - scrollable area */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Fixed navigation items */}
          <div className="shrink-0">
            {!isCollapsed && (
              <div
                onClick={() => router.push("/")}
                className="
                  mx-3 mt-3 flex h-10 cursor-pointer items-center rounded-lg p-3
                  text-sm font-semibold
                  hover:bg-muted
                "
              >
                <Home className="mr-2 size-4" />
                <span>Home</span>
              </div>
            )}
          </div>

          {/* Content area */}
          <div className="flex min-h-0 flex-1 flex-col">
            {renderCollapsedIcons()}
            {/* Meeting Notes folder header - fixed */}
            {!isCollapsed && (
              <div className="shrink-0">
                {filteredSidebarItems
                  .filter((item) => item.type === "folder")
                  .map((item) => (
                    <div key={item.id}>
                      <div className="
                        mx-3 mt-3 flex h-10 items-center rounded-lg p-3 text-sm
                        font-semibold transition-all duration-150
                      ">
                        <NotebookPen className="
                          mr-2 size-4 text-muted-foreground
                        " />
                        <span className="text-foreground">{item.title}</span>
                        {searchQuery &&
                          item.id === "meetings" &&
                          isSearching && (
                            <span className="
                              ml-2 animate-pulse text-sm text-info
                            ">
                              Searching...
                            </span>
                          )}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Scrollable meeting items */}
            {!isCollapsed && (
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {filteredSidebarItems
                  .filter(
                    (item) =>
                      item.type === "folder" &&
                      expandedFolders.has(item.id) &&
                      item.children,
                  )
                  .map((item) => (
                    <div key={`${item.id}-children`} className="mx-2">
                      {item.children!.map((child) => renderItem(child, 1))}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        {!isCollapsed && (
          <div className="shrink-0 border-t border-border p-2">
            <button
              onClick={handleRecordingToggle}
              disabled={isRecording}
              className={`
                flex w-full items-center justify-center px-3 py-2 text-sm
                font-medium text-white
                ${isRecording ? `cursor-not-allowed bg-destructive/60` : `
                  bg-destructive
                  hover:bg-destructive
                `}
                rounded-lg shadow-sm transition-colors
              `}
            >
              {isRecording ? (
                <>
                  <Square className="mr-2 size-4" />
                  <span>Recording in progress...</span>
                </>
              ) : (
                <>
                  <Mic className="mr-2 size-4" />
                  <span>Start Recording</span>
                </>
              )}
            </button>

            {betaFeatures.importAndRetranscribe && (
              <button
                onClick={() => openImportDialog()}
                className="
                  mt-1 flex w-full items-center justify-center rounded-lg
                  bg-info/15 px-3 py-2 text-sm font-medium text-foreground
                  shadow-sm transition-colors
                  hover:bg-info/25
                "
              >
                <Upload className="mr-2 size-4" />
                <span>Import Audio</span>
              </button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push("/settings")}
              className="my-1 w-full"
            >
              <Settings className="mr-2 size-4" />
              <span>Settings</span>
            </Button>
            <Info isCollapsed={isCollapsed} />
            <div className="
              flex w-full items-center justify-center px-3 py-1 text-sm
              text-muted-foreground/70
            ">
              v0.3.0
            </div>
          </div>
        )}

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog
        open={editModalState.isOpen}
        onOpenChange={(open) => {
          if (!open) handleEditCancel();
        }}
      >
        <DialogContent className="sm:max-w-106.25">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="mb-4 text-lg font-semibold">Edit Meeting Title</h3>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="meeting-title"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  Meeting Title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleEditConfirm();
                    } else if (e.key === "Escape") {
                      handleEditCancel();
                    }
                  }}
                  className="
                    w-full rounded-md border border-border px-3 py-2
                    focus:border-transparent focus:ring-2 focus:ring-info
                    focus:outline-none
                  "
                  placeholder="Enter meeting title"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={handleEditCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleEditConfirm}
              className="bg-info text-white hover:bg-info/90"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
