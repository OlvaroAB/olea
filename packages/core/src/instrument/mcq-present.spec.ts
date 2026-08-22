// Scenarios: features/F2-review.md — "F2.15 — Sample-3 and shuffle, per
// presentation", tagged `@auto:core/mcq-present.spec`.
//
// **This suite is meant to be breakable, and that was checked rather than
// asserted.** Two mutations were applied to `presentMcq` and the resulting
// failures recorded on the bead: (1) returning the first three distractors in
// pool order instead of sampling, and (2) returning the four options in a fixed
// order instead of shuffling. Each turns a *named* scenario below red — the
// distractor-coverage one and the answer-position one respectively — rather
// than both being caught by one "is it a permutation" check, which would have
// proved nothing about rotation.
//
// The repeat-presentation assertions deliberately run on the **real** random
// source. A seeded shuffle test is a test that cannot fail for the reason the
// scenario is about (`ol-inv2vacuity`); the seeded tests here are the ones
// asserting the algorithm, and they say so.
import { describe, expect, it } from 'vitest';
import type { RandomSource } from '../ingestion/types.js';
import { mathRandomSource, presentMcq } from './mcq-present.js';
import { MIN_DISTRACTOR_POOL, PRESENTED_DISTRACTORS, PRESENTED_OPTIONS } from './types.js';

/** Deterministic PRNG (mulberry32) — reproducible without depending on `Math.random`. */
function seeded(seed: number): RandomSource {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

const POOL_OF_FIVE = ['pool one', 'pool two', 'pool three', 'pool four', 'pool five'];
const ITEM = {
  stem: 'which one is it?',
  answer: 'the right one',
  distractors: POOL_OF_FIVE,
};

/**
 * How many presentations the statistical scenarios below use.
 *
 * The claims are "the answer reaches all four positions" and "every one of five
 * distractors is eventually shown". Under a correct implementation the chance a
 * given position never holds the answer is (3/4)^400 ≈ 1e-50, and the chance a
 * given distractor is never sampled is (2/5)^400 ≈ 1e-159. These are not
 * "unlikely to be flaky"; they are further from flaky than the machine is from
 * a cosmic-ray bit flip.
 */
const PRESENTATIONS = 400;

describe('presentMcq — one presentation', () => {
  it('shows four options: three distinct pool members plus the answer', () => {
    const presentation = presentMcq(ITEM, seeded(1));
    expect(presentation.stem).toBe(ITEM.stem);
    expect(presentation.options).toHaveLength(PRESENTED_OPTIONS);

    const correct = presentation.options.filter((o) => o.correct);
    expect(correct).toHaveLength(1);
    expect(correct[0]?.text).toBe(ITEM.answer);

    const shown = presentation.options.filter((o) => !o.correct).map((o) => o.text);
    expect(shown).toHaveLength(PRESENTED_DISTRACTORS);
    expect(new Set(shown).size).toBe(PRESENTED_DISTRACTORS);
    for (const text of shown) expect(POOL_OF_FIVE).toContain(text);
  });

  it('is deterministic given the same injected random source', () => {
    // Determinism comes from the injected source, never from the presenter
    // being fixed — which is exactly what the statistical scenarios below
    // prove is not the case.
    expect(presentMcq(ITEM, seeded(7))).toEqual(presentMcq(ITEM, seeded(7)));
  });

  it('refuses a pool below the floor rather than showing a short option list', () => {
    expect(() =>
      presentMcq(
        { ...ITEM, distractors: POOL_OF_FIVE.slice(0, MIN_DISTRACTOR_POOL - 1) },
        seeded(1),
      ),
    ).toThrowError(/at least 4/);
  });

  it('works at the floor: a pool of exactly four still samples three', () => {
    const presentation = presentMcq(
      { ...ITEM, distractors: POOL_OF_FIVE.slice(0, MIN_DISTRACTOR_POOL) },
      seeded(3),
    );
    expect(presentation.options).toHaveLength(PRESENTED_OPTIONS);
    expect(presentation.options.filter((o) => o.correct)).toHaveLength(1);
  });
});

describe('presentMcq — repeat presentation, on the real random source', () => {
  const presentations = Array.from({ length: PRESENTATIONS }, () =>
    presentMcq(ITEM, mathRandomSource),
  );

  it('the correct answer reaches every one of the four positions', () => {
    // A presenter that returned a fixed option order fails here: the answer
    // would sit at one index forever.
    const positions = new Set(presentations.map((p) => p.options.findIndex((o) => o.correct)));
    expect([...positions].sort()).toEqual([0, 1, 2, 3]);
  });

  it('no position monopolises the answer', () => {
    // Guards a shuffle that moves the answer but not uniformly. Uniform is 25%
    // of 400 = 100 with a standard deviation of 8.7, so the [10%, 40%] band is
    // roughly seven standard deviations wide on each side.
    const counts = [0, 0, 0, 0];
    for (const p of presentations) {
      const index = p.options.findIndex((o) => o.correct);
      counts[index] = (counts[index] ?? 0) + 1;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThan(PRESENTATIONS * 0.1);
      expect(count).toBeLessThan(PRESENTATIONS * 0.4);
    }
  });

  it('every distractor in the pool is eventually shown', () => {
    // A presenter that always took the first three of the pool fails here:
    // `pool four` and `pool five` would never appear. This is the assertion
    // that makes the ≥4 floor mean something — with a pool of exactly three
    // there is nothing for this scenario to detect.
    const seen = new Set(
      presentations.flatMap((p) => p.options.filter((o) => !o.correct).map((o) => o.text)),
    );
    expect([...seen].sort()).toEqual([...POOL_OF_FIVE].sort());
  });

  it('the option set itself rotates, not only the order', () => {
    // Distinct *content* sets, ignoring position. There are C(5,3) = 10
    // possible sets; a sampler that rotated nothing would report exactly 1.
    const sets = new Set(
      presentations.map((p) =>
        p.options
          .filter((o) => !o.correct)
          .map((o) => o.text)
          .sort()
          .join('|'),
      ),
    );
    expect(sets.size).toBe(10);
  });

  it('two presentations of the same item are not guaranteed to match', () => {
    // F2.15's actual promise, stated the way the scenario states it.
    const rendered = presentations.map((p) => p.options.map((o) => o.text).join('|'));
    expect(new Set(rendered).size).toBeGreaterThan(1);
  });
});
