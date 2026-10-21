import { describe, expect, it } from 'vitest';
import {
  checkRoutingReachesSelection,
  type RoutingSelectionObservation,
} from './routing-consumption.js';

function observation(
  overrides: Partial<RoutingSelectionObservation> = {},
): RoutingSelectionObservation {
  return { consulted: true, kind: 'fact', deficit: 1, generated: true, ...overrides };
}

describe('checkRoutingReachesSelection', () => {
  it('is green when every candidate consulted routing and none was vetoed', () => {
    const verdict = checkRoutingReachesSelection([
      observation({ kind: 'fact', deficit: 1, generated: true }),
      observation({ kind: 'category', deficit: 2, generated: true }),
      observation({ kind: null, deficit: 0, generated: true }),
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured).toEqual({
      n: 3,
      consulted: 3,
      bypassed: 0,
      vetoed: 0,
      askedAtZeroDeficit: 1,
      distinctKinds: 3,
    });
  });

  it('goes RED when the selection path bypasses routing — the whole point of the check', () => {
    const verdict = checkRoutingReachesSelection([
      observation(),
      observation({ consulted: false, kind: null, deficit: null, generated: true }),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.bypassed).toBe(1);
    expect(verdict.detail).toContain('without consulting routing');
  });

  it('stays GREEN when a zero-deficit concept is asked its first call (D-549 ruled behaviour)', () => {
    const verdict = checkRoutingReachesSelection([
      observation({ kind: 'category', deficit: 0, generated: true }),
      observation({ kind: 'fact', deficit: 3, generated: true }),
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.vetoed).toBe(0);
    expect(verdict.measured.askedAtZeroDeficit).toBe(1);
  });

  it('goes RED when a consulted candidate is not asked - the removed gate coming back (D-549)', () => {
    const verdict = checkRoutingReachesSelection([
      observation({ deficit: 0, generated: false }),
      observation({ deficit: 3, generated: true }),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.vetoed).toBe(1);
    expect(verdict.detail).toContain('vetoed a first call');
  });

  it('fails closed on an empty batch — no observations is not evidence of health', () => {
    const verdict = checkRoutingReachesSelection([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.n).toBe(0);
    expect(verdict.detail).toContain('no selection decisions observed');
  });

  it('counts the unclassified reading as its own label without colliding with a real one', () => {
    const verdict = checkRoutingReachesSelection([
      observation({ kind: null, deficit: 0, generated: true }),
      observation({ kind: 'principle', deficit: 1, generated: true }),
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.distinctKinds).toBe(2);
  });

  it('reports a single-label sweep without failing on it', () => {
    const verdict = checkRoutingReachesSelection([
      observation({ kind: 'fact' }),
      observation({ kind: 'fact' }),
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.distinctKinds).toBe(1);
  });

  it('carries no content — an observation has exactly the four content-free fields (INV-3)', () => {
    expect(Object.keys(observation()).sort()).toEqual([
      'consulted',
      'deficit',
      'generated',
      'kind',
    ]);
  });
});
