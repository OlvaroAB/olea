/**
 * Writing adapters for the question-writing seams: the exact MCQ checks
 * (`checkMcqDraft`, `../../generation/mcq-draft-checks.ts`) and one
 * authoring attempt (`AuthoringAttempt`,
 * `../../generation/authoring-outcome.ts`). Pure; the seams' files are not
 * touched.
 *
 * **The receipt's checks.** `checkMcqDraft` runs seven code checks and
 * reports the ones that failed, by defect kind. `MCQ_EXACT_CHECKS` names
 * the check behind each defect kind, so the receipt lists all seven: failed
 * where a defect of that kind was reported, passed otherwise. Every one is a
 * code check, so the receipt's assurance is `code-checks-only`: a clean
 * receipt says the draft's form is right, never that its keyed answer is.
 * A defect's `detail` quotes the draft, so it never reaches the receipt; the
 * note is a count.
 *
 * **One authoring attempt.** `writingFromAuthoringAttempt` reads the attempt
 * through the seam's own classifier, `classifyAuthoringOutcome`, so the
 * mapping cannot drift from the seam's:
 *
 * - `eligible` or `invalid-draft`: the draft and its receipt (`written` or
 *   `refused`). The caller supplies the draft on a `drafted` attempt, since
 *   the seam's attempt carries only its defects.
 * - `insufficient-evidence`: `declined`, basis `upstream-refused`: the
 *   evidence step refused and nothing was written.
 * - `unavailable`: cause `upstream-unavailable` when the evidence check
 *   could not run, `call-failed` for a drafting-call error, `malformed` for
 *   a response that did not parse.
 * - `deferred` (no deliverable format, or the sweep's budget reached): the
 *   writing step never ran, so there is no writing outcome and this returns
 *   `null`. A deferral is the caller's scheduling fact.
 */

import type { AuthoringAttempt } from '../../generation/authoring-outcome.js';
import { classifyAuthoringOutcome } from '../../generation/authoring-outcome.js';
import type { McqDraftDefect, McqDraftDefectKind } from '../../generation/mcq-draft-checks.js';
import {
  codeProvenance,
  failedCallProvenance,
  modelProvenance,
  type StageSeamContext,
} from '../provenance.js';
import {
  type WritingCheckResult,
  type WritingOutcome,
  type WritingRefused,
  type WritingWritten,
  writingFromChecks,
} from '../writing.js';

/**
 * The check behind each defect kind `checkMcqDraft` can report, in that
 * module's order. A check name says what holds when it passes.
 */
export const MCQ_EXACT_CHECKS: Readonly<Record<McqDraftDefectKind, string>> = {
  'duplicate-distractors': 'distinct-distractors',
  'key-among-distractors': 'key-not-among-distractors',
  'below-distractor-floor': 'distractor-floor',
  'above-style-option': 'no-above-style-option',
  'empty-stem': 'stem-present',
  'empty-feedback': 'feedback-present',
  'presentation-incompatible': 'presentation-compatible',
};

const MCQ_DEFECT_KINDS = Object.keys(MCQ_EXACT_CHECKS) as McqDraftDefectKind[];

/** The seven exact checks' results for one draft's defect list: failed where reported, passed otherwise. */
export function mcqExactCheckResults(defects: readonly McqDraftDefect[]): WritingCheckResult[] {
  return MCQ_DEFECT_KINDS.map((kind) => {
    const count = defects.filter((defect) => defect.kind === kind).length;
    return count === 0
      ? { check: MCQ_EXACT_CHECKS[kind], kind: 'code', status: 'passed' }
      : {
          check: MCQ_EXACT_CHECKS[kind],
          kind: 'code',
          status: 'failed',
          note: `${count} defect${count === 1 ? '' : 's'}`,
        };
  });
}

/** One drafted MCQ and its `checkMcqDraft` defects, as a writing outcome. */
export function writingFromMcqDraft<D>(
  draft: D,
  defects: readonly McqDraftDefect[],
  context: StageSeamContext,
): WritingWritten<D> | WritingRefused {
  return writingFromChecks(draft, mcqExactCheckResults(defects), modelProvenance(context));
}

type DraftedAttempt = Extract<AuthoringAttempt, { kind: 'drafted' }>;

/** An `AuthoringAttempt`, with the draft attached to a `drafted` one. */
export type AuthoringAttemptWithDraft<D> =
  | Exclude<AuthoringAttempt, { kind: 'drafted' }>
  | (DraftedAttempt & { readonly draft: D });

/** The code rule named when the evidence step refused on its own grounds. */
export const EVIDENCE_REFUSED_RULE = 'evidence-refused';

export function writingFromAuthoringAttempt<D>(
  attempt: AuthoringAttemptWithDraft<D>,
  context: StageSeamContext,
): WritingOutcome<D> | null {
  const outcome = classifyAuthoringOutcome(attempt);
  switch (outcome.status) {
    case 'eligible':
    case 'invalid-draft':
      if (attempt.kind !== 'drafted') {
        throw new Error(
          'writingFromAuthoringAttempt: an eligible or invalid-draft outcome must come from a drafted attempt',
        );
      }
      return writingFromMcqDraft(attempt.draft, attempt.defects, context);
    case 'insufficient-evidence':
      return {
        kind: 'declined',
        basis: 'upstream-refused',
        provenance: codeProvenance(EVIDENCE_REFUSED_RULE, context.evidenceDigests),
      };
    case 'unavailable':
      if (attempt.kind === 'refused') {
        return {
          kind: 'unavailable',
          cause: 'upstream-unavailable',
          provenance: failedCallProvenance(context),
        };
      }
      return {
        kind: 'unavailable',
        cause: attempt.kind === 'unparseable' ? 'malformed' : 'call-failed',
        provenance: failedCallProvenance(context),
      };
    case 'deferred':
      return null;
  }
}
