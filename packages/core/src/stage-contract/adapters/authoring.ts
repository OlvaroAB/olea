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
 * - `insufficient-evidence` (the judge rejecting the sources, the one checked
 *   verdict): `declined`, basis `upstream-refused`, rule `evidence-refused`:
 *   the evidence step refused and nothing was written.
 * - `not-assessed` (`[D-441]`, ruled 2026-09-29: the composite veto or the
 *   band's lower bar blocked the request from numbers alone): `declined`,
 *   basis `upstream-refused`, but under the code rule `threshold-blocked`, not
 *   `evidence-refused`. The writing contract has no arm for "not assessed",
 *   so the rule name is what keeps it apart from a judged insufficiency; a
 *   reader must not word it as her notes lacking the material.
 * - `unavailable`: cause `upstream-unavailable` when the evidence check
 *   could not run, `call-failed` for a drafting-call error, `malformed` for
 *   a response that did not parse. **Except** a `refused` attempt whose
 *   `reason` is `'no-hits'` or `'below-relevance-threshold'`: the seam's own
 *   classifier (`classifyAuthoringOutcome`) still reports these as
 *   `unavailable` (retrieval failure, retryable), but `[D-289]` point 2
 *   (`ol-egov.141.89.2.12`) rules an empty evidence package undecided, never
 *   an outage, and `[D-441]` reads a package the relevance floor emptied the
 *   same way — so this adapter reads `attempt.reason` (present on every
 *   `refused` attempt) to refine those into `declined`, basis
 *   `nothing-to-write-from`, under a rule named for the reason: there was
 *   nothing to write from, not a call that failed.
 *   `'judge-unavailable'`/`'composite-check-unavailable'` keep the
 *   `unavailable`/`upstream-unavailable` reading — those genuinely are a
 *   check that could not run.
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

/**
 * The code rule named when a `refused` attempt's `reason` is `'no-hits'` —
 * an empty evidence package, read as `declined`/`nothing-to-write-from`
 * rather than `unavailable` (`[D-289]` point 2, `ol-egov.141.89.2.12`).
 */
export const NO_HITS_RULE = 'no-hits';

/**
 * The code rule named when the relevance floor emptied the package
 * (`'below-relevance-threshold'`): read like an empty package
 * (`[D-441]`, ruled 2026-09-29) but kept under its own rule, so the two
 * reasons stay separable.
 */
export const BELOW_RELEVANCE_RULE = 'below-relevance-threshold';

/**
 * The code rule named when the composite veto or the band's lower bar blocked
 * the request from numbers alone (`'below-composite-threshold'`,
 * `'below-band'`): not assessed, never a checked insufficiency (`[D-441]`).
 */
export const THRESHOLD_BLOCKED_RULE = 'threshold-blocked';

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
    case 'not-assessed':
      return {
        kind: 'declined',
        basis: 'upstream-refused',
        provenance: codeProvenance(THRESHOLD_BLOCKED_RULE, context.evidenceDigests),
      };
    case 'unavailable':
      if (attempt.kind === 'refused') {
        // D-289 point 2: an empty evidence package is undecided, never an
        // outage — refine past the seam's own `unavailable` status for
        // exactly this reason, and (D-441) for the relevance floor emptying
        // the package. See this module's doc.
        if (attempt.reason === 'no-hits' || attempt.reason === 'below-relevance-threshold') {
          return {
            kind: 'declined',
            basis: 'nothing-to-write-from',
            provenance: codeProvenance(
              attempt.reason === 'no-hits' ? NO_HITS_RULE : BELOW_RELEVANCE_RULE,
              context.evidenceDigests,
            ),
          };
        }
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
