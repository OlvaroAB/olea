/**
 * The only source of randomness in this package (SYN-1 acceptance: "same seed,
 * byte-identical stream").
 *
 * `Math.random`, `Date.now`, and `crypto.randomUUID` are all forbidden here and
 * nowhere else in the package calls them — `test/determinism.spec.ts` asserts
 * the observable consequence (two generations from one seed are byte-identical)
 * and `test/no-ambient-entropy.spec.ts` asserts the source-level rule, because a
 * single stray `Date.now()` would make the byte-identity test flaky rather than
 * red, and a flaky determinism test is worse than none.
 *
 * mulberry32 is used deliberately over anything cryptographic: it is 8 lines,
 * has no platform dependency, and its output is reproducible across Node
 * versions and architectures. Statistical quality beyond "well-distributed
 * enough to shape a persona" is not a requirement — nothing here is a security
 * boundary and no threshold is ever fitted to these draws (N-015).
 */

/** FNV-1a over the seed string, so a seed can be a readable label rather than a number. */
function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string) {
    // `| 0` never yields 0 for a non-empty FNV-1a hash in practice, but a zero
    // state is mulberry32's one degenerate input, so it is nudged rather than
    // trusted.
    const initial = seedToUint32(seed);
    this.state = initial === 0 ? 0x9e3779b9 : initial;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: empty range [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability `p`. `p <= 0` never fires; `p >= 1` always does — both without consuming differently, so a probability of 0 and a probability of 1 draw the same number of values and changing one does not shift the rest of the stream. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * A named sub-generator. Two draws taken from `derive('duration')` and
   * `derive('rating')` do not interleave, so adding a draw to one persona's
   * duration model cannot silently re-roll every rating in the stream. That
   * property is what makes the mutation experiments in `test/personas.spec.ts`
   * legible: the diff shows the pattern changing, not the whole stream.
   */
  derive(label: string): Rng {
    return new Rng(`${this.state >>> 0}:${label}`);
  }
}
