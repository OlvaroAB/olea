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
