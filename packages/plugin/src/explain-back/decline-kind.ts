/**
 * `[D-564]` (c), condition 2 (`ol-egov.141.89.6.113`): the judge's `unable-to-assess` outcome
 * carries a free-text `reason`, and a genuine attempt that cannot be assessed is handled
 * differently from a non-attempt. The kinds are told apart by the reason's PREFIX alone;
 * nothing in the response contract, the request or any persisted record changes.
 *
 * - `insufficient-material:` her notes as delivered cannot decide;
 * - `defective-question:` the question cannot be answered as asked, or contradicts itself;
 * - anything else, or no reason at all, is a non-attempt, which is the meaning every decline
 *   had before this file.
 *
 * Neither kind is evidence: no incorrect verdict, no attainment, no misconception, no depth
 * pass (`../../test/explain-back/modal-decline-not-evidence.spec.ts`).
 *
 * **Production caller:** none yet that produces the two genuine-attempt kinds. The production
 * judge (prompt 1.6.0) never sends these prefixes, so every decline in production is a
 * non-attempt. The modal's call site is `./modal.ts`'s `renderUnableToAssessPhase`.
 */

import {
  EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE,
  EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE,
} from './copy.js';

export type ExplainBackDeclineKind = 'non-attempt' | 'insufficient-material' | 'defective-question';

export const INSUFFICIENT_MATERIAL_REASON_PREFIX = 'insufficient-material:';
export const DEFECTIVE_QUESTION_REASON_PREFIX = 'defective-question:';

/** The kind of decline the judge's reason names. Absent, empty or unknown reads as a non-attempt. */
export function declineKindOf(reason: string | null | undefined): ExplainBackDeclineKind {
  if (typeof reason !== 'string') return 'non-attempt';
  if (reason.startsWith(INSUFFICIENT_MATERIAL_REASON_PREFIX)) return 'insufficient-material';
  if (reason.startsWith(DEFECTIVE_QUESTION_REASON_PREFIX)) return 'defective-question';
  return 'non-attempt';
}

/** The one message for a decline of this kind; both genuine-attempt kinds share one string. */
export function declineMessageFor(kind: ExplainBackDeclineKind): string {
  return kind === 'non-attempt'
    ? EXPLAIN_BACK_UNABLE_TO_ASSESS_MESSAGE
    : EXPLAIN_BACK_DECLINED_GENUINE_ATTEMPT_MESSAGE;
}
