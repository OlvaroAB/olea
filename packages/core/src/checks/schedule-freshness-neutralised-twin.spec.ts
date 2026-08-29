/**
 * The planted-failure self-test row 4.4 names, applied to the
 * calendar-schedule path: construct a course genuinely gone quiet and its
 * neutralised twin (the identical course with the quiet signal replaced by
 * material actually having arrived), run the real `computeCourseFreshness`
 * on each, and hand both statuses to `checkScheduleFreshnessNeutralisedTwin`.
 *
 * Same posture as `./rhythm-neutralised-twin.spec.ts`: there is no
 * synthetic-persona generator for calendar schedules, so the constructed
 * terms here are hand-built. Ids and course codes are opaque or generic
 * fixture-shaped strings (INV-3) — none is a real course code or note title.
 *
 * **Five pairs, each isolating a different way `computeCourseFreshness` can
 * fail to tell "gone quiet" from "between cycles" apart:**
 *
 * 1. Direct/observed branch — a calendar-recorded session goes unmatched by
 *    any arrival, comfortably past the grace margin, vs. the same schedule
 *    with the material actually arrived.
 * 2. Extrapolation branch — the synced window has gone stale but a recurring
 *    weekday pattern is still well within `EXTRAPOLATION_BOUND_WEEKS`, vs.
 *    the same schedule with the material arrived.
 * 3. **The extrapolation-basis boundary** — the same extrapolation branch,
 *    constructed as close to `EXTRAPOLATION_BOUND_WEEKS` as the grace margin
 *    allows (27 of the 28 trusted days) — the case where an off-by-one in
 *    the trust window would first show up as a spurious fire on the twin.
 * 4. Direct/observed branch again, at a larger magnitude (a whole term of
 *    silence vs. a schedule that is current) — the same shape as pair 1,
 *    checked at a different scale, the same way `rhythm-neutralised-twin
 *    .spec.ts`'s own corpus repeats magnitudes.
 * 5. **The grace-margin boundary** (`ARRIVAL_GRACE_DAYS`) — a session
 *    exactly one full day overdue (real) vs. the identical schedule read one
 *    day earlier, the same day the session itself falls (twin) — the
 *    narrowest gap the grace margin is meant to absorb.
 */
import { describe, expect, it } from 'vitest';
import { computeCourseFreshness } from '../schedule/freshness.js';
import type { CourseFreshnessStatus } from '../schedule/types.js';
import {
  checkScheduleFreshnessNeutralisedTwin,
  type ScheduleFreshnessTwinCase,
} from './schedule-freshness-neutralised-twin.js';

/** Nine weekly Monday sessions — a stable recurring pattern every pair below starts from. */
const NINE_MONDAYS = [
  '2026-07-06',
  '2026-07-13',
  '2026-07-20',
  '2026-07-27',
  '2026-08-03',
  '2026-08-10',
  '2026-08-17',
  '2026-08-24',
  '2026-08-31',
];

function statusFor(
  courseCode: string,
  matchedDates: readonly string[],
  lastArrivalDay: string | null,
  today: string,
): CourseFreshnessStatus {
  return computeCourseFreshness(courseCode, matchedDates, lastArrivalDay, today).status;
}

/**
 * One constructed pair per row. `real` and `twin` each carry the arguments
 * `computeCourseFreshness` needs beyond the shared matched-dates schedule —
 * differing only in `lastArrivalDay`/`today`, the quiet signal itself, never
 * in the underlying weekly pattern.
 */
const CONSTRUCTED_PAIRS: ReadonlyArray<{
  readonly id: string;
  readonly matchedDates: readonly string[];
  readonly real: { readonly lastArrivalDay: string | null; readonly today: string };
  readonly twin: { readonly lastArrivalDay: string | null; readonly today: string };
}> = [
  {
    // Direct/observed: nothing has arrived since the third session; five
    // later sessions sit unmatched, well past the grace margin.
    id: 'observed-quiet-vs-between-cycles',
    matchedDates: NINE_MONDAYS,
    real: { lastArrivalDay: '2026-07-20', today: '2026-09-14' },
    twin: { lastArrivalDay: '2026-09-02', today: '2026-09-14' },
  },
  {
    // Extrapolation, general: the last session material arrived, but the
    // schedule's own weekly pattern says another session was due three
    // weeks past the synced window and it has not shown up.
    id: 'extrapolated-quiet-vs-between-cycles',
    matchedDates: NINE_MONDAYS,
    real: { lastArrivalDay: '2026-08-31', today: '2026-09-22' },
    twin: { lastArrivalDay: '2026-09-21', today: '2026-09-22' },
  },
  {
    // The extrapolation-basis boundary: 27 of the 28 trusted days, the
    // closest the grace margin allows the trusted-extrapolation branch to
    // sit next to EXTRAPOLATION_BOUND_WEEKS without crossing it.
    id: 'extrapolation-edge-of-trust-quiet-vs-between-cycles',
    matchedDates: NINE_MONDAYS,
    real: { lastArrivalDay: '2026-08-31', today: '2026-09-27' },
    twin: { lastArrivalDay: '2026-09-21', today: '2026-09-27' },
  },
  {
    // Direct/observed, larger magnitude: nothing has arrived since the very
    // first session — a whole term of silence — vs. a schedule current
    // through its most recent session.
    id: 'a-term-of-silence-vs-a-current-schedule',
    matchedDates: NINE_MONDAYS,
    real: { lastArrivalDay: '2026-07-06', today: '2026-09-14' },
    twin: { lastArrivalDay: '2026-09-07', today: '2026-09-14' },
  },
  {
    // The grace-margin boundary (ARRIVAL_GRACE_DAYS = 1): the second session
    // is exactly one full day overdue (real) vs. read on the very day that
    // session falls, before the margin has had a chance to elapse (twin).
    id: 'grace-margin-boundary-quiet-vs-same-day-session',
    matchedDates: ['2026-08-03', '2026-08-10'],
    real: { lastArrivalDay: null, today: '2026-08-11' },
    twin: { lastArrivalDay: '2026-08-03', today: '2026-08-10' },
  },
];

function buildCases(): readonly ScheduleFreshnessTwinCase[] {
  return CONSTRUCTED_PAIRS.map(({ id, matchedDates, real, twin }) => ({
    id,
    realStatus: statusFor(`${id}-real`, matchedDates, real.lastArrivalDay, real.today),
    neutralisedStatus: statusFor(`${id}-twin`, matchedDates, twin.lastArrivalDay, twin.today),
  }));
}

describe('checkScheduleFreshnessNeutralisedTwin', () => {
  it('separates every constructed genuinely-quiet course from its neutralised twin', () => {
    const verdict = checkScheduleFreshnessNeutralisedTwin(buildCases());
    expect(verdict.measured.decorative).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('reports the exact false-positive count on twins, and does not gate on it', () => {
    // Real construction: every twin here is built so the material has
    // genuinely arrived (or the session has not yet fallen due), so this
    // corpus's own measured rate is 0/5 — stated as a fact about THIS
    // corpus, not a claim the reading is false-positive-free in general.
    const verdict = checkScheduleFreshnessNeutralisedTwin(buildCases());
    expect(verdict.measured.n).toBe(5);
    expect(verdict.measured.falsePositiveOnTwin).toEqual([]);
  });

  it('every real case reads a not-arrived status, and every twin reads arrived', () => {
    for (const c of buildCases()) {
      expect(c.realStatus).not.toBe('arrived');
      expect(c.neutralisedStatus).toBe('arrived');
    }
  });

  it('the extrapolation-basis boundary pair is where a trust-window off-by-one would show up first, and it does not here', () => {
    const boundary = buildCases().find(
      (c) => c.id === 'extrapolation-edge-of-trust-quiet-vs-between-cycles',
    );
    expect(boundary?.realStatus).toBe('not-arrived-with-yardstick');
    expect(boundary?.neutralisedStatus).toBe('arrived');
  });

  it('the grace-margin boundary pair is where an off-by-one there would show up first, and it does not here', () => {
    const boundary = buildCases().find(
      (c) => c.id === 'grace-margin-boundary-quiet-vs-same-day-session',
    );
    expect(boundary?.realStatus).toBe('not-arrived-with-yardstick');
    expect(boundary?.neutralisedStatus).toBe('arrived');
  });

  it('fails as decorative when a real case and its twin are constructed identically', () => {
    const status = statusFor('same-course', NINE_MONDAYS, '2026-08-31', '2026-09-14');
    const decorativeCase: ScheduleFreshnessTwinCase = {
      id: 'identical-by-construction',
      realStatus: status,
      neutralisedStatus: status,
    };
    const verdict = checkScheduleFreshnessNeutralisedTwin([decorativeCase]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.decorative).toEqual(['identical-by-construction']);
  });

  it('fails on zero cases (N-013)', () => {
    const verdict = checkScheduleFreshnessNeutralisedTwin([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });

  it('would report, not fail, if a twin ever fired a not-arrived status', () => {
    // Adversarially constructed so the two statuses differ (not decorative)
    // while the twin itself still reads not-arrived — isolates that
    // `falsePositiveOnTwin` is reported independently of the decorative
    // check, and never fails it on its own.
    const adversarial: ScheduleFreshnessTwinCase = {
      id: 'twin-fires-anyway',
      realStatus: 'not-arrived-no-yardstick',
      neutralisedStatus: 'not-arrived-with-yardstick',
    };
    const verdict = checkScheduleFreshnessNeutralisedTwin([adversarial]);
    expect(verdict.measured.falsePositiveOnTwin).toEqual(['twin-fires-anyway']);
    expect(verdict.measured.decorative).toEqual([]);
    expect(verdict.ok).toBe(true); // a false positive on the twin never fails this check
  });
});
