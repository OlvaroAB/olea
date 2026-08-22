/**
 * The suspended-instrument **projection** (F2.6's durable half, D-020;
 * semantics settled in ol-p2t08a).
 *
 * There is no stored list of suspended instruments anywhere in the vault. There
 * is only the append-only review log, and this fold over it. That is the whole
 * design: "what is suspended" is derived, so it can never drift out of sync
 * with the history that produced it, it survives a device that was offline
 * while she suspended something, and a corrupted or deleted projection costs
 * nothing because there was never anything to corrupt — the log rebuilds it.
 *
 * What it deliberately does **not** touch: `SchedulerState`. Suspension does
 * not reset an interval or a due date (F2.6: unsuspending returns the item
 * exactly as it was). Scheduling stays per instrument (R3) and untouched; the
 * queue simply excludes the set this function returns.
 */

import type { ReviewLogEntry } from 'olea-contracts';

/**
 * Folds review-log entries into the set of currently-suspended instrument ids.
 *
 * **Last event per instrument wins**, where "last" is resolved by
 * `(timestamp instant, eventId)` — the same ordering `./merge.ts` sorts by, so
 * for the ordinary case (entries straight out of `mergeReviewLogRecords`) this
 * is exactly a left-to-right fold. Resolving by timestamp rather than by array
 * position is what makes the projection *order-independent*, and that is not a
 * nicety: entries arrive from several devices' files, and a caller that merged
 * them in a different order, or read one file before another, must not get a
 * different answer about what she is currently studying.
 *
 * Review entries are ignored — reviewing an instrument is not an opinion about
 * whether it is suspended.
 *
 * An `unsuspend` with no preceding `suspend` is a **no-op, not an error**: the
 * instrument is simply not in the set. A distributed append-only log cannot
 * promise that the two devices' events arrive paired or at all (a suspend may
 * be in a file that has not synced yet, or in a day file the caller did not
 * read), so treating a lone unsuspend as corruption would turn an ordinary sync
 * state into a failure. The projection states the current belief; it does not
 * audit the history that produced it.
 */
export function suspendedInstrumentIds(entries: readonly ReviewLogEntry[]): ReadonlySet<string> {
  /** instrumentId → the latest suspension event seen for it, and its sort key. */
  const latest = new Map<string, { instant: number; eventId: string; suspended: boolean }>();

  for (const entry of entries) {
    if (entry.kind === 'review') continue;

    const instant = Date.parse(entry.timestamp);
    const prior = latest.get(entry.instrumentId);
    const isLater =
      prior === undefined ||
      instant > prior.instant ||
      (instant === prior.instant && entry.eventId > prior.eventId);
    if (!isLater) continue;

    latest.set(entry.instrumentId, {
      instant,
      eventId: entry.eventId,
      suspended: entry.kind === 'suspend',
    });
  }

  const suspended = new Set<string>();
  for (const [instrumentId, state] of latest) {
    if (state.suspended) suspended.add(instrumentId);
  }
  return suspended;
}

/** Convenience for the queue's one real question, so callers don't rebuild the set per item. */
export function isInstrumentSuspended(
  suspended: ReadonlySet<string>,
  instrumentId: string,
): boolean {
  return suspended.has(instrumentId);
}
