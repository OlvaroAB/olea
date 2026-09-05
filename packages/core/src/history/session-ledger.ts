/**
 * Shape 2b — **a session's record** (`[D-102]`, `ol-0r92.53`).
 *
 * A pure fold over review-log entries into the sessions they came from.
 * Read-only: no I/O, no writes, no cache, no persisted schema.
 *
 * ## No session identity exists in the log, so sessions are derived
 *
 * Nothing in `olea-contracts`' `reviewLogEntry` union carries a `sessionId` —
 * a review event knows its instrument, its concepts, its rating and its
 * selection context, and nothing about the sitting it belonged to. This fold
 * therefore clusters review events on an **inactivity gap the caller
 * supplies**: consecutive reviews closer together than `gapMs` are one
 * session, a longer silence starts the next.
 *
 * The gap is a required argument and has no default here **on purpose**. It is
 * a number that changes what she is shown, and this module is not the place a
 * number like that gets chosen by whoever wrote the first caller. Whether the
 * log should carry a real session identity instead — a persisted-schema
 * change, and therefore Class C — is recorded on the decision bead that
 * ratifies `[D-102]`'s clause.
 *
 * ## No totals, ever
 *
 * `[D-102]` forbids totals, percentages and grade-like summaries on this
 * shape by name. There is no count, no accuracy, no duration-per-item and no
 * "x of y" anywhere below: a renderer gets the items and nothing that reads
 * as a score. That is enforced by absence rather than by a comment, which is
 * the only enforcement that survives the next edit.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { ledgerInstrumentId } from './document-ledger.js';
import type { SessionLedger, SessionLedgerItem } from './types.js';

/** A cluster always holds at least one review; this is how the type says so. */
function isNonEmpty(
  cluster: readonly ReviewLogRecord[],
): cluster is [ReviewLogRecord, ...ReviewLogRecord[]] {
  return cluster.length > 0;
}

/** Narrows to review events, ordered by `(instant, eventId)` — never by array position. */
function orderedReviews(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return entries
    .filter((entry): entry is ReviewLogRecord => entry.kind === 'review')
    .slice()
    .sort((a, b) => {
      const left = Date.parse(a.timestamp);
      const right = Date.parse(b.timestamp);
      if (left !== right) return left - right;
      return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
    });
}

/**
 * Groups the log's review events into sessions and attaches what else the log
 * says about the instruments each session touched.
 *
 * `gapMs` is the inactivity gap that ends a session (see this module's doc on
 * why it has no default). It must be a positive finite number; anything else
 * is a caller bug and throws rather than silently producing one session or
 * one session per item.
 *
 * Sessions come back **newest first**, matching the per-document ledger and
 * the drawn shape.
 */
export function foldSessionLedgers(
  entries: readonly ReviewLogEntry[],
  gapMs: number,
): readonly SessionLedger[] {
  if (!Number.isFinite(gapMs) || gapMs <= 0) {
    throw new RangeError(
      `foldSessionLedgers: gapMs must be a positive finite number, got ${gapMs}`,
    );
  }

  const reviews = orderedReviews(entries);
  if (reviews.length === 0) return [];

  const misconceptionsByReview = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== 'misconception-observed') continue;
    const seen = misconceptionsByReview.get(entry.reviewEventId);
    if (seen === undefined) misconceptionsByReview.set(entry.reviewEventId, [entry.eventId]);
    else seen.push(entry.eventId);
  }

  const clusters: [ReviewLogRecord, ...ReviewLogRecord[]][] = [];
  let current: ReviewLogRecord[] = [];
  let previousInstant: number | null = null;
  for (const review of reviews) {
    const instant = Date.parse(review.timestamp);
    if (previousInstant !== null && instant - previousInstant > gapMs && isNonEmpty(current)) {
      clusters.push(current);
      current = [];
    }
    current.push(review);
    previousInstant = instant;
  }
  if (isNonEmpty(current)) clusters.push(current);

  const ledgers = clusters.map((cluster) => buildLedger(cluster, entries, misconceptionsByReview));
  return ledgers.slice().reverse();
}

function buildLedger(
  cluster: readonly [ReviewLogRecord, ...ReviewLogRecord[]],
  entries: readonly ReviewLogEntry[],
  misconceptionsByReview: ReadonlyMap<string, readonly string[]>,
): SessionLedger {
  const items: SessionLedgerItem[] = cluster.map((review) => ({
    eventId: review.eventId,
    timestamp: review.timestamp,
    instrumentId: review.instrumentId,
    instrumentType: review.instrumentType,
    conceptIds: review.conceptIds,
    rating: review.rating,
    wasUnsure: review.wasUnsure,
    review,
    misconceptionEventIds: misconceptionsByReview.get(review.eventId) ?? [],
  }));

  const opened = cluster[0];
  const closed = cluster[cluster.length - 1] ?? opened;
  const first = Date.parse(opened.timestamp);
  const last = Date.parse(closed.timestamp);
  const answered = new Set(items.map((item) => item.instrumentId));

  const related = entries.filter((entry) => {
    if (entry.kind === 'review') return false;
    const instant = Date.parse(entry.timestamp);
    if (instant < first || instant > last) return false;
    const instrumentId = ledgerInstrumentId(entry);
    return instrumentId !== null && answered.has(instrumentId);
  });

  return {
    startedAt: opened.timestamp,
    endedAt: closed.timestamp,
    items,
    related,
  };
}
