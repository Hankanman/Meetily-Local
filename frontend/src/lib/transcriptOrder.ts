import { Transcript } from "@/types";

/**
 * Pure helpers for maintaining a chronologically-sorted transcript array
 * without re-sorting the whole array on every insert.
 *
 * Ordering key: `audio_start_time` (falling back to `chunk_start_time`,
 * then 0), then `sequence_id` (falling back to 0). audio_start_time is the
 * true chronological anchor across sources — dual-VAD segments can complete
 * out of order (e.g. a long system-audio segment force-cut well after a
 * shorter, later-starting mic segment finishes), so arrival/sequence order
 * alone is not chronological (issue #37).
 */

function orderKey(t: Transcript): [number, number] {
  return [
    t.audio_start_time ?? t.chunk_start_time ?? 0,
    t.sequence_id ?? 0,
  ];
}

/**
 * Compares two segments by chronological order key. Returns <0 if `a`
 * belongs before `b`, >0 if after, 0 if equal.
 */
export function compareSegments(a: Transcript, b: Transcript): number {
  const [aTime, aSeq] = orderKey(a);
  const [bTime, bSeq] = orderKey(b);
  if (aTime !== bTime) return aTime - bTime;
  return aSeq - bSeq;
}

/**
 * Inserts `segment` into `sorted` (assumed already sorted per
 * `compareSegments`) at its correct position via binary search, returning a
 * NEW array. Does not check for existing entries with the same
 * `sequence_id` — use `upsertSorted` when duplicates/updates are possible.
 */
export function insertSorted(
  sorted: Transcript[],
  segment: Transcript,
): Transcript[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareSegments(sorted[mid], segment) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const result = sorted.slice();
  result.splice(lo, 0, segment);
  return result;
}

/**
 * Upserts `segment` into `sorted` (assumed already sorted per
 * `compareSegments`) by `sequence_id`:
 *  - If a segment with the same `sequence_id` exists and its order key is
 *    unchanged, it is replaced in place (no re-sort needed).
 *  - If the order key changed (or no match existed), the old entry (if any)
 *    is removed and the new one is binary-search-inserted.
 *
 * Returns a NEW array; `sorted` is never mutated.
 */
export function upsertSorted(
  sorted: Transcript[],
  segment: Transcript,
): Transcript[] {
  if (segment.sequence_id === undefined) {
    return insertSorted(sorted, segment);
  }

  const existingIndex = sorted.findIndex(
    (t) => t.sequence_id === segment.sequence_id,
  );

  if (existingIndex === -1) {
    return insertSorted(sorted, segment);
  }

  const existing = sorted[existingIndex];
  const [existingTime] = orderKey(existing);
  const [newTime] = orderKey(segment);

  if (existingTime === newTime) {
    // Same chronological slot - replace in place, no re-sort needed.
    const result = sorted.slice();
    result[existingIndex] = segment;
    return result;
  }

  // Start time changed - remove old entry, then binary-search-insert.
  const withoutExisting = sorted.slice();
  withoutExisting.splice(existingIndex, 1);
  return insertSorted(withoutExisting, segment);
}
