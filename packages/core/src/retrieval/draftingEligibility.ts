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
 * `notes-disagree`; `unavailable`, `could-not-decide` and
 * `insufficient-evidence` (the package was empty before any model ran) →
 * `could-not-check`. `[D-289]` point 2 (`ol-egov.141.89.1.6`) rules an empty
 * package an operational outcome, grouped with `unavailable` and
 * `could-not-decide`, and never a verdict about her material — so it may
 * not read to her as "there wasn't enough in your notes for this," the
 * thin-but-present package's message; it reads as "Olea could not check
 * right now" instead (`ol-egov.141.89.2.12` fixed this arm reading it as the
 * former).
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

  // outcome.status is 'insufficient-evidence' | 'unavailable' | 'could-not-decide':
  // all three are operational outcomes, never a verdict about her notes (`[D-289]`
  // point 2) — `insufficient-evidence` is the empty-package case (see module doc).
  return { author: false, refusal: 'could-not-check' };
}
