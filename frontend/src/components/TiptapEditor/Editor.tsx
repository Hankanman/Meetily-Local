"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { Editor as TiptapEditorInstance } from "@tiptap/core";

interface EditorProps {
  /** Initial content as markdown — TipTap parses it on mount. */
  initialMarkdown?: string;
  /** Called whenever the document changes. Always receives the current
   *  markdown serialisation; raw ProseMirror JSON is not exposed. */
  onChange?: (markdown: string) => void;
  /** When true, user can type. False renders read-only. */
  editable?: boolean;
  /** Forwards the underlying editor instance once mounted. Useful when the
   *  parent needs to call e.g. `getMarkdown()` imperatively. */
  onReady?: (editor: TiptapEditorInstance) => void;
}

/**
 * A thin wrapper around TipTap's `useEditor` + `EditorContent`. We keep the
 * surface minimal — markdown in, markdown out — because storage round-trips
 * through markdown anyway. Callers that need ProseMirror JSON can use
 * `onReady` to grab the editor instance directly.
 */
export default function Editor({
  initialMarkdown,
  onChange,
  editable = true,
  onReady,
}: EditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit covers paragraph/heading/bulletList/orderedList/code/etc.
        // Using defaults is fine for summaries; tighten later if needed.
      }),
      Markdown.configure({
        // Round-trip safety: emit pure markdown (no HTML escape), accept
        // the same markdown variants on parse.
        html: false,
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: initialMarkdown ?? "",
    editable,
    // SSR support: explicitly opt out of immediate render so the editor
    // hydrates client-side. Avoids React hydration mismatches.
    immediatelyRender: false,
  });

  // Notify parent of editor readiness exactly once.
  const readyNotified = useRef(false);
  useEffect(() => {
    if (editor && onReady && !readyNotified.current) {
      readyNotified.current = true;
      onReady(editor);
    }
  }, [editor, onReady]);

  // Hook into editor changes to forward markdown to the parent.
  useEffect(() => {
    if (!editor || !onChange) return;
    const handler = ({ editor: ed }: { editor: TiptapEditorInstance }) => {
      // tiptap-markdown attaches the storage at `storage.markdown`; the
      // `getMarkdown()` helper serialises the current document.
      const md = (ed.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown();
      if (typeof md === "string") onChange(md);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, onChange]);

  // Update content when initialMarkdown changes externally (e.g. when the
  // user navigates between meetings without unmounting the editor).
  const lastSetMarkdown = useRef<string | undefined>(initialMarkdown);
  useEffect(() => {
    if (!editor) return;
    if (initialMarkdown !== lastSetMarkdown.current) {
      lastSetMarkdown.current = initialMarkdown;
      // setContent will trigger an `update` — caller's onChange should
      // be guarded by an isContentLoaded ref if they care.
      editor.commands.setContent(initialMarkdown ?? "");
    }
  }, [editor, initialMarkdown]);

  // Reflect editable changes after mount.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <EditorContent
      editor={editor}
      className="tiptap-editor prose max-w-none focus:outline-none"
    />
  );
}
