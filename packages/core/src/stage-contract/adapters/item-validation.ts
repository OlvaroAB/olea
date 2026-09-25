/**
 * Decision adapter for the item-validation seam (F2.23):
 * `checkItemValidation`'s `ItemValidationOutcome`
 * (`../../concept/revision/types.ts`). Pure; the seam's files are not
 * touched.
 *
 * The judge's question is whether the item itself is suspect, never anything
 * about her. The mapping:
 *
 * - `proposed` is the verdict `suspected`; the proposal is the payload. It
 *   stays a proposal for her to confirm: reading it through this contract
 *   moves no weight, eligibility or growth stage.
 * - `not-suspected` is the verdict `not-suspected`, payload `null`.
 * - `judge-unavailable` (no judge configured) is unavailable
 *   `not-configured`.
 * - `no-trigger` returns `null`: the precondition did not hold, so no
 *   decision was asked for.
 *
 * The two verdict words restate the seam's own boolean and arm names; they
 * are not a new wire vocabulary.
 */

import type {
  ItemValidationOutcome,
  ItemValidationProposal,
} from '../../concept/revision/types.js';
import type { DecisionOutcome, DecisionVocabulary } from '../decision.js';
import { failedCallProvenance, modelProvenance, type StageSeamContext } from '../provenance.js';

export type ItemValidationVerdict = 'suspected' | 'not-suspected';

export const ITEM_VALIDATION_VOCABULARY: DecisionVocabulary<ItemValidationVerdict> = {
  verdicts: ['suspected', 'not-suspected'],
};

export type ItemValidationDecision = DecisionOutcome<
  ItemValidationVerdict,
  ItemValidationProposal | null
>;

export function decisionFromItemValidation(
  outcome: ItemValidationOutcome,
  context: StageSeamContext,
): ItemValidationDecision | null {
  switch (outcome.kind) {
    case 'proposed':
      return {
        kind: 'verdict',
        verdict: 'suspected',
        payload: outcome.proposal,
        provenance: modelProvenance(context),
      };
    case 'not-suspected':
      return {
        kind: 'verdict',
        verdict: 'not-suspected',
        payload: null,
        provenance: modelProvenance(context),
      };
    case 'judge-unavailable':
      return {
        kind: 'unavailable',
        cause: 'not-configured',
        provenance: failedCallProvenance(context),
      };
    case 'no-trigger':
      return null;
  }
}
