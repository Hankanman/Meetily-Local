// Date-grouping helpers for the sidebar meetings list. Pure functions —
// no React, no Tauri — so the grouping logic stays trivially testable.

export type DateGroupLabel =
  | "Today"
  | "Yesterday"
  | "Earlier this week"
  | "Earlier this month"
  | "Older";

const ORDER: DateGroupLabel[] = [
  "Today",
  "Yesterday",
  "Earlier this week",
  "Earlier this month",
  "Older",
];

/**
 * Bucket a date into a relative-time label. `now` is injectable for tests.
 * Falls back to "Older" if the input is invalid.
 */
export function bucketDate(iso: string | undefined, now: Date = new Date()): DateGroupLabel {
  if (!iso) return "Older";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Older";

  // Compare on calendar-day boundaries in local time, not millisecond deltas,
  // so a meeting at 11pm yesterday correctly buckets as "Yesterday" even if
  // the elapsed time is < 24h.
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

  const todayStart = startOfDay(now);
  const meetingStart = startOfDay(d);
  const dayDelta = Math.floor((todayStart - meetingStart) / 86_400_000);

  if (dayDelta === 0) return "Today";
  if (dayDelta === 1) return "Yesterday";
  if (dayDelta < 7) return "Earlier this week";

  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth()
  ) {
    return "Earlier this month";
  }
  return "Older";
}

/**
 * Group items by date label, preserving the input order within each bucket.
 * Returned groups are in display order ("Today" first, "Older" last) and
 * empty buckets are omitted.
 */
export function groupByDate<T extends { updated_at?: string }>(
  items: T[],
  now: Date = new Date(),
): Array<{ label: DateGroupLabel; items: T[] }> {
  const buckets = new Map<DateGroupLabel, T[]>();
  for (const item of items) {
    const label = bucketDate(item.updated_at, now);
    const list = buckets.get(label);
    if (list) {
      list.push(item);
    } else {
      buckets.set(label, [item]);
    }
  }
  return ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    items: buckets.get(label)!,
  }));
}
