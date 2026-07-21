"use client";

import { ListChecks, User } from "lucide-react";

import type { LiveActionItem } from "@/hooks/useLiveActionItems";

/**
 * Compact strip shown above the live transcript while recording, listing the
 * provisional action items the beta live extractor has found so far. Renders
 * nothing until there's at least one — the authoritative, grounded list is
 * produced from the full transcript when the summary is generated.
 */
export function LiveActionItemsBar({ items }: { items: LiveActionItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-2">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="size-2 animate-parley-pulse rounded-full bg-info" />
          <span className="text-xs font-medium text-foreground">
            Live action items
          </span>
          <span className="text-xs text-muted-foreground">
            {items.length} · provisional
          </span>
        </div>
        <ul className="flex max-h-24 flex-col gap-1 overflow-y-auto">
          {items.map((item, i) => (
            <li
              key={`${i}-${item.text}`}
              className="flex items-start gap-2 text-sm"
            >
              <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                {item.text}
                {item.assignee && (
                  <span className="
                    ml-2 inline-flex items-center gap-1 text-xs
                    text-muted-foreground
                  ">
                    <User className="size-3" />
                    {item.assignee}
                  </span>
                )}
                {item.due_hint && (
                  <span className="
                    ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px]
                    font-medium text-warning
                  ">
                    {item.due_hint}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
