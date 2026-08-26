/**
 * CHK-2 (`ol-3ux7.15`) — component register row 2.5's health check.
 *
 * Row 2.5 ("Spot and merge repeated misconceptions"): **"the existing test
 * proves only that no network primitive appears in the directory — a
 * privacy fitness check, not a merge-quality check. No false-merge-rate
 * check exists."** The row's own stated principle is asymmetric: "creating
 * two records for one misunderstanding is a much smaller harm than merging
 * two distinct ones and telling her she keeps making a mistake she has only
 * made once" — so the harm this check exists to catch is specifically a
 * **false merge**, never a missed one.
 *
 * A genuine merge-QUALITY measurement needs real paraphrase pairs with a
 * human ground-truth label ("same misunderstanding" / "different
 * misunderstanding") — the same shape of work `eval/grounding/
 * grounding-set-v1.0.1.json` did for row 1.8's threshold, and outside this
 * lane's free/local/no-spend scope (real embeddings of real paraphrased
 * statements would need a model call). What this module CAN do for free is
 * a **boundary regression check**: `../misconception/matcher.js`'s
 * `matchExistingMisconception` is a pure function of two embedding vectors
 * and a threshold, so a caller can construct EXACT cosine geometries (unit
 * vectors at a chosen angle) without touching a real embedder at all, and
 * assert the matcher's own decision boundary behaves as the shipped
 * threshold says it should. This will not catch a genuinely ambiguous real
 * paraphrase; it WILL catch the concrete regression this row's own
 * principle warns about — a threshold that drifted low enough to merge two
 * constructed vectors that were never meant to be the same statement.
 */
import type { CheckVerdict } from './types.js';

export interface MisconceptionMergeCase {
  /** Opaque case id — never a real statement, never a real embedding source (INV-3). */
  readonly id: string;
  /** Ground truth by construction — this pair's cosine geometry was built to represent "the same misunderstanding" (true) or "two distinct ones" (false). */
  readonly shouldMerge: boolean;
  /** What `matchExistingMisconception` actually returned — non-null (a match) or null. */
  readonly matched: boolean;
}

export interface MisconceptionMergeBoundaryMeasured {
  readonly n: number;
  /** `shouldMerge: false` but `matched: true` — the harm row 2.5's own principle names as the one to avoid. */
  readonly falseMerges: readonly string[];
  /** `shouldMerge: true` but `matched: false` — recorded, never a failure: erring toward two records is the row's own stated conservative default. */
  readonly missedMerges: readonly string[];
}

/**
 * One case per constructed vector pair in, a verdict out. Fails on ANY
 * false merge, or if zero cases were supplied (N-013). A missed merge never
 * fails the check — see this module's doc on why that asymmetry is the
 * row's own design, not a gap in this check.
 */
export function checkMisconceptionMergeBoundary(
  cases: readonly MisconceptionMergeCase[],
): CheckVerdict<MisconceptionMergeBoundaryMeasured> {
  const falseMerges = cases.filter((c) => !c.shouldMerge && c.matched).map((c) => c.id);
  const missedMerges = cases.filter((c) => c.shouldMerge && !c.matched).map((c) => c.id);

  const measured: MisconceptionMergeBoundaryMeasured = {
    n: cases.length,
    falseMerges,
    missedMerges,
  };

  if (cases.length === 0) {
    return { ok: false, measured, detail: 'zero cases supplied — nothing was checked' };
  }
  if (falseMerges.length > 0) {
    return {
      ok: false,
      measured,
      detail: `${falseMerges.length} of ${cases.length} case(s) merged two constructed-distinct statements: ${falseMerges.join(', ')}`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `zero false merges across ${cases.length} case(s) (${missedMerges.length} missed merge(s), the conservative-by-design direction)`,
  };
}
