/**
 * The rhythm detector's own behaviour, on hand-built inputs.
 *
 * Two of the scenarios below are the ones `features/F6-today.md` names under
 * this file's path (`@auto:core/today/rhythm.spec`): term-boundary
 * resolution and degradation without term dates. The rest establish the
 * detector's arithmetic and three-way status the same way
 * `insights/spacing.spec.ts` does for spacing — this file does not claim the
 * threshold is "correct" against any real-vault corpus (none exists), only
 * that the module computes what it says it computes.
 */

import { describe, expect, it } from 'vitest';
import type { CalendarDay } from './calendar-day.js';
import {
  detectRhythm,
  QUIET_DAYS_THRESHOLD,
  type RhythmCourseInput,
  resolveTermBoundary,
  type TermWindow,
} from './rhythm.js';

const TODAY: CalendarDay = '2026-09-30';

function shiftedDay(daysAgo: number): CalendarDay {
  const ms = Date.parse(`${TODAY}T00:00:00.000Z`) - daysAgo * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function course(id: string, daysAgo: number | null): RhythmCourseInput {
  return { course: id, lastMaterialArrivalDay: daysAgo === null ? null : shiftedDay(daysAgo) };
}

describe('resolveTermBoundary', () => {
  const recorded: TermWindow = { start: '2026-09-01', end: '2026-12-15' };
  const asked: TermWindow = { start: '2026-09-08', end: '2026-12-20' };

  it('uses her recorded dates, and she is not asked again, when both exist', () => {
    expect(resolveTermBoundary({ recorded, asked })).toEqual(recorded);
  });

  it('falls back to the asked answer only where no recorded value exists', () => {
    expect(resolveTermBoundary({ recorded: null, asked })).toEqual(asked);
  });

  it('resolves to null when neither exists — the ask has not happened yet', () => {
    expect(resolveTermBoundary({ recorded: null, asked: null })).toBeNull();
  });
});

describe('detectRhythm', () => {
  it("reports observed when a course has gone quiet for three weeks (F6.9's own example)", () => {
    const result = detectRhythm({ today: TODAY, courses: [course('C1', 21)] });
    expect(result.status).toBe('observed');
    expect(result.measured?.quietestCourse).toBe('C1');
    expect(result.measured?.maxQuietDays).toBe(21);
  });

  it('reports not-observed for a course quiet for less than the threshold', () => {
    const result = detectRhythm({ today: TODAY, courses: [course('C1', 20)] });
    expect(result.status).toBe('not-observed');
    expect(result.measured?.quietestCourse).toBeNull();
  });

  it('reports not-enough-history for a course with no observed arrival ever', () => {
    const result = detectRhythm({ today: TODAY, courses: [course('C1', null)] });
    expect(result.status).toBe('not-enough-history');
    expect(result.measured?.courses[0]?.status).toBe('not-enough-history');
    expect(result.measured?.courses[0]?.quietDays).toBeNull();
  });

  it('reports not-enough-history overall when zero courses are supplied', () => {
    const result = detectRhythm({ today: TODAY, courses: [] });
    expect(result.status).toBe('not-enough-history');
    expect(result.measured).toBeNull();
  });

  it('names the single quietest course — never an aggregate (ARC-1)', () => {
    const result = detectRhythm({
      today: TODAY,
      courses: [course('QUIET', 40), course('BUSY', 2)],
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.quietestCourse).toBe('QUIET');
    expect(result.measured?.maxQuietDays).toBe(40);
    // The busy course still gets its own reading — this is not a collapsed pair.
    const busy = result.measured?.courses.find((c) => c.course === 'BUSY');
    expect(busy?.status).toBe('not-observed');
  });

  it('one course with no history never blocks a verdict about another course', () => {
    const result = detectRhythm({
      today: TODAY,
      courses: [course('NEVER_SEEN', null), course('QUIET', 30)],
    });
    expect(result.status).toBe('observed');
    expect(result.measured?.quietestCourse).toBe('QUIET');
    const neverSeen = result.measured?.courses.find((c) => c.course === 'NEVER_SEEN');
    expect(neverSeen?.status).toBe('not-enough-history');
  });

  it('absent term dates degrade the reading to arrivals-only, and never block it', () => {
    const withoutWindow = detectRhythm({ today: TODAY, courses: [course('C1', 25)] });
    const withWindow = detectRhythm({
      today: TODAY,
      courses: [course('C1', 25)],
      termWindow: { start: '2026-09-01', end: '2026-12-15' },
    });
    // No yardstick-relative framing exists to differ: the verdict is identical
    // either way, because no term-relative adjustment is built yet (module doc).
    expect(withoutWindow.status).toBe('observed');
    expect(withWindow.status).toBe('observed');
    expect(withoutWindow.measured?.maxQuietDays).toBe(withWindow.measured?.maxQuietDays);
    expect(withoutWindow.measured?.hadTermWindow).toBe(false);
    expect(withWindow.measured?.hadTermWindow).toBe(true);
  });

  it('declines rather than reporting a negative quiet gap on bad input', () => {
    const future = shiftedDay(-5); // an "arrival" five days from now
    const result = detectRhythm({ today: TODAY, courses: [course('C1', 0)] });
    expect(result.status).not.toBe('observed');
    const badResult = detectRhythm({
      today: TODAY,
      courses: [{ course: 'C1', lastMaterialArrivalDay: future }],
    });
    expect(badResult.measured?.courses[0]?.status).toBe('not-enough-history');
    expect(badResult.measured?.courses[0]?.quietDays).toBeNull();
    // sanity: the constant this whole suite leans on is what the clause names
    expect(QUIET_DAYS_THRESHOLD).toBe(21);
  });
});
