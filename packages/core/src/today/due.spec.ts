import { describe, expect, it } from 'vitest';
import { type DueInstrument, isDueThrough, summariseDue } from './due.js';

/** End of her local Monday, as the plugin would compute it. */
const DUE_THROUGH = new Date('2026-08-11T03:59:59.999Z'); // 23:59:59.999 at UTC-4

function instrument(overrides: Partial<DueInstrument> = {}): DueInstrument {
  return {
    instrumentId: 'qa:clast-imbrication:1',
    courseCode: 'BIOL204',
    courseName: 'Quartzose sandstone',
    due: '2026-08-10T13:00:00Z',
    ...overrides,
  };
}

describe('isDueThrough', () => {
  it('an instrument never reviewed is due now, not later', () => {
    expect(isDueThrough(instrument({ due: null }), DUE_THROUGH)).toBe(true);
  });

  it('an instrument due earlier today is due', () => {
    expect(isDueThrough(instrument({ due: '2026-08-10T08:00:00Z' }), DUE_THROUGH)).toBe(true);
  });

  it('an overdue instrument is due', () => {
    expect(isDueThrough(instrument({ due: '2026-07-30T08:00:00Z' }), DUE_THROUGH)).toBe(true);
  });

  it('an instrument due later this week is not due today', () => {
    expect(isDueThrough(instrument({ due: '2026-08-13T08:00:00Z' }), DUE_THROUGH)).toBe(false);
  });

  it('due exactly at the boundary is due', () => {
    expect(isDueThrough(instrument({ due: DUE_THROUGH.toISOString() }), DUE_THROUGH)).toBe(true);
  });

  it('an unparseable due instant under-counts rather than putting a number on screen', () => {
    expect(isDueThrough(instrument({ due: 'whenever' }), DUE_THROUGH)).toBe(false);
  });
});

describe('summariseDue', () => {
  it('nothing in is a real zero, not an absence', () => {
    expect(summariseDue([], { dueThrough: DUE_THROUGH })).toEqual({
      total: 0,
      newCount: 0,
      courses: [],
    });
  });

  it('the headline is the sum of the per-course counts', () => {
    const instruments = [
      instrument({ instrumentId: 'a', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'b', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'c', courseCode: 'STAT110', courseName: 'Counterpoint' }),
    ];
    const summary = summariseDue(instruments, { dueThrough: DUE_THROUGH });
    expect(summary.total).toBe(3);
    expect(summary.courses.reduce((n, c) => n + c.count, 0)).toBe(summary.total);
  });

  it('a course with nothing due is absent, not shown as a zero', () => {
    const instruments = [
      instrument({ instrumentId: 'a', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'b', courseCode: 'STAT110', due: '2026-09-01T08:00:00Z' }),
    ];
    const summary = summariseDue(instruments, { dueThrough: DUE_THROUGH });
    expect(summary.courses.map((c) => c.courseCode)).toEqual(['BIOL204']);
  });

  it('orders by count descending, ties broken by course code, so the list does not reshuffle', () => {
    const instruments = [
      instrument({ instrumentId: 'a1', courseCode: 'STAT110' }),
      instrument({ instrumentId: 'b1', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'b2', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'b3', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'c1', courseCode: 'ARTH150' }),
    ];
    const first = summariseDue(instruments, { dueThrough: DUE_THROUGH });
    const reversed = summariseDue([...instruments].reverse(), { dueThrough: DUE_THROUGH });
    expect(first.courses.map((c) => c.courseCode)).toEqual(['BIOL204', 'ARTH150', 'STAT110']);
    expect(reversed.courses).toEqual(first.courses);
  });

  it('carries the course name through for the row label', () => {
    const summary = summariseDue([instrument()], { dueThrough: DUE_THROUGH });
    expect(summary.courses[0]).toEqual({
      courseCode: 'BIOL204',
      courseName: 'Quartzose sandstone',
      count: 1,
    });
  });

  it('a suspended instrument is not due (F2.6)', () => {
    const instruments = [instrument({ instrumentId: 'a' }), instrument({ instrumentId: 'b' })];
    const summary = summariseDue(instruments, {
      dueThrough: DUE_THROUGH,
      suspendedInstrumentIds: new Set(['b']),
    });
    expect(summary.total).toBe(1);
    expect(summary.courses[0]?.count).toBe(1);
  });

  it('suspending every instrument of a course removes the row entirely', () => {
    const instruments = [
      instrument({ instrumentId: 'a', courseCode: 'BIOL204' }),
      instrument({ instrumentId: 'b', courseCode: 'STAT110' }),
    ];
    const summary = summariseDue(instruments, {
      dueThrough: DUE_THROUGH,
      suspendedInstrumentIds: new Set(['b']),
    });
    expect(summary.courses.map((c) => c.courseCode)).toEqual(['BIOL204']);
  });

  it('an instrument no longer suspended counts normally again', () => {
    // The fold that produces this set is review-log/suspension.ts; here the
    // point is only that an empty set excludes nothing.
    const summary = summariseDue([instrument()], {
      dueThrough: DUE_THROUGH,
      suspendedInstrumentIds: new Set(),
    });
    expect(summary.total).toBe(1);
  });

  it('the same instrument twice is one due item, not two (R3: the id is the identity)', () => {
    const summary = summariseDue([instrument(), instrument()], { dueThrough: DUE_THROUGH });
    expect(summary.total).toBe(1);
  });
});

describe('summariseDue — new is a subset of due, never a second queue', () => {
  it('counts the never-reviewed ones as new inside the same total', () => {
    const summary = summariseDue(
      [
        instrument({ instrumentId: 'seen-1', due: '2026-08-09T08:00:00Z' }),
        instrument({ instrumentId: 'seen-2', due: '2026-08-10T08:00:00Z' }),
        instrument({ instrumentId: 'new-1', due: null }),
        instrument({ instrumentId: 'new-2', due: null }),
        instrument({ instrumentId: 'new-3', due: null }),
      ],
      { dueThrough: DUE_THROUGH },
    );
    expect(summary.total).toBe(5);
    expect(summary.newCount).toBe(3);
  });

  it('leaves the headline identity intact — total is still the sum of the rows', () => {
    const summary = summariseDue(
      [
        instrument({ instrumentId: 'a', courseCode: 'BIOL204', due: null }),
        instrument({ instrumentId: 'b', courseCode: 'STAT110', due: null }),
        instrument({ instrumentId: 'c', courseCode: 'STAT110', due: '2026-08-09T08:00:00Z' }),
      ],
      { dueThrough: DUE_THROUGH },
    );
    expect(summary.courses.reduce((sum, course) => sum + course.count, 0)).toBe(summary.total);
    expect(summary.newCount).toBeLessThanOrEqual(summary.total);
  });

  it('is zero when everything waiting has been reviewed before', () => {
    const summary = summariseDue(
      [
        instrument({ instrumentId: 'a', due: '2026-08-09T08:00:00Z' }),
        instrument({ instrumentId: 'b', due: '2026-07-30T08:00:00Z' }),
      ],
      { dueThrough: DUE_THROUGH },
    );
    expect(summary).toEqual({
      total: 2,
      newCount: 0,
      courses: [{ courseCode: 'BIOL204', courseName: 'Quartzose sandstone', count: 2 }],
    });
  });

  it('a never-reviewed instrument due later than today is neither due nor new', () => {
    // Unreachable through `toDueInstruments` — a null due instant *is* the
    // never-reviewed case — but the guard is stated so that a future adapter
    // carrying a real future instant on a first-exposure instrument cannot
    // quietly inflate the new count past the total.
    const summary = summariseDue(
      [instrument({ instrumentId: 'later', due: '2026-08-20T08:00:00Z' })],
      { dueThrough: DUE_THROUGH },
    );
    expect(summary).toEqual({ total: 0, newCount: 0, courses: [] });
  });

  it('a suspended never-reviewed instrument is excluded from both numbers (F2.6)', () => {
    const summary = summariseDue(
      [
        instrument({ instrumentId: 'suspended', due: null }),
        instrument({ instrumentId: 'live', due: null }),
      ],
      { dueThrough: DUE_THROUGH, suspendedInstrumentIds: new Set(['suspended']) },
    );
    expect(summary.total).toBe(1);
    expect(summary.newCount).toBe(1);
  });

  it('the same never-reviewed instrument twice is one new item, not two (R3)', () => {
    const summary = summariseDue([instrument({ due: null }), instrument({ due: null })], {
      dueThrough: DUE_THROUGH,
    });
    expect(summary.total).toBe(1);
    expect(summary.newCount).toBe(1);
  });
});
