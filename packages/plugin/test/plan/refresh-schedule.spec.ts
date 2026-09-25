/**
 * `refresh-schedule.ts` tests (`[D-167]`, `ol-egov.141.89.10.17`).
 *
 * `main.ts` cannot be loaded under Vitest at all (`obsidian`'s own
 * `package.json` `main` is `""`; see `test/main-wiring.spec.ts`'s module
 * doc), so this pure predicate is the one instrument that can assert the
 * scheduling logic directly. `test/main-wiring.spec.ts` separately asserts
 * (source-level) that `main.ts` actually wires it into the recurring tick
 * and into `refreshCachedStudyPlan`.
 *
 * Every `Date` below uses the local-time constructor form
 * (`new Date(year, monthIndex, day, hour, minute)`), the same basis
 * `localToday`'s own local getters read from — never an ISO string with an
 * embedded offset, whose `Date.getDate()`/`getMonth()`/`getFullYear()` read
 * back through the TEST HOST's own local zone rather than the offset in the
 * string, which would make this test's pass/fail depend on which
 * timezone happens to run it.
 *
 * Scenario: `features/F2-review.md`'s study-plan refresh coverage —
 * @auto:plugin/plan/refresh-schedule.spec.
 */
import { describe, expect, it } from 'vitest';
import { studyPlanRefreshDue } from '../../src/plan/refresh-schedule.js';

describe('studyPlanRefreshDue — [D-167]’s "the clock schedules the check"', () => {
  it('is due on the very first check of a session (never checked yet, lastCheckedDay null)', () => {
    expect(studyPlanRefreshDue(null, new Date(2026, 8, 25, 9, 0))).toBe(true);
  });

  it('is NOT due again on the same local day, even much later the same day (advancing the clock within a day never fires it)', () => {
    const lastCheckedDay = '2026-09-25';
    expect(studyPlanRefreshDue(lastCheckedDay, new Date(2026, 8, 25, 9, 0))).toBe(false);
    expect(studyPlanRefreshDue(lastCheckedDay, new Date(2026, 8, 25, 23, 59))).toBe(false);
  });

  it('IS due once the local day has advanced past lastCheckedDay — advancing the clock across a day boundary, without any reload, fires it', () => {
    const lastCheckedDay = '2026-09-25';
    expect(studyPlanRefreshDue(lastCheckedDay, new Date(2026, 8, 26, 0, 5))).toBe(true);
  });

  it('stays due across more than one elapsed day (a plugin left running over a weekend, say)', () => {
    const lastCheckedDay = '2026-09-25';
    expect(studyPlanRefreshDue(lastCheckedDay, new Date(2026, 8, 29, 12, 0))).toBe(true);
  });

  it('a day going backward (a clock correction) reads as due too — this predicate only ever compares equality, never orders the two days', () => {
    const lastCheckedDay = '2026-09-25';
    expect(studyPlanRefreshDue(lastCheckedDay, new Date(2026, 8, 24, 12, 0))).toBe(true);
  });
});
