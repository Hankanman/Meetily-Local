"use client";

import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useOpenActionItems } from "@/hooks/useOpenActionItems";
import { Badge } from "@/components/ui/badge";
import { SummarySection } from "./SummarySection";

const VISIBLE = 5;

/**
 * Home-screen task summary: open action items across every meeting. Tick the
 * box to complete one (it drops off the list); click the row to open the
 * meeting it came from. Hidden entirely while loading or when nothing is open.
 */
export function OutstandingActionItems() {
  const router = useRouter();
  const { meetings } = useSidebar();
  const { items, isLoading, complete } = useOpenActionItems();

  if (isLoading || items.length === 0) return null;

  const meetingTitle = (id: string) =>
    meetings.find((m) => m.id === id)?.title ?? "Meeting";

  return (
    <SummarySection title="Outstanding action items" count={items.length}>
      {items.slice(0, VISIBLE).map((item) => {
        const subtitle = [meetingTitle(item.meeting_id), item.assignee]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={item.id}
            className="
              flex items-start gap-2.5 rounded-lg border border-border bg-card
              px-3 py-2.5
            "
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={false}
              aria-label={`Complete: ${item.text}`}
              onClick={() => void complete(item)}
              className="
                mt-0.5 flex size-[18px] shrink-0 items-center justify-center
                rounded-md border-[1.5px] border-border text-transparent
                transition-colors
                hover:border-success hover:text-success
                focus-visible:ring-1 focus-visible:ring-ring
                focus-visible:outline-none
              "
            >
              <Check className="size-3" strokeWidth={3} />
            </button>

            <button
              type="button"
              onClick={() =>
                router.push(`/meeting-details?id=${item.meeting_id}`)
              }
              className="min-w-0 flex-1 text-left"
            >
              <div
                className="truncate text-sm font-semibold text-foreground"
                title={item.text}
              >
                {item.text}
              </div>
              {subtitle && (
                <div className="truncate text-xs text-muted-foreground">
                  {subtitle}
                </div>
              )}
            </button>

            {item.due_hint && (
              <Badge variant="warning" className="shrink-0">
                {item.due_hint}
              </Badge>
            )}
          </div>
        );
      })}
    </SummarySection>
  );
}
