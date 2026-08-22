/**
 * The pair constructors SYN-2 (`ol-c9yf`) will build on.
 *
 * No analysis lives here and none is attempted — SYN-2 owns that. What is
 * checked is the property SYN-2 depends on and cannot check for itself: that a
 * "planted-effect pair" differs by exactly the planted effect, and that a "null
 * pair" differs by nothing but the seed. If either promise is false, SYN-2's
 * conclusions are about a confound rather than about the effect, and it would
 * have no way to tell.
 */

import { describe, expect, it } from 'vitest';
import {
  behaviourDelta,
  instrumentShareWhenBothOffered,
  nullPair,
  plantedPair,
  specDelta,
  streamSpec,
  toJsonl,
} from '../src/index.js';

describe('plantedPair', () => {
  const base = streamSpec('instrument-skipper', 'pair-seed');
  const pair = plantedPair(base, { cardTakeRateWhenMcqAvailable: 1 });

  it('differs by exactly one behaviour knob and nothing else', () => {
    expect(specDelta(pair.a.spec, pair.b.spec)).toEqual(['behaviour']);
    expect(behaviourDelta(pair.a.spec, pair.b.spec)).toEqual(['cardTakeRateWhenMcqAvailable']);
    expect(pair.a.spec.seed).toBe(pair.b.spec.seed);
  });

  it('the planted knob actually moves the thing it is supposed to move', () => {
    // Not a detector — just the sanity check that the pair is not two copies of
    // the same stream wearing different labels.
    const before = instrumentShareWhenBothOffered(pair.a.entries).mcqShare;
    const after = instrumentShareWhenBothOffered(pair.b.entries).mcqShare;
    expect(before).toBeGreaterThan(after);
    expect(toJsonl(pair.a.entries)).not.toBe(toJsonl(pair.b.entries));
  });
});

describe('nullPair', () => {
  const base = streamSpec('steady-reviewer', 'unused');
  const pair = nullPair(base, 'null-a', 'null-b');

  it('differs by the seed and nothing else', () => {
    expect(specDelta(pair.a.spec, pair.b.spec)).toEqual(['seed']);
    expect(behaviourDelta(pair.a.spec, pair.b.spec)).toEqual([]);
  });

  it('produces two genuinely different streams from the same persona', () => {
    expect(pair.a.spec.persona).toBe(pair.b.spec.persona);
    expect(toJsonl(pair.a.entries)).not.toBe(toJsonl(pair.b.entries));
  });

  it('refuses two identical seeds, which would make the "pair" one stream twice', () => {
    expect(() => nullPair(base, 'same', 'same')).toThrow(/must differ/);
  });
});
