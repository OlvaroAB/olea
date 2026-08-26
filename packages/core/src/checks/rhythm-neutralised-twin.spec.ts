/**
 * The planted-failure self-test row 4.4 names: construct a course genuinely
 * gone quiet and its neutralised twin (the identical course with the quiet
 * signal replaced by an ordinary between-lecture-cycle gap), run the real
 * `detectRhythm` on each, and hand both verdicts to
 * `checkRhythmNeutralisedTwin`.
 *
 * There is no synthetic-persona generator for course material arrivals (no
 * `olea-synthetic` stream carries one) so, unlike the cramming/effort checks
 * in `packages/workbench`, the constructed terms here are hand-built rather
 * than seeded — the register's own instruction is "run it over constructed
 * terms," not "over a generator." Ids are opaque (INV-3): no real course
 * code or note title appears anywhere in this file.
 */
import { describe, expect, it } from 'vitest';
import { detectRhythm, type RhythmStatus } from '../today/rhythm.js';
import { checkRhythmNeutralisedTwin, type RhythmTwinCase } from './rhythm-neutralised-twin.js';

const TODAY = '2026-09-30';

function shiftedDay(daysAgo: number): string {
  const ms = Date.parse(`${TODAY}T00:00:00.000Z`) - daysAgo * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function statusFor(course: string, quietDaysAgo: number): RhythmStatus {
  return detectRhythm({
    today: TODAY,
    courses: [{ course, lastMaterialArrivalDay: shiftedDay(quietDaysAgo) }],
  }).status;
}

/**
 * One constructed pair per row: `quietGap` is a genuinely-gone-quiet arrival
 * gap (comfortably clear of a month with no material); `twinGap` is the same
 * course with the quiet signal replaced by an ordinary between-lecture-cycle
 * gap — a short break, a reading week, or a fortnight between topics. Both
 * numbers are chosen in plain English, the same discipline every constant in
 * `../today/rhythm.js` uses, not swept to produce a result.
 */
const CONSTRUCTED_PAIRS: ReadonlyArray<{
  readonly id: string;
  readonly quietGapDays: number;
  readonly twinGapDays: number;
}> = [
  { id: 'a-month-vs-a-short-break', quietGapDays: 30, twinGapDays: 7 },
  { id: 'six-weeks-vs-a-reading-week', quietGapDays: 42, twinGapDays: 10 },
  { id: 'a-term-of-silence-vs-a-fortnight-gap', quietGapDays: 90, twinGapDays: 14 },
  { id: 'just-past-threshold-vs-just-under-it', quietGapDays: 22, twinGapDays: 20 },
  { id: 'two-months-vs-a-long-weekend', quietGapDays: 60, twinGapDays: 4 },
];

function buildCases(): readonly RhythmTwinCase[] {
  return CONSTRUCTED_PAIRS.map(({ id, quietGapDays, twinGapDays }) => ({
    id,
    realStatus: statusFor(`${id}-real`, quietGapDays),
    neutralisedStatus: statusFor(`${id}-twin`, twinGapDays),
  }));
}

describe('checkRhythmNeutralisedTwin', () => {
  it('separates every constructed genuinely-quiet course from its neutralised twin', () => {
    const verdict = checkRhythmNeutralisedTwin(buildCases());
    expect(verdict.measured.decorative).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('reports the exact false-positive count on twins, and does not gate on it', () => {
    // Real construction: every twin gap here is chosen well clear of
    // QUIET_DAYS_THRESHOLD (21), so this corpus's own measured rate is 0/5 —
    // stated as a fact about THIS corpus, not a claim the reading is
    // false-positive-free in general (the register leaves that undecided).
    const verdict = checkRhythmNeutralisedTwin(buildCases());
    expect(verdict.measured.n).toBe(5);
    expect(verdict.measured.falsePositiveOnTwin).toEqual([]);
  });

  it('the boundary pair is where a false positive would show up first, and it does not here', () => {
    const boundary = buildCases().find((c) => c.id === 'just-past-threshold-vs-just-under-it');
    expect(boundary?.realStatus).toBe('observed');
    expect(boundary?.neutralisedStatus).toBe('not-observed');
  });

  it('fails as decorative when a real case and its twin are constructed identically', () => {
    const decorativeCase: RhythmTwinCase = {
      id: 'identical-by-construction',
      realStatus: statusFor('same-course', 30),
      neutralisedStatus: statusFor('same-course', 30),
    };
    const verdict = checkRhythmNeutralisedTwin([decorativeCase]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.decorative).toEqual(['identical-by-construction']);
  });

  it('fails on zero cases (N-013)', () => {
    const verdict = checkRhythmNeutralisedTwin([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
  });

  it('would report, not fail, if a twin ever crossed the threshold', () => {
    // Adversarially constructed so the two statuses differ (not decorative)
    // while the twin itself still reads observed — isolates that
    // `falsePositiveOnTwin` is reported independently of the decorative
    // check, and never fails it on its own.
    const adversarial: RhythmTwinCase = {
      id: 'twin-crosses-threshold',
      realStatus: statusFor('real', 15), // not-observed
      neutralisedStatus: statusFor('twin', 25), // observed — the false positive
    };
    const verdict = checkRhythmNeutralisedTwin([adversarial]);
    expect(verdict.measured.falsePositiveOnTwin).toEqual(['twin-crosses-threshold']);
    expect(verdict.measured.decorative).toEqual([]);
    expect(verdict.ok).toBe(true); // a false positive on the twin never fails this check
  });
});
