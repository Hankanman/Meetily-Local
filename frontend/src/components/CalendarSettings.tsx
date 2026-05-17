"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, RefreshCw, Trash2, ExternalLink, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/app/settings/parts/SettingsCard";
import {
  addCalendarSource,
  listCalendarSources,
  refreshCalendarSource,
  removeCalendarSource,
  type CalendarSource,
} from "@/lib/calendar";

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return new Date(ts).toLocaleString();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

export function CalendarSettings() {
  const [sources, setSources] = useState<CalendarSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [recentRefreshCounts, setRecentRefreshCounts] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    try {
      const rows = await listCalendarSources();
      setSources(rows);
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const created = await addCalendarSource(trimmed, label.trim() || null);
      setUrl("");
      setLabel("");
      try {
        const result = await refreshCalendarSource(created.id);
        setRecentRefreshCounts((prev) => ({
          ...prev,
          [created.id]: result.eventCount,
        }));
      } catch (refreshErr) {
        setSaveError(`Added, but initial fetch failed: ${refreshErr}`);
      }
      await reload();
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      const result = await refreshCalendarSource(id);
      setRecentRefreshCounts((prev) => ({ ...prev, [id]: result.eventCount }));
      await reload();
    } catch (err) {
      setLoadError(String(err));
      await reload();
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRemove = async (id: string) => {
    const ok = confirm(
      "Remove this calendar source? Linked meetings will keep their event metadata snapshot.",
    );
    if (!ok) return;
    try {
      await removeCalendarSource(id);
      await reload();
    } catch (err) {
      setLoadError(String(err));
    }
  };

  const sortedSources = useMemo(() => {
    if (!sources) return null;
    return [...sources].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [sources]);

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Public ICS feeds"
        description="Add a public iCalendar URL (Google or Outlook published-calendar links work). Events from the next 90 days will be available to link to recordings."
      >
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="space-y-1">
            <label
              htmlFor="calendar-ics-url"
              className="text-sm font-medium text-foreground"
            >
              ICS URL
            </label>
            <input
              id="calendar-ics-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              required
              className="
                h-9 w-full rounded-md border border-border bg-background px-3
                text-sm placeholder:text-muted-foreground/70
                focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none
              "
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="calendar-ics-label"
              className="text-sm font-medium text-foreground"
            >
              Label{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              id="calendar-ics-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Work calendar"
              className="
                h-9 w-full rounded-md border border-border bg-background px-3
                text-sm placeholder:text-muted-foreground/70
                focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none
              "
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isSaving || !url.trim()}>
              {isSaving ? "Adding…" : "Add calendar"}
            </Button>
            {saveError && (
              <span className="text-sm text-destructive">{saveError}</span>
            )}
          </div>
        </form>
      </SettingsCard>

      <SettingsCard title="Connected calendars">
        {loadError && (
          <p className="mb-3 text-sm text-destructive">{loadError}</p>
        )}
        {sortedSources === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sortedSources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No calendars yet. Add one above to start linking recordings to
            calendar events.
          </p>
        ) : (
          <ul className="space-y-2">
            {sortedSources.map((s) => {
              const isRefreshing = refreshingId === s.id;
              const recentCount = recentRefreshCounts[s.id];
              return (
                <li
                  key={s.id}
                  className="
                    flex flex-col gap-2 rounded-md border border-border
                    bg-background p-3 sm:flex-row sm:items-start
                  "
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">
                        {s.label?.trim() || s.url}
                      </span>
                    </div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="
                        flex items-center gap-1 truncate text-xs
                        text-muted-foreground hover:text-foreground
                      "
                      title={s.url}
                    >
                      <ExternalLink className="size-3" />
                      <span className="truncate">{s.url}</span>
                    </a>
                    <div className="text-xs text-muted-foreground">
                      Last fetched {formatRelative(s.lastFetchedAt)}
                      {typeof recentCount === "number" && (
                        <span className="ml-1 text-foreground">
                          · {recentCount} event{recentCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    {s.lastError && (
                      <p className="text-xs text-destructive">
                        Last error: {s.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRefresh(s.id)}
                      disabled={isRefreshing}
                      className="gap-1.5"
                    >
                      {isRefreshing ? (
                        <RefreshCw className="size-3.5 animate-spin" />
                      ) : recentCount !== undefined && !s.lastError ? (
                        <Check className="size-3.5" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      <span>{isRefreshing ? "Fetching…" : "Refresh"}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRemove(s.id)}
                      aria-label="Remove calendar"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
