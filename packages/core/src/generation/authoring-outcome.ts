/**
 * Authoring outcome (`docs/dev/intelligence-build/pra.md` §3, `[ILB-PRA-4]`)
 * — the pure classification step between "what actually happened on one
 * drafting attempt" and the five-way outcome pra.md §3 names: "Authoring
 * returns one of: `eligible` (a draft with its specification and receipt);
 * `insufficient-evidence` (from `EVD`, no generation); `invalid-draft` with
 * the defect (checks failed after the one repair the workflow budget
 * allows); `deferred` (unmet format, budget exhausted); `unavailable`
 * (transient)."
 *
 * **Not wired.** No production caller builds an `AuthoringAttempt` yet —
 * `[ILB-PRA-5]` is where the sweep (`packages/plugin/src/generation
 * /pipeline.ts`) and the heading-card offer (`packages/plugin/src/review
 * /heading-offer.ts`) would actually construct one from a live call, once
 * the specification/receipt shapes pra.md §7 gates exist. This module is the
 * mapping alone, over data a caller assembles.
 *
 * **`AuthoringAttempt` restates, as plain data, the result shapes this
 * repo's drafting path already produces — never imported, because
 * `olea-core` has no dependency on `packages/plugin` (the dependency runs
 * the other way):**
 *
 *  - `'refused'` mirrors `draftQuizCardsForConcept`'s own `DraftQuizCardsResult`
 *    (`packages/plugin/src/retrieval/draft-quiz-cards.ts`) `{status: 'refused',
 *    reason}` branch — `reason` is this package's own `GroundingRefusalReason`
 *    (`../retrieval/groundedContext.js`), the exact type that result already
 *    carries.
 *  - `'draft-error'` mirrors `runGenerationSweep`'s own `try`/`catch` around
 *    `draftForConcept` (`pipeline.ts`) — a transport failure or a malformed
 *    transport response, caught rather than thrown further, never cached.
 *  - `'unparseable'` mirrors `extractDraftedQuestions`/`extractDraftedProvenance`
 *    (`packages/plugin/src/generation/response.ts`) returning `null` for a
 *    `'drafted'` result: the Worker answered `ok: true`, but not in a shape
 *    this package's own parser recognises.
 *  - `'routed-away'` mirrors `./routing/practice-need.js`'s own `'unmet'`
 *    branch (this bead's other pure-logic piece) — the routing step already
 *    decided no deliverable format is wanted; this classifier only restates
 *    that fact as an authoring outcome, it does not re-decide it.
 *  - `'budget-exhausted'` mirrors the sweep's own per-sweep cap
 *    (`MAX_CONCEPTS_PER_SWEEP`, `pipeline.ts`'s `constants.ts`) — reached
 *    before a drafting call was even attempted this candidate.
 *  - `'drafted'` mirrors a `'drafted'` result whose response parsed cleanly,
 *    carrying whatever `./mcq-draft-checks.js`'s `checkMcqDraft` found for it
 *    — `defects: []` is a clean draft.
 *
 * **The refused → insufficient-evidence / unavailable split** reads
 * `GroundingRefusalReason`'s own documented distinction (`groundedContext.ts`):
 * `'judge-unavailable'` and `'composite-check-unavailable'` are the two
 * reasons that module's own doc states as "we could not check just now,"
 * never "her notes don't cover this" — every other reason in the union is a
 * checked, negative verdict. This module reads that distinction rather than
 * re-deciding it: the transient two map to `unavailable`, everything else to
 * `insufficient-evidence`.
 */

import type { GroundingRefusalReason } from '../retrieval/groundedContext.js';
import type { McqDraftDefect } from './mcq-draft-checks.js';

/**
 * One authoring attempt, restated as plain data — see the module doc for how
 * each variant maps onto the drafting path's real result shapes.
 */
export type AuthoringAttempt =
  | { readonly kind: 'routed-away' }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'refused'; readonly reason: GroundingRefusalReason }
  | { readonly kind: 'draft-error' }
  | { readonly kind: 'unparseable' }
  | { readonly kind: 'drafted'; readonly defects: readonly McqDraftDefect[] };

/** pra.md §3's `deferred` outcome names exactly these two reasons. */
export type AuthoringDeferralReason = 'unmet-format' | 'budget';

/** pra.md §3's five-way authoring outcome. */
export type AuthoringOutcome =
  | { readonly status: 'eligible' }
  | { readonly status: 'insufficient-evidence' }
  | { readonly status: 'invalid-draft'; readonly defects: readonly McqDraftDefect[] }
  | { readonly status: 'deferred'; readonly reason: AuthoringDeferralReason }
  | { readonly status: 'unavailable'; readonly retryable: true };

/**
 * `GroundingRefusalReason`'s own "we could not check" subset — see the
 * module doc. Every other member of the union is a checked, negative
 * verdict and classifies as `insufficient-evidence`.
 */
const TRANSIENT_REFUSAL_REASONS: ReadonlySet<GroundingRefusalReason> = new Set([
  'judge-unavailable',
  'composite-check-unavailable',
]);

/**
 * Classifies one authoring attempt into pra.md §3's five-way outcome. Pure:
 * the same `attempt` always produces the same outcome.
 */
export function classifyAuthoringOutcome(attempt: AuthoringAttempt): AuthoringOutcome {
  switch (attempt.kind) {
    case 'routed-away':
      return { status: 'deferred', reason: 'unmet-format' };
    case 'budget-exhausted':
      return { status: 'deferred', reason: 'budget' };
    case 'refused':
      return TRANSIENT_REFUSAL_REASONS.has(attempt.reason)
        ? { status: 'unavailable', retryable: true }
        : { status: 'insufficient-evidence' };
    case 'draft-error':
    case 'unparseable':
      return { status: 'unavailable', retryable: true };
    case 'drafted':
      return attempt.defects.length === 0
        ? { status: 'eligible' }
        : { status: 'invalid-draft', defects: attempt.defects };
    default: {
      const exhaustive: never = attempt;
      throw new Error(
        `classifyAuthoringOutcome: unhandled attempt kind ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
