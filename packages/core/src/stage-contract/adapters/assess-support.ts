/**
 * Decision adapter for the sufficiency seam: `AssessSupportOutcome`
 * (`../../retrieval/groundedContext.ts`), the outcome of the evidence
 * chain's decide step behind `AssessSupportPort`. Pure, and the seam's file
 * is not touched: this reads its values, it does not change how any are
 * produced.
 *
 * The mapping:
 *
 * - `assessed` is a verdict: the four-way `verdict` is the step's closed
 *   set; `supported`, `reason` and `missing` travel as the payload.
 * - `could-not-decide` is undecided, basis `abstained`: the provider ran
 *   and could not settle it.
 * - `insufficient-evidence` is undecided, basis `nothing-to-decide-from`,
 *   produced by code. `[D-289]` (ruled) rules the empty package an
 *   operational outcome that is never a verdict; the drafting-eligibility
 *   doc and the evidence spec read this arm as that empty package. (The
 *   seam's own doc also describes it as a provider finding the evidence did
 *   not settle the question; either reading is non-verdict, so the mapping
 *   holds for both.)
 * - `unavailable` is unavailable, cause `call-failed`: the seam folds a
 *   throw, a timeout and an unusable value into one arm and does not say
 *   which.
 *
 * `assessSupportFromDecision` maps back. For every outcome this module
 * produces, the round trip returns the seam's value unchanged, which is the
 * proof that a consumer reading through the contract sees exactly what it
 * saw before (`assess-support.spec.ts`).
 */

import type {
  AssessSupportOutcome,
  AssessSupportPort,
  AssessSupportRequest,
  AssessSupportVerdict,
} from '../../retrieval/groundedContext.js';
import type { DecisionOutcome, DecisionSeat, DecisionVocabulary } from '../decision.js';
import {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';

/** The sufficiency step's closed verdict set (`evd.md` §3, `[D-289]`). */
export const ASSESS_SUPPORT_VOCABULARY: DecisionVocabulary<AssessSupportVerdict> = {
  verdicts: ['sufficient', 'partial', 'insufficient', 'conflicting'],
};

/** What an `assessed` outcome carries besides its verdict. */
export interface AssessSupportPayload {
  readonly supported: boolean;
  readonly reason: string;
  readonly missing?: readonly string[];
}

export type AssessSupportDecision = DecisionOutcome<AssessSupportVerdict, AssessSupportPayload>;

/** The code rule named on the undecided outcome for an empty evidence package. */
export const EMPTY_EVIDENCE_PACKAGE_RULE = 'empty-evidence-package';

export function decisionFromAssessSupport(
  outcome: AssessSupportOutcome,
  context: StageSeamContext,
): AssessSupportDecision {
  switch (outcome.status) {
    case 'assessed':
      return {
        kind: 'verdict',
        verdict: outcome.verdict,
        payload: {
          supported: outcome.supported,
          reason: outcome.reason,
          ...(outcome.missing !== undefined ? { missing: outcome.missing } : {}),
        },
        provenance: modelProvenance(context),
      };
    case 'could-not-decide':
      return { kind: 'undecided', basis: 'abstained', provenance: modelProvenance(context) };
    case 'insufficient-evidence':
      return {
        kind: 'undecided',
        basis: 'nothing-to-decide-from',
        provenance: codeProvenance(EMPTY_EVIDENCE_PACKAGE_RULE, context.evidenceDigests),
      };
    case 'unavailable':
      return {
        kind: 'unavailable',
        cause: 'call-failed',
        provenance: failedCallProvenance(context),
      };
  }
}

/**
 * The seam's value for a decision. Lossless for everything
 * `decisionFromAssessSupport` produces. For outcomes it never produces, the
 * nearest seam arm: any other undecided basis reads as `could-not-decide`,
 * any unavailable cause as `unavailable`.
 */
export function assessSupportFromDecision(decision: AssessSupportDecision): AssessSupportOutcome {
  switch (decision.kind) {
    case 'verdict':
      return {
        status: 'assessed',
        supported: decision.payload.supported,
        reason: decision.payload.reason,
        verdict: decision.verdict,
        ...(decision.payload.missing !== undefined ? { missing: decision.payload.missing } : {}),
      };
    case 'undecided':
      return decision.basis === 'nothing-to-decide-from'
        ? { status: 'insufficient-evidence' }
        : { status: 'could-not-decide' };
    case 'unavailable':
      return { status: 'unavailable' };
  }
}

/**
 * Any `AssessSupportPort` as a `DecisionSeat`, sitting in `context.seat`.
 * This is how an incumbent judge, a cheaper candidate and a stronger
 * fallback all sit behind the one interface `cascadeDecisionSeats` composes.
 * A port that throws becomes `unavailable`, never an uncaught error.
 */
export function assessSupportSeat(
  port: AssessSupportPort,
  context: StageSeamContext,
): DecisionSeat<AssessSupportRequest, AssessSupportVerdict, AssessSupportPayload> {
  return {
    async decide(request: AssessSupportRequest): Promise<AssessSupportDecision> {
      let outcome: AssessSupportOutcome;
      try {
        outcome = await port.assessSupport(request);
      } catch {
        outcome = { status: 'unavailable' };
      }
      return decisionFromAssessSupport(outcome, context);
    },
  };
}
