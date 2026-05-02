"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  RemoveFormatting,
  Eraser,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  ListChecks,
  SquareCode,
  Quote,
  Minus,
  CornerDownLeft,
  Undo2,
  Redo2,
  Table,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  TableColumnsSplit,
  TableRowsSplit,
  TableCellsMerge,
  TableCellsSplit,
  Rows3,
  Columns3,
  TableProperties,
  Trash2,
} from "lucide-react";
import { menuBarStateSelector } from "./menuBarState";

const ICON_SIZE = 16;

interface ToolButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

function ToolButton({ label, onClick, active, disabled, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={active ? "is-active" : ""}
    >
      {children}
    </button>
  );
}

export function MenuBar({ editor }: { editor: Editor | null }) {
  const editorState = useEditorState({
    editor,
    selector: menuBarStateSelector,
  });

  if (!editor || !editorState) {
    return null;
  }

  return (
    <div className="control-group">
      <div className="button-group">
        <ToolButton
          label="Bold"
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editorState.canBold}
          active={editorState.isBold}
        >
          <Bold size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Italic"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editorState.canItalic}
          active={editorState.isItalic}
        >
          <Italic size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Strike"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editorState.canStrike}
          active={editorState.isStrike}
        >
          <Strikethrough size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Inline code"
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={!editorState.canCode}
          active={editorState.isCode}
        >
          <Code size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Clear marks"
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        >
          <RemoveFormatting size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Clear nodes"
          onClick={() => editor.chain().focus().clearNodes().run()}
        >
          <Eraser size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Paragraph"
          onClick={() => editor.chain().focus().setParagraph().run()}
          active={editorState.isParagraph}
        >
          <Pilcrow size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Heading 1"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editorState.isHeading1}
        >
          <Heading1 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Heading 2"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editorState.isHeading2}
        >
          <Heading2 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Heading 3"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editorState.isHeading3}
        >
          <Heading3 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Heading 4"
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          active={editorState.isHeading4}
        >
          <Heading4 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Heading 5"
          onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
          active={editorState.isHeading5}
        >
          <Heading5 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Heading 6"
          onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
          active={editorState.isHeading6}
        >
          <Heading6 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Bullet list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editorState.isBulletList}
        >
          <List size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Ordered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editorState.isOrderedList}
        >
          <ListOrdered size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Task list"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editorState.isTaskList}
        >
          <ListChecks size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Code block"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editorState.isCodeBlock}
        >
          <SquareCode size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Blockquote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editorState.isBlockquote}
        >
          <Quote size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Hard break"
          onClick={() => editor.chain().focus().setHardBreak().run()}
        >
          <CornerDownLeft size={ICON_SIZE} />
        </ToolButton>
      </div>
      <div className="button-group">
        <ToolButton
          label="Insert table"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <Table size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Add column before"
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          disabled={!editorState.canAddColumnBefore}
        >
          <ArrowLeftToLine size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Add column after"
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          disabled={!editorState.canAddColumnAfter}
        >
          <ArrowRightToLine size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Delete column"
          onClick={() => editor.chain().focus().deleteColumn().run()}
          disabled={!editorState.canDeleteColumn}
        >
          <TableColumnsSplit size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Add row before"
          onClick={() => editor.chain().focus().addRowBefore().run()}
          disabled={!editorState.canAddRowBefore}
        >
          <ArrowUpToLine size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Add row after"
          onClick={() => editor.chain().focus().addRowAfter().run()}
          disabled={!editorState.canAddRowAfter}
        >
          <ArrowDownToLine size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Delete row"
          onClick={() => editor.chain().focus().deleteRow().run()}
          disabled={!editorState.canDeleteRow}
        >
          <TableRowsSplit size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Merge cells"
          onClick={() => editor.chain().focus().mergeCells().run()}
          disabled={!editorState.canMergeCells}
        >
          <TableCellsMerge size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Split cell"
          onClick={() => editor.chain().focus().splitCell().run()}
          disabled={!editorState.canSplitCell}
        >
          <TableCellsSplit size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Toggle header row"
          onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          disabled={!editorState.canToggleHeaderRow}
        >
          <Rows3 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Toggle header column"
          onClick={() => editor.chain().focus().toggleHeaderColumn().run()}
          disabled={!editorState.canToggleHeaderColumn}
        >
          <Columns3 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Toggle header cell"
          onClick={() => editor.chain().focus().toggleHeaderCell().run()}
          disabled={!editorState.canToggleHeaderCell}
        >
          <TableProperties size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Delete table"
          onClick={() => editor.chain().focus().deleteTable().run()}
          disabled={!editorState.canDeleteTable}
        >
          <Trash2 size={ICON_SIZE} />
        </ToolButton>
      </div>
      <div className="button-group">
        <ToolButton
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editorState.canUndo}
        >
          <Undo2 size={ICON_SIZE} />
        </ToolButton>
        <ToolButton
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editorState.canRedo}
        >
          <Redo2 size={ICON_SIZE} />
        </ToolButton>
      </div>
    </div>
  );
}
