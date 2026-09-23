/**
 * Drafting eligibility (`docs/dev/intelligence-build/evd.md` §3,
 * `[ILB-EVD-4]`) — the pure policy step between the `assessSupport` seam's
 * outcome (`AssessSupportOutcome`, `groundedContext.ts`) and "may instrument
 * drafting author from this."
 *
 * **Not wired.** `evd.md` §3: "Drafting authors an instrument only on
 * `sufficient`." Today's production caller
 * (`packages/plugin/src/retrieval/draft-quiz-cards.ts`) still reads
 * `GroundingResult`/`GroundingJudgeVerdict` directly, not
 * `AssessSupportOutcome` — wiring this function in is `[ILB-EVD-5]`'s job,
 * once `[D-289]` ratifies the four-verdict judge contract this depends on.
 *
 * **The mapping, verbatim from the spec:** `sufficient` → `{author: true}`;
 * `partial` and `insufficient` → `not-enough-in-notes`; `conflicting` →
 * `notes-disagree`; `unavailable` and `could-not-decide` → `could-not-check`;
 * `insufficient-evidence` (the package was empty before any model ran) →
 * `not-enough-in-notes`, the same refusal a thin-but-present package gets —
 * both read to her as "there wasn't enough in your notes for this."
 */

import type { AssessSupportOutcome } from './groundedContext.js';

export type DraftingRefusalReason = 'not-enough-in-notes' | 'notes-disagree' | 'could-not-check';

export type DraftingEligibility =
  | { readonly author: true }
  | { readonly author: false; readonly refusal: DraftingRefusalReason };

/** Pure: the same `outcome` always maps to the same eligibility, nothing here calls out or reads state. */
export function draftingEligibility(outcome: AssessSupportOutcome): DraftingEligibility {
  if (outcome.status === 'assessed') {
    switch (outcome.verdict) {
      case 'sufficient':
        return { author: true };
      case 'partial':
      case 'insufficient':
        return { author: false, refusal: 'not-enough-in-notes' };
      case 'conflicting':
        return { author: false, refusal: 'notes-disagree' };
    }
  }

  if (outcome.status === 'insufficient-evidence') {
    return { author: false, refusal: 'not-enough-in-notes' };
  }

  // outcome.status is 'unavailable' | 'could-not-decide'.
  return { author: false, refusal: 'could-not-check' };
}
