/**
 * `detectRecurrencePattern` / `mostRecentExpectedOccurrence` (RHY-3 §9,
 * `ol-hna1`).
 *
 * INV-3: every date and course reference in this file is invented for the
 * test. None of it comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { CalendarDay } from '../today/calendar-day.js';
import { detectRecurrencePattern, mostRecentExpectedOccurrence } from './recurrence.js';

/** Independently cross-checks a date's weekday via `Date.UTC`, without touching this module's own (unexported) weekday helper. */
function weekdayOf(day: CalendarDay): number {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, date as number)).getUTCDay();
}

describe('detectRecurrencePattern', () => {
  it('is undefined for an empty date list — nothing to detect a pattern from', () => {
    expect(detectRecurrencePattern([])).toBeUndefined();
  });

  it('detects a single weekday recurring across every observed week', () => {
    // Three Mondays, one week apart.
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-10', '2026-08-17'];
    const pattern = detectRecurrencePattern(dates);

    expect(pattern?.weeksObserved).toBe(3);
    expect(pattern?.lastObservedDate).toBe('2026-08-17');
    expect(pattern?.recurringWeekdays).toEqual([
      { weekday: weekdayOf('2026-08-03'), occurrences: 3 },
    ]);
  });

  it('detects two weekdays recurring independently in the same weeks', () => {
    const dates: CalendarDay[] = [
      '2026-08-03', // Mon
      '2026-08-05', // Wed
      '2026-08-10',
      '2026-08-12',
      '2026-08-17',
      '2026-08-19',
    ];
    const pattern = detectRecurrencePattern(dates);

    expect(pattern?.weeksObserved).toBe(3);
    const weekdays = pattern?.recurringWeekdays.map((w) => w.weekday).sort((a, b) => a - b);
    expect(weekdays).toEqual(
      [weekdayOf('2026-08-03'), weekdayOf('2026-08-05')].sort((a, b) => a - b),
    );
  });

  it("excludes a weekday that appears in only a minority of observed weeks — the reference vault's own third-week-extra-slot case", () => {
    // Monday recurs all three weeks; Wednesday only appears in the third
    // week (1 of 3 = 33%, not a majority) — RHY-3 §9's own worked example of
    // "a real pattern, but not perfectly rigid."
    const dates: CalendarDay[] = [
      '2026-08-03', // Mon, week 1
      '2026-08-10', // Mon, week 2
      '2026-08-17', // Mon, week 3
      '2026-08-19', // Wed, week 3 only
    ];
    const pattern = detectRecurrencePattern(dates);

    expect(pattern?.weeksObserved).toBe(3);
    expect(pattern?.recurringWeekdays).toEqual([
      { weekday: weekdayOf('2026-08-03'), occurrences: 3 },
    ]);
  });

  it('returns an empty recurringWeekdays list when no weekday reaches a majority', () => {
    // A different weekday every week — no majority anywhere.
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-11', '2026-08-20'];
    const pattern = detectRecurrencePattern(dates);

    expect(pattern?.weeksObserved).toBe(3);
    expect(pattern?.recurringWeekdays).toEqual([]);
  });

  it('counts two events on the same weekday in the same week as one occurrence of that week, not two', () => {
    // Two Monday-labelled lines that both fall in the same calendar week
    // (a duplicate or a re-synced line) must not inflate the majority count.
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-03', '2026-08-10'];
    const pattern = detectRecurrencePattern(dates);

    expect(pattern?.weeksObserved).toBe(2);
    expect(pattern?.recurringWeekdays).toEqual([
      { weekday: weekdayOf('2026-08-03'), occurrences: 2 },
    ]);
  });

  it('lastObservedDate is the latest date regardless of input order', () => {
    const dates: CalendarDay[] = ['2026-08-17', '2026-08-03', '2026-08-10'];
    expect(detectRecurrencePattern(dates)?.lastObservedDate).toBe('2026-08-17');
  });
});

describe('mostRecentExpectedOccurrence', () => {
  it('projects the next weekly occurrence past the last observed date', () => {
    const monday = weekdayOf('2026-08-17');
    // Last observed Monday 2026-08-17; asking as of the following Monday
    // should surface exactly that next occurrence, 2026-08-24.
    expect(mostRecentExpectedOccurrence([monday], '2026-08-17', '2026-08-24')).toBe('2026-08-24');
  });

  it('is undefined when the only occurrence in range is not after `after`', () => {
    const monday = weekdayOf('2026-08-17');
    // `onOrBefore` is the same day as `after` — nothing strictly after it.
    expect(mostRecentExpectedOccurrence([monday], '2026-08-17', '2026-08-17')).toBeUndefined();
    // A few days later, still short of a full week — no new Monday yet.
    expect(mostRecentExpectedOccurrence([monday], '2026-08-17', '2026-08-20')).toBeUndefined();
  });

  it('picks the most recent among multiple recurring weekdays', () => {
    const monday = weekdayOf('2026-08-17');
    const wednesday = weekdayOf('2026-08-19');
    expect(mostRecentExpectedOccurrence([monday, wednesday], '2026-08-17', '2026-08-24')).toBe(
      '2026-08-24',
    );
    expect(mostRecentExpectedOccurrence([monday, wednesday], '2026-08-19', '2026-08-24')).toBe(
      '2026-08-24',
    );
  });

  it('is undefined for an empty weekday list', () => {
    expect(mostRecentExpectedOccurrence([], '2026-08-17', '2026-08-24')).toBeUndefined();
  });
});
