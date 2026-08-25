/**
 * CHK-1 — component register row 3.4's health check: **"set the weight to 1
 * and assert the gap view returns the ranking's order exactly."**
 *
 * `gap/readiness.ts`'s own contract: `mcqRecognitionWeight: 1` disables the
 * MCQ-recognition weighting entirely, and every concept's `gapScore` is then
 * its oracle `priorityScore` multiplied by exactly `1`. That is a claim
 * about the ARITHMETIC; this checks the CONSEQUENCE, which is the thing a
 * regression could actually break without touching that arithmetic at all —
 * a sort comparator with an unstable tie-break, an off-by-one in how the
 * weighted scores are re-ordered, a second field silently joined into the
 * sort key. If the gap view's own order at weight 1 ever stops matching the
 * oracle's, one of those has happened, whatever the multiplication itself
 * still says.
 *
 * Same division of labour as `rank-factor-ablation.ts`: computing the two
 * orders is the caller's job (run `rankOracle` once, then whatever produces
 * the gap view's order with `mcqRecognitionWeight: 1`); this function only
 * compares them.
 */
import type { CheckVerdict } from './types.js';

export interface GapWeightIdentityMeasured {
  readonly compared: number;
  /** Index of the first divergence, or `null` if the sequences matched throughout what was compared. */
  readonly mismatchedAt: number | null;
  readonly lengthsMatch: boolean;
}

/**
 * `oracleOrder` — the ranking's own concept order for one course.
 * `gapOrderAtWeightOne` — the gap view's concept order for the same course,
 * computed with the MCQ-recognition weight forced to `1`. Both are opaque
 * concept keys, never display names, and both are expected over the SAME
 * course and the SAME input — comparing across courses or across a stale
 * ranking is a caller error this function cannot see.
 */
export function checkGapWeightIdentity(
  oracleOrder: readonly string[],
  gapOrderAtWeightOne: readonly string[],
): CheckVerdict<GapWeightIdentityMeasured> {
  const lengthsMatch = oracleOrder.length === gapOrderAtWeightOne.length;
  const compared = Math.max(oracleOrder.length, gapOrderAtWeightOne.length);
  let mismatchedAt: number | null = null;
  if (!lengthsMatch) {
    mismatchedAt = Math.min(oracleOrder.length, gapOrderAtWeightOne.length);
  } else {
    for (let i = 0; i < oracleOrder.length; i += 1) {
      if (oracleOrder[i] !== gapOrderAtWeightOne[i]) {
        mismatchedAt = i;
        break;
      }
    }
  }

  const measured: GapWeightIdentityMeasured = { compared, mismatchedAt, lengthsMatch };

  if (compared === 0) {
    return { ok: false, measured, detail: 'no concepts supplied to compare' };
  }
  if (mismatchedAt !== null) {
    return {
      ok: false,
      measured,
      detail: lengthsMatch
        ? `gap order at weight 1 diverges from the oracle order at position ${mismatchedAt} of ${compared}`
        : `gap order at weight 1 has ${gapOrderAtWeightOne.length} concepts against the oracle's ${oracleOrder.length}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `gap order at weight 1 matches the oracle order across ${compared} concepts`,
  };
}
