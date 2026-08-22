/**
 * The A→B analysis instrument SYN-2 (`ol-c9yf`) dry-runs before it ever meets
 * real data.
 *
 * The question this answers is the one `ol-p5t07` (F2.8) exists to answer:
 * "did a change to queue composition actually change what she studied, or is
 * whatever we're looking at just noise." This module answers one *instance* of
 * that question — did the share of MCQ-vs-card answers, counted only where
 * both were on offer, change between two streams — because that is exactly
 * what `instrumentShareWhenBothOffered` already measures (`measures.ts`, the
 * spec amendment's second early-warning signal) and exactly what
 * `plantedPair`'s `cardTakeRateWhenMcqAvailable` knob moves (`pairs.ts`). A
 * dry run over that pair is therefore a dry run of *this* statistic, not a
 * stand-in for it. `ol-p5t07`'s real analysis over real D7.1 findings may need
 * other statistics for other questions; this one is scoped to what SYN-2 can
 * actually exercise against known ground truth.
 *
 * ## The statistic, and why
 *
 * A two-proportion z-test with pooled variance under the null of equal
 * proportions — the ordinary test for "did the share of a binary outcome
 * change between two samples." It was chosen, not invented: it is the
 * standard test for exactly this shape of question, with a closed-form
 * statistic and p-value, not a hand-picked cut-off on `mcqShare`'s raw
 * difference.
 *
 * **Free parameters: one.** `Z_CRITICAL_ALPHA_05`, the significance cut-off
 * (two-tailed, alpha = 0.05, z ≈ 1.96 — the ordinary statistical convention).
 * It was **not** swept or fit against any distribution this package generates
 * — it is the standard value used for this test regardless of what data feeds
 * it. That is what keeps this from repeating run 14's shape (CLAUDE.md,
 * "verifying the numbers is not verifying the conclusion"): there was no
 * search over candidate thresholds scored on the very pairs this module is
 * dry-run against below.
 *
 * It is still marked **`synthetic-provisional`** (N-015), for a narrower
 * reason than usual: the z-test's validity rests on an independence
 * assumption — each review is treated as an independent Bernoulli draw — that
 * has never been checked against real review-log behaviour. If her real
 * reviews cluster (e.g. she resolves a run of MCQ-vs-card decisions in one
 * sitting, correlated with a mood or a deck she's in), the effective sample
 * size is smaller than raw `total`, and this test is more liberal than its
 * nominal 5% suggests. Nothing here may gate anything about the real alpha
 * user until that is checked (eval/CLAUDE.md, olea-service).
 */

import type { SyntheticStream } from './generate.js';
import { instrumentShareWhenBothOffered } from './measures.js';

/**
 * synthetic-provisional (N-015; see module doc above) — the two-tailed
 * z-critical value for alpha = 0.05, i.e. the `z` such that
 * `P(|Z| > z) = 0.05` under the standard normal. Not fit against this
 * package's output; still provisional because the test's independence
 * assumption is unchecked against real data.
 */
export const Z_CRITICAL_ALPHA_05 = 1.959963984540054;

export interface TwoProportionResult {
  readonly countA: number;
  readonly totalA: number;
  readonly shareA: number;
  readonly countB: number;
  readonly totalB: number;
  readonly shareB: number;
  /** Pooled-variance z statistic for the difference `shareA - shareB`. */
  readonly statistic: number;
  /** Two-tailed p-value for `statistic` under the standard normal. */
  readonly pValue: number;
  /** `|statistic| > zCritical`. The one decision this module adds on top of a descriptive share. */
  readonly effectDetected: boolean;
  /** The z-critical actually used to decide `effectDetected`, for legibility (and for the mutation test below). */
  readonly zCritical: number;
}

/**
 * Abramowitz & Stegun 7.1.26 — a deterministic rational approximation to
 * `erf`, max error 1.5e-7. Pure arithmetic, no platform dependency: same
 * input, same output, forever (house rule — see `rng.ts`).
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** Two-tailed p-value, `P(|Z| > |z|)`, for the standard normal — via `Φ(z) = (1 + erf(z/√2)) / 2`. */
function twoTailedPValue(z: number): number {
  const phi = (1 + erf(Math.abs(z) / Math.SQRT2)) / 2;
  return 2 * (1 - phi);
}

/**
 * Two-proportion z-test with pooled variance under the null of equal
 * proportions. `zCritical` defaults to `Z_CRITICAL_ALPHA_05` and is a
 * parameter precisely so the over-sensitivity mutation demonstrated in
 * `test/ab-analysis.spec.ts` can be expressed and reasoned about in the type
 * signature — but every call in this package other than that one mutation
 * test uses the default.
 */
export function twoProportionEffect(
  countA: number,
  totalA: number,
  countB: number,
  totalB: number,
  zCritical: number = Z_CRITICAL_ALPHA_05,
): TwoProportionResult {
  const shareA = totalA === 0 ? 0 : countA / totalA;
  const shareB = totalB === 0 ? 0 : countB / totalB;
  if (totalA === 0 || totalB === 0) {
    // No draws on one side: there is nothing to compare. Reported as "no
    // effect" rather than a NaN statistic — this is a data-shape guard, not a
    // threshold decision.
    return {
      countA,
      totalA,
      shareA,
      countB,
      totalB,
      shareB,
      statistic: 0,
      pValue: 1,
      effectDetected: false,
      zCritical,
    };
  }
  const pooled = (countA + countB) / (totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  const statistic = se === 0 ? 0 : (shareA - shareB) / se;
  const pValue = twoTailedPValue(statistic);
  return {
    countA,
    totalA,
    shareA,
    countB,
    totalB,
    shareB,
    statistic,
    pValue,
    effectDetected: Math.abs(statistic) > zCritical,
    zCritical,
  };
}

/**
 * The A→B analysis SYN-2 dry-runs: `twoProportionEffect` applied to
 * `instrumentShareWhenBothOffered` on each stream. Pure and deterministic —
 * given the same two streams it returns the same result, with no ambient
 * input of any kind.
 */
export function abInstrumentShareEffect(
  a: SyntheticStream,
  b: SyntheticStream,
  zCritical: number = Z_CRITICAL_ALPHA_05,
): TwoProportionResult {
  const sharesA = instrumentShareWhenBothOffered(a.entries);
  const sharesB = instrumentShareWhenBothOffered(b.entries);
  return twoProportionEffect(sharesA.mcq, sharesA.total, sharesB.mcq, sharesB.total, zCritical);
}
