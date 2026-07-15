"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Summary, Block } from "@/types";
import { Section } from "./Section";
import { EditableTitle } from "../EditableTitle";
import { AlertTriangle as ExclamationTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// Lives outside the component so the `Date.now()` / `Math.random()` calls
// don't run during render — keeps react-hooks/purity happy and matches
// React 19 guidance for impure helpers.
const generateUniqueId = (sectionKey: string) =>
  `${sectionKey}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Whether a keydown's target is a native text-editing control (or an
// ARIA contentEditable region). The block-editor's global keyboard
// shortcuts (undo/redo, copy selected blocks, delete selected blocks)
// must not hijack native editing behavior while the user is typing/
// selecting inside an input, textarea, or contentEditable element.
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
};

// True when the user currently has a non-collapsed native text
// selection (e.g. highlighting a phrase inside a block's textarea, or
// anywhere else on the page) — native copy should win over the
// block-selection copy shortcut in that case.
const hasActiveTextSelection = (): boolean => {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed;
};

interface Props {
  summary: Summary | null;
  status:
    | "idle"
    | "processing"
    | "summarizing"
    | "regenerating"
    | "completed"
    | "error";
  error: string | null;
  onSummaryChange: (summary: Summary) => void;
  onRegenerateSummary: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
}

export const AISummary = ({
  summary,
  status,
  error,
  onSummaryChange,
  onRegenerateSummary,
  meeting,
}: Props) => {
  const ensureUniqueBlockIds = (summary: Summary): Summary => {
    // Deep clone to avoid mutating readonly props
    const updatedSummary: Summary = {};

    Object.entries(summary).forEach(([sectionKey, section]) => {
      // Ensure section has blocks array before mapping
      if (section && Array.isArray(section.blocks)) {
        updatedSummary[sectionKey] = {
          ...section,
          blocks: section.blocks.map((block) => ({
            ...block,
            id: block.id.includes(sectionKey)
              ? block.id
              : generateUniqueId(sectionKey),
          })),
        };
      } else {
        // Initialize empty blocks array if missing or invalid
        updatedSummary[sectionKey] = {
          title: section?.title || sectionKey,
          blocks: [],
        };
      }
    });

    return updatedSummary;
  };

  const currentSummary = useMemo(() => {
    if (!summary) {
      return {
        Agenda: { title: "Agenda", blocks: [] },
        Decisions: { title: "Decisions", blocks: [] },
        ActionItems: { title: "Action Items", blocks: [] },
        ClosingRemarks: { title: "Closing Remarks", blocks: [] },
      };
    }
    return ensureUniqueBlockIds(summary);
  }, [summary]);

  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([]);
  const [lastSelectedBlock, setLastSelectedBlock] = useState<string | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartBlock, setDragStartBlock] = useState<string | null>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);

  // History management
  const [history, setHistory] = useState<Summary[]>([currentSummary]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(0);
  const [isUndoRedoing, setIsUndoRedoing] = useState(false);

  // Append to undo history when the summary prop changes from outside.
  // This is a true accumulator (history depends on previous history + new
  // value), so it can't be derived during render. Functional setState lets
  // us reference current values without listing them as deps. The
  // `isUndoRedoing` guard suppresses the round-trip when the change came
  // from our own undo/redo handler.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!isUndoRedoing && summary) {
      setHistory((prev) => {
        const truncated = prev.slice(0, currentHistoryIndex + 1);
        truncated.push(summary);
        return truncated;
      });
      setCurrentHistoryIndex((idx) => idx + 1);
    }
    setIsUndoRedoing(false);
  }, [summary]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const handleUndo = useCallback(() => {
    if (currentHistoryIndex > 0) {
      setIsUndoRedoing(true);
      const newIndex = currentHistoryIndex - 1;
      setCurrentHistoryIndex(newIndex);
      onSummaryChange(history[newIndex]);
    }
  }, [currentHistoryIndex, history, onSummaryChange]);

  const handleRedo = useCallback(() => {
    if (currentHistoryIndex < history.length - 1) {
      setIsUndoRedoing(true);
      const newIndex = currentHistoryIndex + 1;
      setCurrentHistoryIndex(newIndex);
      onSummaryChange(history[newIndex]);
    }
  }, [currentHistoryIndex, history, onSummaryChange]);

  const getAllBlocks = () => {
    const allBlocks: { id: string; sectionKey: string }[] = [];
    Object.entries(currentSummary).forEach(([sectionKey, section]) => {
      section.blocks.forEach((block) => {
        allBlocks.push({ id: block.id, sectionKey });
      });
    });
    return allBlocks;
  };

  const findBlockAndSection = (blockId: string) => {
    for (const [sectionKey, section] of Object.entries(currentSummary)) {
      const block = section.blocks.find((b) => b.id === blockId);
      if (block) {
        return { block, sectionKey };
      }
    }
    return null;
  };

  const handleBlockNavigate = (blockId: string, direction: "up" | "down") => {
    const allBlocks = getAllBlocks();
    const currentIndex = allBlocks.findIndex((b) => b.id === blockId);

    if (currentIndex === -1) return;

    let targetIndex: number;
    if (direction === "up") {
      targetIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex;
    } else {
      targetIndex =
        currentIndex < allBlocks.length - 1 ? currentIndex + 1 : currentIndex;
    }

    if (targetIndex !== currentIndex) {
      const targetBlock = allBlocks[targetIndex];
      setSelectedBlocks([targetBlock.id]);
      setLastSelectedBlock(targetBlock.id);
    }
  };

  const getBlockRange = (startId: string, endId: string) => {
    const allBlocks = getAllBlocks();
    const startIndex = allBlocks.findIndex((b) => b.id === startId);
    const endIndex = allBlocks.findIndex((b) => b.id === endId);

    if (startIndex === -1 || endIndex === -1) return [];

    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    return allBlocks.slice(start, end + 1).map((b) => b.id);
  };

  const handleBlockMouseDown = (
    blockId: string,
    sectionKey: keyof Summary,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (!e.shiftKey) {
      setDragStartBlock(blockId);
      setLastSelectedBlock(blockId);
      setSelectedBlocks([blockId]);
    }
    setIsDragging(true);
  };

  const handleBlockMouseEnter = (
    blockId: string,
    sectionKey: keyof Summary,
  ) => {
    if (isDragging && dragStartBlock) {
      const range = getBlockRange(dragStartBlock, blockId);
      setSelectedBlocks(range);
    }
  };

  const handleBlockMouseUp = (
    blockId: string,
    sectionKey: keyof Summary,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (e.shiftKey && lastSelectedBlock) {
      const range = getBlockRange(lastSelectedBlock, blockId);
      setSelectedBlocks(range);
    }
    setIsDragging(false);
  };

  const handleBlockChange = (
    sectionKey: keyof Summary,
    blockId: string,
    newContent: string,
  ) => {
    onSummaryChange({
      ...currentSummary,
      [sectionKey]: {
        ...currentSummary[sectionKey],
        blocks: currentSummary[sectionKey].blocks.map((block) =>
          block.id === blockId ? { ...block, content: newContent } : block,
        ),
      },
    });
  };

  const handleBlockTypeChange = (blockId: string, newType: Block["type"]) => {
    // Find the section key for this block
    let blockSectionKey: string | null = null;
    for (const [sectionKey, section] of Object.entries(currentSummary)) {
      if (section.blocks.some((b) => b.id === blockId)) {
        blockSectionKey = sectionKey;
        break;
      }
    }

    if (!blockSectionKey) return;

    onSummaryChange({
      ...currentSummary,
      [blockSectionKey]: {
        ...currentSummary[blockSectionKey],
        blocks: currentSummary[blockSectionKey].blocks.map((block) =>
          block.id === blockId ? { ...block, type: newType } : block,
        ),
      },
    });
  };

  const handleTitleChange = (sectionKey: keyof Summary, newTitle: string) => {
    console.log("Title change:", { sectionKey, newTitle });
    const updatedSummary = {
      ...currentSummary,
      [sectionKey]: {
        ...currentSummary[sectionKey],
        title: newTitle,
      },
    };
    console.log("Updated summary:", updatedSummary);
    onSummaryChange(updatedSummary);
  };

  const handleDeleteSelectedBlocks = useCallback(() => {
    // Group selected blocks by section
    const blocksBySection = new Map<string, string[]>();
    selectedBlocks.forEach((blockId) => {
      Object.entries(currentSummary).forEach(([sectionKey, section]) => {
        if (section.blocks.some((b) => b.id === blockId)) {
          const blocks = blocksBySection.get(sectionKey) || [];
          blocks.push(blockId);
          blocksBySection.set(sectionKey, blocks);
        }
      });
    });

    // Create new summary with blocks removed
    const newSummary = { ...currentSummary };
    blocksBySection.forEach((blockIds, sectionKey) => {
      newSummary[sectionKey] = {
        ...newSummary[sectionKey],
        blocks: newSummary[sectionKey].blocks.filter(
          (b) => !blockIds.includes(b.id),
        ),
      };
    });

    onSummaryChange(newSummary);
    setSelectedBlocks([]);
    setLastSelectedBlock(null);
  }, [selectedBlocks, currentSummary, onSummaryChange]);

  const handleKeyDown = (e: React.KeyboardEvent, blockId: string) => {
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selectedBlocks.length > 1
    ) {
      // Handle multi-block deletion
      e.preventDefault();
      handleDeleteSelectedBlocks();
    }
  };

  const handleCreateNewBlock = (
    blockId: string,
    newBlockContent: string,
    blockType: Block["type"],
    currentBlockContent?: string,
  ) => {
    // Find the section key for this block
    let blockSectionKey: string | null = null;
    let currentBlockIndex = -1;

    for (const [sectionKey, section] of Object.entries(currentSummary)) {
      currentBlockIndex = section.blocks.findIndex((b) => b.id === blockId);
      if (currentBlockIndex !== -1) {
        blockSectionKey = sectionKey;
        break;
      }
    }

    if (!blockSectionKey) return;

    const currentBlock =
      currentSummary[blockSectionKey].blocks[currentBlockIndex];
    if (!currentBlock) return;

    const newId = generateUniqueId(blockSectionKey);

    // Update the blocks array for the specific section
    const updatedBlocks = [...currentSummary[blockSectionKey].blocks];

    // Get the type of the new block (inherit from current block for bullets)
    const newBlockType = blockType === "bullet" ? "bullet" : "text";

    // Update the current block's content if provided
    if (currentBlockContent !== undefined) {
      updatedBlocks[currentBlockIndex] = {
        ...currentBlock,
        content: currentBlockContent,
      };
    }

    // Insert new block after current block
    updatedBlocks.splice(currentBlockIndex + 1, 0, {
      id: newId,
      type: newBlockType,
      content: newBlockContent,
      color: currentBlock.color || "default",
    });

    onSummaryChange({
      ...currentSummary,
      [blockSectionKey]: {
        ...currentSummary[blockSectionKey],
        blocks: updatedBlocks,
      },
    });

    // Focus and select the new block
    setSelectedBlocks([newId]);
    setLastSelectedBlock(newId);

    // Use setTimeout to ensure the textarea is mounted
    setTimeout(() => {
      const newTextarea = document.querySelector(
        `[data-block-id="${newId}"]`,
      ) as HTMLTextAreaElement;
      if (newTextarea) {
        newTextarea.focus();
        newTextarea.setSelectionRange(0, 0);
      }
    }, 0);
  };

  const handleBlockDelete = (blockId: string, mergeContent?: string) => {
    // Find the section key for this block
    let blockSectionKey: string | null = null;
    let currentBlockIndex = -1;

    for (const [sectionKey, section] of Object.entries(currentSummary)) {
      currentBlockIndex = section.blocks.findIndex((b) => b.id === blockId);
      if (currentBlockIndex !== -1) {
        blockSectionKey = sectionKey;
        break;
      }
    }

    if (!blockSectionKey) return;

    const updatedBlocks = [...currentSummary[blockSectionKey].blocks];

    // If there's content to merge and a previous block exists
    if (mergeContent && currentBlockIndex > 0) {
      const previousBlock = updatedBlocks[currentBlockIndex - 1];
      const previousContent = previousBlock.content;
      const cursorPosition = previousContent.length;

      // Update previous block with merged content
      updatedBlocks[currentBlockIndex - 1] = {
        ...previousBlock,
        content: previousContent + mergeContent,
      };

      // Remove current block
      updatedBlocks.splice(currentBlockIndex, 1);

      onSummaryChange({
        ...currentSummary,
        [blockSectionKey]: {
          ...currentSummary[blockSectionKey],
          blocks: updatedBlocks,
        },
      });

      // Select the previous block and set cursor at merge point
      setSelectedBlocks([previousBlock.id]);
      setLastSelectedBlock(previousBlock.id);

      // Use setTimeout to ensure the textarea is mounted
      setTimeout(() => {
        const textarea = document.querySelector(
          `[data-block-id="${previousBlock.id}"]`,
        ) as HTMLTextAreaElement;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(cursorPosition, cursorPosition);
        }
      }, 0);
    } else {
      // Just remove the block if no content to merge
      updatedBlocks.splice(currentBlockIndex, 1);

      onSummaryChange({
        ...currentSummary,
        [blockSectionKey]: {
          ...currentSummary[blockSectionKey],
          blocks: updatedBlocks,
        },
      });

      // Select the previous block if it exists, otherwise the next block
      if (updatedBlocks.length > 0) {
        const newSelectedBlock =
          updatedBlocks[Math.max(0, currentBlockIndex - 1)];
        setSelectedBlocks([newSelectedBlock.id]);
        setLastSelectedBlock(newSelectedBlock.id);
      } else {
        setSelectedBlocks([]);
        setLastSelectedBlock(null);
      }
    }
  };

  const getSelectedBlocksContent = useCallback(() => {
    return selectedBlocks
      .map((blockId) => {
        for (const [sectionKey, section] of Object.entries(currentSummary)) {
          const block = section.blocks.find((b) => b.id === blockId);
          if (block) {
            return block.content;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }, [selectedBlocks, currentSummary]);

  useEffect(() => {
    if (hiddenInputRef.current && selectedBlocks.length > 1) {
      const content = getSelectedBlocksContent();
      hiddenInputRef.current.value = content;
      hiddenInputRef.current.select();
    }
  }, [selectedBlocks, getSelectedBlocksContent]);

  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "z") {
          // Let native undo/redo win while typing in a text field —
          // only hijack for the block-editor's own history stack.
          if (isEditableTarget(e.target)) return;
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if (e.key === "c") {
          // Only treat this as "copy the selected blocks" when that's
          // clearly the intent: there must be a block selection, and the
          // user must not be editing/selecting native text elsewhere
          // (an input/textarea/contentEditable, or any active text
          // selection) — in those cases native copy should win.
          if (selectedBlocks.length === 0) return;
          if (isEditableTarget(e.target) || hasActiveTextSelection()) return;

          const blockContents = selectedBlocks
            .map((blockId) => {
              for (const [sectionKey, section] of Object.entries(
                currentSummary,
              )) {
                const block = section.blocks.find((b) => b.id === blockId);
                if (block) {
                  return block.content;
                }
              }
              return "";
            })
            .filter(Boolean);

          // Prevent native copy from also firing so it can't race with
          // (and get overwritten by) this clipboard write.
          e.preventDefault();
          navigator.clipboard.writeText(blockContents.join("\n"));
        }
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedBlocks.length > 1
      ) {
        // Don't hijack normal text editing (e.g. backspacing inside a
        // block's own textarea) just because multiple blocks are selected.
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        handleDeleteSelectedBlocks();
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedBlocks, currentSummary, handleUndo, handleRedo, handleDeleteSelectedBlocks]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    visible: boolean;
  }>({ x: 0, y: 0, visible: false });

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu((prev) => ({ ...prev, visible: false }));
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    const menuWidth = 160;
    const menuHeight = 80; // Approximate height for 2 items

    let x = e.clientX;
    let y = e.clientY;

    // Check right boundary
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }

    // Check bottom boundary
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }

    // Check left boundary
    if (x < 10) {
      x = 10;
    }

    // Check top boundary
    if (y < 10) {
      y = 10;
    }

    setContextMenu({
      x,
      y,
      visible: true,
    });
  };

  const handleCopyBlocks = useCallback(() => {
    const content = getSelectedBlocksContent();
    navigator.clipboard.writeText(content);
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, [getSelectedBlocksContent]);

  const handleDeleteBlocks = () => {
    handleDeleteSelectedBlocks();
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  const handleSectionDelete = (sectionKey: keyof Summary) => {
    const newSummary = { ...currentSummary };
    delete newSummary[sectionKey];
    onSummaryChange(newSummary);
  };

  const handleAddSection = () => {
    const newSectionKey = `section${Object.keys(currentSummary).length + 1}`;
    const newBlockId = Date.now().toString();
    const newSummary: Summary = {
      ...currentSummary,
      [newSectionKey]: {
        title: "New Section",
        blocks: [
          {
            id: newBlockId,
            type: "text" as const,
            content: "",
            color: "default" as const,
          },
        ],
      },
    };
    onSummaryChange(newSummary);

    // Select the new block
    setSelectedBlocks([newBlockId]);
    setLastSelectedBlock(newBlockId);
  };

  const convertToMarkdown = () => {
    let markdown = `# AI Generated Summary of Meeting: ${meeting?.id || "Unknown"} - ${meeting?.title || "Untitled Meeting"}\n\n`;
    markdown += `## Date: ${meeting?.created_at ? new Date(meeting.created_at).toLocaleDateString() : new Date().toLocaleDateString()}\n\n`;

    Object.entries(currentSummary).forEach(([key, section]) => {
      if (key === "title") {
        markdown = `# ${section.title || "AI Enhanced Summary"}\n\n`;
      } else {
        markdown += `## ${section.title || key}\n\n`;
        section.blocks.forEach((block) => {
          switch (block.type) {
            case "heading1":
              markdown += `### ${block.content}\n\n`;
              break;
            case "heading2":
              markdown += `#### ${block.content}\n\n`;
              break;
            case "bullet":
              markdown += `- ${block.content}\n`;
              break;
            case "text":
            default:
              markdown += `${block.content}\n\n`;
          }
        });
        // Add an extra newline after bullet lists
        if (section.blocks.some((block) => block.type === "bullet")) {
          markdown += "\n";
        }
      }
    });

    return markdown;
  };

  const handleExport = () => {
    const markdown = convertToMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSummary.title || "ai-summary"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderErrorState = () => (
    <div className="w-full rounded-lg border border-destructive/30 bg-destructive/10 p-4">
      <div className="mb-2 flex items-center">
        <ExclamationTriangleIcon className="mr-2 size-5 text-destructive" />
        <h3 className="font-medium text-destructive">Error Generating Summary</h3>
      </div>
      <p className="text-sm text-destructive">{error}</p>
      <p className="mt-2 text-xs text-destructive">
        Please check your model configuration and API keys, or try again.
      </p>
    </div>
  );

  const renderLoadingState = () => (
    <div className="
      w-full rounded-lg border border-info/30 bg-info-muted p-4
    ">
      <div className="flex items-center space-x-3">
        <div className="
          size-5 animate-spin rounded-full border-2 border-info
          border-t-transparent
        "></div>
        <div>
          <h3 className="font-medium text-info">
            {status === "processing"
              ? "Processing Transcript"
              : "Generating Summary"}
          </h3>
          <p className="text-sm text-info">
            {status === "processing"
              ? "Analyzing your transcript..."
              : "Creating a detailed summary of your meeting..."}
          </p>
        </div>
      </div>
    </div>
  );

  if (error) {
    return renderErrorState();
  }

  if (
    status === "processing" ||
    status === "summarizing" ||
    status === "regenerating"
  ) {
    return renderLoadingState();
  }

  const hasContent = Object.values(currentSummary).some(
    (section) =>
      section?.blocks?.length > 0 &&
      section?.blocks?.some((block) => block.content.trim()),
  );

  if (!hasContent && status === "completed") {
    return (
      <div className="
        w-full rounded-lg border border-border bg-muted p-4 text-center
      ">
        <p className="text-muted-foreground">No summary content available.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try generating a new summary.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {selectedBlocks.length > 1 && (
        <textarea
          ref={hiddenInputRef}
          className="sr-only"
          readOnly
          value={getSelectedBlocksContent()}
          tabIndex={-1}
        />
      )}

      {/* Context Menu */}
      {contextMenu.visible && selectedBlocks.length > 0 && (
        <div
          className="
            animate-in fade-in zoom-in-95 fixed z-50 min-w-40 rounded-lg
            border border-border bg-background py-1 shadow-lg duration-150
          "
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={handleCopyBlocks}
          >
            <span className="text-muted-foreground">📋</span>
            <span>
              Copy{" "}
              {selectedBlocks.length > 1
                ? `${selectedBlocks.length} blocks`
                : "block"}
            </span>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start text-destructive hover:text-destructive"
            onClick={handleDeleteBlocks}
          >
            <span>🗑️</span>
            <span>
              Delete{" "}
              {selectedBlocks.length > 1
                ? `${selectedBlocks.length} blocks`
                : "block"}
            </span>
          </Button>
        </div>
      )}

      {Object.keys(currentSummary)
        .filter((key) => currentSummary[key]?.blocks?.length > 0)
        .map((key) => {
          const section = currentSummary[key];
          return (
            <Section
              key={key}
              section={section}
              sectionKey={key}
              selectedBlocks={selectedBlocks}
              onBlockTypeChange={handleBlockTypeChange}
              onBlockChange={(blockId, content) =>
                handleBlockChange(key, blockId, content)
              }
              onBlockMouseDown={(blockId, e) =>
                handleBlockMouseDown(blockId, key, e)
              }
              onBlockMouseEnter={(blockId) =>
                handleBlockMouseEnter(blockId, key)
              }
              onBlockMouseUp={(blockId, e) =>
                handleBlockMouseUp(blockId, key, e)
              }
              onKeyDown={handleKeyDown}
              onTitleChange={handleTitleChange}
              onSectionDelete={handleSectionDelete}
              onBlockDelete={(blockId, mergeContent) =>
                handleBlockDelete(blockId, mergeContent)
              }
              onContextMenu={handleContextMenu}
              onBlockNavigate={(blockId, direction) =>
                handleBlockNavigate(blockId, direction)
              }
              onCreateNewBlock={handleCreateNewBlock}
            />
          );
        })}
    </div>
  );
};
