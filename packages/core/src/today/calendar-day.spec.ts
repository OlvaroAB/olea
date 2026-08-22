import { describe, expect, it } from 'vitest';
import {
  calendarDayFromLocalDate,
  calendarDayOfTimestamp,
  calendarDaysEndingOn,
  isCalendarDay,
  shiftCalendarDay,
} from './calendar-day.js';

describe('calendarDayOfTimestamp', () => {
  it('reads the local day straight off an offset timestamp', () => {
    expect(calendarDayOfTimestamp('2026-08-10T09:00:00-04:00')).toBe('2026-08-10');
  });

  it('a late evening east of Greenwich stays on her day, not the UTC one', () => {
    // 23:30 on the 10th at UTC+2 is 21:30 UTC on the 10th — same day here, but
    // the point is the general one: the offset is what makes the answer local.
    expect(calendarDayOfTimestamp('2026-08-10T23:30:00+02:00')).toBe('2026-08-10');
    // And the case that actually breaks under UTC normalisation: 01:00 on the
    // 11th at UTC+2 is the 10th in UTC. Her day is the 11th.
    expect(calendarDayOfTimestamp('2026-08-11T01:00:00+02:00')).toBe('2026-08-11');
  });

  it('a Z timestamp yields the UTC day — the only honest answer when no offset was recorded', () => {
    expect(calendarDayOfTimestamp('2026-08-10T23:30:00Z')).toBe('2026-08-10');
  });

  it('returns null rather than throwing on a malformed timestamp', () => {
    expect(calendarDayOfTimestamp('')).toBeNull();
    expect(calendarDayOfTimestamp('not a date')).toBeNull();
    expect(calendarDayOfTimestamp('20260810T090000Z')).toBeNull();
  });
});

describe('isCalendarDay', () => {
  it('accepts YYYY-MM-DD and nothing else', () => {
    expect(isCalendarDay('2026-08-10')).toBe(true);
    expect(isCalendarDay('2026-8-10')).toBe(false);
    expect(isCalendarDay('2026-08-10T09:00:00Z')).toBe(false);
  });
});

describe('calendarDayFromLocalDate', () => {
  it('uses the local getters, so it is her day and not UTC', () => {
    // Constructed from local components, so this is exact regardless of the
    // zone the test host runs in — which is the property under test.
    const date = new Date(2026, 7, 10, 23, 30, 0);
    expect(calendarDayFromLocalDate(date)).toBe('2026-08-10');
  });

  it('pads single-digit months and days', () => {
    expect(calendarDayFromLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('shiftCalendarDay', () => {
  it('walks backwards over a month boundary', () => {
    expect(shiftCalendarDay('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('walks over a leap day', () => {
    expect(shiftCalendarDay('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftCalendarDay('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('walks over a year boundary in both directions', () => {
    expect(shiftCalendarDay('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftCalendarDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('rejects a non-day rather than silently producing one', () => {
    expect(() => shiftCalendarDay('2026-8-1', -1)).toThrow(/not a calendar day/);
  });
});

describe('calendarDaysEndingOn', () => {
  it('returns the window oldest first, ending on the given day', () => {
    expect(calendarDaysEndingOn('2026-08-10', 3)).toEqual([
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
    ]);
  });

  it('a zero-length window is empty, not an error', () => {
    expect(calendarDaysEndingOn('2026-08-10', 0)).toEqual([]);
  });

  it('rejects a negative or fractional length', () => {
    expect(() => calendarDaysEndingOn('2026-08-10', -1)).toThrow(/non-negative integer/);
    expect(() => calendarDaysEndingOn('2026-08-10', 1.5)).toThrow(/non-negative integer/);
  });
});
