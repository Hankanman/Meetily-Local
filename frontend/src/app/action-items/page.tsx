"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, ListChecks, Trash2, User } from "lucide-react";

import { Page, PageBody, PageLoading } from "@/components/layout/Page";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useAllActionItems } from "@/hooks/useAllActionItems";
import { useSelfIdentity } from "@/hooks/useSelfIdentity";
import { ActionItem } from "@/lib/actionItems";
import { cn } from "@/lib/utils";

type Filter = "open" | "done" | "all";
type Scope = "mine" | "everyone";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

const SCOPES: { id: Scope; label: string }[] = [
  { id: "mine", label: "Mine" },
  { id: "everyone", label: "Everyone" },
];

/** One meeting's worth of items, in the order meetings appear in the sidebar. */
interface Group {
  meetingId: string;
  title: string;
  items: ActionItem[];
}

export default function ActionItemsPage() {
  const router = useRouter();
  const { meetings } = useSidebar();
  const { items, isLoading, toggle, remove } = useAllActionItems();
  const { displayName, isMine } = useSelfIdentity();
  const [filter, setFilter] = useState<Filter>("open");
  const [scope, setScope] = useState<Scope>("mine");

  // Scope narrows to the current user's items; counts reflect the active scope.
  const scoped = useMemo(
    () => (scope === "mine" ? items.filter((i) => isMine(i.assignee)) : items),
    [items, scope, isMine],
  );
  const openCount = scoped.filter((i) => i.status !== "done").length;
  const doneCount = scoped.length - openCount;

  // Group by meeting, ordered by the sidebar's meeting order (recent first);
  // items whose meeting isn't in the list fall into a trailing "Other" bucket.
  const groups = useMemo<Group[]>(() => {
    const visible = scoped.filter((i) =>
      filter === "all" ? true : filter === "done" ? i.status === "done" : i.status !== "done",
    );
    const byMeeting = new Map<string, ActionItem[]>();
    for (const item of visible) {
      const list = byMeeting.get(item.meeting_id) ?? [];
      list.push(item);
      byMeeting.set(item.meeting_id, list);
    }
    // Open items before done within each meeting.
    for (const list of byMeeting.values()) {
      list.sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
    }

    const order = meetings.map((m) => m.id);
    const known = meetings
      .filter((m) => byMeeting.has(m.id))
      .map((m) => ({ meetingId: m.id, title: m.title, items: byMeeting.get(m.id)! }));
    const orphans = [...byMeeting.keys()]
      .filter((id) => !order.includes(id))
      .map((id) => ({ meetingId: id, title: "Untitled meeting", items: byMeeting.get(id)! }));
    return [...known, ...orphans];
  }, [scoped, meetings, filter]);

  if (isLoading) {
    return (
      <PageLoading>
        <Spinner size="lg" />
      </PageLoading>
    );
  }

  const totalVisible = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Page>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-6 py-3.5">
        <ListChecks className="size-5 text-brand-strong" />
        <h1 className="font-display text-h1 tracking-tight text-foreground">
          Action items
        </h1>
        {openCount > 0 && <Badge variant="brand">{openCount} open</Badge>}
        {doneCount > 0 && <Badge variant="secondary">{doneCount} done</Badge>}

        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            options={SCOPES}
            value={scope}
            onChange={setScope}
          />
          <SegmentedControl
            options={FILTERS}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </div>

      <PageBody className="custom-scrollbar">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
          {totalVisible === 0 ? (
            <EmptyState filter={filter} scope={scope} displayName={displayName} />
          ) : (
            groups.map((group) => (
              <section key={group.meetingId}>
                <button
                  type="button"
                  onClick={() => router.push(`/meeting-details?id=${group.meetingId}`)}
                  className="group mb-2 flex w-full items-center gap-2 px-1 text-left"
                >
                  <span className="truncate font-display text-h3 font-semibold text-foreground">
                    {group.title}
                  </span>
                  <Badge variant="secondary">{group.items.length}</Badge>
                  <ChevronRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
                <div className="flex flex-col gap-1.5">
                  {group.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      onToggle={() => void toggle(item)}
                      onDelete={() => void remove(item)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </PageBody>
    </Page>
  );
}

/** Small segmented control (pill group). Generic over the option id type. */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            value === o.id
              ? "bg-brand-muted text-brand-strong"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({
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
    <div className="group flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={isDone}
        aria-label={isDone ? `Reopen: ${item.text}` : `Complete: ${item.text}`}
        onClick={onToggle}
        className={cn(
          `mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-md
           border-[1.5px] transition-colors
           focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none`,
          isDone
            ? "border-success bg-success text-success-foreground"
            : "border-border text-transparent hover:border-success hover:text-success",
        )}
      >
        <Check className="size-3" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-medium",
            isDone ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {item.text}
        </div>
        {(item.assignee || item.due_hint) && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {item.assignee && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <User className="size-3" />
                {item.assignee}
              </span>
            )}
            {item.due_hint && (
              <Badge variant={isDone ? "secondary" : "warning"}>{item.due_hint}</Badge>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={`Delete: ${item.text}`}
        onClick={onDelete}
        className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function EmptyState({
  filter,
  scope,
  displayName,
}: {
  filter: Filter;
  scope: Scope;
  displayName: string | null;
}) {
  let message: string;
  if (scope === "mine") {
    const who = displayName ? `"${displayName}"` : "your name";
    message =
      filter === "done"
        ? `Nothing assigned to you is done yet.`
        : `No action items assigned to you. Items are matched to ${who} — name your voice under Settings → Speakers so yours are recognised.`;
  } else {
    message =
      filter === "done"
        ? "No completed action items yet."
        : filter === "open"
          ? "No open action items — you're all caught up."
          : "No action items yet. They're extracted automatically when a meeting is summarised.";
  }
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-brand-muted text-brand-strong">
        <ListChecks className="size-6" />
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
