/**
 * Stream *pairs* — built for SYN-2 (`ol-c9yf`), which follows this bead.
 *
 * SYN-1 does not do the A→B analysis and there is no detector anywhere in this
 * package. What is here is the two constructors that analysis needs, and
 * nothing else, because the shape of SYN-2's exercise is fixed by its own
 * acceptance criteria and it is cheap to make it easy now:
 *
 *  - **`plantedPair`** — two streams from **one seed**, differing by exactly
 *    one behaviour knob. Everything the RNG decides is identical up to the
 *    point the knob changes what is asked of it, so any difference the analysis
 *    finds is attributable to the knob and to nothing else.
 *  - **`nullPair`** — two streams from **one spec** under two seeds. No planted
 *    effect exists between them. This is the half that makes SYN-2 a test
 *    rather than a demo: an analysis that finds the planted effect proves it is
 *    sensitive, and only the null pair proves it is not merely enthusiastic.
 *
 * `specDelta` exists so the pair constructors' own promise is checkable:
 * `plantedPair` asserts, in its test, that exactly the named knobs differ, and
 * `nullPair` asserts that only the seed does. A "pair differing by exactly one
 * thing" that quietly differs by two is the failure mode that would make SYN-2
 * report a real effect that was actually three effects.
 */

import type { StreamSpec, SyntheticStream } from './generate.js';
import { generateStream } from './generate.js';
import type { Behaviour } from './personas.js';

export interface StreamPair {
  readonly a: SyntheticStream;
  readonly b: SyntheticStream;
}

/**
 * Two streams from one seed whose specs differ by exactly the given behaviour
 * patch — the "B" arm of an A→B comparison with a known, single cause.
 */
export function plantedPair(base: StreamSpec, effect: Partial<Behaviour>): StreamPair {
  const bSpec: StreamSpec = { ...base, behaviour: { ...(base.behaviour ?? {}), ...effect } };
  return { a: generateStream(base), b: generateStream(bSpec) };
}

/**
 * Two streams differing only by seed. No effect is planted between them, so a
 * correct analysis must report nothing.
 */
export function nullPair(base: StreamSpec, seedA: string, seedB: string): StreamPair {
  if (seedA === seedB) {
    throw new Error('nullPair: the two seeds must differ, or the "pair" is one stream twice.');
  }
  return {
    a: generateStream({ ...base, seed: seedA }),
    b: generateStream({ ...base, seed: seedB }),
  };
}

/** Top-level `StreamSpec` keys whose values differ between two specs, sorted. */
export function specDelta(a: StreamSpec, b: StreamSpec): readonly string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    const left = (a as unknown as Record<string, unknown>)[key];
    const right = (b as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(left) !== JSON.stringify(right)) changed.push(key);
  }
  return changed.sort();
}

/** Behaviour-override keys whose values differ between two specs, sorted. */
export function behaviourDelta(a: StreamSpec, b: StreamSpec): readonly string[] {
  const left = (a.behaviour ?? {}) as Record<string, unknown>;
  const right = (b.behaviour ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((k) => JSON.stringify(left[k]) !== JSON.stringify(right[k])).sort();
}
