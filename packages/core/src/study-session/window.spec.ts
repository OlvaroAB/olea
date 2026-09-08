/**
 * `[FOCUS-3b]` (`ol-ulj7`). Scenarios: `features/F6-today.md` (olea-service),
 * the C5.6 window-deficit block — `@auto:core/study-session/compose.spec`
 * (the feature-level cases live in `compose.spec.ts`, wired through the
 * composer; this file is the unit-level proof of the arithmetic itself).
 */

import { describe, expect, it } from 'vitest';
import type { CalendarDay } from '../today/calendar-day.js';
import {
  computeWindowDeficit,
  type PastSessionRecord,
  WINDOW_SLACK_SESSIONS,
  windowWidthSessions,
} from './window.js';

function session(
  day: CalendarDay,
  eligibleCourses: readonly string[],
  received: Readonly<Record<string, number>>,
  entitlement?: Readonly<Record<string, number>>,
): PastSessionRecord {
  return {
    asOf: day,
    eligibleCourses,
    received: new Map(Object.entries(received)),
    ...(entitlement !== undefined ? { entitlement: new Map(Object.entries(entitlement)) } : {}),
  };
}

describe('[FOCUS-3b] windowWidthSessions', () => {
  it("is running courses plus D-092's own slack (2)", () => {
    expect(WINDOW_SLACK_SESSIONS).toBe(2);
    expect(windowWidthSessions(2)).toBe(4);
    expect(windowWidthSessions(3)).toBe(5);
  });
});

describe('[FOCUS-3b] computeWindowDeficit', () => {
  it('a course absent for courses + 1 sessions accrues the largest deficit', () => {
    // 2 running courses -> window width 4. ALPHA served every session at its
    // 0.5 share; BETA never served across all 4 windowed sessions despite
    // being eligible (and entitled 0.5) throughout.
    const history: PastSessionRecord[] = [
      session('2026-09-01', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
      session('2026-09-03', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
      session('2026-09-05', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
      session('2026-09-07', ['ALPHA', 'BETA'], { ALPHA: 300 }, { ALPHA: 0.5, BETA: 0.5 }),
    ];
    const currentShares = new Map([
      ['ALPHA', 0.5],
      ['BETA', 0.5],
    ]);
    const result = computeWindowDeficit(history, ['ALPHA', 'BETA'], currentShares);

    // ALPHA is the only course receiving anything each session, so it reads
    // 100% of what was actually received (not 50%) every time — running well
    // AHEAD of its 0.5 entitlement, a real negative deficit.
    expect(result.get('ALPHA')?.deficit).toBeCloseTo(-2);
    // BETA: entitled 0.5, received 0, every one of the 4 windowed sessions.
    expect(result.get('BETA')?.deficit).toBeCloseTo(2);
    // Never served anywhere in the WHOLE supplied history (all 4 entries) —
    // the unbounded "never seen" reading, not a bounded count of 4.
    expect(result.get('BETA')?.sessionsSinceLastServed).toBe(Number.POSITIVE_INFINITY);
    expect((result.get('BETA')?.deficit ?? 0) > (result.get('ALPHA')?.deficit ?? 0)).toBe(true);
  });

  it('a refused (ineligible) session accrues nothing for the refused course', () => {
    // GAMMA is refused (absent from eligibleCourses) every session it does
    // not appear in — its deficit must stay 0, not read as "owed and unpaid".
    const history: PastSessionRecord[] = [
      session('2026-09-01', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
      session('2026-09-03', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
      session('2026-09-05', ['ALPHA'], { ALPHA: 600 }, { ALPHA: 1 }),
    ];
    const currentShares = new Map([
      ['ALPHA', 1],
      ['GAMMA', 0],
    ]);
    const result = computeWindowDeficit(history, ['ALPHA', 'GAMMA'], currentShares);

    expect(result.get('GAMMA')?.deficit).toBe(0);
    expect(result.get('GAMMA')?.sessionsSinceLastServed).toBe(Number.POSITIVE_INFINITY);
    expect(result.get('ALPHA')?.deficit).toBeCloseTo(0);
  });

  it('only the last windowWidthSessions entries feed the deficit sum', () => {
    // 2 running courses -> width 4. BETA starved for 2 sessions OUTSIDE the
    // window (older than the last 4) and served in full for the 4 sessions
    // inside it -- the deficit must read 0, not carry the older starvation.
    const history: PastSessionRecord[] = [
      session('2026-08-20', ['ALPHA', 'BETA'], { ALPHA: 600 }, { ALPHA: 0.5, BETA: 0.5 }), // outside window
      session('2026-08-22', ['ALPHA', 'BETA'], { ALPHA: 600 }, { ALPHA: 0.5, BETA: 0.5 }), // outside window
      session(
        '2026-08-24',
        ['ALPHA', 'BETA'],
        { ALPHA: 300, BETA: 300 },
        { ALPHA: 0.5, BETA: 0.5 },
      ),
      session(
        '2026-08-26',
        ['ALPHA', 'BETA'],
        { ALPHA: 300, BETA: 300 },
        { ALPHA: 0.5, BETA: 0.5 },
      ),
      session(
        '2026-08-28',
        ['ALPHA', 'BETA'],
        { ALPHA: 300, BETA: 300 },
        { ALPHA: 0.5, BETA: 0.5 },
      ),
      session(
        '2026-08-30',
        ['ALPHA', 'BETA'],
        { ALPHA: 300, BETA: 300 },
        { ALPHA: 0.5, BETA: 0.5 },
      ),
    ];
    const currentShares = new Map([
      ['ALPHA', 0.5],
      ['BETA', 0.5],
    ]);
    const result = computeWindowDeficit(history, ['ALPHA', 'BETA'], currentShares);

    expect(result.get('BETA')?.deficit).toBeCloseTo(0);
    // But the unbounded `sessionsSinceLastServed` still reads 0 -- it was
    // served last session, regardless of the window truncation.
    expect(result.get('BETA')?.sessionsSinceLastServed).toBe(0);
  });

  it('falls back to currentShares when a session carries no entitlement of its own', () => {
    const history: PastSessionRecord[] = [
      session('2026-09-01', ['ALPHA', 'BETA'], { ALPHA: 600 }), // no entitlement map at all
    ];
    const currentShares = new Map([
      ['ALPHA', 0.5],
      ['BETA', 0.5],
    ]);
    const result = computeWindowDeficit(history, ['ALPHA', 'BETA'], currentShares);

    // BETA: entitled 0.5 (from currentShares), received 0 -> deficit 0.5.
    expect(result.get('BETA')?.deficit).toBeCloseTo(0.5);
    expect(result.get('ALPHA')?.deficit).toBeCloseTo(-0.5);
  });

  it('a course with no history at all reads no accrued debt, but "never served"', () => {
    const result = computeWindowDeficit([], ['ALPHA'], new Map());
    expect(result.get('ALPHA')?.deficit).toBe(0);
    expect(result.get('ALPHA')?.sessionsSinceLastServed).toBe(Number.POSITIVE_INFINITY);
  });

  it('a negative deficit (running ahead of share) is not clamped to zero', () => {
    const history: PastSessionRecord[] = [
      session(
        '2026-09-01',
        ['ALPHA', 'BETA'],
        { ALPHA: 900, BETA: 100 },
        { ALPHA: 0.5, BETA: 0.5 },
      ),
    ];
    const result = computeWindowDeficit(history, ['ALPHA', 'BETA'], new Map());
    expect(result.get('ALPHA')?.deficit).toBeCloseTo(0.5 - 0.9);
    expect((result.get('ALPHA')?.deficit ?? 0) < 0).toBe(true);
  });
});
