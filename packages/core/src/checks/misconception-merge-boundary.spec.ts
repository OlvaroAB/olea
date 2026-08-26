// CHK-2 (`ol-3ux7.15`). Case ids are opaque placeholders — no real statement
// text, no real embeddings (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): one case includes a single false
// merge among otherwise-correct cases.
import { describe, expect, it } from 'vitest';
import { checkMisconceptionMergeBoundary } from './misconception-merge-boundary.js';

describe('checkMisconceptionMergeBoundary', () => {
  it('fails on a single false merge, even with everything else correct', () => {
    const cases = [
      { id: 'near-duplicate', shouldMerge: true, matched: true },
      { id: 'distinct-pair', shouldMerge: false, matched: false },
      // A distinct pair that matched anyway — the harm the row's principle names.
      { id: 'drifted-threshold', shouldMerge: false, matched: true },
    ];
    const verdict = checkMisconceptionMergeBoundary(cases);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.falseMerges).toEqual(['drifted-threshold']);
  });

  it('passes when a same-statement pair fails to match — the conservative direction is not a failure', () => {
    const cases = [
      { id: 'near-duplicate', shouldMerge: true, matched: true },
      // Conservative miss: two occurrences of one misunderstanding stayed unmerged.
      { id: 'borderline-duplicate', shouldMerge: true, matched: false },
      { id: 'distinct-pair', shouldMerge: false, matched: false },
    ];
    const verdict = checkMisconceptionMergeBoundary(cases);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.missedMerges).toEqual(['borderline-duplicate']);
    expect(verdict.measured.falseMerges).toEqual([]);
  });

  it('reports zero cases as a failure — a check that ran nothing cannot pass (N-013)', () => {
    const verdict = checkMisconceptionMergeBoundary([]);
    expect(verdict.ok).toBe(false);
  });
});
