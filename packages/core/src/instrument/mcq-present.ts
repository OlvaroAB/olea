/**
 * Sample-3 and shuffle, per presentation (F2.15, P2-T05).
 *
 * F2.15 sets the pool floor at **four distractors** and has every presentation
 * draw **three** of them and shuffle, so that meeting the same item twice does
 * not decay into recalling which option won last time.
 *
 * Two distinct rotations, and both have to be real:
 *
 *   1. **Which distractors she sees.** Three drawn from a pool of four or more,
 *      so the option *set* differs between showings. This is the one the floor
 *      protects: three from three is not a sample, it is the whole pool every
 *      time.
 *   2. **Where the answer sits.** All four options shuffled, so the answer is
 *      not learnable by position. A pool that rotates content while pinning the
 *      answer to slot A would still degrade into "it's the first one".
 *
 * Neither is decorative and neither is the other, which is why the test suite
 * asserts them separately: a presenter that shuffled but never resampled, and a
 * presenter that resampled but never shuffled, must each fail a *named*
 * scenario rather than both passing an "is it a permutation" check.
 *
 * ## Randomness is injected, and that is not the same as being seeded
 *
 * `RandomSource` comes in from the caller (the same port the ingestion queue's
 * jitter uses) so the algorithm is testable exactly. It is emphatically *not*
 * so the shuffle tests can pin a seed that makes them pass: a seeded shuffle
 * test proves the arithmetic and nothing about rotation. The suite therefore
 * uses the injected source for the exact-algorithm assertions and the real
 * default source for the repeat-presentation assertions, where the claim being
 * made is statistical and the failure modes above are what must go red.
 */

import type { RandomSource } from '../ingestion/types.js';
import { MIN_DISTRACTOR_POOL, PRESENTED_DISTRACTORS, PRESENTED_OPTIONS } from './types.js';

/** Production default. Anything wanting determinism passes its own. */
export const mathRandomSource: RandomSource = { next: () => Math.random() };

export interface McqPresentationOption {
  readonly text: string;
  readonly correct: boolean;
}

export interface McqPresentation {
  readonly stem: string;
  /** Exactly `PRESENTED_OPTIONS` of them, exactly one correct, in presentation order. */
  readonly options: readonly McqPresentationOption[];
}

/** The minimum an instrument must supply to be presented — a structural subset of `McqInstrument`. */
export interface PresentableMcq {
  readonly stem: string;
  readonly answer: string;
  readonly distractors: readonly string[];
}

/**
 * Fisher–Yates over a copy, consuming one `random.next()` per position from the
 * end down. Written out rather than pulled from a helper because the two
 * callers below want different halves of it: sampling needs the first
 * `PRESENTED_DISTRACTORS` positions of a partial shuffle, and the option order
 * needs a full one.
 */
function shuffleInPlace<T>(items: T[], random: RandomSource, positions = items.length): void {
  const limit = Math.min(positions, items.length - 1);
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(random.next() * (items.length - i));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

/**
 * One presentation: three distractors sampled from the pool, plus the answer,
 * all four shuffled.
 *
 * Throws below the floor rather than degrading. The parse boundary already
 * rejects such a block (`mcq-format.ts`), so reaching here with three
 * distractors means something constructed an instrument without going through
 * the format — and showing her three options where four belong, silently, is
 * the failure this whole mechanism exists to prevent.
 */
export function presentMcq(
  item: PresentableMcq,
  random: RandomSource = mathRandomSource,
): McqPresentation {
  if (item.distractors.length < MIN_DISTRACTOR_POOL) {
    throw new Error(
      `presentMcq: ${item.distractors.length} distractor(s); F2.15 requires a pool of at least ${MIN_DISTRACTOR_POOL}`,
    );
  }

  const pool = [...item.distractors];
  shuffleInPlace(pool, random, PRESENTED_DISTRACTORS);
  const sampled = pool.slice(0, PRESENTED_DISTRACTORS);

  const options: McqPresentationOption[] = [
    ...sampled.map((text) => ({ text, correct: false })),
    { text: item.answer, correct: true },
  ];
  shuffleInPlace(options, random);

  if (options.length !== PRESENTED_OPTIONS) {
    throw new Error('presentMcq: internal error, wrong option count');
  }
  return { stem: item.stem, options };
}
