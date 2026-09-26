/**
 * Decision adapter for the explain-back correctness seam: the settled result
 * of `gradeExplainBack` (`../../grading/gradingPipeline.ts`), a
 * `PendingExplainBackGrading` or the error it threw. Pure; the seam's files
 * are not touched.
 *
 * The mapping:
 *
 * - a fulfilled grading whose `grading.outcome` is `'graded'` is a verdict:
 *   `grading.verdict` is the step's closed set (`correct`, `partial`,
 *   `incorrect`), and the whole pending grading is the payload, unchanged.
 *   It is still `pending-review`: reading it through this contract does not
 *   accept it, and the INV-6 accept step stays where it is.
 * - **`[D-321]` / `ol-0r92.130` (round 2, this adapter's own follow-up):** a
 *   fulfilled grading whose `grading.outcome` is `'unable-to-assess'` is
 *   undecided, basis `'abstained'` — never a verdict, and never
 *   `'nothing-to-decide-from'`. Read `decision.ts`'s own `UndecidedBasis` doc
 *   literally: `'abstained'` is "the producer ran and said it could not
 *   settle it (a could-not-decide, cannot-tell or unclassified answer)" —
 *   exactly this case, the model ran and declined — while
 *   `'nothing-to-decide-from'` is reserved for when no model was asked at
 *   all (an empty reference answer below, or the Worker's own
 *   `grounding-refused` refusal). **Flagged, not silently decided**: this is
 *   a Class A/B mapping call (a non-persisted vocabulary choice within an
 *   existing envelope, not a schema or contract change) — `'abstained'` is
 *   the textually correct member of the closed `UndecidedBasis` set for this
 *   case; report before relying on it if that reading is wrong.
 *   `EXPLAIN_BACK_CORRECTNESS_VOCABULARY.undecided` names the step's own
 *   word for it (`'unable-to-assess'`, `decisionWord`'s own vocabulary hook
 *   — `decision.ts`'s module doc gives this exact word as its worked
 *   example), so a reader of the envelope sees the step's real term, not the
 *   generic `'undecided'`.
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

import type { GroundedGradingGraded } from '../../grading/gradingPipeline.js';
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

export type ExplainBackCorrectnessVerdict = GroundedGradingGraded['verdict'];

/**
 * The correctness step's closed verdict set as the seam returns it today,
 * plus the step's own word for its undecided outcome (`[D-321]`'s
 * `'unable-to-assess'` — see the module doc's mapping note).
 */
export const EXPLAIN_BACK_CORRECTNESS_VOCABULARY: DecisionVocabulary<ExplainBackCorrectnessVerdict> =
  {
    verdicts: ['correct', 'partial', 'incorrect'],
    undecided: 'unable-to-assess',
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
    // `[D-321]`: the model ran and said it could not tell — `'abstained'`,
    // never a verdict, never `'nothing-to-decide-from'` (that basis is
    // reserved for when no model was asked at all). See the module doc's
    // mapping note.
    if (settled.value.grading.outcome === 'unable-to-assess') {
      return {
        kind: 'undecided',
        basis: 'abstained',
        provenance: modelProvenance(context),
      };
    }
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
