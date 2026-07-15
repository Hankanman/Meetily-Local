"use client";

import { useState } from "react";
import { Check, ListChecks, Plus, Sparkles, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Heading } from "@/components/ui/typography";
import { ActionItem } from "@/lib/actionItems";
import { useActionItems } from "@/hooks/meeting-details/useActionItems";
import { cn } from "@/lib/utils";

interface ActionItemsPanelProps {
  meetingId: string;
  /** Whether the meeting has a summary. Without one there's nothing for the
   *  on-demand extractor to read, so its button is hidden rather than shown
   *  disabled — offering an action that can only fail is worse than omitting
   *  it. */
  hasSummary: boolean;
}

/**
 * The checkable task list under the summary.
 *
 * Items land here automatically after a summary completes (extraction runs in
 * the background and emits an event this subscribes to via `useActionItems`),
 * or manually via the input at the bottom. Meetings that predate the feature
 * show an "Extract from summary" button instead of an empty list.
 */
export function ActionItemsPanel({ meetingId, hasSummary }: ActionItemsPanelProps) {
  const {
    items,
    openCount,
    isLoading,
    isExtracting,
    addItem,
    removeItem,
    toggleStatus,
    runExtraction,
  } = useActionItems(meetingId);

  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text || isAdding) return;
    setIsAdding(true);
    try {
      await addItem(text);
      setDraft("");
    } finally {
      setIsAdding(false);
    }
  };

  if (isLoading) return null;

  const isEmpty = items.length === 0;

  return (
    <section className="rounded-lg border border-border bg-muted/30 p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          <Heading level={3}>Action Items</Heading>
          {openCount > 0 && (
            <span
              className="
                inline-flex min-w-5 items-center justify-center rounded-full
                bg-info/15 px-1.5 py-0.5 text-xs font-medium text-info
              "
              title={`${openCount} open`}
            >
              {openCount}
            </span>
          )}
          {!isEmpty && openCount === 0 && (
            <span className="text-xs text-success">All done</span>
          )}
        </div>

        {hasSummary && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void runExtraction()}
            disabled={isExtracting}
            className="gap-1.5 text-muted-foreground"
            title={
              isEmpty
                ? "Extract action items from the summary"
                : "Re-extract from the summary (your own items are kept)"
            }
          >
            {isExtracting ? <Spinner size="sm" /> : <Sparkles className="size-3.5" />}
            {isEmpty ? "Extract from summary" : "Re-extract"}
          </Button>
        )}
      </header>

      {isEmpty ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {hasSummary
            ? "No action items yet. Extract them from the summary, or add one below."
            : "No action items yet. Add one below."}
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {items.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              onToggle={() => void toggleStatus(item)}
              onDelete={() => void removeItem(item)}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="Add an action item…"
          className="h-8 text-sm"
          disabled={isAdding}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleAdd()}
          disabled={!draft.trim() || isAdding}
          className="shrink-0 gap-1.5"
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </section>
  );
}

function ActionItemRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ActionItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const isDone = item.status === "done";

  return (
    <li
      className="
        group flex items-start gap-2 rounded-md px-1.5 py-1
        hover:bg-background/60
      "
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? `Reopen: ${item.text}` : `Complete: ${item.text}`}
        onClick={onToggle}
        className={cn(
          `
            mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm
            border transition-colors
            focus-visible:ring-1 focus-visible:ring-ring
            focus-visible:outline-none
          `,
          isDone
            ? "border-success bg-success text-white"
            : `
              border-input
              hover:border-foreground/40
            `,
        )}
      >
        {isDone && <Check className="size-3" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <span
          className={cn(
            "text-sm",
            isDone && "text-muted-foreground line-through",
          )}
        >
          {item.text}
        </span>
        {(item.assignee || item.due_hint) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            {item.assignee && (
              <span className="
                inline-flex items-center gap-1 text-xs text-muted-foreground
              ">
                <User className="size-3" />
                {item.assignee}
              </span>
            )}
            {item.due_hint && (
              <span className="
                inline-flex items-center rounded-full bg-warning/15 px-1.5
                py-0.5 text-[10px] font-medium text-warning
              ">
                {item.due_hint}
              </span>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={`Delete: ${item.text}`}
        onClick={onDelete}
        className="
          mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity
          group-hover:opacity-100
          hover:text-destructive
          focus-visible:opacity-100 focus-visible:outline-none
        "
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}
