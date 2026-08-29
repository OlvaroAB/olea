/**
 * The freshness measure: is this week's expected material in yet? (RHY-3 §3,
 * `ol-hna1` — the last stage of the build chain `ol-4chx` -> `ol-r6s0` ->
 * `ol-hna1` -> `ol-at1a`.) Combines `./recurrence.ts`'s weekday pattern with a
 * caller-supplied "when did material for this course last land" fact to
 * produce the three resolvable per-course states from
 * `RHY-3-multicourse-composition.md` §2.0 — `arrived`,
 * `not-arrived-with-yardstick`, `not-arrived-no-yardstick`. The fourth state
 * there, "not in scope this week" (pre-start/archived), is explicitly left
 * unresolved by RHY-3 §7 and is not attempted here.
 *
 * **This module supplies only the expectation side of the comparison.**
 * RHY-3 §3: "this file does not redefine what counts as a note having
 * landed; it supplies the expectation side of the comparison, not the
 * observation side." `lastArrivalDay` is a caller-supplied fact per course —
 * the same split `./associate.ts` already draws for `knownCourseCodes`; this
 * module never itself decides what "arrived" means for a note.
 *
 * **Two ways a course reaches "not arrived," in order of confidence.**
 * (1) A session the calendar note itself records, dated after the last
 * arrival and past the grace margin — no extrapolation needed, the strongest
 * claim this signal can make (RHY-3 §4's "an actual date... with
 * confidence"). (2) Where the synced window has gone stale relative to
 * `today` (RHY-3 §1: the window does not reach "today" by design) and a
 * recurring weekday pattern is trusted, the most recent weekday occurrence
 * extrapolated past the window — a weaker claim, and RHY-3 §4 is explicit
 * the copy layer must never state it with the same confidence as (1). This
 * module marks which kind produced a reading via `basis` so a copy layer
 * downstream can honour that distinction; it does not itself choose wording.
 *
 * **The yardstick is never displayed** (F6.9) — `expectedSessionDate` is
 * carried for a copy layer and for tests/diagnostics only, exactly like
 * `../today/rhythm.ts`'s `quietDays`. This module decides only what is true,
 * never what to say.
 *
 * **Per-course, never per-note.** One course's reading never affects
 * another's — `computeScheduleFreshness` builds every course's reading
 * independently over the whole matched-event list, the same discipline
 * `./associate.ts` already applies one stage earlier.
 *
 * **Recompute-on-read, no caching** (RHY-3 §8 Class C stop 1). Pure
 * functions, no I/O.
 */

import type { CalendarDay } from '../today/calendar-day.js';
import { detectRecurrencePattern, mostRecentExpectedOccurrence } from './recurrence.js';
import type {
  AssociatedScheduleEvent,
  CourseFreshnessBasis,
  CourseFreshnessReading,
} from './types.js';

// Re-exported so the package barrel (`../index.ts`) can name the report
// shapes from this one module, per this bead's `owns` scope limiting the
// barrel to a single export statement — the same convention `./discover.ts`
// and `./associate.ts` already established for steps 1 and 2.
export type {
  CourseFreshnessBasis,
  CourseFreshnessReading,
  CourseFreshnessStatus,
} from './types.js';

/**
 * Minimum historical sessions a course must have among its matched calendar
 * events before its schedule counts as a yardstick at all (RHY-3 §3/§6/§7's
 * "trust threshold"). **Declared**: a single observed session cannot show a
 * course meets on a given day *reliably* — a guest lecture or a one-off
 * rescheduling looks identical to the start of a pattern from one data
 * point — so nothing about it should be asserted as an expectation yet; two
 * sessions is the minimum evidence of a repeat. This is exactly the "one
 * course just starting, nothing to compare against yet" case
 * `RHY-3-multicourse-composition.md` §2.1 (state D) already names and
 * expects to read as "no yardstick."
 */
export const MIN_HISTORICAL_SESSIONS_TO_TRUST = 2;

/**
 * Days of grace after an expected or observed session before "not yet
 * arrived" fires (RHY-3 §3's own worked example, verbatim). **Declared**: a
 * lecture note is often written up the same evening, sometimes not until the
 * next morning, before the material would otherwise read as missing — one
 * full day absorbs that without asserting a gap that same-evening writing
 * would already have closed.
 */
export const ARRIVAL_GRACE_DAYS = 1;

/**
 * How many weeks past the last synced session this module will still trust
 * a recurring weekday pattern enough to extrapolate forward (RHY-3 §6 row 5:
 * "extrapolate forward... up to a bound; beyond that bound, degrade... to
 * 'no yardstick' rather than assert a session date with no basis").
 * **Declared**: a month with no fresher sync is as consistent with a term
 * break or a stalled calendar integration as with a still-live weekly
 * pattern — past that horizon, continuing to extrapolate the old pattern is
 * closer to a guess than an inference, so the reading backs off rather than
 * naming a specific expected date it can no longer stand behind.
 */
export const EXTRAPOLATION_BOUND_WEEKS = 4;

function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

function latestOf(dates: readonly CalendarDay[]): CalendarDay {
  return dates.reduce((latest, date) => (date > latest ? date : latest));
}

function reading(
  courseCode: string,
  status: CourseFreshnessReading['status'],
  expectedSessionDate: CalendarDay | undefined,
  basis: CourseFreshnessBasis | undefined,
  reason: string,
): CourseFreshnessReading {
  return { courseCode, status, expectedSessionDate, basis, reason };
}

/**
 * The freshness reading for one course, given its matched calendar-event
 * dates (any order, may include duplicates), the last day material for it
 * was observed to arrive (`null` when never observed), and `today`. Pure —
 * reads only its arguments.
 */
export function computeCourseFreshness(
  courseCode: string,
  matchedDates: readonly CalendarDay[],
  lastArrivalDay: CalendarDay | null,
  today: CalendarDay,
): CourseFreshnessReading {
  if (matchedDates.length < MIN_HISTORICAL_SESSIONS_TO_TRUST) {
    return reading(
      courseCode,
      'not-arrived-no-yardstick',
      undefined,
      undefined,
      `${matchedDates.length} historical session(s) observed, below the ${MIN_HISTORICAL_SESSIONS_TO_TRUST}-session trust threshold`,
    );
  }

  // Step 1: a session the calendar note itself records, unmatched by any
  // arrival and past the grace margin — no extrapolation, the strongest
  // claim this signal can make (RHY-3 §4).
  const overdueObserved = matchedDates.filter(
    (date) =>
      (lastArrivalDay === null || date > lastArrivalDay) &&
      daysBetween(date, today) >= ARRIVAL_GRACE_DAYS,
  );
  if (overdueObserved.length > 0) {
    const expectedSessionDate = latestOf(overdueObserved);
    return reading(
      courseCode,
      'not-arrived-with-yardstick',
      expectedSessionDate,
      'observed',
      `a calendar-recorded session on ${expectedSessionDate} is unmatched by any arrival, past the ${ARRIVAL_GRACE_DAYS}-day grace margin`,
    );
  }

  // Step 2: the synced window may lag "today" (RHY-3 §1) — extrapolate past
  // it only where a recurring weekday pattern is trusted and the gap since
  // the last synced session is within the extrapolation bound.
  const pattern = detectRecurrencePattern(matchedDates);
  if (pattern === undefined || pattern.recurringWeekdays.length === 0) {
    return reading(
      courseCode,
      'arrived',
      undefined,
      undefined,
      'no calendar-recorded session is overdue, and no weekday recurs in a majority of observed weeks to extrapolate from',
    );
  }

  const daysSinceLastObserved = daysBetween(pattern.lastObservedDate, today);
  if (daysSinceLastObserved > EXTRAPOLATION_BOUND_WEEKS * 7) {
    return reading(
      courseCode,
      'not-arrived-no-yardstick',
      undefined,
      undefined,
      `the synced calendar window is ${daysSinceLastObserved} days stale, past the ${EXTRAPOLATION_BOUND_WEEKS}-week extrapolation bound — the recurring pattern is no longer trusted this far out`,
    );
  }

  const expected = mostRecentExpectedOccurrence(
    pattern.recurringWeekdays.map((slot) => slot.weekday),
    pattern.lastObservedDate,
    today,
  );
  if (
    expected !== undefined &&
    (lastArrivalDay === null || expected > lastArrivalDay) &&
    daysBetween(expected, today) >= ARRIVAL_GRACE_DAYS
  ) {
    return reading(
      courseCode,
      'not-arrived-with-yardstick',
      expected,
      'extrapolated',
      `a recurring weekday pattern extrapolates an expected session on ${expected}, past the synced window and unmatched by any arrival, past the ${ARRIVAL_GRACE_DAYS}-day grace margin`,
    );
  }

  return reading(
    courseCode,
    'arrived',
    undefined,
    undefined,
    'no calendar-recorded or extrapolated session is overdue',
  );
}

/**
 * The freshness reading for every course present in `matched` (RHY-3 §9's
 * per-course degradation — one course's reading never affects another's).
 * Courses absent from `matched` entirely (no calendar signal at all) produce
 * no reading here; per RHY-3 §5's table that degrades to "no yardstick" for
 * every such course, but naming the full expected roster to fill that gap in
 * is a caller's job — the same split `./associate.ts` draws for
 * `knownCourseCodes` — this function only ever reports on courses it has
 * calendar evidence for.
 */
export function computeScheduleFreshness(
  matched: readonly AssociatedScheduleEvent[],
  lastArrivalByCourse: ReadonlyMap<string, CalendarDay | null>,
  today: CalendarDay,
): readonly CourseFreshnessReading[] {
  const datesByCourse = new Map<string, CalendarDay[]>();
  for (const { event, courseCode } of matched) {
    const dates = datesByCourse.get(courseCode) ?? [];
    dates.push(event.date);
    datesByCourse.set(courseCode, dates);
  }

  const readings: CourseFreshnessReading[] = [];
  for (const [courseCode, dates] of datesByCourse) {
    const lastArrivalDay = lastArrivalByCourse.get(courseCode) ?? null;
    readings.push(computeCourseFreshness(courseCode, dates, lastArrivalDay, today));
  }
  return readings;
}
