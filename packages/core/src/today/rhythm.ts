/**
 * F6.9 — the rhythm reading: is material arriving? (component register row
 * 4.4, `RHY-2`.) Nothing here existed before this bead (`ol-ggz3`) — the
 * register's own words for row 4.4 were "Nothing built."
 *
 * ## What this module deliberately does NOT build, and why
 *
 * The clause names three inputs "to be computable at all": term start and
 * end (asked once, her own recorded dates outranking the ask); **tempo** —
 * credit weight and expected weekly hours — as "an internal yardstick, never
 * a displayed figure"; and a per-course last-material-arrival timestamp.
 * Two of the three still have nowhere real to come from: there is no
 * extraction stage anywhere in this codebase that reads a term start date, a
 * term end date or a credit-weight/expected-weekly-hours figure, and no
 * settings surface asks for the term dates either (that remains
 * `ol-0r92.6`'s scope). Building those is real work belonging to the
 * extraction and settings lanes, not to this one.
 *
 * **Tempo's SOURCE is no longer one of the absent two.** `[D-155]`
 * (`ol-egov.55`, ruled 2026-08-31) closed the question of where a tempo
 * value comes from during v0.9: a flat declared default, in place of an
 * ask-once field or a document-extraction claim the reference vault does not
 * support — the same posture the sibling allocation module already
 * implements (`src/plan/allocation.ts`'s `DECLARED_FLAT_TEMPO_WEIGHT`, in
 * the service repo; no import path crosses the two repos, so the value and
 * its defence are restated here, not shared). `ol-v7r5.8` wires that same
 * input into this module below — `DECLARED_FLAT_TEMPO_WEIGHT` and
 * `RhythmCourseInput.tempoWeight` — as a per-course scale on
 * `QUIET_DAYS_THRESHOLD`, with no new student-visible surface and no clause
 * change (`[D-155]` rules both out).
 *
 * **This is deliberately NOT the clause's full term-relative yardstick.**
 * The clause never states the arithmetic that turns *term dates and tempo
 * together* into a displayed expectation, and that gap has not closed:
 * inventing a formula that folds credit weight, expected weekly hours *and*
 * a term window into a day-count would still be fitting one on the spot,
 * with no corpus and no ruling behind it — exactly what N-015 forbids, and
 * term dates still have no source to feed it. What changed is narrower: with
 * a source now ruled for tempo alone, this module scales its own existing
 * flat threshold by that one input, in isolation, using the same
 * plain-English, declared-not-fitted posture the rest of this module's
 * constants use. At `DECLARED_FLAT_TEMPO_WEIGHT` (every course, until a real
 * per-course value exists), the scale is a no-op and every course's
 * threshold is still exactly `QUIET_DAYS_THRESHOLD` — this build changes
 * nothing observable for the vault as it exists today; the seam exists so a
 * later per-course tempo value takes effect without a second wiring pass.
 * This build still implements only the flat-threshold form of the clause's
 * worked example — *"nothing from this course has arrived in three
 * weeks"* — never a term-relative or fitted tempo-relative one. Every real
 * course in the reference vault has no term dates at all, so the degraded
 * form is not a fallback path here — it is the only path that will ever
 * fire against real material.
 *
 * `resolveTermBoundary` and `TermWindow` exist so a term window can be
 * threaded through once one is ever asked for, and so the two scenarios
 * `features/F6-today.md` already commits to under this file's name
 * (`core/today/rhythm.spec`) are answerable now: recorded dates outrank the
 * ask, and an unresolved window never blocks the reading. Neither currently
 * changes `detectRhythm`'s verdict — that wiring is still future work for
 * whoever picks up the term-relative yardstick, unaffected by the tempo
 * wiring above (a term window and a tempo weight are two different inputs;
 * only the second has a source today).
 *
 * ## The three-way status, same discipline as F6.5
 *
 * `not-enough-history` (no arrival was ever observed for a course — the
 * reading cannot say anything about a course it has never seen material
 * from) is not a negative result, exactly as `insights/types.ts` states for
 * spacing and effort: *"I have never seen this course" and "I have seen it,
 * and it has gone quiet"* are different claims, and only a three-way status
 * keeps them apart.
 *
 * ## What this never says (F6.9's forbidden list)
 *
 * No streak, no effort score, no hours total, no completion figure, and
 * nothing phrased as "behind" or "ahead" — this module states a day count
 * since the last arrival and nothing else. The sentence itself is not built
 * here: exactly like `insights/index.ts`'s split with `plugin/today/copy.ts`,
 * this module decides only what is true, never what to say.
 */

import { type CalendarDay, isCalendarDay } from './calendar-day.js';

/**
 * "How quiet is quiet enough to mention" — the one constant the register
 * names for this row. **Declared**, chosen in the plain English of F6.9's
 * own worked example ("three weeks"), not fitted to any corpus: there is no
 * real-vault rhythm corpus to fit it against, and the register is explicit
 * that a fitted version of this constant would need its own ruling before it
 * could be called derived. Twenty-one days is a calendar unit a student
 * plans around the same way `PRE_ASSESSMENT_WINDOW_DAYS` (`../insights/
 * spacing.js`) is a week rather than a swept number.
 *
 * REVERSIBILITY: a parameter, not a schema — nothing is persisted, and nudging
 * this affects only which day a reading crosses over on.
 */
export const QUIET_DAYS_THRESHOLD = 21;

/**
 * DECLARED, per `[D-155]` (`ol-egov.55`, ruled 2026-08-31). Every course gets
 * the same tempo weight until a real per-course value exists — option (c) of
 * that decision's three surveyed candidates, adopted because it needs no new
 * ask-once surface and no unsupported document-extraction claim (round 34
 * found tempo readable in only 1 of 21 course-document PDFs against the
 * reference vault). Restated from `src/plan/allocation.ts`'s constant of the
 * same name in the service repo — no import path crosses the two repos, so
 * the value and its provenance travel by comment, not by code.
 *
 * At this flat default, `effectiveQuietDaysThreshold` below returns
 * `QUIET_DAYS_THRESHOLD` unchanged for every course — the tempo input does
 * not yet discriminate between courses, the same accepted consequence
 * `DECLARED_FLAT_TEMPO_WEIGHT`'s allocation.ts twin states for its own
 * formula. **Revisit only if the still-open tempo-to-yardstick arithmetic
 * design shows per-course tempo variance is load-bearing** — `[D-155]`'s own
 * revisit condition — or a real per-course tempo value becomes available
 * (`RhythmCourseInput.tempoWeight` overrides this default per course when
 * supplied).
 *
 * @provenance declared — `[D-155]` (ruled 2026-08-31): a flat tempo default,
 * option (c) of three surveyed candidates, adopted because no defensible
 * extraction or ask-once source exists yet. Not fitted against a corpus,
 * vault snapshot or simulation.
 */
export const DECLARED_FLAT_TEMPO_WEIGHT = 1;

/**
 * DECLARED. Floor under a supplied `tempoWeight` before it is used as a
 * threshold divisor, so a caller passing zero (or a negative value, which is
 * a bug upstream rather than a real signal) cannot produce an infinite or
 * negative quiet threshold. Same defensive posture as
 * `MIN_DAYS_FOR_PROXIMITY_DIVISOR` in `src/plan/allocation.ts` (service
 * repo): a guard against a malformed input, not a claim about a realistic
 * tempo value. A tenth of the flat default is comfortably below any tempo
 * weight this module expects to see supplied.
 *
 * @provenance declared — a defensive divisor floor, argued in plain English
 * above; not fitted against a corpus, vault snapshot or simulation.
 */
export const MIN_TEMPO_WEIGHT_FOR_THRESHOLD_DIVISOR = 0.1;

export type RhythmStatus = 'observed' | 'not-observed' | 'not-enough-history';

/**
 * A term's boundary, in her own local calendar days. Asked once per F6.9;
 * this module never asks — it only resolves precedence between a recorded
 * value and one she was asked for and gave.
 */
export interface TermWindow {
  readonly start: CalendarDay;
  readonly end: CalendarDay;
}

/**
 * F6.9's "her own recorded dates outrank the ask" rule, made a pure function
 * so it is testable without any settings UI: a term window recorded
 * somewhere in her vault wins over an answer she gave when asked, and
 * either may be absent. This is the whole of what "asked once" means from
 * this module's side — deciding *whether* and *when* to show the ask is a
 * UI/settings concern (`F7.2`) this module does not own.
 */
export function resolveTermBoundary(input: {
  readonly recorded: TermWindow | null;
  readonly asked: TermWindow | null;
}): TermWindow | null {
  return input.recorded ?? input.asked ?? null;
}

export interface RhythmCourseInput {
  readonly course: string;
  /**
   * The most recent local calendar day material Olea built from this course
   * arrived, or `null` when no arrival has ever been observed for it. A
   * course that has never produced an observed arrival cannot be read as
   * "quiet" — quiet is a gap since something, and there is nothing to
   * measure the gap from.
   */
  readonly lastMaterialArrivalDay: CalendarDay | null;
  /**
   * Credit weight / expected-weekly-hours tempo signal, normalised so the
   * course-average is 1 — the same normalisation
   * `CourseAllocationInput.tempoWeight` documents in `src/plan/
   * allocation.ts` (service repo). Defaults to `DECLARED_FLAT_TEMPO_WEIGHT`
   * when omitted; see that constant's doc. Scales this course's own quiet
   * threshold (`effectiveQuietDaysThreshold`) — does not change any other
   * arithmetic in this module, and does not itself constitute the clause's
   * term-relative yardstick (see the module doc).
   */
  readonly tempoWeight?: number;
}

export interface RhythmCourseReading {
  readonly course: string;
  readonly status: RhythmStatus;
  /** Days between the last observed arrival and `today`. `null` only when `status` is `not-enough-history`. */
  readonly quietDays: number | null;
  /**
   * This course's own quiet threshold, in days — `QUIET_DAYS_THRESHOLD`
   * scaled by its `tempoWeight` (`effectiveQuietDaysThreshold`). Equal to
   * `QUIET_DAYS_THRESHOLD` whenever `tempoWeight` was omitted or equals
   * `DECLARED_FLAT_TEMPO_WEIGHT`. Always populated, even for
   * `not-enough-history`, since it is a property of the course's input, not
   * of whether a gap could be measured.
   */
  readonly quietDaysThreshold: number;
  /** Short, content-free — for tests and a workbench inspector. Never rendered to her, never logged. */
  readonly reason: string;
}

export interface RhythmMeasured {
  readonly courses: readonly RhythmCourseReading[];
  /**
   * The course whose quiet gap reached ITS OWN quiet threshold
   * (`RhythmCourseReading.quietDaysThreshold`) by the widest margin, or
   * `null` when none did. Compared by margin, not by raw `quietDays`, so a
   * course with a longer (lighter-tempo) threshold cannot out-rank a course
   * that crossed its own, shorter bar by more — see
   * `effectiveQuietDaysThreshold`. Named explicitly per the course-naming
   * rule (`../insights/index.js`, ARC-1): this reading's truth is about ONE
   * course's arrivals, never an aggregate across her running courses, so a
   * caller has no way to reach a quiet finding without also holding the
   * course it is about.
   */
  readonly quietestCourse: string | null;
  /** `0` when no course reached the threshold. */
  readonly maxQuietDays: number;
  /**
   * Whether a resolved term window was supplied when this was computed.
   * Carried for a caller's own bookkeeping only — see this module's doc: it
   * does not currently change the verdict, because no term-relative
   * yardstick is built yet (term dates still have no source; unaffected by
   * tempo's own wiring below).
   */
  readonly hadTermWindow: boolean;
}

export interface RhythmInsight {
  readonly id: 'rhythm';
  readonly status: RhythmStatus;
  /** `null` only when `courses` was empty — nothing was there to read at all. */
  readonly measured: RhythmMeasured | null;
  readonly reason: string;
}

export interface RhythmInput {
  readonly today: CalendarDay;
  readonly courses: readonly RhythmCourseInput[];
  /** Resolved via `resolveTermBoundary`, or `null`/absent when none exists yet. Never required (F6.9). */
  readonly termWindow?: TermWindow | null;
}

function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/**
 * This course's quiet threshold, scaled by its tempo weight: a course
 * expected to produce material twice as often as the flat default (tempo
 * weight 2) reaches the same absolute silence at half the wait; a course
 * expected half as often (tempo weight 0.5) gets twice as long before the
 * same silence counts as quiet. At `DECLARED_FLAT_TEMPO_WEIGHT` — every
 * course, until a real per-course value exists — this returns
 * `QUIET_DAYS_THRESHOLD` unchanged; see that constant's doc for why the flat
 * default does not yet discriminate between courses.
 */
function effectiveQuietDaysThreshold(tempoWeight: number): number {
  const divisor = Math.max(tempoWeight, MIN_TEMPO_WEIGHT_FOR_THRESHOLD_DIVISOR);
  return QUIET_DAYS_THRESHOLD / divisor;
}

function readCourse(course: RhythmCourseInput, today: CalendarDay): RhythmCourseReading {
  const { lastMaterialArrivalDay } = course;
  const tempoWeight = course.tempoWeight ?? DECLARED_FLAT_TEMPO_WEIGHT;
  const quietDaysThreshold = effectiveQuietDaysThreshold(tempoWeight);

  if (lastMaterialArrivalDay === null || !isCalendarDay(lastMaterialArrivalDay)) {
    return {
      course: course.course,
      status: 'not-enough-history',
      quietDays: null,
      quietDaysThreshold,
      reason: 'no material arrival has ever been observed for this course',
    };
  }

  const quietDays = daysBetween(lastMaterialArrivalDay, today);
  if (quietDays < 0) {
    // A last-arrival day after "today" is bad input, not a signal — decline
    // rather than report a negative quiet gap.
    return {
      course: course.course,
      status: 'not-enough-history',
      quietDays: null,
      quietDaysThreshold,
      reason: 'last-arrival day falls after today',
    };
  }

  if (quietDays >= quietDaysThreshold) {
    return {
      course: course.course,
      status: 'observed',
      quietDays,
      quietDaysThreshold,
      reason: `${quietDays} days since the last observed arrival reaches this course's ${quietDaysThreshold}-day quiet threshold`,
    };
  }
  return {
    course: course.course,
    status: 'not-observed',
    quietDays,
    quietDaysThreshold,
    reason: `${quietDays} days since the last observed arrival is below this course's ${quietDaysThreshold}-day quiet threshold`,
  };
}

/**
 * Pure. Reads no clock — `today` is supplied, exactly like every other
 * `today/*` module — and writes nothing.
 *
 * One reading per course, plus a single top-level verdict naming the
 * quietest course that crossed the threshold (or none). A course this
 * module has never seen an arrival for contributes `not-enough-history` to
 * `measured.courses` but never blocks a verdict about the OTHER courses —
 * the same per-course independence `detectEffortImbalance` uses.
 */
export function detectRhythm(input: RhythmInput): RhythmInsight {
  if (input.courses.length === 0) {
    return {
      id: 'rhythm',
      status: 'not-enough-history',
      measured: null,
      reason: 'no courses were supplied',
    };
  }

  const courses = input.courses.map((course) => readCourse(course, input.today));
  const hadTermWindow = (input.termWindow ?? null) !== null;

  const withHistory = courses.filter((c) => c.status !== 'not-enough-history');
  if (withHistory.length === 0) {
    return {
      id: 'rhythm',
      status: 'not-enough-history',
      measured: { courses, quietestCourse: null, maxQuietDays: 0, hadTermWindow },
      reason: 'no course has an observed material arrival to measure a gap from',
    };
  }

  // Ranked by margin over EACH course's own threshold, not raw quietDays —
  // see `RhythmMeasured.quietestCourse`'s doc: a lighter-tempo course's
  // longer threshold must not let it out-rank a heavier-tempo course that
  // crossed its own, shorter bar by more.
  let quietest: RhythmCourseReading | null = null;
  let quietestMargin = Number.NEGATIVE_INFINITY;
  for (const reading of withHistory) {
    if (reading.status !== 'observed') continue;
    const margin = (reading.quietDays ?? 0) - reading.quietDaysThreshold;
    if (quietest === null || margin > quietestMargin) {
      quietest = reading;
      quietestMargin = margin;
    }
  }

  const measured: RhythmMeasured = {
    courses,
    quietestCourse: quietest?.course ?? null,
    maxQuietDays: quietest?.quietDays ?? 0,
    hadTermWindow,
  };

  if (quietest !== null) {
    return {
      id: 'rhythm',
      status: 'observed',
      measured,
      reason: `${quietest.course} reached ${quietest.quietDays} quiet days`,
    };
  }
  return {
    id: 'rhythm',
    status: 'not-observed',
    measured,
    reason: `${withHistory.length} course(s) with an observed arrival, none past its own quiet threshold`,
  };
}
