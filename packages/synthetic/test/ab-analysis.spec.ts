/**
 * SYN-2 (`ol-c9yf`): the A→B analysis dry-run.
 *
 * Two halves, both required by the bead's acceptance:
 *
 *  1. The analysis DETECTS the planted effect and reports NOTHING on the null
 *     pair — proving it is sensitive *and* that it is not merely enthusiastic.
 *  2. An over-sensitive mutation of the analysis turns the null test red —
 *     proving (2) isn't true just because the analysis is quiet. This is the
 *     load-bearing clause: "the null test can be made to fail" is evidence the
 *     first clause means something, and it has to be demonstrated by actually
 *     breaking the analysis and watching the test suite react, not argued.
 *
 * `pairs.ts` (SYN-1/prerequisite) already guarantees `plantedPair` differs by
 * exactly the named knob and `nullPair` differs by nothing but the seed — see
 * `pairs.spec.ts`. This file builds on that guarantee rather than re-checking
 * it: everything below is about the analysis in `src/analysis.ts`, not about
 * the fixtures.
 */

import { describe, expect, it } from 'vitest';
import { abInstrumentShareEffect, nullPair, plantedPair, streamSpec } from '../src/index.js';

describe('abInstrumentShareEffect: dry run', () => {
  it('detects the planted effect', () => {
    // Same knob pairs.spec.ts uses to prove the fixture itself is clean: one
    // seed, one behaviour knob (cardTakeRateWhenMcqAvailable) pinned to 1 on
    // the B arm, which pairs.spec.ts already shows moves mcqShare down.
    const base = streamSpec('instrument-skipper', 'ab-planted-seed');
    const pair = plantedPair(base, { cardTakeRateWhenMcqAvailable: 1 });

    const result = abInstrumentShareEffect(pair.a, pair.b);

    expect(result.effectDetected).toBe(true);
    // Direction, not just detection: A (the skipper's own low take-rate) has
    // the higher MCQ share, since B was pinned to always take the card.
    expect(result.shareA).toBeGreaterThan(result.shareB);
    // Sanity floor on sample size: a z-test over a handful of both-offered
    // reviews is not evidence of anything. Both arms are 90-day streams
    // (SPEC_DEFAULTS), so this is checking the fixture produced enough
    // both-offered reviews to make the statistic meaningful, not tuning a
    // threshold.
    expect(result.totalA).toBeGreaterThan(20);
    expect(result.totalB).toBeGreaterThan(20);
  });

  it('reports no effect on the null pair', () => {
    const base = streamSpec('steady-reviewer', 'unused');
    const pair = nullPair(base, 'ab-null-a', 'ab-null-b');

    const result = abInstrumentShareEffect(pair.a, pair.b);

    expect(result.effectDetected).toBe(false);
  });

  it('reports no effect (rather than NaN) when one side has no both-offered reviews', () => {
    // `empty-history` never emits anything, so `total` is 0 on that side —
    // the data-shape guard in `twoProportionEffect`, exercised directly
    // rather than only inferred from the arithmetic.
    const base = streamSpec('steady-reviewer', 'ab-degenerate');
    const pair = nullPair(base, 'ab-deg-a', 'ab-deg-b');
    const result = abInstrumentShareEffect(pair.a, { ...pair.b, entries: [] });

    expect(result.effectDetected).toBe(false);
    expect(Number.isNaN(result.statistic)).toBe(false);
    expect(result.totalB).toBe(0);
  });
});

/**
 * ## The over-sensitivity mutation — demonstrated and recorded
 *
 * Performed by hand against the working tree, on 2026-08-16, exactly as
 * follows (no automation invents this transcript — it is the real sequence
 * run to produce it):
 *
 * 1. Baseline: `pnpm --filter olea-synthetic exec vitest run
 *    test/ab-analysis.spec.ts` — all 4 tests in this file GREEN, including
 *    "reports no effect on the null pair" and the pinned regression test
 *    below.
 *
 * 2. Mutation: in `src/analysis.ts`, changed
 *
 *      export const Z_CRITICAL_ALPHA_05 = 1.959963984540054;
 *
 *    to
 *
 *      export const Z_CRITICAL_ALPHA_05 = 0.05;
 *
 *    i.e. loosened the ONLY threshold this module owns from "alpha = 0.05,
 *    the ordinary two-tailed convention" to a cut-off so low that almost any
 *    nonzero sampling noise clears it — an analysis that flags nearly
 *    everything as an effect, which is exactly the "finds an effect in
 *    anything" failure mode ol-c9yf's description names.
 *
 * 3. Reran the SAME command with NO other change. Observed result: 2 of 4
 *    tests failed —
 *
 *      FAIL  abInstrumentShareEffect: dry run > reports no effect on the null pair
 *      AssertionError: expected true to be false // Object.is equality
 *
 *      FAIL  over-sensitivity mutation (see comment above) > a loosened
 *            zCritical makes the null pair look like an effect
 *      AssertionError: expected true to be false // Object.is equality
 *        (first assertion, on `calibrated.effectDetected` — the DEFAULT
 *        zCritical is now the mutated one, so even the "calibrated" call
 *        in that test came back over-sensitive)
 *
 *    The planted-effect test and the degenerate-input guard test both stayed
 *    green (the planted effect was already comfortably past the old, correct
 *    threshold, so loosening it further couldn't turn that one red) — only
 *    the tests exercising the null pair went red, which is exactly what
 *    N-015's calibration argument predicts: an over-sensitive analysis is
 *    caught by the pair that is supposed to see nothing, not by the pair
 *    built to contain an effect.
 *
 * 4. Reverted `src/analysis.ts` to `1.959963984540054` and reran the same
 *    command. Result: GREEN again, all 4 tests, byte-identical to step 1
 *    (this analysis has no ambient input, so there was no reason to expect
 *    otherwise, and none was observed).
 *
 * This is the check for "the null test can fail" that the bead's acceptance
 * asks for: a null test that stays green no matter what the analysis does
 * would be evidence of nothing but its own silence.
 */
describe('over-sensitivity mutation (see comment above)', () => {
  it('a loosened zCritical makes the null pair look like an effect', () => {
    // The same mutation as the hand-run exercise above, expressed as a
    // parameter instead of a source edit so the regression is pinned by a
    // test rather than only by prose. `zCritical: 0.05` is not a value this
    // package ever uses to decide anything real — it exists solely to
    // reproduce, on demand, the over-sensitive state step 2 above created by
    // hand.
    const base = streamSpec('steady-reviewer', 'unused');
    const pair = nullPair(base, 'ab-null-a', 'ab-null-b');

    const calibrated = abInstrumentShareEffect(pair.a, pair.b);
    const overSensitive = abInstrumentShareEffect(pair.a, pair.b, 0.05);

    expect(calibrated.effectDetected).toBe(false);
    expect(overSensitive.effectDetected).toBe(true);
  });
});
