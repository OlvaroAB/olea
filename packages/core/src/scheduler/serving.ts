/**
 * `[D-240]` item 2's serving rule — **the one implementation, for both
 * composers** (`ol-2zfj.71` [SESS-7], C5.6, F2.17).
 *
 * > **F2.17 (amended, `[D-240]` item 2, `ol-egov.130`).** Format preference
 * > (F4.8) may still prefer the assessment-matched instrument, but it may not
 * > defer a concept's recall-tier instrument once THAT instrument is overdue
 * > by its own scheduled interval. Past that bound the recall instrument takes
 * > the concept's slot and the matched kind is the one that reviews late.
 *
 * ## Why this module exists rather than the rule living in one composer
 *
 * There are two session composers in this package and both are production,
 * for the sessions she actually sits and for the session she plans:
 *
 *  - the **queue** path — `../queue/compose.ts`'s `composeQueue`, reached
 *    through `../session/build.ts`'s `buildReviewSession`, which is what the
 *    review tab and the Today panel compose the instruments she answers from;
 *  - the **study-session** path — `../study-session/compose.ts`'s
 *    `buildComposedStudySession` (via `../study-session/reentry.ts`'s
 *    `composeReentrySession`), which is what the session builder and the Home
 *    screen compose, and what the term harness replays.
 *
 * They compose different things — the queue answers *which due instruments
 * are offered, in what order*, over `QueueCandidate`s; the study-session layer
 * answers *which concepts fit a declared time budget*, over `GapRow`s, and
 * fills each row from the vault's instrument index. Neither is a wrapper of
 * the other and merging them is not this bead's change. But **the serving
 * rule they both apply is one rule**, and C5.7's "arbitration is C5.6's and
 * has no second home" is exactly the principle a second copy of it would
 * break: the pre-flight defect `ol-3ux7.5.57.14.21` diagnosed was the rule
 * running on one path and not the other, and two implementations would make
 * that recur silently the next time either is edited. So the rule lives here,
 * in neither composer, and both call it.
 *
 * ## The null state — a recall card never yet asked (`[D-240]` item 2, ratified)
 *
 * The bound is "overdue by its own interval", and an instrument that has never
 * been reviewed has no interval — which is precisely the population the
 * pre-flight found stuck: a concept whose recall card never once won a slot
 * against a preferred MCQ can never become overdue, so preference defers it
 * for ever. David ratified the reading on 2026-09-07 (`ol-egov.130`'s notes):
 * **a card never yet asked waits as long as the scheduler would make it wait
 * after a first good answer — its initial interval — and then the override
 * applies.** No new constant: {@link firstIntervalDaysAfterGood} reads that
 * number out of the real scheduler rather than restating it, so it stays the
 * scheduler's number if the scheduler's configuration ever changes.
 *
 * The wait is measured from the day the concept's material **arrived**
 * ({@link RecallServingCandidate.arrivalDay}, ARRIVE-1's `arrivalDays` map on
 * both composers' inputs) — the first day the instrument could have been
 * served at all. Absent an arrival day the wait is unknowable, and this
 * module answers `false`: the same "no-op absent `arrivalDays`" posture both
 * composers already take for that map, and the conservative direction, since
 * `false` leaves F2.17's un-amended preference rule in charge.
 */

import { daysBetween } from '../dates.js';
import type { SchedulableInstrumentType } from '../instrument/rating.js';
import { isRecallTier } from '../mastery/vitality.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { isCalendarDay } from '../today/calendar-day.js';
import { createFsrsScheduler } from './fsrs-scheduler.js';
import type { SchedulerState } from './types.js';

/**
 * Which serving rule a composer applies, selectable so `[D-240]` item 4's
 * three-arm sweep can replay each arm on the real composer:
 *
 *  - `'interval-bound'` (the default on both paths) — `[D-240]` item 2's
 *    amended rule, this module;
 *  - `'today'` — the pre-amendment behaviour, format preference unbounded;
 *  - `'preference-off'` — format preference ignored entirely, as if none were
 *    supplied, which makes the override moot for the same reason an empty
 *    preference does.
 *
 * `../queue/types.ts` re-exports this as `QueueServingPolicy`, its name on
 * that path since `[SESS-3]`; there is one definition and it is here.
 */
export type ServingPolicy = 'today' | 'interval-bound' | 'preference-off';

/**
 * `[D-240]` item 3 (`ol-egov.130`), pre-committed in
 * `findings/precommitment-dedupe-interval.md` (private repo; `[D-194]`
 * bucket two, bead `ol-egov.131` / `[SESS-5]`): the multiplier on a
 * recall-tier instrument's own interval past which format preference
 * (F2.17/F4.8) may no longer defer it.
 *
 * **Declared, not derived** (component register's line, `[BND-4]`/`[D-191]`):
 * defensible in one plain-English sentence — *"a deferral may cost at most
 * one more wait of the length the scheduler already chose for this item"* —
 * never fitted against a corpus, so it is safe to ship in this public client
 * package. It moves only on her lived outcomes, by the pre-commitment file's
 * own trigger/prediction/moved-enough terms, in a change that shows this
 * comment updated alongside it — never ad hoc.
 *
 * It multiplies the never-reviewed initial interval
 * ({@link firstIntervalDaysAfterGood}) exactly as it multiplies a reviewed
 * instrument's `scheduledDays`: one bound, one multiplier, two ways of
 * knowing the interval.
 *
 * Re-exported from `../queue/compose.ts` under the same name, which is where
 * `[SESS-3]` first declared it and where the harness and specs cite it from.
 */
export const DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER = 1;

/** Memoised — see {@link firstIntervalDaysAfterGood}. */
let cachedFirstIntervalDays: number | null = null;

/**
 * The interval, in whole days, the scheduler would assign an instrument on a
 * first **good** answer — the wait `[D-240]` item 2's ratified null-state
 * reading gives a recall card that has never been asked.
 *
 * **Read from the scheduler, never written down here.** It is
 * `createFsrsScheduler().schedule({ state: null, rating: 'good', ... })`'s own
 * `intervalDays`, so it is whatever FSRS-6 says under this package's
 * configuration (`enable_short_term: false`, fuzz off — see
 * `./fsrs-scheduler.ts`'s module doc) and it follows that configuration if it
 * ever changes. Both of those settings are what make it a constant at all:
 * with fuzz off the answer does not depend on the instant, and with
 * short-term steps off it resolves on the whole-day scale the rest of this
 * package works in. It is memoised for that reason and no other — this runs
 * once per candidate inside a composition loop.
 */
export function firstIntervalDaysAfterGood(): number {
  if (cachedFirstIntervalDays !== null) return cachedFirstIntervalDays;
  const { intervalDays } = createFsrsScheduler().schedule({
    instrumentId: 'olea:first-interval-probe',
    state: null,
    rating: 'good',
    // Any instant: fuzz is off, so the interval is a property of the
    // algorithm and not of the day it is asked on.
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  cachedFirstIntervalDays = intervalDays;
  return intervalDays;
}

/** What the rule needs to know about one instrument, on either composer's row shape. */
export interface RecallServingCandidate {
  readonly instrumentType: SchedulableInstrumentType;
  /** Its FSRS state, or `null` when it has never been reviewed. */
  readonly state: SchedulerState | null;
  /**
   * The day its concept's material arrived (ARRIVE-1), for the never-reviewed
   * branch only. `null`/omitted reads as "no signal" and never as day zero.
   */
  readonly arrivalDay?: CalendarDay | null;
}

/** `day` as the instant of its UTC midnight — `daysBetween` normalises to UTC midnight anyway, so this loses nothing. */
function startOfDay(day: CalendarDay): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Has this instrument waited the interval past which format preference may no
 * longer defer it?
 *
 * Two ways of knowing the interval, one bound:
 *
 *  - **reviewed** — `state.scheduledDays`, "the interval, in whole days, that
 *    produced `due` from `lastReview`" (`SchedulerState`'s own doc), and the
 *    lateness is measured from `due`, mirroring the composers' own `daysLate`
 *    arithmetic rather than restating it differently;
 *  - **never reviewed** — {@link firstIntervalDaysAfterGood}, and the wait is
 *    measured from the concept's arrival day (see the module doc).
 *
 * `false` for an instrument not yet due at all, and `false` when a
 * never-reviewed instrument has no arrival day to measure from.
 */
export function hasWaitedItsOwnInterval(candidate: RecallServingCandidate, now: Date): boolean {
  if (candidate.state === null) {
    const arrivalDay = candidate.arrivalDay ?? null;
    if (arrivalDay === null || !isCalendarDay(arrivalDay)) return false;
    const waitedDays = daysBetween(startOfDay(arrivalDay), now);
    if (waitedDays <= 0) return false;
    return waitedDays >= firstIntervalDaysAfterGood() * DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER;
  }
  const daysLate = daysBetween(new Date(candidate.state.due), now);
  if (daysLate <= 0) return false;
  return daysLate >= candidate.state.scheduledDays * DEDUPE_DEFERRAL_INTERVAL_MULTIPLIER;
}

/**
 * **The rule.** May this instrument no longer be deferred by format
 * preference — i.e. does it take its concept's session slot outright?
 *
 * True only when all four hold: the composer is running `[D-240]` item 2's
 * amended policy (`'interval-bound'`), a format preference is actually in
 * force to defer against (with none, both composers already fall back to
 * plain order and the amendment does not touch that), the instrument is
 * recall-tier (R3's filter, {@link isRecallTier}), and it has waited its own
 * interval ({@link hasWaitedItsOwnInterval}).
 *
 * Both composers call exactly this — `../queue/compose.ts`'s `dedupeRank`
 * and `../study-session/build.ts`'s `orderedForFormat` — and neither restates
 * any part of it.
 */
export function recallOutranksFormatPreference(
  candidate: RecallServingCandidate,
  now: Date,
  servingPolicy: ServingPolicy,
  formatPreferenceInForce: boolean,
): boolean {
  if (servingPolicy !== 'interval-bound') return false;
  if (!formatPreferenceInForce) return false;
  if (!isRecallTier(candidate.instrumentType)) return false;
  return hasWaitedItsOwnInterval(candidate, now);
}
