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
 * **The refused split** reads `GroundingRefusalReason`'s own documented
 * distinctions (`groundedContext.ts`) and keeps four apart, each carrying the
 * specific `reason` it came from so a funnel can still separate them
 * (`[D-441]`, David's ruling on decision-sheet row 15, 2026-09-29):
 *
 *  - **retrieval failure → `unavailable`** (`no-hits`, `below-relevance-threshold`):
 *    retrieval gave nothing usable. `[D-289]` point 2 (`ol-egov.141.89.1.6`)
 *    rules an empty evidence package an operational outcome, never a verdict
 *    about her material, and a package the relevance floor emptied is
 *    equivalent to an empty one
 *    (`docs/dev/intelligence-build/pipelines/pra.json`'s evidence step: "an
 *    empty package ... is never a verdict ... it is unavailable here, to be
 *    retried, not read as a fact about her notes");
 *  - **service failure → `unavailable`** (`judge-unavailable`,
 *    `composite-check-unavailable`): the check itself could not run;
 *  - **threshold-blocked → `not-assessed`** (`below-composite-threshold`,
 *    `below-band`): the composite veto and the band's lower bar decided from
 *    numbers alone. Row 15 asks what those scores demonstrate and does not let
 *    them stand as "checked insufficiency" merely because some passages were
 *    retrieved, so this keeps its own status and never claims her notes lack
 *    the material;
 *  - **checked insufficiency → `insufficient-evidence`** (`judge-rejected`
 *    only): the judge read the query and the passages together.
 *
 * The switch over the reason is exhaustive: a new reason has to be classified
 * here on purpose, never defaulted into a verdict about her notes
 * (`ol-egov.141.89.2.12` fixed `'no-hits'` reading as one).
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
 * The refusal outcomes `evd.md` §3, `[D-289]` and `[D-441]` keep apart,
 * carried as a value beside the status so no site merges them
 * (`ol-egov.141.89.1.44`, `ol-egov.141.89.1.5`):
 *  - `retrieval-failure`: retrieval gave the judge nothing usable — an empty
 *    package, or one the relevance floor emptied (`[D-441]`). Operational,
 *    never a verdict about her notes;
 *  - `source-insufficient`: the judge ran and found the sources do not support
 *    the operation — the only cause that is a checked verdict;
 *  - `judgment-uncertain`: the judge ran and could not decide;
 *  - `service-failure`: a call could not be reached, timed out or came back
 *    malformed;
 *  - `threshold-blocked`: hits existed but the composite veto or the band's
 *    lower bar blocked the request from numbers alone (`[D-441]`, ruled
 *    2026-09-29). Not assessed: no judgement about her notes was made, so it
 *    is never `source-insufficient` and never worded as her notes lacking the
 *    material.
 */
export type AuthoringRefusalCause =
  | 'retrieval-failure'
  | 'source-insufficient'
  | 'judgment-uncertain'
  | 'service-failure'
  | 'threshold-blocked';

/**
 * pra.md §3's five-way authoring outcome, plus `not-assessed` (`[D-441]`,
 * ruled 2026-09-29): a threshold-blocked request is neither a checked
 * `insufficient-evidence` nor a transient `unavailable`. **Every outcome that
 * came from a refusal carries the specific `reason` it came from**, so the
 * funnel and the `[D-414]` measures can still tell an empty package from a
 * relevance-floor empty package, a composite veto from a below-band request.
 */
export type AuthoringOutcome =
  | { readonly status: 'eligible' }
  | {
      readonly status: 'insufficient-evidence';
      readonly cause: 'source-insufficient';
      readonly reason: 'judge-rejected';
    }
  | {
      readonly status: 'not-assessed';
      readonly cause: 'threshold-blocked';
      readonly reason: 'below-composite-threshold' | 'below-band';
    }
  | { readonly status: 'invalid-draft'; readonly defects: readonly McqDraftDefect[] }
  | { readonly status: 'deferred'; readonly reason: AuthoringDeferralReason }
  | {
      readonly status: 'unavailable';
      readonly retryable: true;
      readonly cause: Exclude<AuthoringRefusalCause, 'source-insufficient' | 'threshold-blocked'>;
      /** Present when the outcome came from a refusal; absent for a judge that could not decide and for a drafting-call failure. */
      readonly reason?: GroundingRefusalReason;
    };

/** One refusal reason, classified. Exhaustive over the union, so a new reason cannot silently default into a verdict about her notes. */
function classifyRefusal(reason: GroundingRefusalReason): AuthoringOutcome {
  switch (reason) {
    case 'no-hits':
    case 'below-relevance-threshold':
      return { status: 'unavailable', retryable: true, cause: 'retrieval-failure', reason };
    case 'below-composite-threshold':
    case 'below-band':
      return { status: 'not-assessed', cause: 'threshold-blocked', reason };
    case 'judge-unavailable':
    case 'composite-check-unavailable':
      return { status: 'unavailable', retryable: true, cause: 'service-failure', reason };
    case 'judge-rejected':
      return { status: 'insufficient-evidence', cause: 'source-insufficient', reason };
    default: {
      const exhaustive: never = reason;
      throw new Error(
        `classifyAuthoringOutcome: unclassified refusal reason ${String(exhaustive)}`,
      );
    }
  }
}

/**
 * Classifies one authoring attempt into pra.md §3's outcome (five-way, plus
 * `not-assessed` for `[D-441]`). Pure:
 * the same `attempt` always produces the same outcome.
 */
export function classifyAuthoringOutcome(attempt: AuthoringAttempt): AuthoringOutcome {
  switch (attempt.kind) {
    case 'routed-away':
      return { status: 'deferred', reason: 'unmet-format' };
    case 'budget-exhausted':
      return { status: 'deferred', reason: 'budget' };
    case 'refused':
      return classifyRefusal(attempt.reason);
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
