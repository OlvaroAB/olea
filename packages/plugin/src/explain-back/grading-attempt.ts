/**
 * `[D-482]` (F5.5 / F5.3): runs ONE correctness attempt for the modal and says what the modal
 * should do with it, as a plain value. Pure of `obsidian` and of the DOM so it can be tested
 * behaviourally (the modal itself cannot be instantiated under Vitest).
 *
 * Three rules, each pinned by `test/explain-back/modal-refusal.spec.ts` and
 * `modal-idempotency.spec.ts`:
 * - The call is bounded (`CORRECTNESS_OVERALL_BOUND_MS`): a call that never returns, errors at
 *   the transport or returns an unusable response ends as `refused / check-failed`, the
 *   existing could-not-check result. Never a verdict, never `insufficient-notes`: that copy is
 *   reserved for `UnusableGradingInputError` (an empty reference).
 * - A refusal records nothing: this function returns a value and writes nowhere.
 * - A result that settles after `isCurrent()` turned false (she pressed Try again and started a
 *   newer attempt) is `superseded`: the modal ignores it, so a late response never replaces the
 *   newer attempt.
 *
 * Never logs or carries content (D-005): the failure reason is the only thing it surfaces.
 */

import {
  boundedCall,
  CORRECTNESS_OVERALL_BOUND_MS,
  classifyGradingCallFailure,
  type GradeExplainBackInput,
  type PendingExplainBackGrading,
} from 'olea-core';

export type GradingAttemptResult =
  | { readonly kind: 'graded'; readonly pending: PendingExplainBackGrading }
  /** The grader is not configured (or switched off): the existing `unavailable` refusal. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'refused'; readonly reason: 'check-failed' | 'insufficient-notes' }
  /** A newer attempt began while this one was outstanding; the result is dropped. */
  | { readonly kind: 'superseded' };

export interface RunGradingAttemptParams {
  readonly grade: (input: GradeExplainBackInput) => Promise<PendingExplainBackGrading | null>;
  readonly input: GradeExplainBackInput;
  /** True while this attempt is still the modal's current one. Read after the call settles. */
  readonly isCurrent: () => boolean;
  readonly boundMs?: number;
}

export async function runGradingAttempt(
  params: RunGradingAttemptParams,
): Promise<GradingAttemptResult> {
  let result: GradingAttemptResult;
  try {
    const pending = await boundedCall(() => params.grade(params.input), {
      boundMs: params.boundMs ?? CORRECTNESS_OVERALL_BOUND_MS,
      classify: classifyGradingCallFailure,
    });
    result = pending === null ? { kind: 'unavailable' } : { kind: 'graded', pending };
  } catch (error) {
    const isUnusableInput = error instanceof Error && error.name === 'UnusableGradingInputError';
    result = {
      kind: 'refused',
      reason: isUnusableInput ? 'insufficient-notes' : 'check-failed',
    };
  }
  return params.isCurrent() ? result : { kind: 'superseded' };
}
