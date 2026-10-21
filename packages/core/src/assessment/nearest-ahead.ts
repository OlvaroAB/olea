/**
 * The one home of "the assessment whose format applies" (`ol-egov.141.89.105.15`, `[D-551]`).
 *
 * Per course, from the nearest assessment not yet passed, as of a calendar day. Two readers
 * answer the same question and now share this function: the plugin's sweep register
 * (`generation/format-match.ts`, `nearestUpcomingAssessment`) and the session composer's
 * format preference (`../study-session/build.ts`, F2.17/F4.8). The gap view keeps its own
 * reading (the assessment contributing most to a concept's score) and does not use this.
 *
 * Semantics, unchanged from both readers before they met here: only a record whose `due` is a
 * readable calendar day counts; an assessment due `asOf` itself is not yet passed; the soonest
 * wins; two due the same day resolve to the lexically-smaller `path`, so the answer never
 * depends on read order; `status` is never consulted (her free text). `null` when no record
 * qualifies. What a caller does then (the session names its top row's target) stays with the
 * caller; this function never guesses.
 */

import { daysBetween } from '../dates.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { isCalendarDay } from '../today/calendar-day.js';
import type { AssessmentRecord } from './types.js';

export interface NearestAssessmentAhead {
  readonly record: AssessmentRecord;
  /** Whole calendar days from `asOf` to `record.due`; 0 for one due today, never negative. */
  readonly daysUntil: number;
}

/**
 * The nearest assessment not yet passed among those of `courses` (one course name, or a set
 * of them), or `null`. A record with no `course` never matches.
 */
export function nearestAssessmentAhead(
  assessments: readonly AssessmentRecord[],
  courses: string | ReadonlySet<string>,
  asOf: CalendarDay,
): NearestAssessmentAhead | null {
  if (!isCalendarDay(asOf)) return null;
  const inScope = (course: string): boolean =>
    typeof courses === 'string' ? course === courses : courses.has(course);
  const asOfDate = new Date(`${asOf}T00:00:00.000Z`);
  let best: NearestAssessmentAhead | null = null;
  for (const record of assessments) {
    if (record.course === undefined || !inScope(record.course)) continue;
    const due = record.due;
    if (due === undefined || !isCalendarDay(due)) continue;
    const daysUntil = daysBetween(asOfDate, new Date(`${due}T00:00:00.000Z`));
    if (daysUntil < 0) continue;
    if (
      best === null ||
      daysUntil < best.daysUntil ||
      (daysUntil === best.daysUntil && record.path < best.record.path)
    ) {
      best = { record, daysUntil };
    }
  }
  return best;
}
