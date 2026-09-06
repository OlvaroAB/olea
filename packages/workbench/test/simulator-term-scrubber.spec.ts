/**
 * `simulator/term-scrubber.ts`'s pure date arithmetic (`ol-3ux7.64.16`
 * [WBX-13]). `renderTermScrubber` itself builds real DOM (`createDiv`/
 * `createEl`, the obsidian-shim extensions) and is exercised only by
 * Playwright (`e2e/simulator/lived-term.spec.ts`) — same story as
 * `shell.ts`'s own DOM builders, which this package's plain-Node Vitest
 * environment has no `document` to run. What is unit-tested here is the
 * offset math the scrubber and `controller.ts`'s `scrubTo` both depend on
 * agreeing about.
 */
import { describe, expect, it } from 'vitest';
import {
  daysSinceAsOf,
  SCRUBBER_MAX_DAYS,
  SCRUBBER_TERM_WEEKS,
  scrubberDateAt,
  scrubberMinDays,
} from '../src/simulator/term-scrubber.js';

describe('SCRUBBER_MAX_DAYS', () => {
  it('is SCRUBBER_TERM_WEEKS whole weeks', () => {
    expect(SCRUBBER_MAX_DAYS).toBe(SCRUBBER_TERM_WEEKS * 7);
  });
});

describe('scrubberDateAt', () => {
  it('day 0 is asOf itself', () => {
    expect(scrubberDateAt('2026-08-28', 0)).toBe('2026-08-28');
  });

  it('adds whole days, crossing a month boundary', () => {
    expect(scrubberDateAt('2026-08-28', 4)).toBe('2026-09-01');
  });

  it('reaches exactly SCRUBBER_MAX_DAYS past asOf', () => {
    expect(scrubberDateAt('2026-08-28', SCRUBBER_MAX_DAYS)).toBe('2026-12-18');
  });

  it("is the exact inverse of daysSinceAsOf over the scrubber's own bounded range", () => {
    const asOf = '2026-08-28';
    for (const days of [0, 1, 7, 30, SCRUBBER_MAX_DAYS]) {
      expect(daysSinceAsOf(asOf, scrubberDateAt(asOf, days))).toBe(days);
    }
  });
});

describe('daysSinceAsOf', () => {
  it('is 0 at asOf', () => {
    expect(daysSinceAsOf('2026-08-28', '2026-08-28')).toBe(0);
  });

  it('counts whole days forward', () => {
    expect(daysSinceAsOf('2026-08-28', '2026-09-04')).toBe(7);
  });

  it('clamps a day before asOf to 0 — the scrubber never scrubs earlier than the snapshot', () => {
    expect(daysSinceAsOf('2026-08-28', '2026-08-01')).toBe(0);
  });

  it('clamps a day past the declared window to SCRUBBER_MAX_DAYS', () => {
    expect(daysSinceAsOf('2026-08-28', '2028-01-01')).toBe(SCRUBBER_MAX_DAYS);
  });
});

/**
 * The backward reach (`ol-3ux7.5.57.13` [MOM-9b], F9.S17). A seeded persona
 * world declares its own term start in `world.json`'s `streamSpec.startDate`;
 * every other world declares none, and keeps exactly the forward-only range
 * it had before this feature. The two worlds the PUBLIC build can produce —
 * fixture, and the real snapshot — are both in the second group, which is
 * what makes this private-build-only without a build-mode flag anywhere in
 * the client.
 */
describe('scrubberMinDays', () => {
  it('is 0 when the world declares no term start — the public build is unchanged', () => {
    expect(scrubberMinDays('2026-08-28', undefined)).toBe(0);
  });

  it("reaches back to a persona world's declared term start", () => {
    // The three first-cycle persona worlds all declare 2026-05-04 / asOf 2026-08-28.
    expect(scrubberMinDays('2026-08-28', '2026-05-04')).toBe(-116);
  });

  it('never inverts its own bounds for a start on or after asOf', () => {
    expect(scrubberMinDays('2026-08-28', '2026-08-28')).toBe(0);
    expect(scrubberMinDays('2026-08-28', '2026-09-30')).toBe(0);
  });

  it('ignores a malformed start rather than throwing', () => {
    expect(scrubberMinDays('2026-08-28', 'not-a-day')).toBe(0);
  });

  it('is the exact inverse of scrubberDateAt across the whole seeded range', () => {
    const asOf = '2026-08-28';
    const min = scrubberMinDays(asOf, '2026-05-04');
    expect(scrubberDateAt(asOf, min)).toBe('2026-05-04');
    for (const days of [min, -91, -42, -1, 0, 7, SCRUBBER_MAX_DAYS]) {
      expect(daysSinceAsOf(asOf, scrubberDateAt(asOf, days), min)).toBe(days);
    }
  });
});

describe('daysSinceAsOf with a negative lower bound', () => {
  it('counts whole days BACK from asOf once a term start is declared', () => {
    const min = scrubberMinDays('2026-08-28', '2026-05-04');
    expect(daysSinceAsOf('2026-08-28', '2026-08-21', min)).toBe(-7);
    expect(daysSinceAsOf('2026-08-28', '2026-05-04', min)).toBe(min);
  });

  it('still clamps below the declared term start — never earlier than the world begins', () => {
    const min = scrubberMinDays('2026-08-28', '2026-05-04');
    expect(daysSinceAsOf('2026-08-28', '2025-01-01', min)).toBe(min);
  });

  it('clamps to 0 when no term start was declared, exactly as before', () => {
    expect(daysSinceAsOf('2026-08-28', '2026-05-04')).toBe(0);
  });
});
