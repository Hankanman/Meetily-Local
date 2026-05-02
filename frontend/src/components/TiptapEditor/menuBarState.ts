import type { Editor } from "@tiptap/core";
import type { EditorStateSnapshot } from "@tiptap/react";

export function menuBarStateSelector(ctx: EditorStateSnapshot<Editor | null>) {
  if (!ctx.editor) {
    return {
      isBold: false,
      canBold: false,
      isItalic: false,
      canItalic: false,
      isStrike: false,
      canStrike: false,
      isCode: false,
      canCode: false,
      canClearMarks: false,
      isParagraph: false,
      isHeading1: false,
      isHeading2: false,
      isHeading3: false,
      isHeading4: false,
      isHeading5: false,
      isHeading6: false,
      isBulletList: false,
      isOrderedList: false,
      isTaskList: false,
      isCodeBlock: false,
      isBlockquote: false,
      canAddColumnBefore: false,
      canAddColumnAfter: false,
      canDeleteColumn: false,
      canAddRowBefore: false,
      canAddRowAfter: false,
      canDeleteRow: false,
      canDeleteTable: false,
      canMergeCells: false,
      canSplitCell: false,
      canToggleHeaderRow: false,
      canToggleHeaderColumn: false,
      canToggleHeaderCell: false,
      canUndo: false,
      canRedo: false,
    };
  }
  const e = ctx.editor;
  return {
    isBold: e.isActive("bold") ?? false,
    canBold: e.can().chain().toggleBold().run() ?? false,
    isItalic: e.isActive("italic") ?? false,
    canItalic: e.can().chain().toggleItalic().run() ?? false,
    isStrike: e.isActive("strike") ?? false,
    canStrike: e.can().chain().toggleStrike().run() ?? false,
    isCode: e.isActive("code") ?? false,
    canCode: e.can().chain().toggleCode().run() ?? false,
    canClearMarks: e.can().chain().unsetAllMarks().run() ?? false,

    isParagraph: e.isActive("paragraph") ?? false,
    isHeading1: e.isActive("heading", { level: 1 }) ?? false,
    isHeading2: e.isActive("heading", { level: 2 }) ?? false,
    isHeading3: e.isActive("heading", { level: 3 }) ?? false,
    isHeading4: e.isActive("heading", { level: 4 }) ?? false,
    isHeading5: e.isActive("heading", { level: 5 }) ?? false,
    isHeading6: e.isActive("heading", { level: 6 }) ?? false,

    isBulletList: e.isActive("bulletList") ?? false,
    isOrderedList: e.isActive("orderedList") ?? false,
    isTaskList: e.isActive("taskList") ?? false,
    isCodeBlock: e.isActive("codeBlock") ?? false,
    isBlockquote: e.isActive("blockquote") ?? false,

    // Table operations are only enabled inside a table — `.can()` reflects that.
    canAddColumnBefore: e.can().addColumnBefore() ?? false,
    canAddColumnAfter: e.can().addColumnAfter() ?? false,
    canDeleteColumn: e.can().deleteColumn() ?? false,
    canAddRowBefore: e.can().addRowBefore() ?? false,
    canAddRowAfter: e.can().addRowAfter() ?? false,
    canDeleteRow: e.can().deleteRow() ?? false,
    canDeleteTable: e.can().deleteTable() ?? false,
    canMergeCells: e.can().mergeCells() ?? false,
    canSplitCell: e.can().splitCell() ?? false,
    canToggleHeaderRow: e.can().toggleHeaderRow() ?? false,
    canToggleHeaderColumn: e.can().toggleHeaderColumn() ?? false,
    canToggleHeaderCell: e.can().toggleHeaderCell() ?? false,

    canUndo: e.can().chain().undo().run() ?? false,
    canRedo: e.can().chain().redo().run() ?? false,
  };
}

export type MenuBarState = ReturnType<typeof menuBarStateSelector>;
