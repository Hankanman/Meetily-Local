"use client";

import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";

const VISIBLE = 6;

/**
 * Compact card grid of the most recent meetings, shown below the hero
 * pre-recording. Source-of-truth is `useSidebar().meetings` — same list
 * the sidebar renders, just slightly different presentation. Click =
 * navigate to that meeting's details page.
 */
export function RecentMeetings() {
  const router = useRouter();
  const { meetings } = useSidebar();
  const recent = meetings.slice(0, VISIBLE);

  if (recent.length === 0) return null;

  return (
    <section className="w-full max-w-3xl">
      <h2 className="
        mb-3 px-1 text-xs font-medium tracking-wide text-muted-foreground
        uppercase
      ">
        Recent meetings
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {recent.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => router.push(`/meeting-details?id=${m.id}`)}
            className="
              flex items-start gap-2 rounded-md border border-border
              bg-background p-3 text-left transition-colors
              hover:border-info/40 hover:bg-muted
            "
          >
            <Calendar className="size-4 shrink-0 text-muted-foreground" />
            <span
              className="line-clamp-2 min-w-0 text-sm font-medium"
              title={m.title}
            >
              {m.title}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
