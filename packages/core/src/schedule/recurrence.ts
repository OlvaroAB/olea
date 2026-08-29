/**
 * Weekday recurrence detection and forward extrapolation over a course's
 * matched schedule events (RHY-3 §9, `ol-hna1` — step 3 of the build chain
 * `ol-4chx` -> `ol-r6s0` -> `ol-hna1` -> `ol-at1a`). `./associate.ts` (step 2)
 * hands over events already matched to a known course code; this module's
 * whole job is asking "does this course meet on the same weekday most weeks,
 * and if so, what is the most recent date that pattern implies at or before a
 * given day" — nothing about whether material has actually landed for that
 * expected session (`./freshness.ts`'s job, one layer up).
 *
 * **Weekday only, never weekday+time.** RHY-3 §9's prose describes
 * "weekday+approximate-time slots," but `./event-line.ts`'s own module doc and
 * `./types.ts`'s `ScheduleEventRecord.timeRange` doc both state the time range
 * is "unused by anything in this build chain today." Freshness is a cadence
 * question over dates (RHY-3 §2: "answerable from dates alone, on both sides
 * of the comparison"), and two sessions on the same weekday at different or
 * unrecorded times are still the same weekly cadence for that purpose.
 * Dropping the time component narrows what the design already says is
 * unused, rather than departing from it.
 *
 * **"Recurs" means "a majority of observed weeks," never "every week."**
 * Verbatim from RHY-3 §9, motivated by the reference vault's own data: one
 * course gains an extra weekly slot starting in its third observed week.
 * That slot appears in one of three weeks (33%) and is correctly excluded as
 * a genuine but non-majority exception, rather than mistaken for a second
 * recurring pattern from a single data point.
 *
 * **Weekday is derived from `date`, never from a parsed weekday token.**
 * `./types.ts`'s `ScheduleEventRecord.weekday` doc is explicit that field is
 * "informational only — never authoritative over `date`"; this module takes
 * only bare `CalendarDay` strings and computes the weekday itself from the
 * one field that is authoritative.
 *
 * **Recompute-on-read, no caching** (RHY-3 §8 Class C stop 1) — same posture
 * as `./discover.ts` and `./associate.ts`. Pure functions, no I/O.
 */

import { type CalendarDay, shiftCalendarDay } from '../today/calendar-day.js';

/**
 * `Date.UTC`'s own weekday convention (0 = Sunday .. 6 = Saturday), read off
 * a bare `YYYY-MM-DD` string with no timezone involved — the same
 * component-parsing style `../today/calendar-day.js`'s `shiftCalendarDay`
 * already uses, so a date is never round-tripped through a machine-local
 * clock to answer "what weekday is this."
 */
function weekdayIndexOf(day: CalendarDay): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

/** The Monday that starts `day`'s calendar week — the unit "a majority of observed weeks" (RHY-3 §9) is counted over. */
function weekStartOf(day: CalendarDay): CalendarDay {
  const daysSinceMonday = (weekdayIndexOf(day) + 6) % 7;
  return shiftCalendarDay(day, -daysSinceMonday);
}

/** One weekday a course's matched events recur on, per RHY-3 §9's majority rule. */
export interface RecurringWeekday {
  /** 0 = Sunday .. 6 = Saturday. */
  readonly weekday: number;
  /** Distinct observed weeks in which this course had an event on this weekday. */
  readonly occurrences: number;
}

/** The recurring pattern detected from one course's matched event dates, and the evidence it rests on. */
export interface CourseRecurrencePattern {
  /**
   * Distinct calendar weeks (Monday-anchored) any matched event fell in — the
   * denominator for the majority rule, and this module's own measure of how
   * much history a course has.
   */
  readonly weeksObserved: number;
  /** The latest date among the matched events this pattern was built from. */
  readonly lastObservedDate: CalendarDay;
  /**
   * Weekdays that recur in a majority of `weeksObserved` distinct weeks. May
   * be empty — an irregular schedule with no majority weekday is a real
   * outcome, not a defect; `./freshness.ts` is what decides how that
   * degrades a reading.
   */
  readonly recurringWeekdays: readonly RecurringWeekday[];
}

/**
 * Detects the recurring weekday pattern in one course's matched event dates.
 * `dates` need not be sorted or deduplicated. `undefined` when `dates` is
 * empty — nothing to detect a pattern from; `./freshness.ts` decides how an
 * absent pattern degrades a reading, not this function.
 */
export function detectRecurrencePattern(
  dates: readonly CalendarDay[],
): CourseRecurrencePattern | undefined {
  if (dates.length === 0) return undefined;

  const weekdaysByWeek = new Map<CalendarDay, Set<number>>();
  let lastObservedDate: CalendarDay = dates[0] as CalendarDay;

  for (const day of dates) {
    if (day > lastObservedDate) lastObservedDate = day;
    const week = weekStartOf(day);
    const weekdaysThisWeek = weekdaysByWeek.get(week) ?? new Set<number>();
    weekdaysThisWeek.add(weekdayIndexOf(day));
    weekdaysByWeek.set(week, weekdaysThisWeek);
  }

  const weeksObserved = weekdaysByWeek.size;
  const occurrencesByWeekday = new Map<number, number>();
  for (const weekdaysThisWeek of weekdaysByWeek.values()) {
    for (const weekday of weekdaysThisWeek) {
      occurrencesByWeekday.set(weekday, (occurrencesByWeekday.get(weekday) ?? 0) + 1);
    }
  }

  const recurringWeekdays: RecurringWeekday[] = [];
  for (const [weekday, occurrences] of occurrencesByWeekday) {
    if (occurrences / weeksObserved > 0.5) {
      recurringWeekdays.push({ weekday, occurrences });
    }
  }
  recurringWeekdays.sort((a, b) => a.weekday - b.weekday);

  return { weeksObserved, lastObservedDate, recurringWeekdays };
}

/**
 * The most recent date, strictly after `after` and on or before
 * `onOrBefore`, that falls on one of `weekdays` — the forward extrapolation
 * itself (RHY-3 §9). `undefined` when no such date exists (including when
 * `weekdays` is empty, or every candidate falls at or before `after`).
 *
 * Extrapolating this way needs no week-by-week loop: because a weekday
 * recurs every seven days, the most recent occurrence of a given weekday on
 * or before `onOrBefore` is found by shifting back at most six days, and
 * that single computed date either clears `after` or it does not — there is
 * no closer one to find by iterating further back.
 */
export function mostRecentExpectedOccurrence(
  weekdays: readonly number[],
  after: CalendarDay,
  onOrBefore: CalendarDay,
): CalendarDay | undefined {
  let best: CalendarDay | undefined;
  for (const weekday of weekdays) {
    const daysBack = (weekdayIndexOf(onOrBefore) - weekday + 7) % 7;
    const candidate = shiftCalendarDay(onOrBefore, -daysBack);
    if (candidate <= after) continue;
    if (best === undefined || candidate > best) best = candidate;
  }
  return best;
}
