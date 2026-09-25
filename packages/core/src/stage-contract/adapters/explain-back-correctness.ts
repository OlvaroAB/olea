/**
 * Decision adapter for the explain-back correctness seam: the settled result
 * of `gradeExplainBack` (`../../grading/gradingPipeline.ts`), a
 * `PendingExplainBackGrading` or the error it threw. Pure; the seam's files
 * are not touched.
 *
 * The mapping:
 *
 * - a fulfilled grading is a verdict: `grading.verdict` is the step's closed
 *   set (`correct`, `partial`, `incorrect`), and the whole pending grading is
 *   the payload, unchanged. It is still `pending-review`: reading it through
 *   this contract does not accept it, and the INV-6 accept step stays where
 *   it is.
 * - `UnusableGradingInputError` (an empty reference answer, so the model is
 *   never called) is undecided, basis `nothing-to-decide-from`, produced by
 *   code. It is a fact about the instrument, never about her answer.
 * - `WorkerJudgeError` reads its Worker code (`./worker-failure.ts`): a
 *   well-formed refusal is unavailable `service-refused` with the code; no
 *   code means an unusable response, unavailable `malformed`;
 *   `grounding-refused` is undecided `nothing-to-decide-from`.
 * - anything else thrown (the transport, most often) is unavailable
 *   `call-failed`.
 *
 * Today's seam keeps a verdict even when grounding dropped every citation.
 * The target pipeline voids such a verdict (undecided, `voided-by-check`),
 * but that is a behaviour change for the chain's own build bead, so this
 * adapter reports the verdict exactly as the seam returns it.
 */

import {
  type PendingExplainBackGrading,
  UnusableGradingInputError,
} from '../../grading/gradingPipeline.js';
import { WorkerJudgeError } from '../../grading/workerJudgeCaller.js';
import type { DecisionOutcome, DecisionVocabulary } from '../decision.js';
import {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';
import { readWorkerErrorCode } from './worker-failure.js';

export type ExplainBackCorrectnessVerdict = PendingExplainBackGrading['grading']['verdict'];

/** The correctness step's closed verdict set as the seam returns it today. */
export const EXPLAIN_BACK_CORRECTNESS_VOCABULARY: DecisionVocabulary<ExplainBackCorrectnessVerdict> =
  {
    verdicts: ['correct', 'partial', 'incorrect'],
  };

export type ExplainBackCorrectnessDecision = DecisionOutcome<
  ExplainBackCorrectnessVerdict,
  PendingExplainBackGrading
>;

/** The code rule named on the undecided outcome for an empty reference answer. */
export const EMPTY_REFERENCE_ANSWER_RULE = 'empty-reference-answer';

export function decisionFromExplainBackGrading(
  settled: PromiseSettledResult<PendingExplainBackGrading>,
  context: StageSeamContext,
): ExplainBackCorrectnessDecision {
  if (settled.status === 'fulfilled') {
    return {
      kind: 'verdict',
      verdict: settled.value.grading.verdict,
      payload: settled.value,
      provenance: modelProvenance(context),
    };
  }
  const error: unknown = settled.reason;
  if (error instanceof UnusableGradingInputError) {
    return {
      kind: 'undecided',
      basis: 'nothing-to-decide-from',
      provenance: codeProvenance(EMPTY_REFERENCE_ANSWER_RULE, context.evidenceDigests),
    };
  }
  if (error instanceof WorkerJudgeError) {
    const reading = readWorkerErrorCode(error.code);
    switch (reading.kind) {
      case 'nothing-to-work-from':
        return {
          kind: 'undecided',
          basis: 'nothing-to-decide-from',
          provenance: failedCallProvenance(context),
        };
      case 'service-refused':
        return {
          kind: 'unavailable',
          cause: 'service-refused',
          serviceCode: reading.serviceCode,
          provenance: failedCallProvenance(context),
        };
      case 'malformed':
        return {
          kind: 'unavailable',
          cause: 'malformed',
          provenance: failedCallProvenance(context),
        };
    }
  }
  return { kind: 'unavailable', cause: 'call-failed', provenance: failedCallProvenance(context) };
}
