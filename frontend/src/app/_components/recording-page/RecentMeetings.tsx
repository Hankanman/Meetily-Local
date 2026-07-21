"use client";

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { formatRelativeDate } from "@/lib/relative-date";
import { SummarySection } from "./SummarySection";

const VISIBLE = 4;

/**
 * Home-screen meeting summary: the most recent meetings as clickable rows
 * (title + relative date). Source-of-truth is `useSidebar().meetings` — the
 * same list the sidebar renders. Click = open that meeting's details.
 */
export function RecentMeetings() {
  const router = useRouter();
  const { meetings } = useSidebar();
  const recent = meetings.slice(0, VISIBLE);

  if (recent.length === 0) return null;

  return (
    <SummarySection title="Recent meetings">
      {recent.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => router.push(`/meeting-details?id=${m.id}`)}
          className="
            flex items-center justify-between gap-3 rounded-lg border
            border-border bg-card px-3.5 py-2.5 text-left transition-colors
            hover:border-brand/40 hover:bg-accent
          "
        >
          <div className="min-w-0">
            <div
              className="truncate text-sm font-semibold text-foreground"
              title={m.title}
            >
              {m.title}
            </div>
            {m.updated_at && (
              <div className="text-xs text-muted-foreground">
                {formatRelativeDate(m.updated_at)}
              </div>
            )}
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </SummarySection>
  );
}
