/**
 * A fixed-seed `RandomSource` (`olea-core`'s `{ next(): number }` contract).
 *
 * ## Why this file exists (found by WB-2, `ol-z6x2`, while wiring visual regression)
 *
 * `packages/plugin`'s `adaptReviewQueue` documents its `random` field as
 * "Injected for deterministic tests. Production takes the default, which is
 * `Math.random`." — a seam built for exactly this. `queue/derive.ts`'s
 * `itemsOfType` called `adaptReviewQueue` with no `random`, so every MCQ
 * state's option sampling and shuffling (F2.15, `presentMcq`) drew from live
 * `Math.random()`, once per page load.
 *
 * That contradicts this package's own documented promise —
 * `scenarios.ts`'s header: "Determinism is deliberate: a fixed clock,
 * deterministic prior scheduling states, deterministic event ids, and
 * index-based instrument picks... A screenshot taken twice is the same
 * screenshot." The clock, the prior state and the event ids all held; MCQ
 * presentation did not. Found by loading `#/review/mcq-open` three times
 * against the same built artifact and diffing the four option labels in the
 * DOM — they differed on every load.
 *
 * This closes the gap through the seam that was already built for it, rather
 * than adding a new one: `deriveWorkbenchQueue` now threads one
 * `createDeterministicRandom()` instance through every `adaptReviewQueue`
 * call it makes, so the sequence of draws — and therefore every MCQ state's
 * rendered options — is identical on every load of the same URL.
 *
 * mulberry32: a small, public-domain, dependency-free PRNG (Tommy Ettinger).
 * Nothing about the seed or the algorithm needs to be unpredictable — the
 * whole point is that two runs draw the *same* sequence, not a hard-to-guess
 * one.
 */

import type { RandomSource } from 'olea-core';

/** Arbitrary and fixed. Its only property that matters is that it never changes. */
const FIXED_SEED = 0x0a1e_a75c;

export function createDeterministicRandom(seed: number = FIXED_SEED): RandomSource {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}
