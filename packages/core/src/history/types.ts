/**
 * The History ledger's projection types (`[D-102]`, `ol-0r92.53`).
 *
 * `[D-102]` rules in an inspectable, **pull-based** history rendered from the
 * event log — three shapes: per-document, per-session, per-composition. This
 * module carries the types for the two that are a fold over the review log
 * (`.olea/reviews/*.jsonl`); nothing here reads a file, nothing here writes
 * one, and nothing here persists a new schema. Everything is derived at read
 * time from entries the caller already holds, the same split
 * `../review-log/verdicts.ts` and `../review-log/suspension.ts` use.
 *
 * **Two things are deliberately absent, and their absence is the design.**
 *
 * 1. **No totals, no percentages, no rates.** `[D-102]` forbids them on the
 *    per-session shape by name, and the cheapest way to keep a renderer
 *    honest is to give it nothing to render. There is no `correctCount`, no
 *    `accuracy`, no `itemsPerMinute` field anywhere below — a caller that
 *    wants one has to compute it itself, which makes it a visible choice
 *    rather than a field that was simply there.
 * 2. **No invented event.** Where the drawn shape
 *    (`olea-service/docs/design/pass7-home-and-history/`, Surface 2) names a
 *    line the log does not carry — document registration, concept detection,
 *    draft generation, a link offered into her own notes — this module emits
 *    nothing rather than guessing. The gaps are recorded on the decision bead
 *    that ratifies the clause, not papered over with a heuristic.
 *
 * **No contract clause defines a History surface yet.** These are read-only
 * projections with no view, no command and no registered surface behind them;
 * building one waits on the clause. INV-6 is untouched by construction — this
 * layer writes nothing, anywhere.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';

/**
 * Where an instrument lives, as the caller already knows it.
 *
 * The review log is keyed by `instrumentId` and carries **no document path**
 * — nothing in `olea-contracts`' `reviewLogEntry` union names a note. So the
 * per-document ledger cannot be a fold over the log alone; it is a fold over
 * the log **joined** to a location index the caller supplies, built from
 * `../session/enumerate.js`'s `VaultInstrumentRecord.notePath`. Passing the
 * index in rather than reading the vault here keeps this module pure and
 * keeps the join visible: an instrument absent from the index contributes no
 * rows to any document, and is reported (see `DocumentLedger.unlocated`)
 * instead of being silently dropped.
 */
export type InstrumentLocations = ReadonlyMap<string, string>;

/** One dated row of a document's history, carrying the source event verbatim. */
export interface DocumentLedgerRow {
  readonly eventId: string;
  /** ISO-8601 with offset, exactly as the log recorded it. Never reformatted here. */
  readonly timestamp: string;
  /**
   * The instrument this row is about — the join key into
   * `InstrumentLocations` — or `null` for a row the log attributes to the
   * document directly (a `retrospective-*` record's `assessmentPath`).
   */
  readonly instrumentId: string | null;
  /** The log entry itself, unmodified, so a renderer can say what actually happened. */
  readonly entry: ReviewLogEntry;
}

/** Everything the log can say about one note, newest first. */
export interface DocumentLedger {
  /** The note this ledger is about, as the caller named it. */
  readonly notePath: string;
  /**
   * Rows in **newest-first** order (the drawn shape's order), tie-broken by
   * descending `eventId` so two events sharing an instant order the same way
   * on every device rather than by whichever file was read first.
   */
  readonly rows: readonly DocumentLedgerRow[];
  /** Every instrument in this note the log has anything to say about, sorted. */
  readonly instrumentIds: readonly string[];
  /**
   * Instruments the log names that the location index could not place, sorted.
   *
   * Reported rather than dropped: an instrument whose note was renamed, or
   * whose enumeration failed, is a fact about the join, and a history that
   * silently omits it looks like a history where nothing happened.
   */
  readonly unlocated: readonly string[];
}

/** One answered item inside a session, in the order it was answered. */
export interface SessionLedgerItem {
  readonly eventId: string;
  readonly timestamp: string;
  readonly instrumentId: string;
  readonly instrumentType: ReviewLogRecord['instrumentType'];
  readonly conceptIds: readonly string[];
  /** The four-way rating, or `null` where the log recorded none. Never rendered as a score. */
  readonly rating: ReviewLogRecord['rating'];
  readonly wasUnsure: boolean;
  /** The review event itself, for anything a renderer needs that is not lifted above. */
  readonly review: ReviewLogRecord;
  /**
   * `misconception-observed` events whose `reviewEventId` is this item's —
   * the drawn shape's *"you picked the option matching a misconception noted
   * …"* line, resolved by the log's own back-reference rather than by
   * guessing from timing.
   */
  readonly misconceptionEventIds: readonly string[];
}

/**
 * One session, as the log can reconstruct it.
 *
 * **The log carries no session identity.** Nothing in `reviewLogEntry` has a
 * `sessionId`; a session is therefore *derived* here by clustering review
 * events on an inactivity gap the caller supplies. That is a real limitation,
 * not a rendering detail — two sessions run back to back read as one, and a
 * long pause inside one session splits it — and it is recorded on the
 * ratifying decision bead rather than fixed by inventing a persisted field.
 */
export interface SessionLedger {
  /** First item's timestamp, verbatim. */
  readonly startedAt: string;
  /** Last item's timestamp, verbatim. */
  readonly endedAt: string;
  /** Items in the order they were answered. No totals row, by construction. */
  readonly items: readonly SessionLedgerItem[];
  /**
   * Every non-review event that fell inside this session's span and names an
   * instrument the session answered — a contest raised mid-session, a
   * suspension, an explain-back offer. Kept as raw entries: what a renderer
   * says about each is the clause's business, not this fold's.
   */
  readonly related: readonly ReviewLogEntry[];
}
