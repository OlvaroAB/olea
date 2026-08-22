import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from './dates.js';

describe('daysBetween', () => {
  it('is zero for two timestamps on the same UTC calendar day', () => {
    const morning = new Date('2026-08-09T01:00:00Z');
    const night = new Date('2026-08-09T23:59:00Z');
    expect(daysBetween(morning, night)).toBe(0);
  });

  it('counts one whole day across a UTC midnight boundary', () => {
    const day1 = new Date('2026-08-09T23:59:00Z');
    const day2 = new Date('2026-08-10T00:01:00Z');
    expect(daysBetween(day1, day2)).toBe(1);
  });

  it('is negative when `to` is before `from`', () => {
    const later = new Date('2026-08-15T00:00:00Z');
    const earlier = new Date('2026-08-10T00:00:00Z');
    expect(daysBetween(later, earlier)).toBe(-5);
  });

  it('crosses a month boundary correctly', () => {
    const from = new Date('2026-08-30T00:00:00Z');
    const to = new Date('2026-09-02T00:00:00Z');
    expect(daysBetween(from, to)).toBe(3);
  });

  it('crosses a leap-year February correctly', () => {
    // 2028 is a leap year: Feb has 29 days.
    const from = new Date('2028-02-27T12:00:00Z');
    const to = new Date('2028-03-01T06:00:00Z');
    expect(daysBetween(from, to)).toBe(3);
  });
});

describe('addDays', () => {
  it('round-trips with daysBetween', () => {
    const start = new Date('2026-08-09T09:30:00Z');
    const shifted = addDays(start, 21);
    expect(daysBetween(start, shifted)).toBe(21);
  });

  it('preserves the time-of-day component', () => {
    const start = new Date('2026-08-09T09:30:00Z');
    const shifted = addDays(start, 1);
    expect(shifted.getUTCHours()).toBe(9);
    expect(shifted.getUTCMinutes()).toBe(30);
  });
});
