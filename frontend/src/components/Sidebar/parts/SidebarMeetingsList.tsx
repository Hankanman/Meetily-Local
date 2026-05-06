"use client";

import { useMemo } from "react";
import type { CurrentMeeting } from "../SidebarProvider";
import { SidebarMeetingItem } from "./SidebarMeetingItem";
import { groupByDate } from "./dateGroup";

interface TranscriptSearchHit {
  id: string;
  matchContext: string;
}

interface SidebarMeetingsListProps {
  meetings: CurrentMeeting[];
  activeMeetingId: string | null;
  searchQuery: string;
  searchResults: TranscriptSearchHit[];
  onSelect: (meeting: CurrentMeeting) => void;
  onRename: (meeting: CurrentMeeting) => void;
  onDelete: (meetingId: string) => void;
}

/**
 * Date-grouped meetings list. Filters by search query against both meeting
 * titles and transcript-search hits (the latter come from `api_search_transcripts`,
 * managed by the parent's `SidebarProvider`).
 */
export function SidebarMeetingsList({
  meetings,
  activeMeetingId,
  searchQuery,
  searchResults,
  onSelect,
  onRename,
  onDelete,
}: SidebarMeetingsListProps) {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return meetings;
    const matchedIds = new Set(searchResults.map((r) => r.id));
    return meetings.filter(
      (m) => matchedIds.has(m.id) || m.title.toLowerCase().includes(q),
    );
  }, [meetings, searchQuery, searchResults]);

  const matchByMeetingId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of searchResults) map.set(r.id, r.matchContext);
    return map;
  }, [searchResults]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  if (filtered.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-xs text-muted-foreground">
        {searchQuery.trim()
          ? "No meetings match this search."
          : "No meetings yet. Hit Start recording to make your first one."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(({ label, items }) => (
        <div key={label}>
          <h3 className="
            mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground
            uppercase
          ">
            {label}
          </h3>
          <div className="space-y-0.5">
            {items.map((m) => (
              <SidebarMeetingItem
                key={m.id}
                meeting={m}
                isActive={m.id === activeMeetingId}
                match={
                  matchByMeetingId.has(m.id)
                    ? { matchContext: matchByMeetingId.get(m.id)! }
                    : undefined
                }
                onClick={() => onSelect(m)}
                onRename={() => onRename(m)}
                onDelete={() => onDelete(m.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
