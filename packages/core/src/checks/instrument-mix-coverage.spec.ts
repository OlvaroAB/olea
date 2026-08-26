// CHK-2 (`ol-3ux7.15`). Kind ids are the real, small enumerable domain
// (`fact`/`category`/`principle`), never a concept name.
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): one case collapses every kind
// onto the identical mix, one case leaves a routing group at `'none'`
// everywhere, and one case passes with a healthy spread.
import { describe, expect, it } from 'vitest';
import { checkInstrumentMixCoverage, type RoutedMix } from './instrument-mix-coverage.js';

describe('checkInstrumentMixCoverage', () => {
  it('fails when every kind collapses onto the identical mix', () => {
    const routed: RoutedMix[] = [
      { kind: 'fact', mix: { retrieval: 'dominant', quiz: 'floor', explainBack: 'floor' } },
      { kind: 'category', mix: { retrieval: 'dominant', quiz: 'floor', explainBack: 'floor' } },
      { kind: 'principle', mix: { retrieval: 'dominant', quiz: 'floor', explainBack: 'floor' } },
    ];
    const verdict = checkInstrumentMixCoverage(routed);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.distinctMixes).toBe(1);
  });

  it('fails when a routing group never rises above none', () => {
    const routed: RoutedMix[] = [
      { kind: 'fact', mix: { retrieval: 'dominant', quiz: 'none', explainBack: 'floor' } },
      { kind: 'category', mix: { retrieval: 'floor', quiz: 'none', explainBack: 'weighted' } },
    ];
    const verdict = checkInstrumentMixCoverage(routed);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.unreachableGroups).toEqual(['quiz']);
  });

  it('passes a healthy, spread routing table', () => {
    const routed: RoutedMix[] = [
      { kind: 'fact', mix: { retrieval: 'dominant', quiz: 'floor', explainBack: 'floor' } },
      { kind: 'category', mix: { retrieval: 'floor', quiz: 'weighted', explainBack: 'floor' } },
      { kind: 'principle', mix: { retrieval: 'floor', quiz: 'floor', explainBack: 'weighted' } },
    ];
    const verdict = checkInstrumentMixCoverage(routed);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.unreachableGroups).toEqual([]);
  });

  it('reports zero kinds as a failure — a check that ran nothing cannot pass (N-013)', () => {
    const verdict = checkInstrumentMixCoverage([]);
    expect(verdict.ok).toBe(false);
  });
});
