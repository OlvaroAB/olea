/**
 * Decision adapter for the explain-back depth seam: the settled result of
 * `gradeSolo` (`../../grading/explainBackSolo.ts`), a `PendingSoloGrading`
 * or the error it threw. Pure; the seam's files are not touched.
 *
 * The mapping:
 *
 * - a fulfilled grading is a verdict: `soloLevel` is the step's closed set
 *   of five levels, and the whole pending grading is the payload, unchanged
 *   and still `pending-review` (the INV-6 accept step is untouched).
 * - `WorkerSoloJudgeError` reads its Worker code the same way the
 *   correctness adapter does (`./worker-failure.ts`).
 * - anything else thrown is unavailable `call-failed`.
 *
 * There is no nothing-to-decide-from arm: the seam deliberately has no
 * unusable-input refusal, because an empty answer is honestly the lowest
 * level rather than a reason not to grade (`gradeSolo`'s own doc).
 */

import type { SoloLevel } from 'olea-contracts';
import type { PendingSoloGrading } from '../../grading/explainBackSolo.js';
import { WorkerSoloJudgeError } from '../../grading/workerSoloJudgeCaller.js';
import type { DecisionOutcome, DecisionVocabulary } from '../decision.js';
import { failedCallProvenance, modelProvenance, type StageSeamContext } from '../provenance.js';
import { readWorkerErrorCode } from './worker-failure.js';

/** The depth step's closed verdict set: the five SOLO levels, lowest first. */
export const EXPLAIN_BACK_DEPTH_VOCABULARY: DecisionVocabulary<SoloLevel> = {
  verdicts: [
    'prestructural',
    'unistructural',
    'multistructural',
    'relational',
    'extended-abstract',
  ],
};

export type ExplainBackDepthDecision = DecisionOutcome<SoloLevel, PendingSoloGrading>;

export function decisionFromSoloGrading(
  settled: PromiseSettledResult<PendingSoloGrading>,
  context: StageSeamContext,
): ExplainBackDepthDecision {
  if (settled.status === 'fulfilled') {
    return {
      kind: 'verdict',
      verdict: settled.value.soloLevel,
      payload: settled.value,
      provenance: modelProvenance(context),
    };
  }
  const error: unknown = settled.reason;
  if (error instanceof WorkerSoloJudgeError) {
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
