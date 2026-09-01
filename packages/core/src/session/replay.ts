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
 * `compareByInstantThenEventId`, imported from `../review-log/merge.ts` rather
 * than kept as a private copy here (`ol-2jod.15`) — that module owns the ruled
 * total order (`ol-egov.20`: `(instant, deviceId, eventId)`), and this is its
 * single-device projection: sound whenever every entry being compared shares
 * one device identity, which is exactly this module's situation. Replay never
 * sees a `deviceId` — it is handed either a single device's own entries, or an
 * array some caller (a merge across devices) already folded into one ordered
 * whole — so there is no third device identity left to distinguish by the time
 * entries reach here, and the projection is provably the same order the full
 * comparator would give (see `merge.spec.ts` and the "shares merge.ts's order"
 * describe block in this module's own spec). Entries reach a caller from
 * several devices' files in whatever order it read them, and FSRS is
 * emphatically order-dependent — replaying yesterday's Again after today's
 * Good produces a different state. Sorting here rather than trusting the
 * caller is what makes the projection the same on the phone and the laptop.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { compareByInstantThenEventId } from '../review-log/merge.js';
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
  const ordered = [...entries].sort(compareByInstantThenEventId);
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

/**
 * One scheduling observation (`[D-083]`/`[D-087]`, F5.3a, knowledge model R7)
 * still live for its neighbour concept — the consumer half `ol-0r92.11`
 * builds. "The scheduler reads the field" (knowledge model :623-625) means
 * exactly this: a scheduler-side reader, never the mastery fold, and never a
 * second scoring target (C5.11) — nothing here touches `neighbourConceptId`'s
 * stage or vitality, only whether an already-authorised offer is proposed.
 */
export interface UnconsumedSchedulingObservation {
  /** The concept the reciprocal explain-back offer would be about — never scored by this observation (C5.11). */
  readonly neighbourConceptId: string;
  /** The explain-back review's own subject concept(s) — X in "explain X, including how it relates to Y". */
  readonly subjectConceptIds: readonly string[];
  /** The `eventId` of the review that recorded this observation. */
  readonly sourceEventId: string;
  /** ISO-8601 timestamp of that review. */
  readonly observedAt: string;
}

/**
 * Which scheduling observations are still live, replayed from the log in
 * order (`[D-083]`/`[D-087]`).
 *
 * **"Unconsumed" is decided by a LATER graded explain-back review of the
 * neighbour concept itself** — the reciprocal prompt F5.3a names actually
 * being taken — never by an ordinary review of that concept. An ordinary
 * review is what F5.3a's offer is triggered FROM (`scheduling-observation-
 * routing.ts`'s decision reads the SAME neighbour concept id against this
 * map at that moment), so treating it as consumption would race the trigger
 * against its own cause and the offer would never fire. Only the most
 * recent observation per neighbour concept is kept, the same "most recent
 * wins" chronological resolution GLOSSARY already uses for depth — a fresh
 * observation on a concept whose earlier one was never acted on simply
 * replaces it rather than stacking.
 *
 * Pure, over entries a caller already holds — same posture as
 * `replaySchedulerStates` above, and the same total order
 * (`compareByInstantThenEventId`) so a caller never needs to sort twice.
 */
export function replayUnconsumedSchedulingObservations(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, UnconsumedSchedulingObservation> {
  const ordered = [...entries].sort(compareByInstantThenEventId);
  const live = new Map<string, UnconsumedSchedulingObservation>();

  for (const entry of ordered) {
    if (entry.kind !== 'review') continue;

    // A completed reciprocal explain-back on THIS concept consumes whatever
    // observation was waiting for it — checked before this entry might also
    // (in principle) carry its own fresh observation below, so a record can
    // both consume one relation and open another in the same pass.
    if (entry.instrumentType === 'explain-back') {
      for (const conceptId of entry.conceptIds) live.delete(conceptId);
    }

    if (entry.schedulingObservation !== undefined) {
      const { neighbourConceptId } = entry.schedulingObservation;
      live.set(neighbourConceptId, {
        neighbourConceptId,
        subjectConceptIds: entry.conceptIds,
        sourceEventId: entry.eventId,
        observedAt: entry.timestamp,
      });
    }
  }

  return live;
}
