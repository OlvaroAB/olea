/**
 * `[D-416]` (`ol-egov.141.89.6.63`): the attempt she sets aside with Try
 * again, written to her log as its own `explain-back-set-aside` record, so Try
 * again never erases the attempt sequence. The view's in-memory sequence
 * (`./attempt-sequence.ts`) decides WHICH attempt a retry follows and what
 * rung it was answered at; this module turns one of its entries into the
 * persisted record and supplies the writer the composition root wires.
 *
 * **Never evidence.** The record is read by nothing that reports what she
 * knows (the contract's own doc; `olea-core`'s
 * `review-log/set-aside-not-evidence.spec.ts` proves it per fold).
 *
 * **No content (D-005).** Ids, a three-value verdict with its call's stamp,
 * the rung and a duration. The input type has no place for her answer, the
 * feedback or a cited passage.
 */
import {
  appendExplainBackSetAsideRecord,
  EXPLAIN_BACK_JUDGE_TASK_ID,
  type ExplainBackSetAsideLogRecordInput,
  type PendingExplainBackGrading,
  type VaultSource,
} from 'olea-core';
import { isoWithLocalOffset } from '../review/ports.js';
import type { SetAsideAttempt } from './attempt-sequence.js';

export interface SetAsideRecordParams {
  /** The id the accepted retry's review would carry (`ResolvedPrompt.originInstrumentId`). */
  readonly instrumentId: string;
  /**
   * The prompt's subject concept. `null` (a free-form prompt with no resolved
   * concept) writes nothing, exactly as the accepted retry's review writes
   * nothing without one (`./solo-review.ts`'s `recordSoloGradeAndReview`).
   */
  readonly subjectConceptId: string | null;
  /** The entry `appendSetAsideAttempt` just added to the view's sequence. */
  readonly attempt: SetAsideAttempt;
  /** The grading she set aside, for the correctness call's stamp. */
  readonly pending: PendingExplainBackGrading;
  readonly durationMs: number | null;
  /** The moment she chose Try again. */
  readonly at: Date;
}

/**
 * The record input for one set-aside attempt, or `null` when there is no
 * concept to attribute it to.
 *
 * The concept list is the one the accepted retry's review would name,
 * `[subjectConceptId]`, so a retry and the attempts it followed are joinable
 * on the same concept. The verdict keeps the correctness call's own stamp when
 * the grading carries one (always, in production); absent means provenance
 * unknown, never invented or borrowed from another call. An unknown rung and
 * a first attempt are omitted, never written as a key.
 */
export function setAsideRecordInput(
  params: SetAsideRecordParams,
): ExplainBackSetAsideLogRecordInput | null {
  const { attempt, pending, subjectConceptId } = params;
  if (subjectConceptId === null) return null;
  const stamp = pending.stamp;
  const outcome: ExplainBackSetAsideLogRecordInput['outcome'] =
    attempt.outcome.kind === 'graded'
      ? {
          kind: 'graded',
          verdict: attempt.outcome.verdict,
          ...(stamp !== undefined
            ? {
                artifactProvenance: {
                  taskId: EXPLAIN_BACK_JUDGE_TASK_ID,
                  promptVersion: stamp.promptVersion,
                  modelId: stamp.modelId,
                },
              }
            : {}),
        }
      : { kind: 'unable-to-assess' };
  return {
    timestamp: isoWithLocalOffset(params.at),
    instrumentId: params.instrumentId,
    conceptIds: [subjectConceptId],
    attemptId: attempt.attemptId,
    ...(attempt.followsAttemptId !== null ? { followsAttemptId: attempt.followsAttemptId } : {}),
    outcome,
    ...(attempt.supportLevelShown !== undefined
      ? { supportLevelShown: attempt.supportLevelShown }
      : {}),
    durationMs: params.durationMs,
  };
}

export interface RecordSetAsideAttemptDeps {
  readonly vault: VaultSource;
  /** Per-install id, resolved per call like every other explain-back write in `main.ts`. */
  readonly deviceId: () => Promise<string>;
}

/**
 * The `ExplainBackModalDeps.recordSetAsideAttempt` implementation the
 * composition root wires: one append through core's
 * `appendExplainBackSetAsideRecord`.
 */
export function createRecordSetAsideAttempt(
  deps: RecordSetAsideAttemptDeps,
): (input: ExplainBackSetAsideLogRecordInput) => Promise<void> {
  return async (input) => {
    await appendExplainBackSetAsideRecord(deps.vault, input, { deviceId: await deps.deviceId() });
  };
}
