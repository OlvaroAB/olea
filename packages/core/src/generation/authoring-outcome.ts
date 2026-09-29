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
 * **`classifyAuthoringOutcome` is not wired; `judgeDraftedDemand` (`[D-437]`, `ol-egov.141.89.2.26`,
 * below) is.** The demand check is the one part of this module with a production caller:
 * `packages/plugin/src/generation/demand-target.ts`, from both materialisers at accept time. A
 * `'drafted'` attempt may carry `demand` facts, and then the same check makes a question that
 * declares a different demand than the one asked an `invalid-draft` with the `demand-mismatch`
 * defect (T5); an attempt without them classifies exactly as it always did.
 *
 * **Not wired (`classifyAuthoringOutcome`).** No production caller builds an `AuthoringAttempt` yet —
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

import type { PaperDemand } from '../oracle/paper-types.js';
import type { GroundingRefusalReason } from '../retrieval/groundedContext.js';
import type { McqDraftDefect } from './mcq-draft-checks.js';

// ---------------------------------------------------------------------------
// The demand check (`[D-437]`, `ol-egov.141.89.2.26`, design sections 2, 4.3 and 4.4)
// ---------------------------------------------------------------------------

/**
 * What one drafted question, and the request it answered, say about demand. Plain data the caller
 * assembles from the drafting result: nothing here is read from the model except the two words the
 * response carries (the server's acknowledgement and the question's own proposal).
 */
export interface DraftedDemandFacts {
  /** The demand the request carried (`intendedDemand`). Absent when nothing was asked: an unspecified need, or an ask no generator serves, which sends neither field. */
  readonly intendedDemand?: PaperDemand;
  /** The server's `demandAcknowledgement.intendedDemand`: present exactly when it read the demand and applied it. Absent from an older Worker's response. */
  readonly acknowledgedDemand?: PaperDemand;
  /** This question's own `declaredDemand`: the author's proposal, consumed only to REFUSE. */
  readonly declaredDemand?: PaperDemand;
}

/** The defect a question declaring a different demand than the one asked (or none) is refused with. Same `{kind, detail}` shape as `McqDraftDefect`; the detail is vocabulary words only, never her heading. */
export interface DemandMismatchDefect {
  readonly kind: 'demand-mismatch';
  readonly detail: string;
}

/** Every defect an `invalid-draft` outcome can carry: the exact MCQ checks, and the demand check. */
export type AuthoringDraftDefect = McqDraftDefect | DemandMismatchDefect;

/**
 * The reading of one drafted question's demand:
 *  - `declared`: the request asked for `demand`, the server acknowledged it, and the question's
 *    own declaration agrees. **This is authoring intent and no more** (`[D-277]` (h), row 36:
 *    "declared intent does not certify delivered demand"): the agreeing declaration adds nothing,
 *    so the result carries the demand that was ASKED and no basis but that. It is what the target
 *    record stores under the literal basis `authoring-intent`.
 *  - `unspecified`: nothing may be recorded. `none-asked`: the request carried no demand.
 *    `not-acknowledged`: it did and the response did not acknowledge it (an old Worker, or an
 *    acknowledgement of a different demand): deployment skew, not a defect, so the item
 *    materialises unspecified, the need stays open, and the reason is what a count keys on.
 *  - `refused`: the question declared a different demand than the one asked (or none): an invalid
 *    draft, and nothing is recorded.
 */
export type DraftedDemandDisposition =
  | { readonly kind: 'declared'; readonly demand: PaperDemand }
  | { readonly kind: 'unspecified'; readonly reason: 'none-asked' | 'not-acknowledged' }
  | { readonly kind: 'refused'; readonly defect: DemandMismatchDefect };

/**
 * Judges one drafted question's demand by code alone (`[D-310]`: no per-item demand judge, and
 * demand match is not a candidate check). Pure and total.
 *
 * The order is load-bearing. **The acknowledgement is read first**: a response the server did not
 * acknowledge is skew whatever else it carries, so an old Worker's item is never misread as a
 * mismatch and a new caller never records as intended what an old server ignored. Only an
 * acknowledged demand reaches the comparison, and the comparison only ever REFUSES: the
 * author's own declaration equal to the ask is not consumable evidence (`[D-262]` ruling 1) and
 * certifies nothing, while a missing one is not agreement.
 */
export function judgeDraftedDemand(facts: DraftedDemandFacts): DraftedDemandDisposition {
  const asked = facts.intendedDemand;
  if (asked === undefined) return { kind: 'unspecified', reason: 'none-asked' };
  if (facts.acknowledgedDemand !== asked)
    return { kind: 'unspecified', reason: 'not-acknowledged' };
  if (facts.declaredDemand !== asked) {
    return {
      kind: 'refused',
      defect: {
        kind: 'demand-mismatch',
        detail: `the request asked for ${asked} and the question declared ${facts.declaredDemand ?? 'no demand'}`,
      },
    };
  }
  return { kind: 'declared', demand: asked };
}

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
  | {
      readonly kind: 'drafted';
      readonly defects: readonly McqDraftDefect[];
      /**
       * `[D-437]`: what the request and response say about demand, when the caller assembles it.
       * Absent for an attempt that predates the carriage, which classifies exactly as it always did.
       */
      readonly demand?: DraftedDemandFacts;
    };

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
  | {
      readonly status: 'eligible';
      /**
       * Present only for a drafted attempt that carried `demand` facts (`[D-437]`): `declared` (the
       * demand may be recorded, as intent) or `unspecified` (it may not, and the reason is what a
       * count keys on). Never `refused`: a refused demand makes the draft `invalid-draft`.
       */
      readonly demand?: Exclude<DraftedDemandDisposition, { readonly kind: 'refused' }>;
    }
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
  | { readonly status: 'invalid-draft'; readonly defects: readonly AuthoringDraftDefect[] }
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
 * A drafted attempt: the exact MCQ defects first, then the demand check's, all in one
 * `invalid-draft`. An attempt with no `demand` facts is exactly what it was before `[D-437]`.
 */
function classifyDrafted(
  attempt: Extract<AuthoringAttempt, { kind: 'drafted' }>,
): AuthoringOutcome {
  const disposition = attempt.demand === undefined ? undefined : judgeDraftedDemand(attempt.demand);
  const defects: AuthoringDraftDefect[] = [...attempt.defects];
  if (disposition?.kind === 'refused') defects.push(disposition.defect);
  if (defects.length > 0) return { status: 'invalid-draft', defects };
  return disposition === undefined || disposition.kind === 'refused'
    ? { status: 'eligible' }
    : { status: 'eligible', demand: disposition };
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
      return classifyDrafted(attempt);
    default: {
      const exhaustive: never = attempt;
      throw new Error(
        `classifyAuthoringOutcome: unhandled attempt kind ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
