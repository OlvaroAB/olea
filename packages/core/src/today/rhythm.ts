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
 * Only the third of these has anywhere to come from today — there is no
 * extraction stage anywhere in this codebase that reads a term start date, a
 * term end date, a credit weight or an expected-weekly-hours figure, and no
 * settings surface that asks for the first two. Building those is real work
 * belonging to the extraction and settings lanes, not to this one.
 *
 * More importantly, **the clause never states the arithmetic that turns
 * tempo into a yardstick.** "The expectation comes from tempo" says what
 * feeds the calculation, not what the calculation is, and this register row
 * itself leaves the one constant it names ("how quiet is quiet enough to
 * mention") explicitly open: *"Declared if chosen in English; derived if
 * ever fitted. Decide that when it is chosen."* Inventing a formula that
 * folds credit weight and expected weekly hours into a day-count would be
 * fitting one on the spot, with no corpus and no ruling behind it — exactly
 * what N-015 exists to forbid. So this build implements only the form the
 * clause spells out **completely**, in its own worked example: *"nothing
 * from this course has arrived in three weeks"* — a flat, declared quiet
 * threshold, with no term-relative or tempo-relative adjustment. This is not
 * a corner cut; it is the reading F6.9 explicitly provides for: *"Absent
 * term dates degrade the reading to what is arriving, without a yardstick;
 * they never block it."* Every real course in the reference vault has no
 * term dates at all, so the degraded form is not a fallback path here — it
 * is the only path that will ever fire against real material.
 *
 * `resolveTermBoundary` and `TermWindow` exist so a term window can be
 * threaded through once one is ever asked for, and so the two scenarios
 * `features/F6-today.md` already commits to under this file's name
 * (`core/today/rhythm.spec`) are answerable now: recorded dates outrank the
 * ask, and an unresolved window never blocks the reading. Neither currently
 * changes `detectRhythm`'s verdict — that wiring is exactly the tempo
 * formula this doc declines to invent, and is future work for whoever picks
 * up the term-relative yardstick.
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
}

export interface RhythmCourseReading {
  readonly course: string;
  readonly status: RhythmStatus;
  /** Days between the last observed arrival and `today`. `null` only when `status` is `not-enough-history`. */
  readonly quietDays: number | null;
  /** Short, content-free — for tests and a workbench inspector. Never rendered to her, never logged. */
  readonly reason: string;
}

export interface RhythmMeasured {
  readonly courses: readonly RhythmCourseReading[];
  /**
   * The course whose quiet gap reached `QUIET_DAYS_THRESHOLD` by the widest
   * margin, or `null` when none did. Named explicitly per the course-naming
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
   * does not currently change the verdict, because no tempo-relative
   * yardstick is built yet.
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

function readCourse(course: RhythmCourseInput, today: CalendarDay): RhythmCourseReading {
  const { lastMaterialArrivalDay } = course;
  if (lastMaterialArrivalDay === null || !isCalendarDay(lastMaterialArrivalDay)) {
    return {
      course: course.course,
      status: 'not-enough-history',
      quietDays: null,
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
      reason: 'last-arrival day falls after today',
    };
  }

  if (quietDays >= QUIET_DAYS_THRESHOLD) {
    return {
      course: course.course,
      status: 'observed',
      quietDays,
      reason: `${quietDays} days since the last observed arrival reaches the ${QUIET_DAYS_THRESHOLD}-day quiet threshold`,
    };
  }
  return {
    course: course.course,
    status: 'not-observed',
    quietDays,
    reason: `${quietDays} days since the last observed arrival is below the ${QUIET_DAYS_THRESHOLD}-day quiet threshold`,
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

  let quietest: RhythmCourseReading | null = null;
  for (const reading of withHistory) {
    if (reading.status !== 'observed') continue;
    if (quietest === null || (reading.quietDays ?? 0) > (quietest.quietDays ?? 0)) {
      quietest = reading;
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
    reason: `${withHistory.length} course(s) with an observed arrival, none past the ${QUIET_DAYS_THRESHOLD}-day threshold`,
  };
}
