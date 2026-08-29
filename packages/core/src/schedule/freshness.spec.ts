/**
 * `computeCourseFreshness` / `computeScheduleFreshness` (RHY-3 §3, `ol-hna1`
 * — step 3 of the build chain `ol-4chx` -> `ol-r6s0` -> `ol-hna1` ->
 * `ol-at1a`).
 *
 * INV-3: every course code, date and label in this file is invented for the
 * test. None of it comes from any real vault.
 */

import { describe, expect, it } from 'vitest';
import type { CalendarDay } from '../today/calendar-day.js';
import {
  ARRIVAL_GRACE_DAYS,
  computeCourseFreshness,
  computeScheduleFreshness,
  EXTRAPOLATION_BOUND_WEEKS,
  MIN_HISTORICAL_SESSIONS_TO_TRUST,
} from './freshness.js';
import type { AssociatedScheduleEvent, ScheduleEventRecord } from './types.js';

function event(
  date: CalendarDay,
  overrides: Partial<ScheduleEventRecord> = {},
): ScheduleEventRecord {
  return {
    sourcePath: 'Imports/synced.md',
    lineNumber: 1,
    label: 'whatever the calendar wrote',
    weekday: undefined,
    timeRange: undefined,
    date,
    ...overrides,
  };
}

describe('computeCourseFreshness — below the trust threshold', () => {
  it('reads "no yardstick" for a course with fewer sessions than the trust threshold', () => {
    const reading = computeCourseFreshness('GEOL101', ['2026-08-03'], null, '2026-09-01');
    expect(reading.status).toBe('not-arrived-no-yardstick');
    expect(reading.expectedSessionDate).toBeUndefined();
    expect(reading.basis).toBeUndefined();
    expect(reading.reason).toContain(String(MIN_HISTORICAL_SESSIONS_TO_TRUST));
  });

  it('reads "no yardstick" for a course with zero matched sessions', () => {
    const reading = computeCourseFreshness('GEOL101', [], null, '2026-09-01');
    expect(reading.status).toBe('not-arrived-no-yardstick');
  });
});

describe('computeCourseFreshness — directly observed sessions (no extrapolation)', () => {
  const dates: CalendarDay[] = ['2026-08-03', '2026-08-10', '2026-08-17'];

  it('flags an observed session unmatched by any arrival, past the grace margin', () => {
    // Nothing has ever arrived for this course; the last synced session is
    // 5 days before "today", well past the 1-day grace margin.
    const reading = computeCourseFreshness('GEOL101', dates, null, '2026-08-22');
    expect(reading.status).toBe('not-arrived-with-yardstick');
    expect(reading.basis).toBe('observed');
    expect(reading.expectedSessionDate).toBe('2026-08-17');
  });

  it('reads "arrived" when material has landed at or after the most recent overdue-looking session', () => {
    const reading = computeCourseFreshness('GEOL101', dates, '2026-08-17', '2026-08-22');
    expect(reading.status).toBe('arrived');
    expect(reading.expectedSessionDate).toBeUndefined();
  });

  it('honours the grace margin: a session dated fewer than ARRIVAL_GRACE_DAYS ago is not yet flagged', () => {
    // Arrived through the second-to-last session, so only the most recent
    // one (2026-08-17) is under test for the grace margin.
    const lastArrivalDay = '2026-08-10';

    // "today" is the very same day as the session — zero days of grace
    // elapsed, and nothing to extrapolate past it either.
    const sameDay = computeCourseFreshness('GEOL101', dates, lastArrivalDay, '2026-08-17');
    expect(sameDay.status).toBe('arrived');

    // Exactly ARRIVAL_GRACE_DAYS later, the grace margin has elapsed.
    const afterGrace = computeCourseFreshness(
      'GEOL101',
      dates,
      lastArrivalDay,
      shiftDay('2026-08-17', ARRIVAL_GRACE_DAYS),
    );
    expect(afterGrace.status).toBe('not-arrived-with-yardstick');
  });

  it('picks the latest overdue observed session when more than one qualifies', () => {
    const reading = computeCourseFreshness(
      'GEOL101',
      ['2026-08-03', '2026-08-10', '2026-08-17'],
      '2026-07-01',
      '2026-08-25',
    );
    expect(reading.expectedSessionDate).toBe('2026-08-17');
  });
});

describe('computeCourseFreshness — extrapolation past a stale synced window', () => {
  it('extrapolates a weekly Monday pattern forward past the last synced session', () => {
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-10', '2026-08-17']; // three Mondays
    // Nothing arrived since the last synced session; asking one week later,
    // one day past the extrapolated next Monday (2026-08-24) plus grace.
    const today = shiftDay('2026-08-24', ARRIVAL_GRACE_DAYS);
    const reading = computeCourseFreshness('GEOL101', dates, '2026-08-17', today);
    expect(reading.status).toBe('not-arrived-with-yardstick');
    expect(reading.basis).toBe('extrapolated');
    expect(reading.expectedSessionDate).toBe('2026-08-24');
  });

  it('does not flag the extrapolated session before the grace margin elapses', () => {
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-10', '2026-08-17'];
    // Exactly on the extrapolated day itself — no grace has elapsed yet.
    const reading = computeCourseFreshness('GEOL101', dates, '2026-08-17', '2026-08-24');
    expect(reading.status).toBe('arrived');
  });

  it('reads "no yardstick" once the synced window is stale past the extrapolation bound', () => {
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-10', '2026-08-17'];
    const staleToday = shiftDay('2026-08-17', EXTRAPOLATION_BOUND_WEEKS * 7 + 1);
    const reading = computeCourseFreshness('GEOL101', dates, '2026-08-17', staleToday);
    expect(reading.status).toBe('not-arrived-no-yardstick');
    expect(reading.expectedSessionDate).toBeUndefined();
  });

  it('reads "arrived" when no weekday reaches a majority — nothing to extrapolate from, and nothing observed is overdue', () => {
    // A different weekday each observed week: no majority pattern.
    const dates: CalendarDay[] = ['2026-08-03', '2026-08-11', '2026-08-20'];
    const reading = computeCourseFreshness('GEOL101', dates, '2026-08-20', '2026-08-25');
    expect(reading.status).toBe('arrived');
  });
});

describe('computeScheduleFreshness — per-course independence', () => {
  it('produces one reading per course present in the matched events, independently of each other', () => {
    const matched: AssociatedScheduleEvent[] = [
      { event: event('2026-08-03'), courseCode: 'GEOL101' },
      { event: event('2026-08-10'), courseCode: 'GEOL101' },
      { event: event('2026-08-17'), courseCode: 'GEOL101' },
      { event: event('2026-08-05'), courseCode: 'PHIL220' },
      { event: event('2026-08-12'), courseCode: 'PHIL220' },
    ];
    const lastArrival = new Map<string, CalendarDay | null>([
      ['GEOL101', null], // overdue
      ['PHIL220', '2026-08-20'], // arrived today, covering even the extrapolated session
    ]);

    const readings = computeScheduleFreshness(matched, lastArrival, '2026-08-20');
    const byCourse = new Map(readings.map((r) => [r.courseCode, r]));

    expect(byCourse.get('GEOL101')?.status).toBe('not-arrived-with-yardstick');
    expect(byCourse.get('PHIL220')?.status).toBe('arrived');
  });

  it('defaults to no observed arrival when a course is absent from the arrival map', () => {
    const matched: AssociatedScheduleEvent[] = [
      { event: event('2026-08-03'), courseCode: 'GEOL101' },
      { event: event('2026-08-10'), courseCode: 'GEOL101' },
    ];
    const readings = computeScheduleFreshness(matched, new Map(), '2026-08-20');
    expect(readings).toHaveLength(1);
    expect(readings[0]?.status).toBe('not-arrived-with-yardstick');
  });

  it("produces no reading at all for a course with no matched events — a caller's job to degrade", () => {
    const readings = computeScheduleFreshness([], new Map(), '2026-08-20');
    expect(readings).toEqual([]);
  });
});

/** Test-local day arithmetic so this file does not need to import `shiftCalendarDay` just to build fixtures. */
function shiftDay(day: CalendarDay, delta: number): CalendarDay {
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(
    Date.UTC(year as number, (month as number) - 1, (date as number) + delta),
  );
  return shifted.toISOString().slice(0, 10);
}
