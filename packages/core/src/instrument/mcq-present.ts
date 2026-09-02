/**
 * Sample-3-or-fewer and shuffle, per presentation (F2.15, P2-T05, `[D-195]`).
 *
 * F2.15 has every presentation draw up to **three** distractors from the pool
 * and shuffle, so that meeting the same item twice does not decay into
 * recalling which option won last time. Above the pool floor that is a real
 * sample; at or near the floor it is the whole pool, shown once and shuffled —
 * see "THE SHORT-POOL DEGRADE" below.
 *
 * Two distinct rotations, and both have to be real wherever the pool allows it:
 *
 *   1. **Which distractors she sees.** Up to three drawn from the pool, so the
 *      option *set* differs between showings whenever the pool is larger than
 *      the sample. This is the one the old floor of four protected
 *      unconditionally; below it, there is nothing left to rotate and that is
 *      an accepted, ratified state (see below), not a bug.
 *   2. **Where the answer sits.** Every option shown is shuffled, so the answer
 *      is not learnable by position regardless of pool size. A pool that
 *      rotates content while pinning the answer to slot A would still degrade
 *      into "it's the first one".
 *
 * Neither is decorative and neither is the other, which is why the test suite
 * asserts them separately: a presenter that shuffled but never resampled, and a
 * presenter that resampled but never shuffled, must each fail a *named*
 * scenario rather than both passing an "is it a permutation" check.
 *
 * ## THE SHORT-POOL DEGRADE (`[D-195]` / `ol-2zfj.57`)
 *
 * `MIN_DISTRACTOR_POOL` dropped from 4 to 2 (`types.ts`'s doc on that
 * constant) so the client can present a genuinely short, genuinely grounded
 * pool rather than reject it or pad it with an invented option — F2.15's own
 * amendment names "shuffle-only" as the ratified fallback, never "an
 * ungrounded option manufactured to hit the count." So below
 * `PRESENTED_DISTRACTORS`'s own pool size, this module presents
 * `min(PRESENTED_DISTRACTORS, pool.length)` distractors — i.e. everything the
 * pool has — plus the answer, all shuffled. It still throws below
 * `MIN_DISTRACTOR_POOL` (below, unchanged in shape, lowered in value): that
 * floor is about whether an item is presentable at all, not about how many of
 * `PRESENTED_DISTRACTORS` a presentation can draw.
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
import { MIN_DISTRACTOR_POOL, PRESENTED_DISTRACTORS } from './types.js';

/** Production default. Anything wanting determinism passes its own. */
export const mathRandomSource: RandomSource = { next: () => Math.random() };

export interface McqPresentationOption {
  readonly text: string;
  readonly correct: boolean;
}

export interface McqPresentation {
  readonly stem: string;
  /**
   * `min(PRESENTED_DISTRACTORS, pool.length) + 1` of them (`[D-195]`'s
   * short-pool degrade — see the module doc), exactly one correct, in
   * presentation order. Equal to `PRESENTED_OPTIONS` whenever the pool is at
   * least `PRESENTED_DISTRACTORS` long, which is every pool above the old
   * floor and most pools at or above the new one.
   */
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
 * One presentation: up to `PRESENTED_DISTRACTORS` distractors sampled from the
 * pool, plus the answer, all shuffled.
 *
 * Throws below `MIN_DISTRACTOR_POOL` rather than degrading further — that is
 * a different question from how many `PRESENTED_DISTRACTORS` draws. The parse
 * boundary already rejects a block below the floor (`mcq-format.ts`), so
 * reaching here below it means something constructed an instrument without
 * going through the format, and showing her too few options to be a real MCQ,
 * silently, is the failure this whole mechanism exists to prevent.
 *
 * **Between the floor and `PRESENTED_DISTRACTORS`'s own pool size, this never
 * throws and never pads** (`[D-195]`, module doc's "THE SHORT-POOL DEGRADE"):
 * it samples `min(PRESENTED_DISTRACTORS, item.distractors.length)` — the
 * whole pool, once the pool is that short — and shuffles what it has. A pool
 * of exactly `MIN_DISTRACTOR_POOL` therefore shows every distractor it holds,
 * every time; rotation resumes automatically once the pool grows past
 * `PRESENTED_DISTRACTORS`.
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

  const sampleSize = Math.min(PRESENTED_DISTRACTORS, item.distractors.length);
  const pool = [...item.distractors];
  shuffleInPlace(pool, random, sampleSize);
  const sampled = pool.slice(0, sampleSize);

  const options: McqPresentationOption[] = [
    ...sampled.map((text) => ({ text, correct: false })),
    { text: item.answer, correct: true },
  ];
  shuffleInPlace(options, random);

  if (options.length !== sampleSize + 1) {
    throw new Error('presentMcq: internal error, wrong option count');
  }
  return { stem: item.stem, options };
}
