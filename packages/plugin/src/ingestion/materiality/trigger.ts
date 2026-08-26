/**
 * `evaluateMaterialityGate` — the free half of register row 1.4's two-stage
 * trigger (`TRG-1`, `ol-tqy3`): "a free content hash over every vault file,
 * then, for changed files, a cheap model judgement." This is everything
 * before "then" — pure, synchronous, and (deliberately, following
 * `packages/core/src/checks/types.ts`'s own rule for algorithm code in this
 * codebase) never doing I/O itself, so it is exhaustively testable without a
 * vault, a clock mock framework, or a network call. `wiring.ts` is the
 * caller that supplies real hashes, a real clock and real persistence.
 *
 * Four ways this returns without ever considering a judge call — in the
 * order checked, each one a cheaper reason than the last to skip a paid
 * call:
 *
 * 1. `'unchanged'` — the raw hash matches the last one recorded. Free:
 *    string equality on hashes already computed for the ingestion queue's
 *    own idempotency key (`olea-core`'s `hash.ts`).
 * 2. `'formatting-only'` — the raw hash differs but the canonicalised hash
 *    (`canonical.ts`) does not. Row 1.4's own health check, met
 *    structurally: a reflow, a re-tagged bullet, a promoted heading never
 *    reaches this far.
 * 3. `'debounced'` — this path changed too recently (`MaterialityConstants
 *    .debounceMs`). Guards the cost model's "on every save" concern — see
 *    `constants.ts`.
 * 4. `'below-floor'` — the canonicalised delta is smaller than
 *    `MaterialityConstants.minEditChars`. See `constants.ts` for why this
 *    floor is deliberately generous rather than aggressive, and why it never
 *    exempts a file from a later, larger change.
 *
 * Anything past all four is `'call-judge'` — the caller owes the model read.
 */

import type { MaterialityConstants } from './constants.js';
import type { MaterialityGateOutcome, MaterialityHashes } from './types.js';

export interface EvaluateMaterialityGateInput {
  /** The previously-recorded hashes for this path, or `null` on first sighting. */
  readonly previous: MaterialityHashes | null;
  /** The hashes just computed for the file's current content. */
  readonly current: MaterialityHashes;
  /**
   * Absolute character-length difference between the previous and current
   * canonicalised text. Ignored when `previous` is `null` (a first sighting
   * always clears the floor — there is nothing to diff against, and row 1.4
   * exists to notice new material, which a never-before-seen file always
   * is). The caller computes this (comparing full canonicalised strings, not
   * just their hashes) because a floor decision needs the size of the
   * difference, which a hash alone cannot give back.
   */
  readonly canonicalCharDelta: number;
  /** Epoch ms this path was last observed changing, or `null` if never before. */
  readonly lastChangedAt: number | null;
  readonly now: number;
  readonly constants: MaterialityConstants;
}

export function evaluateMaterialityGate(
  input: EvaluateMaterialityGateInput,
): MaterialityGateOutcome {
  const { previous, current, canonicalCharDelta, lastChangedAt, now, constants } = input;

  if (previous !== null && previous.rawHash === current.rawHash) {
    return { kind: 'unchanged' };
  }
  if (previous !== null && previous.canonicalHash === current.canonicalHash) {
    return { kind: 'formatting-only' };
  }
  if (lastChangedAt !== null) {
    const quietFor = now - lastChangedAt;
    if (quietFor < constants.debounceMs) {
      return { kind: 'debounced', resumeNotBefore: lastChangedAt + constants.debounceMs };
    }
  }
  if (previous !== null && canonicalCharDelta < constants.minEditChars) {
    return { kind: 'below-floor' };
  }
  return { kind: 'call-judge' };
}
