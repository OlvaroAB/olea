/**
 * Merges review-log records from any number of sources — typically one file
 * per device for the same day (C5.2) — into one deduplicated,
 * deterministically ordered list, **without any coordination** between the
 * devices that produced them (this bead's own acceptance clause).
 *
 * `eventId` is the merge key (contracts' review-log.ts doc): two records
 * that share an `eventId` are the same event, however many times, in
 * whatever file, in whatever order they were seen — every occurrence after
 * the first is dropped. Sorting the surviving records by `(instant,
 * eventId)` rather than by input order is what makes the merge
 * order-independent: `merge(a, b)`, `merge(b, a)`, and
 * `merge(a, b, a, b)` all produce the exact same array. That is the concrete
 * property the "two-device same-day merge" acceptance criterion tests —
 * idempotent and commutative with zero coordination between devices.
 *
 * A duplicate `eventId` whose *content* differs between occurrences is not
 * silently resolved by "first wins" — that would hide a real correctness
 * bug (an id collision, or two distinct events wrongly sharing an id) behind
 * an unrecoverable record, which INV-4 rules out. It throws instead.
 *
 * **Every kind of entry merges the same way (D-020).** Suspend and unsuspend
 * events are merged alongside review events with no special case: `eventId`
 * idempotency applies identically, so two devices that saw the same suspension
 * collapse it to one event, while a suspend on one device and an unsuspend on
 * another are two distinct events and both survive. Deciding which of those
 * *won* is not the merger's job — that is the projection's
 * (`./suspension.ts`), over a list this function has already put in
 * chronological order.
 */

import type { ReviewLogEntry } from 'olea-contracts';

export interface MergeReviewLogResult {
  /** Deduplicated entries, sorted by timestamp instant, then `eventId` as a stable tiebreaker. */
  readonly records: readonly ReviewLogEntry[];
  /** `eventId`s that appeared more than once across the merged inputs — detected, not swallowed. */
  readonly duplicateEventIds: readonly string[];
}

function sameContent(a: ReviewLogEntry, b: ReviewLogEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeReviewLogRecords(
  ...sources: ReadonlyArray<readonly ReviewLogEntry[]>
): MergeReviewLogResult {
  const byEventId = new Map<string, ReviewLogEntry>();
  const duplicateEventIds = new Set<string>();

  for (const source of sources) {
    for (const record of source) {
      const prior = byEventId.get(record.eventId);
      if (prior !== undefined) {
        if (!sameContent(prior, record)) {
          throw new Error(
            `mergeReviewLogRecords: eventId ${JSON.stringify(record.eventId)} appears twice ` +
              'with different content — an eventId must uniquely identify one event.',
          );
        }
        duplicateEventIds.add(record.eventId);
        continue;
      }
      byEventId.set(record.eventId, record);
    }
  }

  const records = [...byEventId.values()].sort((a, b) => {
    const instantA = Date.parse(a.timestamp);
    const instantB = Date.parse(b.timestamp);
    if (instantA !== instantB) return instantA - instantB;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });

  return { records, duplicateEventIds: [...duplicateEventIds].sort() };
}
