// CHK-1 (`ol-3ux7.1`). Opaque ids only (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): a divergent order, a length
// mismatch, and an empty comparison are each asserted `ok: false` below,
// alongside the identical-order `ok: true` case.
import { describe, expect, it } from 'vitest';
import { checkGapWeightIdentity } from './gap-weight-identity.js';

describe('checkGapWeightIdentity', () => {
  it('passes when the gap order at weight 1 matches the oracle order exactly', () => {
    const verdict = checkGapWeightIdentity(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.mismatchedAt).toBeNull();
  });

  it('fails on a reordering — a sort-key regression that the arithmetic itself would not show', () => {
    const verdict = checkGapWeightIdentity(['a', 'b', 'c'], ['a', 'c', 'b']);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.mismatchedAt).toBe(1);
  });

  it('fails on a length mismatch rather than silently comparing a prefix', () => {
    const verdict = checkGapWeightIdentity(['a', 'b', 'c'], ['a', 'b']);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.lengthsMatch).toBe(false);
  });

  it('fails on an empty comparison rather than vacuously passing', () => {
    const verdict = checkGapWeightIdentity([], []);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.compared).toBe(0);
  });

  it('catches a divergence at the very first position', () => {
    const verdict = checkGapWeightIdentity(['x', 'y'], ['y', 'x']);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.mismatchedAt).toBe(0);
  });
});
