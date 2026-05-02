"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import dynamic from "next/dynamic";
import type { Editor as TiptapEditorInstance } from "@tiptap/core";
import { Summary, SummaryDataResponse, SummaryFormat } from "@/types";
import { AISummary } from "./index";

// SSR-safe dynamic import — TipTap touches `window` during init.
const Editor = dynamic(() => import("../TiptapEditor/Editor"), { ssr: false });

interface TiptapSummaryViewProps {
  summaryData: SummaryDataResponse | Summary | null;
  /** Called on save; we always emit markdown — no editor-specific JSON. */
  onSave?: (data: { markdown: string }) => void;
  onSummaryChange?: (summary: Summary) => void;
  status?:
    | "idle"
    | "processing"
    | "summarizing"
    | "regenerating"
    | "completed"
    | "error";
  error?: string | null;
  onRegenerateSummary?: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
  onDirtyChange?: (isDirty: boolean) => void;
}

export interface TiptapSummaryViewRef {
  saveSummary: () => Promise<void>;
  getMarkdown: () => Promise<string>;
  isDirty: boolean;
}

// Format detection — markdown-first since we no longer store editor-specific JSON.
function detectSummaryFormat(data: unknown): {
  format: SummaryFormat;
  data: any;
} {
  if (!data || typeof data !== "object")
    return { format: "legacy", data: null };
  const d = data as Record<string, unknown>;

  // Markdown is the canonical storage format going forward. Older saves
  // also stored a `summary_json` field (BlockNote-shaped); we ignore it
  // and parse the markdown that was always saved alongside.
  if (typeof d.markdown === "string" && d.markdown.length > 0) {
    return { format: "markdown", data: d };
  }

  // Legacy custom JSON shape (very old saves with `MeetingName` etc.)
  const hasLegacyStructure =
    d.MeetingName ||
    Object.keys(d).some((key) => {
      const v = d[key];
      return v && typeof v === "object" && "title" in v && "blocks" in v;
    });
  if (hasLegacyStructure) return { format: "legacy", data: d };

  return { format: "legacy", data: null };
}

export const TiptapSummaryView = forwardRef<
  TiptapSummaryViewRef,
  TiptapSummaryViewProps
>(
  (
    {
      summaryData,
      onSave,
      onSummaryChange,
      status = "idle",
      error = null,
      onRegenerateSummary,
      meeting,
      onDirtyChange,
    },
    ref,
  ) => {
    const { format, data } = detectSummaryFormat(summaryData);
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const editorRef = useRef<TiptapEditorInstance | null>(null);
    const currentMarkdownRef = useRef<string>(data?.markdown ?? "");
    const isContentLoaded = useRef(false);

    // After initial content settles, allow change events to mark dirty.
    useEffect(() => {
      if (format !== "markdown") return;
      const t = setTimeout(() => {
        isContentLoaded.current = true;
      }, 100);
      return () => clearTimeout(t);
    }, [format, data?.markdown]);

    const handleEditorChange = useCallback((markdown: string) => {
      currentMarkdownRef.current = markdown;
      if (isContentLoaded.current) setIsDirty(true);
    }, []);

    useEffect(() => {
      onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const handleSave = useCallback(async () => {
      if (!onSave || !isDirty) return;
      setIsSaving(true);
      try {
        onSave({ markdown: currentMarkdownRef.current });
        setIsDirty(false);
      } catch (err) {
        console.error("Save failed:", err);
        alert("Failed to save changes. Please try again.");
      } finally {
        setIsSaving(false);
      }
    }, [onSave, isDirty]);

    useImperativeHandle(
      ref,
      () => ({
        saveSummary: handleSave,
        getMarkdown: async () => {
          // Prefer the live editor's current content; fall back to whatever
          // was last loaded. Returning empty string is acceptable for legacy
          // entries that have no markdown stored.
          if (editorRef.current) {
            const md = (
              editorRef.current.storage as {
                markdown?: { getMarkdown(): string };
              }
            ).markdown?.getMarkdown();
            if (typeof md === "string") return md;
          }
          return currentMarkdownRef.current ?? data?.markdown ?? "";
        },
        isDirty,
      }),
      [handleSave, isDirty, data],
    );

    if (format === "legacy") {
      return (
        <AISummary
          summary={summaryData as Summary}
          status={status}
          error={error}
          onSummaryChange={onSummaryChange ?? (() => {})}
          onRegenerateSummary={onRegenerateSummary ?? (() => {})}
          meeting={meeting}
        />
      );
    }

    // Markdown is the only "live editing" format.
    return (
      <div className="flex w-full flex-col">
        <div className="w-full">
          <Editor
            initialMarkdown={data?.markdown ?? ""}
            onChange={handleEditorChange}
            onReady={(ed) => {
              editorRef.current = ed;
            }}
            editable={true}
          />
        </div>
      </div>
    );
  },
);

TiptapSummaryView.displayName = "TiptapSummaryView";
