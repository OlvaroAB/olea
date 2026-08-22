/**
 * Rebuilding scheduling state from the review log (R3, C5.2, F2.14, F2.16).
 *
 * Olea stores no scheduler state anywhere. Plan §7.1 makes the vault's review
 * log the local event source, and `SchedulerState` is a *derived* value: replay
 * an instrument's rated reviews through the `Scheduler` port in order and you
 * have its current state. That is the same design as the suspended set
 * (`review-log/suspension.ts`) and it buys the same three things — a projection
 * that cannot drift from the history that produced it, a device that was
 * offline catching up by merging files rather than reconciling state, and a
 * corrupted projection costing nothing, because there was never anything to
 * corrupt.
 *
 * It works only because `Scheduler` implementations are required to be pure
 * functions of `(instrumentId, state, rating, now)` — `scheduler/types.ts` says
 * so, and names "a full replay of a review log to rebuild state from scratch"
 * as the reason. This module is that caller.
 *
 * ## Pure, over entries someone else read
 *
 * No `VaultSource`, no path, no clock. The I/O is `./history.ts`, one thin
 * function away, so this one is testable against a literal array and so a
 * caller that already holds the log (the workbench, a merge across devices)
 * does not read it twice.
 *
 * ## What never enters
 *
 *   - **Suspension events.** Suspending does not move a schedule (F2.6:
 *     unsuspending returns the item exactly as it was). They are skipped, not
 *     "applied as a no-op".
 *   - **Explain-back attempts.** Not FSRS-scheduled (F2.14), and they carry
 *     `rating: null` by construction (`instrument/rating.ts`). Both are checked
 *     — the type and the value — because either alone would be a single point
 *     of failure for a rule the whole R7 ordering rests on.
 *   - **Any review whose rating is null.** The frozen record allows it so that
 *     a real bug stays loggable (`olea-contracts`' own note); a null rating is
 *     not something to feed a scheduler.
 *
 * ## Order is (timestamp, eventId), not array order
 *
 * The same total order `mergeReviewLogRecords` sorts by and `suspension.ts`
 * resolves by. Entries reach a caller from several devices' files in whatever
 * order it read them, and FSRS is emphatically order-dependent — replaying
 * yesterday's Again after today's Good produces a different state. Sorting here
 * rather than trusting the caller is what makes the projection the same on the
 * phone and the laptop.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';

/**
 * One instrument's replayed state and how it got there. Returned alongside the
 * state because "never reviewed" and "reviewed and back to nothing" are
 * different claims, and a count is how a caller tells them apart without
 * re-walking the log.
 */
export interface ReplayedInstrument {
  readonly instrumentId: string;
  readonly state: SchedulerState;
  /** Rated reviews that contributed. Always ≥ 1 — an instrument with none has no entry at all. */
  readonly reviewCount: number;
  /** ISO-8601 timestamp of the last rated review replayed. */
  readonly lastReviewedAt: string;
}

export interface ReplayResult {
  /** `instrumentId` -> replayed state. An instrument that was never rated is **absent**, never present with a zeroed state. */
  readonly states: ReadonlyMap<string, ReplayedInstrument>;
  /** Rated reviews actually replayed, across every instrument. Diagnostics. */
  readonly replayedCount: number;
  /** Entries skipped because they are not a rated review — suspensions, explain-backs, null ratings. */
  readonly skippedCount: number;
}

/** The total order every projection over this log uses. See the module doc. */
function byInstantThenEventId(a: ReviewLogEntry, b: ReviewLogEntry): number {
  const instantA = Date.parse(a.timestamp);
  const instantB = Date.parse(b.timestamp);
  if (instantA !== instantB) return instantA - instantB;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

/**
 * Folds review-log entries into current scheduling state, one instrument at a
 * time.
 *
 * Pure: same entries and same `Scheduler`, same result, always. It reads no
 * clock — every `now` handed to the scheduler is the timestamp the entry
 * carries, which is what makes replaying a two-month-old session produce the
 * state it produced then rather than the state today would give it.
 */
export function replaySchedulerStates(
  entries: readonly ReviewLogEntry[],
  scheduler: Scheduler,
): ReplayResult {
  const ordered = [...entries].sort(byInstantThenEventId);
  const states = new Map<string, ReplayedInstrument>();
  let replayedCount = 0;
  let skippedCount = 0;

  for (const entry of ordered) {
    if (entry.kind !== 'review') {
      skippedCount += 1;
      continue;
    }
    // Two guards, one rule (F2.14/F2.16). The type says explain-back is not
    // schedulable; the null says this event produced no rating. Either alone
    // would be a single point of failure for the rule R7's whole ordering rests
    // on, so both are checked.
    if (entry.instrumentType === 'explain-back' || entry.rating === null) {
      skippedCount += 1;
      continue;
    }

    const prior = states.get(entry.instrumentId);
    const output = scheduler.schedule({
      instrumentId: entry.instrumentId,
      state: prior?.state ?? null,
      rating: entry.rating,
      now: new Date(Date.parse(entry.timestamp)),
    });
    states.set(entry.instrumentId, {
      instrumentId: entry.instrumentId,
      state: output.state,
      reviewCount: (prior?.reviewCount ?? 0) + 1,
      lastReviewedAt: entry.timestamp,
    });
    replayedCount += 1;
  }

  return { states, replayedCount, skippedCount };
}

/**
 * `QueueCandidate.state`'s value for one instrument: its replayed state, or
 * `null` for the first-exposure case.
 *
 * One line, exported, because "absent from the map" and "never reviewed" being
 * the same fact is the kind of thing that gets re-derived slightly differently
 * in three places otherwise.
 */
export function replayedStateOf(result: ReplayResult, instrumentId: string): SchedulerState | null {
  return result.states.get(instrumentId)?.state ?? null;
}
