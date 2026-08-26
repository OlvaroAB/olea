// CHK-2 (`ol-3ux7.15`). Fixtures are inline, opaque-id maps — no vault
// content (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013): one case perturbs the second
// pass's state for one instrument, one perturbs the key set itself, and one
// passes both replays as identical.
import { describe, expect, it } from 'vitest';
import { checkReplayDeterminism } from './replay-determinism.js';

describe('checkReplayDeterminism', () => {
  it('fails when an instrument replays to a different state on the second pass', () => {
    const first = new Map([
      ['inst-a', { stability: 2.1, difficulty: 5 }],
      ['inst-b', { stability: 8.4, difficulty: 3 }],
    ]);
    const second = new Map([
      ['inst-a', { stability: 2.1, difficulty: 5 }],
      // Perturbed — a non-deterministic scheduler would produce this shape.
      ['inst-b', { stability: 8.5, difficulty: 3 }],
    ]);
    const verdict = checkReplayDeterminism(first, second);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.mismatchedInstrumentIds).toEqual(['inst-b']);
  });

  it('fails when the two passes disagree on which instruments exist at all', () => {
    const first = new Map([['inst-a', { stability: 1 }]]);
    const second = new Map([
      ['inst-a', { stability: 1 }],
      ['inst-c', { stability: 9 }],
    ]);
    const verdict = checkReplayDeterminism(first, second);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.mismatchedInstrumentIds).toEqual(['inst-c']);
  });

  it('passes byte-identical replays', () => {
    const first = new Map([
      ['inst-a', { stability: 2.1, difficulty: 5 }],
      ['inst-b', { stability: 8.4, difficulty: 3 }],
    ]);
    const second = new Map([
      ['inst-a', { stability: 2.1, difficulty: 5 }],
      ['inst-b', { stability: 8.4, difficulty: 3 }],
    ]);
    const verdict = checkReplayDeterminism(first, second);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.mismatchedInstrumentIds).toEqual([]);
  });

  it('reports zero instruments as a failure — a check that replayed nothing cannot pass (N-013)', () => {
    const verdict = checkReplayDeterminism(new Map(), new Map());
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.instrumentCount).toBe(0);
  });
});
