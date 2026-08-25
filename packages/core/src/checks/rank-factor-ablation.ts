/**
 * CHK-1 — component register row 3.3's health check: **"drop each factor in
 * turn and re-rank — a factor whose removal does not change the top twenty
 * is decoration, and a factor that never varies across her concept set is
 * doing nothing."**
 *
 * `rankOracle` (`oracle/rank.ts`) combines five independent knobs into one
 * priority score per concept: yield rank, edge confidence, assessment
 * weight, exam proximity, and the mastery-need ladder. A formula with five
 * multiplied inputs can have inputs that never move the answer — a
 * miswired factor, a constant that collapsed to a single value across the
 * real data, a sign error that cancels against another term — and every one
 * of those failure modes still produces a ranking that looks exactly like a
 * working one, because a formula that ignores an input still multiplies
 * four others together and returns a number.
 *
 * **This module does the comparing, not the ranking.** Re-running
 * `rankOracle` with one factor neutralised is an algorithm call — the
 * caller's job (a harness script, in production the same place that would
 * ever run an ablation sweep), not a pure check's. What this function takes
 * is the RESULT of that work: the top-N concept order from the real ranking
 * and from each single-factor-neutralised re-run, already computed.
 * Comparing ORDERED sequences rather than sets matters: a factor that
 * reorders the top twenty without changing its membership still did
 * something, and a check that only compared membership would call that
 * factor decorative too.
 */
import type { CheckVerdict } from './types.js';

export interface FactorAblationCell {
  /** Which of `rankOracle`'s knobs this cell neutralised. Never a concept name — an internal factor id. */
  readonly factor: string;
  /** The real ranking's top-N concept order (opaque concept keys, never display names). */
  readonly topNBefore: readonly string[];
  /** The same course's top-N order with only `factor` neutralised. */
  readonly topNAfter: readonly string[];
}

export interface RankFactorAblationMeasured {
  readonly topN: number;
  readonly cells: readonly { readonly factor: string; readonly changed: boolean }[];
  /** Factors whose removal left the top-N sequence byte-for-byte identical. */
  readonly decorativeFactors: readonly string[];
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * One cell per factor ablated. Fails if any factor's removal left the top-N
 * order completely unchanged, or if no cells were supplied at all — a
 * runner that ran zero ablations is a check that cannot fail, which is the
 * defect this whole bead exists to name (N-013).
 */
export function checkRankFactorAblation(
  cells: readonly FactorAblationCell[],
): CheckVerdict<RankFactorAblationMeasured> {
  const measuredCells = cells.map((cell) => ({
    factor: cell.factor,
    changed: !sameSequence(cell.topNBefore, cell.topNAfter),
  }));
  const decorativeFactors = measuredCells.filter((c) => !c.changed).map((c) => c.factor);
  const topN = cells[0]?.topNBefore.length ?? 0;

  const measured: RankFactorAblationMeasured = { topN, cells: measuredCells, decorativeFactors };

  if (cells.length === 0) {
    return { ok: false, measured, detail: 'no factors were ablated — nothing was checked' };
  }
  if (decorativeFactors.length > 0) {
    return {
      ok: false,
      measured,
      detail:
        `${decorativeFactors.length} of ${cells.length} factor(s) left the top ${topN} ` +
        `completely unchanged when removed: ${decorativeFactors.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `every one of ${cells.length} factors changed the top ${topN} when removed`,
  };
}
