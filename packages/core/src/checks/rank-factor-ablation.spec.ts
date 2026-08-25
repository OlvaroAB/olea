// CHK-1 (`ol-3ux7.1`). Structural fixtures only — opaque ids, never concept
// or course vocabulary (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): "a decorative factor exists and
// is caught" and "zero cells is itself a failure" are both exercised as
// `ok: false` cases below, alongside the `ok: true` case where every
// supplied factor actually moved the order.
import { describe, expect, it } from 'vitest';
import { checkRankFactorAblation, type FactorAblationCell } from './rank-factor-ablation.js';

describe('checkRankFactorAblation', () => {
  it('fails when a factor is decorative — removing it leaves the top-N unchanged', () => {
    const cells: FactorAblationCell[] = [
      { factor: 'yield', topNBefore: ['a', 'b', 'c'], topNAfter: ['c', 'a', 'b'] },
      { factor: 'confidence', topNBefore: ['a', 'b', 'c'], topNAfter: ['a', 'b', 'c'] }, // decorative
      { factor: 'examProximity', topNBefore: ['a', 'b', 'c'], topNAfter: ['b', 'c', 'a'] },
    ];
    const verdict = checkRankFactorAblation(cells);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.decorativeFactors).toEqual(['confidence']);
  });

  it('fails when every factor is decorative — the formula is not discriminating at all', () => {
    const cells: FactorAblationCell[] = [
      { factor: 'yield', topNBefore: ['a', 'b'], topNAfter: ['a', 'b'] },
      { factor: 'confidence', topNBefore: ['a', 'b'], topNAfter: ['a', 'b'] },
    ];
    const verdict = checkRankFactorAblation(cells);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.decorativeFactors).toEqual(['yield', 'confidence']);
  });

  it('fails on zero cells — a check that ran nothing cannot report a pass', () => {
    const verdict = checkRankFactorAblation([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.cells).toEqual([]);
  });

  it('passes when every factor changes the top-N', () => {
    const cells: FactorAblationCell[] = [
      { factor: 'yield', topNBefore: ['a', 'b', 'c'], topNAfter: ['c', 'b', 'a'] },
      { factor: 'confidence', topNBefore: ['a', 'b', 'c'], topNAfter: ['b', 'a', 'c'] },
      { factor: 'assessmentWeight', topNBefore: ['a', 'b', 'c'], topNAfter: ['a', 'c', 'b'] },
      { factor: 'examProximity', topNBefore: ['a', 'b', 'c'], topNAfter: ['c', 'a', 'b'] },
      { factor: 'masteryNeedWeight', topNBefore: ['a', 'b', 'c'], topNAfter: ['b', 'c', 'a'] },
    ];
    const verdict = checkRankFactorAblation(cells);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.decorativeFactors).toEqual([]);
  });

  it('detects a reorder with the same membership as a real change (compares sequences, not sets)', () => {
    const cells: FactorAblationCell[] = [
      { factor: 'yield', topNBefore: ['a', 'b', 'c'], topNAfter: ['a', 'c', 'b'] },
    ];
    const verdict = checkRankFactorAblation(cells);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.cells[0]?.changed).toBe(true);
  });

  it('treats a length change as a change, not a crash', () => {
    const cells: FactorAblationCell[] = [
      { factor: 'assessmentWeight', topNBefore: ['a', 'b', 'c'], topNAfter: ['a', 'b'] },
    ];
    const verdict = checkRankFactorAblation(cells);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.cells[0]?.changed).toBe(true);
  });
});
