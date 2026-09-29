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
 * never "her notes don't cover this". `'no-hits'` joins them for a different
 * reason, not a transient one: it means retrieval returned nothing at all, so
 * no model was ever asked — `[D-289]` point 2 (`ol-egov.141.89.1.6`) rules an
 * empty evidence package an operational outcome, never a verdict about her
 * material, and `docs/dev/intelligence-build/pipelines/pra.json`'s evidence
 * step spells this out for this exact chain: "an empty package ... is never a
 * verdict ... it is unavailable here, to be retried, not read as a fact about
 * her notes." Every other reason in the union is a checked, negative verdict.
 * This module reads that distinction rather than re-deciding it: the three
 * operational reasons map to `unavailable`, everything else to
 * `insufficient-evidence` (`ol-egov.141.89.2.12` fixed `'no-hits'` reading as
 * a checked verdict here).
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
  /** The sufficiency judge ran and could not settle the question (`could-not-decide`, `evd.md` §3). Not a refusal reason: it is judgment uncertainty. */
  | { readonly kind: 'undecided' }
  | { readonly kind: 'draft-error' }
  | { readonly kind: 'unparseable' }
  | { readonly kind: 'drafted'; readonly defects: readonly McqDraftDefect[] };

/** pra.md §3's `deferred` outcome names exactly these two reasons. */
export type AuthoringDeferralReason = 'unmet-format' | 'budget';

/**
 * The four refusal outcomes `evd.md` §3 and `[D-289]` keep apart, carried as a
 * value beside the five-way status so no site merges them (`ol-egov.141.89.1.44`):
 *  - `retrieval-failure`: retrieval gave the judge nothing usable (empty package,
 *    or hits that failed the relevance, composite or band bar) — operational,
 *    never a verdict about her notes;
 *  - `source-insufficient`: the judge ran and found the sources do not support
 *    the operation — the only cause that is a checked verdict;
 *  - `judgment-uncertain`: the judge ran and could not decide;
 *  - `service-failure`: a call could not be reached, timed out or came back
 *    malformed.
 */
export type AuthoringRefusalCause =
  | 'retrieval-failure'
  | 'source-insufficient'
  | 'judgment-uncertain'
  | 'service-failure';

/** pra.md §3's five-way authoring outcome. */
export type AuthoringOutcome =
  | { readonly status: 'eligible' }
  | { readonly status: 'insufficient-evidence'; readonly cause: 'source-insufficient' }
  | { readonly status: 'invalid-draft'; readonly defects: readonly McqDraftDefect[] }
  | { readonly status: 'deferred'; readonly reason: AuthoringDeferralReason }
  | {
      readonly status: 'unavailable';
      readonly retryable: true;
      readonly cause: Exclude<AuthoringRefusalCause, 'source-insufficient'>;
    };

/**
 * `GroundingRefusalReason`s where retrieval, not the judge, is why nothing
 * could be authored: no hits at all (`[D-289]` point 2), hits below the
 * relevance bar, and the composite and band bars that gate the judge.
 * Operational, never a verdict about her notes.
 */
const RETRIEVAL_FAILURE_REASONS: ReadonlySet<GroundingRefusalReason> = new Set([
  'no-hits',
  'below-relevance-threshold',
  'below-composite-threshold',
  'below-band',
]);

/** The two reasons that mean the check itself could not run. */
const SERVICE_FAILURE_REASONS: ReadonlySet<GroundingRefusalReason> = new Set([
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
      if (RETRIEVAL_FAILURE_REASONS.has(attempt.reason)) {
        return { status: 'unavailable', retryable: true, cause: 'retrieval-failure' };
      }
      if (SERVICE_FAILURE_REASONS.has(attempt.reason)) {
        return { status: 'unavailable', retryable: true, cause: 'service-failure' };
      }
      return { status: 'insufficient-evidence', cause: 'source-insufficient' };
    case 'undecided':
      return { status: 'unavailable', retryable: true, cause: 'judgment-uncertain' };
    case 'draft-error':
    case 'unparseable':
      return { status: 'unavailable', retryable: true, cause: 'service-failure' };
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
