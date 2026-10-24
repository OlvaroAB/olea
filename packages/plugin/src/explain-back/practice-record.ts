/**
 * The practice explanation the explain-back view writes when she leaves an answer (D7.1,
 * `[D-603]`, `[D-614]`; `ol-egov.141.89.6.129`): once per answer, when she leaves it by "Done" or
 * by "Try again", through `olea-core`'s `recordPracticeExplanation` (`ol-egov.141.89.6.128`).
 *
 * This module is the plugin half: {@link practiceExplanationInput} turns what the view knows into
 * the writer's input (pure apart from hashing, so it is tested directly), and
 * {@link createRecordPracticeExplanation} is the dependency the composition root wires, closing
 * over the offer behind the prompt the way `recordNonAttempt` does, since the view has no way to
 * know it.
 *
 * **What the view supplies and what the writer works out.** The view names the question, the
 * attempt, the concepts, the prompt's shape, the timing, her text and, for each earlier attempt in
 * this view that she left by "Try again", the passages shown after it, by digest
 * (`passagesShownInView`). The writer reads her log for the rest: exposure on an earlier attempt
 * in an earlier session, or after a reload, comes from the `[D-460]` markers the view writes
 * before the passages appear, and the writer is idempotent on the attempt id, so reopening or
 * reloading writes no second entry.
 *
 * **No content leaves her vault and nothing is logged with it (D-005).** Her text goes only to the
 * `[D-077]` content store, by the writer; passages travel only as digests.
 */
import type { ExplainBackOfferTrigger, ExplainBackPromptShape } from 'olea-contracts';
import {
  digestPassage,
  type RecordPracticeExplanationInput,
  type RecordPracticeExplanationResult,
  recordPracticeExplanation,
  type VaultSource,
} from 'olea-core';
import { isoWithLocalOffset } from '../review/ports.js';

/** Everything the writer takes except the offer behind the prompt, which the composition root closes over. */
export type ViewPracticeExplanationInput = Omit<
  RecordPracticeExplanationInput,
  'trigger' | 'offerEventId'
>;

/** The writer `ExplainBackModalDeps.recordPracticeExplanation` is. Rejects on a validation or vault failure. */
export type RecordViewPracticeExplanation = (
  input: ViewPracticeExplanationInput,
) => Promise<RecordPracticeExplanationResult>;

/**
 * The writer's input for one answer she is leaving.
 *
 * - `earlierAttemptIds`: the attempts in this view she left by "Try again" before writing this
 *   answer, oldest first; `[]` for a first attempt. Every attempt in one view answers the same
 *   prompt and is shown the same passages (the prompt carries them and Try again never searches
 *   again), so each is paired with the digests of `passageTexts`.
 * - `localCheckFlagged` is never set: no declared local check exists yet (F5.7).
 */
export async function practiceExplanationInput(params: {
  readonly instrumentId: string;
  readonly attemptId: string;
  readonly conceptIds: readonly string[];
  readonly promptShape: ExplainBackPromptShape;
  readonly durationMs: number | null;
  readonly answer: string;
  /** When she left the answer: the record's own date. */
  readonly leftAt: Date;
  readonly earlierAttemptIds: readonly string[];
  /** The passages the prompt carries, shown after each attempt, as text (digested here, never passed on). */
  readonly passageTexts: readonly string[];
}): Promise<ViewPracticeExplanationInput> {
  const passageFingerprints =
    params.earlierAttemptIds.length === 0
      ? []
      : await Promise.all(params.passageTexts.map((text) => digestPassage(text)));
  return {
    timestamp: isoWithLocalOffset(params.leftAt),
    instrumentId: params.instrumentId,
    attemptId: params.attemptId,
    conceptIds: [...params.conceptIds],
    promptShape: params.promptShape,
    durationMs: params.durationMs,
    answer: params.answer,
    passagesShownInView: params.earlierAttemptIds.map((attemptId) => ({
      attemptId,
      passageFingerprints: [...passageFingerprints],
    })),
  };
}

export interface RecordPracticeExplanationDeps {
  readonly vault: VaultSource;
  /** Per-install id, resolved per call like every other explain-back write in `main.ts`. */
  readonly deviceId: () => Promise<string>;
  /** The trigger the offer behind this prompt was made under (`'on-demand'` for her own request). */
  readonly trigger: ExplainBackOfferTrigger;
  /** The `explain-back-offered` record's event id, only when a real offer stands behind the prompt (`[D-369]`). */
  readonly offerEventId?: string | undefined;
}

/**
 * The `ExplainBackModalDeps.recordPracticeExplanation` implementation the composition root wires:
 * one call into `olea-core`'s `recordPracticeExplanation`, with the trigger and offer closed over.
 * Rejects when the device id, validation or the vault write fails; the view catches it.
 */
export function createRecordPracticeExplanation(
  deps: RecordPracticeExplanationDeps,
): RecordViewPracticeExplanation {
  return async (input) =>
    recordPracticeExplanation(
      deps.vault,
      {
        ...input,
        trigger: deps.trigger,
        ...(deps.offerEventId !== undefined ? { offerEventId: deps.offerEventId } : {}),
      },
      { deviceId: await deps.deviceId() },
    );
}
