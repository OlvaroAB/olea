/**
 * The non-punitive study streak (F6.1, P2-T09).
 *
 * F6.1 asks this panel for three things: a due-today summary, due counts broken
 * out per course, and a study streak that is explicitly **not** a punishment
 * device — it counts, it never nags, and a missed day clears nothing. Principle
 * 11's coach-not-a-game framing is where that constraint comes from.
 *
 * Three properties are built in here rather than left to the renderer, because
 * a renderer can only be as non-punitive as the data it is handed:
 *
 * 1. **The streak has no storage, so a break resets nothing.** It is a pure
 *    projection folded from the append-only review log, exactly like the
 *    suspended set (`review-log/suspension.ts`, D-020). Nothing in this module
 *    writes, and there is nothing anywhere for a break to clear. That is what
 *    P2-T09's acceptance is after when it confines a break's effect to what is
 *    drawn — no stored value altered, nothing said to her about it: it is not a
 *    discipline anyone has to remember, it is a consequence of there being no
 *    state to keep.
 *
 * 2. **There is deliberately no `longestStreak`, `bestEver`, `brokenOn` or
 *    `daysMissed` field.** Each of those is a number whose only use on screen
 *    is as a loss — "your best was 34" says nothing at 3 except that she is
 *    down 31. The type does not have them, so no later renderer can find one
 *    lying around. `streak.spec.ts` asserts the field set, which makes that a
 *    test rather than a comment.
 *
 * 3. **A missed day and a day that has not happened yet are the same mark.**
 *    `StreakDay.studied` is a fact; there is no `missed` flag. The Pass 1 UI kit
 *    (`../olea-service/docs/design/pass1/`) reached the same conclusion
 *    independently: it gives a missed day no colour of its own and draws it
 *    exactly as it draws a day still to come. That is the one part of that
 *    file's behaviour that is straight F6.1, so the shape is adopted here.
 *
 * **Yesterday's grace, and why it is not an invention.** The streak counts back
 * from today when she has already studied today, and from yesterday when she
 * has not. Without that, the number reads zero every morning until she opens a
 * session — i.e. the panel would greet a nine-day run with "0 days" and then
 * silently correct itself, which is nagging in the only form a number can nag.
 * It is a reversible default (Class B), stated here so the alternative is
 * visible: the stricter reading resets at midnight and is *more* punitive than
 * F6.1 permits, not less.
 *
 * **What counts as studying.** Any `kind: 'review'` entry, including
 * explain-back (which carries no rating — F2.16/F5). Suspension events do not:
 * deciding to stop studying something is not studying. See `studyDays`.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type CalendarDay,
  calendarDayOfTimestamp,
  calendarDaysEndingOn,
  isCalendarDay,
  shiftCalendarDay,
} from './calendar-day.js';

/** One cell of the week strip. A fact and two positions — never a verdict. */
export interface StreakDay {
  readonly day: CalendarDay;
  /** At least one review event fell on this day. */
  readonly studied: boolean;
  /** This is the day the panel is being drawn on. */
  readonly isToday: boolean;
}

/**
 * What the panel renders. Every field is either a fact or a statement about
 * the limits of what was read — see this module's doc for the fields that are
 * deliberately absent.
 */
export interface StreakSummary {
  /** Consecutive days ending today (or yesterday, if today has no reviews yet). */
  readonly currentDays: number;
  /** She has already studied today. */
  readonly studiedToday: boolean;
  /**
   * The run reached the oldest day the caller supplied history for, so
   * `currentDays` is a floor, not a measurement. The panel renders `N+`.
   * Reporting a number as exact when the history behind it ran out is the
   * same class of overstatement `ol-1n1v` rejected on the coverage screen.
   */
  readonly atWindowEdge: boolean;
  /** How many days of history the summary was computed over. */
  readonly windowDays: number;
  /** The trailing strip, oldest first, ending on today. */
  readonly week: readonly StreakDay[];
}

export interface ComputeStreakOptions {
  /** The day the panel is being drawn on, in her local calendar. */
  readonly today: CalendarDay;
  /**
   * How many days back the caller's `entries` actually cover. The streak is
   * never reported as longer than this — see `atWindowEdge`.
   */
  readonly windowDays: number;
  /** Cells in the trailing strip. Defaults to a week. */
  readonly weekLength?: number;
}

/** The strip the Pass 1 kit draws: seven days, Monday-ish through today. */
export const DEFAULT_WEEK_LENGTH = 7;

/**
 * The set of local calendar days that hold at least one review.
 *
 * Suspend/unsuspend entries are excluded on purpose: F2.6's events record that
 * she took something *out* of rotation, which is a decision about her deck and
 * not a study session. Counting them would let a tidying-up afternoon extend a
 * streak, which is precisely the kind of number-gaming a non-punitive streak
 * has no reason to reward.
 *
 * A record whose timestamp does not parse as a calendar day is skipped rather
 * than thrown on, matching `parse.ts`: one bad line never costs the days
 * around it.
 */
export function studyDays(entries: readonly ReviewLogEntry[]): ReadonlySet<CalendarDay> {
  const days = new Set<CalendarDay>();
  for (const entry of entries) {
    if (entry.kind !== 'review') continue;
    const day = calendarDayOfTimestamp(entry.timestamp);
    if (day !== null) days.add(day);
  }
  return days;
}

/**
 * Folds the log into `StreakSummary`. Pure: same entries and same options
 * always give the same answer, and nothing is written anywhere.
 */
export function computeStreak(
  entries: readonly ReviewLogEntry[],
  options: ComputeStreakOptions,
): StreakSummary {
  const { today, windowDays } = options;
  if (!isCalendarDay(today)) {
    throw new Error(`computeStreak: today is not a calendar day: ${JSON.stringify(today)}`);
  }
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(`computeStreak: windowDays must be a positive integer, got ${windowDays}`);
  }
  const weekLength = options.weekLength ?? DEFAULT_WEEK_LENGTH;

  const studied = studyDays(entries);
  const studiedToday = studied.has(today);

  // Count back from today when today is already in, from yesterday otherwise.
  // See the module doc: a run that ends yesterday is intact, not lost.
  //
  // `oldestDay` is the far edge of what the caller actually read. The walk
  // stops there whether or not the run did, and `atWindowEdge` records which
  // of the two happened — so a streak longer than the history behind it is
  // reported as "at least this", never as a measured number.
  const oldestDay = shiftCalendarDay(today, -(windowDays - 1));
  let cursor = studiedToday ? today : shiftCalendarDay(today, -1);
  let currentDays = 0;
  while (cursor >= oldestDay && studied.has(cursor)) {
    currentDays += 1;
    cursor = shiftCalendarDay(cursor, -1);
  }
  const atWindowEdge = currentDays > 0 && cursor < oldestDay;

  const week = calendarDaysEndingOn(today, weekLength).map(
    (day): StreakDay => ({ day, studied: studied.has(day), isToday: day === today }),
  );

  return {
    currentDays,
    studiedToday,
    atWindowEdge,
    windowDays,
    week,
  };
}
