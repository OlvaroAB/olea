/**
 * F2.24 — **offering an application probe** (`docs/Olea_alpha_functional_scope.md`
 * F2.24, added `[D-335]`, amended `[D-394]`; foundation `ol-v7r5.74`, carried on
 * `[D-394]`'s ruling of `docs/direction/briefs/85-d335-contract-wording.md`).
 *
 * `[D-394]`'s own text: *"The offer condition is the existing strong-recall
 * condition reused as it stands (top stage, vitality holding, no competing
 * explain-back trigger, not the session that earned the top stage, and the
 * first-offer or re-arm conditions) with no new constant... the trigger
 * offers application practice without claiming that application ability has
 * already been demonstrated."*
 *
 * ## Reuse, not a new decision
 *
 * This module deliberately reuses `./strong-recall-proposal.js`'s own
 * constants — {@link STRONG_RECALL_MARGIN_DAYS} and
 * `MIN_SPACED_RETRIEVAL_DAYS` — rather than declaring anything new, per
 * `[D-394]`'s "no new constant" and per Choice 1 Option A of brief 85 (the
 * ruled option). The margin is re-applied here to the evidence recorded
 * *since the concept's last probe presentation* (the re-arm condition), the
 * same test `evaluateStrongRecallProposal` already runs against evidence
 * since the concept's last graded explain-back.
 *
 * ## It proposes; it does not claim
 *
 * `[D-394]` condition 2 (ruling text): *"the trigger is provisional... and it
 * is a trigger for offering application practice, never a claim that she can
 * already apply the idea."* Structurally, not by convention: this module
 * reads a `state`/`vitality` pair a caller already computed and returns a
 * decision that carries neither — firing this function moves no stage,
 * vitality or readiness reading, because nothing here writes to any of the
 * three. `application-probe-trigger.spec.ts` asserts this by freezing every
 * input object before evaluating, so any attempted write throws.
 *
 * ## The five gates, each independently testable
 *
 * 1. **Top stage (`tree`)** — F2.24: nothing below `tree` is ever proposed a
 *    probe (`[D-264]` ruling 4).
 * 2. **Vitality `holding`** — the same "going well" reading F2.21 requires,
 *    reused verbatim.
 * 3. **No competing explain-back trigger** — F2.12 (confusion routing),
 *    F2.21's own reopening branch, or F5.3a (`../misconception/*.js`) already
 *    proposing something for this concept. The caller already runs all
 *    three (they are cheaper, and this module's doc order mirrors F2.24's
 *    own clause order) and passes the OR of their results in
 *    {@link ApplicationProbeTriggerInput.competingExplainBackTriggerHolds}.
 * 4. **Not the session that earned `tree`** — a concept that just reached the
 *    top stage this session gets no probe stacked immediately behind the
 *    explanation that earned it (brief 85, rejecting Choice 1 Option C).
 * 5. **First-offer or re-arm** — no presentation since `tree`, OR the last
 *    presentation did not succeed and the strong-recall margin is re-met
 *    over evidence recorded since, OR `[D-093]`'s changed-claim event has
 *    moved the principle since the last presentation.
 *
 * Session-level dedup (`[D-394]` condition 4 — at most one offer per concept
 * per session, surviving a session extension) is **also** the caller's to
 * hold, in {@link ApplicationProbeTriggerInput.alreadyOfferedThisSessionForConcept}
 * — this module has no session concept of its own, the same posture
 * `strong-recall-proposal.ts` takes toward everything it reads. See this
 * repo's lane report for the wiring seam this leaves (a live lane's `owns`).
 *
 * ## What "shown" and "success" are, and why neither field is read here
 *
 * This module answers WHETHER to offer, never whether a past probe
 * succeeded — that split is `../instrument/probe-presentation-store.js`
 * (shown, set once, survives a restart) and `../instrument/probe-outcome.js`
 * (success, derived at read time, never stored). A caller passes only the
 * two booleans this module needs (`presentation.succeeded`,
 * `presentation.successfulScoredDaysSincePresentation`) — already derived —
 * exactly the "narrow evidence slice" discipline every sibling trigger in
 * this directory keeps.
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no vault I/O, no clock, nothing
 * stored, nothing scheduled — F2.24's own guarantee that a probe is never a
 * member of the schedulable set holds structurally: nothing produced here
 * carries a rank, a due date or scheduler state.
 */

import type { MasteryState } from 'olea-contracts';
import { MIN_SPACED_RETRIEVAL_DAYS } from '../mastery/rollup.js';
import type { Vitality } from '../mastery/vitality.js';
import { STRONG_RECALL_MARGIN_DAYS } from './strong-recall-proposal.js';

/**
 * The `explainBackOfferTrigger`-shaped literal a caller would log for an
 * offer this module produced, named here so a future D7.1 wiring lane never
 * hand-types the string. **Not yet a persisted enum member** — extending
 * `olea-contracts`' `explainBackOfferTrigger` (or a new review-log record
 * kind) to carry this literal is a Class C, persisted-schema change this
 * lane does not make; see this module's own file-level "left for another
 * lane" note below.
 */
export const APPLICATION_PROBE_TRIGGER = 'application-probe-readiness' as const;

/**
 * **The D-072 / spend gate, held explicitly.** `[D-335]`'s own precondition
 * ("nothing here goes live before C4.8's challenge set passes and its spend
 * is separately authorised") has its first half satisfied — the challenge
 * set (`ol-3ux7.67`, PROBE-4) is closed — but spend for a live grading call
 * has not been separately authorised. This constant is the single place a
 * future wiring lane checks before ever calling
 * {@link evaluateApplicationProbeTrigger} from a live session path;
 * `application-probe-trigger.spec.ts` pins it `false`. **Never set this
 * `true` from this lane** — that is the spend authorisation itself, a
 * decision only David makes.
 */
export const APPLICATION_PROBE_OFFER_LIVE = false as const;

/**
 * The narrow evidence slice this decision needs. Every field is a fact a
 * caller already computed or holds — nothing here is re-derived.
 */
export interface ApplicationProbeTriggerInput {
  /** The concept the offer would be about. Opaque id; never a display name (D-005). */
  readonly conceptId: string;
  /** `computeConceptMastery(...).state` — must be `tree` for F2.24 to ever fire. */
  readonly state: MasteryState;
  /** `readConceptVitality(...).value` — F2.24 names `holding` explicitly. */
  readonly vitality: Vitality;
  /**
   * The OR of F2.12's confusion routing, F2.21's own reopening branch, and
   * F5.3a's scheduling-observation routing, each already evaluated by the
   * caller for this concept. F2.24: "no other explain-back trigger's
   * condition currently holds for it."
   */
  readonly competingExplainBackTriggerHolds: boolean;
  /**
   * True when the concept reached `tree` in the session currently open.
   * F2.24: "the current session is not the one in which tree was earned."
   */
  readonly earnedTopStageThisSession: boolean;
  /**
   * Undefined means no application probe has been presented on this concept
   * since it reached `tree` — the first-offer branch. Present once a probe
   * has been shown at least once since `tree` (read from
   * `../instrument/probe-presentation-store.js` plus
   * `../instrument/probe-outcome.js`, the caller's job).
   */
  readonly presentation?: ApplicationProbeSincePresentation;
  /**
   * `[D-093]`'s changed-claim event: true when the principle has moved since
   * the last presentation, independent of whether that presentation
   * succeeded. Defaults to `false`.
   */
  readonly changedClaimEventSincePresentation?: boolean;
  /**
   * `[D-394]` condition 4: true once this concept has already been offered a
   * probe in the session currently open, taken or not. The caller holds this
   * for the life of the session, including across an extension — this
   * module has no session concept of its own.
   */
  readonly alreadyOfferedThisSessionForConcept: boolean;
}

/** What the caller already knows about the concept's most recent probe presentation. */
export interface ApplicationProbeSincePresentation {
  /**
   * `false` when the qualifying review-log event of that presentation reads
   * not-succeeded (a skip, a defective-probe attempt, or no qualifying event
   * at all) — see `../instrument/probe-outcome.js`.
   */
  readonly succeeded: boolean;
  /**
   * `ConceptMasteryEvidence.successfulScoredDays`, recomputed over evidence
   * recorded strictly after the presentation — the same fold
   * `evaluateStrongRecallProposal` reads, run on a narrower window. Only
   * meaningful when `succeeded` is `false`.
   */
  readonly successfulScoredDaysSincePresentation: number;
  /**
   * The spacing gate that recomputation used, when non-default. Defaults to
   * {@link MIN_SPACED_RETRIEVAL_DAYS}, mirroring
   * `StrongRecallProposalInput.minSpacedRetrievalDays`.
   */
  readonly minSpacedRetrievalDaysSincePresentation?: number;
}

/**
 * Why Olea is asking. **In memory only** — F2.24's own text names no
 * persisted reason field, the same restraint `StrongRecallReason` keeps
 * (`[D-095]`).
 */
export interface ApplicationProbeOfferReason {
  /**
   * `first-offer` — no probe has been presented on this concept since it
   * reached `tree`. `repair` — the last presentation did not succeed and the
   * strong-recall margin has been re-met since. `principle-changed` —
   * `[D-093]`'s changed-claim event fired since the last presentation.
   */
  readonly kind: 'first-offer' | 'repair' | 'principle-changed';
}

export interface ApplicationProbeOffer {
  readonly shouldOffer: true;
  readonly conceptId: string;
  readonly trigger: typeof APPLICATION_PROBE_TRIGGER;
  readonly reason: ApplicationProbeOfferReason;
  /** F2.24 / vocabulary registry §14's offer-sentence guidance, built by {@link applicationProbeOfferLine}. */
  readonly promptText: string;
}

/** Which condition stopped the offer. Not a state and not persisted — mirrors `NoProposalReason`. */
export type NoApplicationProbeOfferReason =
  | 'not-top-stage'
  | 'recall-not-holding'
  | 'competing-trigger-active'
  | 'earned-top-stage-this-session'
  | 'already-offered-this-session'
  | 'not-ready-to-rearm';

export interface NoApplicationProbeOffer {
  readonly shouldOffer: false;
  readonly because: NoApplicationProbeOfferReason;
}

export type ApplicationProbeTriggerDecision = ApplicationProbeOffer | NoApplicationProbeOffer;

/**
 * Phrase fragments {@link applicationProbeOfferLine}'s output must never
 * contain — the mechanical half of vocabulary registry §14's offer-sentence
 * guidance and §4's `[D-263]` forbidden framing. Case-insensitive check in
 * `application-probe-trigger.spec.ts`, the same floor
 * `FORBIDDEN_VERDICT_PHRASES` (`../misconception/framing.js`) already is for
 * verdict phrasing — this list catches the registry's own named forbidden
 * fragments for THIS offer specifically, not a general verdict floor.
 */
export const PROBE_OFFER_FORBIDDEN_PHRASES: readonly string[] = [
  'unseen',
  'never seen before',
  'really know',
  'really apply',
  'application probe',
];

/**
 * F2.24's offer sentence (vocabulary registry §14, `[D-335]`): names the
 * evidence fact (stage `tree`, vitality `holding`, in the registry's own
 * words for those states), then asks whether she wants to try the idea on a
 * situation her notes don't describe. Never previews or names a scenario,
 * never says "unseen"/"never seen before", never frames the offer as
 * checking whether she "really" knows the idea, never uses the internal term
 * "application probe". Passes no verdict on a prior attempt (`[D-217]`): the
 * `repair` line says only that it follows one that missed, without naming
 * that scenario.
 */
export function applicationProbeOfferLine(reason: ApplicationProbeOfferReason): string {
  const invitation = "Want to try the idea on a situation your notes don't describe?";
  if (reason.kind === 'repair') {
    return `This one's reached tree, and your recall on it is holding — and this follows one that missed. ${invitation}`;
  }
  if (reason.kind === 'principle-changed') {
    return `This one's reached tree, and your recall on it is holding — and the idea itself has moved since you last tried this. ${invitation}`;
  }
  return `This one's reached tree, and your recall on it is holding. ${invitation}`;
}

/**
 * F2.24's whole decision, in one pure function. See this module's doc for
 * the five gates and the session-level dedup the caller holds.
 */
export function evaluateApplicationProbeTrigger(
  input: ApplicationProbeTriggerInput,
): ApplicationProbeTriggerDecision {
  if (input.conceptId.length === 0) {
    throw new Error('evaluateApplicationProbeTrigger: conceptId must be non-empty');
  }

  // Gate 4 first — [D-394] condition 4: an already-offered concept is silent
  // for the rest of the session regardless of every other gate, including
  // one that would otherwise re-arm.
  if (input.alreadyOfferedThisSessionForConcept) {
    return { shouldOffer: false, because: 'already-offered-this-session' };
  }
  if (input.state !== 'tree') {
    return { shouldOffer: false, because: 'not-top-stage' };
  }
  if (input.vitality !== 'holding') {
    return { shouldOffer: false, because: 'recall-not-holding' };
  }
  if (input.competingExplainBackTriggerHolds) {
    return { shouldOffer: false, because: 'competing-trigger-active' };
  }
  if (input.earnedTopStageThisSession) {
    return { shouldOffer: false, because: 'earned-top-stage-this-session' };
  }

  const reason = readinessReason(input);
  if (reason === undefined) {
    return { shouldOffer: false, because: 'not-ready-to-rearm' };
  }

  return {
    shouldOffer: true,
    conceptId: input.conceptId,
    trigger: APPLICATION_PROBE_TRIGGER,
    reason,
    promptText: applicationProbeOfferLine(reason),
  };
}

/**
 * Gate 5 — first-offer or re-arm. `undefined` when none of the three
 * sub-conditions holds (an already-presented, not-yet-re-armed probe).
 */
function readinessReason(
  input: ApplicationProbeTriggerInput,
): ApplicationProbeOfferReason | undefined {
  if (input.presentation === undefined) {
    return { kind: 'first-offer' };
  }
  if (input.changedClaimEventSincePresentation === true) {
    return { kind: 'principle-changed' };
  }
  if (input.presentation.succeeded) {
    return undefined;
  }
  const minSpacedRetrievalDays =
    input.presentation.minSpacedRetrievalDaysSincePresentation ?? MIN_SPACED_RETRIEVAL_DAYS;
  const strongRecallDays = minSpacedRetrievalDays + STRONG_RECALL_MARGIN_DAYS;
  if (input.presentation.successfulScoredDaysSincePresentation >= strongRecallDays) {
    return { kind: 'repair' };
  }
  return undefined;
}

/**
 * ## What this leaves for another lane
 *
 * `[D-394]`'s own choice 2 (shown apart from answered) is built in
 * `../instrument/probe-presentation-store.js` and `../instrument/probe-outcome.js`
 * — a review-log-independent shown flag and a pure outcome reader over an
 * abstract qualifying-event shape. **Wiring that outcome reader to the real
 * review-log schema is a Class C, persisted-schema change** (extending
 * `olea-contracts`' `review-log.ts` with a probe-presented/probe-outcome
 * event kind, or extending `explainBackOfferTrigger` to carry
 * {@link APPLICATION_PROBE_TRIGGER}) — brief 85 itself defers exactly this
 * ("D7.1 and F5.7... belongs with whichever bead lands the persisted
 * schema, escalated per CLAUDE.md's 'Escalate to the orchestrator'"). This
 * lane does not touch `packages/contracts/src/review-log.ts`.
 *
 * Also left: wiring `evaluateApplicationProbeTrigger` into a live review
 * occasion (`packages/plugin/src/review/session.ts`,
 * `packages/plugin/src/session-builder/provider.ts`), the per-session
 * `alreadyOfferedThisSessionForConcept` tracker this module reads but does
 * not hold, and `packages/plugin/src/main.ts`'s composition root wiring —
 * all named off-limits, live-lane files for this bead. Wiring must check
 * {@link APPLICATION_PROBE_OFFER_LIVE} (`false`) before ever calling this
 * function from a live path.
 */
