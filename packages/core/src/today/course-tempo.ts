/**
 * A per-course tempo PRODUCER (row 4.4's remaining gap, `ol-v7r5.56`). NOT
 * wired into `detectRhythm` or `RhythmCourseInput.tempoWeight` by this file
 * — wiring the schedule to consume this instead of `DECLARED_FLAT_TEMPO_WEIGHT`
 * changes what she sees on every course simultaneously and is therefore a
 * Class C question left to a decision bead (see `ol-v7r5.56`'s report). This
 * module only proves a producer CAN exist without a model call.
 *
 * ## Why this is not the extraction path `[D-155]` already rejected
 *
 * `[D-155]` (`ol-egov.55`) ruled out reading an explicit tempo figure (credit
 * weight, expected weekly hours) out of course-document TEXT: checked against
 * the reference vault, only 1 of 21 course-document PDFs carried a matching
 * figure and 0 of the plain-text notes did — exactly the "fitting without a
 * corpus" mistake N-015 forbids. This module never reads document text and
 * never claims a credit-weight or hours figure. It reads only DATES two kinds
 * of course fact already carry once core has produced them elsewhere — a
 * course's own registered assessment due dates (F1.1's `AssessmentRecord`,
 * `../assessment/read.ts`) and a course's own document-arrival dates (already
 * tracked per course, e.g. `../history/document-ledger.ts`'s per-note rows or
 * the plugin's material-arrival store) — and turns their SPACING into a
 * relative pace signal. No text is parsed by this file; no model is called.
 *
 * Deliberately decoupled from both source modules' own types (a plain
 * `readonly CalendarDay[]` per course, not `AssessmentRecord[]` or a queue
 * type) — the same "no shared type across the boundary" posture `rhythm.ts`'s
 * own module doc uses for `DECLARED_FLAT_TEMPO_WEIGHT` and its
 * `allocation.ts` twin: a caller assembles the two date lists from whichever
 * producer it already has, and this module never needs to import CHG's queue
 * types or the assessment reader's report shape to stay correct.
 *
 * ## The arithmetic, and why every number here is DECLARED, not derived
 *
 * A course's own CADENCE is the average number of days between its own
 * distinct known dates (assessment due dates ∪ document-arrival dates,
 * deduped, sorted): `(latest - earliest) / (count - 1)`. A course producing
 * dated facts more often than the group average gets a tempo weight above 1;
 * one producing them less often gets a weight below 1 — the same "course
 * average is 1" normalisation `RhythmCourseInput.tempoWeight`'s own doc
 * states, computed here from the actual set of courses supplied rather than
 * assumed. Plain-English arithmetic, no coefficient tuned against any corpus
 * or simulation — there is no real-vault tempo corpus to fit one against, the
 * same posture `QUIET_DAYS_THRESHOLD` and `DECLARED_FLAT_TEMPO_WEIGHT`
 * themselves take (see `rhythm.ts`). Nothing here is a derived (fitted)
 * constant; both constants below are declared guards, defended in plain
 * English at their own definitions.
 *
 * A course with fewer than two distinct dated facts (or a set with no course
 * meeting that bar at all) has no cadence to measure and falls back to
 * `DECLARED_FLAT_TEMPO_WEIGHT` — the same declared interim `[D-155]` adopted,
 * never a fabricated pace.
 */

import { isCalendarDay, type CalendarDay } from './calendar-day.js';
import { DECLARED_FLAT_TEMPO_WEIGHT } from './rhythm.js';

/**
 * DECLARED. A floor under a course's own computed cadence before it is used
 * as a divisor. With `CalendarDay` (whole-day) granularity and the distinct-
 * date dedup `cadenceDaysOf` already applies, `n` distinct days can never
 * span fewer than `n - 1` days, so the raw cadence can never actually fall
 * below 1 — this floor cannot bind against today's day-granularity inputs
 * and is kept only as an explicit, documented guard against a future input
 * with finer-than-day timestamps (a same-instant coincidence would otherwise
 * produce a zero cadence and an unbounded tempo weight). Argued in plain
 * English above; not fitted against a corpus, vault snapshot or simulation.
 *
 * @provenance declared
 */
export const MIN_CADENCE_DAYS_FOR_TEMPO_DIVISOR = 1;

/**
 * DECLARED. Below this many courses with a usable cadence in one call, a
 * group average would be measuring noise from a single course rather than a
 * real relative pace — so the whole set falls back to the flat declared
 * interim instead of normalising against itself. Two is the minimum for
 * "relative to the others" to mean anything at all. Not fitted.
 *
 * @provenance declared
 */
export const MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO = 2;

/** Basis this course's tempo reading was computed on — never hidden inside the number itself. */
export type CourseTempoBasis =
  | 'derived-from-cadence'
  | 'declared-fallback-insufficient-course-facts'
  | 'declared-fallback-insufficient-group-facts';

/**
 * The dated facts about ONE course's own documents that this module reads —
 * however many of each are already known; never fabricated, never read from
 * document text. Both may be empty; a course this module has no dates for at
 * all reads as insufficient, never as a zero pace.
 */
export interface CourseDocumentFacts {
  readonly course: string;
  /**
   * This course's own assessment calendar (F1.1) — due dates already read
   * elsewhere in core for THIS course, in whatever order the caller has
   * them. Empty when none are registered yet.
   */
  readonly assessmentDueDays: readonly CalendarDay[];
  /**
   * Dates already known in core that a document reached this course —
   * however many arrivals are already tracked for it. Empty when none.
   */
  readonly documentArrivalDays: readonly CalendarDay[];
}

export interface CourseTempoReading {
  readonly course: string;
  /** Feeds straight into `RhythmCourseInput.tempoWeight` (`./rhythm.js`); never itself displayed. */
  readonly tempoWeight: number;
  readonly basis: CourseTempoBasis;
  /** Content-free — for tests and a workbench inspector, per the same posture as `RhythmCourseReading.reason`. */
  readonly reason: string;
}

function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

function distinctSortedDays(facts: CourseDocumentFacts): readonly CalendarDay[] {
  const all = [...facts.assessmentDueDays, ...facts.documentArrivalDays].filter(isCalendarDay);
  return [...new Set(all)].sort();
}

/**
 * This course's own cadence in days (average gap between its distinct known
 * dates), or `null` when fewer than two distinct dates are known — there is
 * no gap to measure from one date or none.
 */
function cadenceDaysOf(facts: CourseDocumentFacts): number | null {
  const days = distinctSortedDays(facts);
  if (days.length < 2) return null;
  const span = daysBetween(days[0] as CalendarDay, days[days.length - 1] as CalendarDay);
  return Math.max(span / (days.length - 1), MIN_CADENCE_DAYS_FOR_TEMPO_DIVISOR);
}

/**
 * Pure. One reading per course supplied, in input order. Reads no clock and
 * no vault — every date arrives already resolved by the caller — and calls
 * no model.
 *
 * A course's tempo weight is its own cadence relative to the GROUP's mean
 * cadence (courses with a usable cadence only), so the group's own average
 * tempo is 1 — matching `RhythmCourseInput.tempoWeight`'s documented
 * normalisation. A course below the two-distinct-date floor, or a whole set
 * with fewer than `MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO` such courses,
 * falls back to `DECLARED_FLAT_TEMPO_WEIGHT` rather than a fabricated pace.
 */
export function deriveCourseTempo(
  courses: readonly CourseDocumentFacts[],
): readonly CourseTempoReading[] {
  const cadenceByCourse = new Map<string, number | null>();
  for (const facts of courses) cadenceByCourse.set(facts.course, cadenceDaysOf(facts));

  const usableCadences = [...cadenceByCourse.values()].filter(
    (c): c is number => c !== null,
  );

  if (usableCadences.length < MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO) {
    return courses.map((facts) => ({
      course: facts.course,
      tempoWeight: DECLARED_FLAT_TEMPO_WEIGHT,
      basis: 'declared-fallback-insufficient-group-facts',
      reason:
        `fewer than ${MIN_COURSES_WITH_CADENCE_FOR_RELATIVE_TEMPO} course(s) in this set have ` +
        'two or more distinct dated facts, so no relative pace can be measured',
    }));
  }

  const meanCadence = usableCadences.reduce((sum, c) => sum + c, 0) / usableCadences.length;

  return courses.map((facts) => {
    const cadence = cadenceByCourse.get(facts.course) ?? null;
    if (cadence === null) {
      return {
        course: facts.course,
        tempoWeight: DECLARED_FLAT_TEMPO_WEIGHT,
        basis: 'declared-fallback-insufficient-course-facts',
        reason: 'fewer than two distinct dated facts are known for this course',
      };
    }
    return {
      course: facts.course,
      tempoWeight: meanCadence / cadence,
      basis: 'derived-from-cadence',
      reason: `${cadence.toFixed(2)}-day average cadence against the group's ${meanCadence.toFixed(2)}-day mean`,
    };
  });
}
