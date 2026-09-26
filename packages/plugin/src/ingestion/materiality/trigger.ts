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
 *
 * **`'below-floor'` is a ONE-TIME defer, never a verdict** (`[DOS-C3]`,
 * ol-2zfj.152). This function only ever sees one save at a time and has no
 * memory of a path's history, so it cannot itself tell "this is the first
 * sub-floor edit" from "this is the fifth in a row" — that recurrence
 * tracking lives in the caller (`wiring.ts`'s `MaterialityTrigger`, which
 * escalates a path's *second* consecutive `'below-floor'` straight to
 * `'call-judge'`, regardless of that edit's own delta). This matters because
 * a same-length substitution (a sign flip, a digit swap, an inserted
 * negation word) has a canonical delta of zero and would otherwise never
 * accumulate past the floor no matter how many times it recurs. The floor
 * may defer, batch or deprioritise a call; it may never, by itself or by
 * the caller's bookkeeping, be the reason a real content change goes
 * undecided forever.
 *
 * **Recurrence is not the only way out of a defer** (`[DOS-3]`, ol-2zfj.159).
 * A below-floor edit that never recurs on its own path has no second edit to
 * escalate on — the caller's recurrence bookkeeping alone would leave it
 * pending forever, the exact outcome the paragraph above forbids. `wiring.ts`'s
 * `MaterialityTrigger.drainDuePendingEdits` is the other half: a time-based
 * drain that forces a pending, non-recurring below-floor edit to the judge
 * once it has sat long enough with nothing else touching that path.
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
  /**
   * Canonicalised length of `current`'s own text, when the caller has the
   * text to compute it from (`wiring.ts` always does). Optional and used for
   * exactly one thing: telling "a genuinely empty first sighting" apart from
   * "an enormous one" (`ol-egov.141.89.5.7`, defect 4) — `canonicalCharDelta`
   * cannot do this alone, since it is `Number.POSITIVE_INFINITY` for both
   * when `previous` is `null`. Omitted (or non-zero), this check never
   * fires, so an existing caller that only has hashes keeps today's
   * behaviour unchanged.
   */
  readonly currentCanonicalLength?: number | undefined;
}

export function evaluateMaterialityGate(
  input: EvaluateMaterialityGateInput,
): MaterialityGateOutcome {
  const {
    previous,
    current,
    canonicalCharDelta,
    lastChangedAt,
    now,
    constants,
    currentCanonicalLength,
  } = input;

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
  // Defect 4 (ol-egov.141.89.5.7): a first sighting always clears every gate
  // above (there is nothing to diff against) -- but an empty new note has no
  // groundable content for row 1.4 to notice in the first place. Scoped to
  // `previous === null`: an EXISTING note edited down to empty still reaches
  // the judge as an ordinary content change (deletion of substantive content
  // is its own, already-covered failure class, chg.md sec 4).
  if (previous === null && currentCanonicalLength === 0) {
    return { kind: 'no-groundable-content' };
  }
  return { kind: 'call-judge' };
}
