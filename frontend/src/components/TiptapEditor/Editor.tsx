"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Markdown } from "tiptap-markdown";
import type { Editor as TiptapEditorInstance } from "@tiptap/core";

import { MenuBar } from "./MenuBar";

interface EditorProps {
  initialMarkdown?: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  onReady?: (editor: TiptapEditorInstance) => void;
}

const extensions = [
  TextStyleKit,
  StarterKit,
  Markdown.configure({
    html: false,
    linkify: true,
    breaks: false,
    transformPastedText: true,
    transformCopiedText: true,
  }),
];

export default function Editor({
  initialMarkdown,
  onChange,
  editable = true,
  onReady,
}: EditorProps) {
  const editor = useEditor({
    extensions,
    content: initialMarkdown ?? "",
    editable,
    immediatelyRender: false,
  });

  const readyNotified = useRef(false);
  useEffect(() => {
    if (editor && onReady && !readyNotified.current) {
      readyNotified.current = true;
      onReady(editor);
    }
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor || !onChange) return;
    const handler = ({ editor: ed }: { editor: TiptapEditorInstance }) => {
      const md = (ed.storage as { markdown?: { getMarkdown(): string } }).markdown?.getMarkdown();
      if (typeof md === "string") onChange(md);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor, onChange]);

  const lastSetMarkdown = useRef<string | undefined>(initialMarkdown);
  useEffect(() => {
    if (!editor) return;
    if (initialMarkdown !== lastSetMarkdown.current) {
      lastSetMarkdown.current = initialMarkdown;
      editor.commands.setContent(initialMarkdown ?? "");
    }
  }, [editor, initialMarkdown]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <div className="tiptap-editor">
      {editable && <MenuBar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
