/**
 * F2.21 — **opening the depth gate for a concept that is going well**
 * (`docs/Olea_alpha_functional_scope.md`, F2.21; foundation item 18,
 * `[D-076]`, round 3, *"How does a concept ever reach the top?"*;
 * `ol-v7r5.1 / MSTG-2`).
 *
 * F2.21's own words: *"Olea proposes an explain-back when recall evidence is
 * strong (sapling, holding, across spaced attempts) and depth evidence is
 * absent, and says why it is asking — the same offer shape as F2.12's
 * 'You've missed this four times… want to explain it back?', triggered from
 * the opposite side of the evidence. She can decline; declining changes
 * nothing and is not itself a state."*
 *
 * ## The inverted trap this closes
 *
 * The depth gate's two older routes into explain-back — on-demand (F2.7) and
 * confusion routing after repeated failure (F2.12,
 * `../misconception/confusion-routing.ts`) — are both triggered by trouble or
 * by her asking. A concept she is quietly good at, that never fails and that
 * she never happens to ask about, reaches neither, so `tree`
 * (`../mastery/rollup.ts`'s depth gate) is structurally unreachable for
 * exactly the concepts she knows best. This module is the third condition
 * that proposes the same offer, from the strong side of the evidence.
 *
 * ## It proposes; it does not schedule
 *
 * **F2.14 stands exactly as written.** This is a third *trigger* for the same
 * on-demand instrument, delivered through the existing on-demand channel
 * (F2.7/F2.12), never through queue composition, and it must never render as
 * a due item or enter FSRS state. Structurally, not by convention:
 * {@link StrongRecallProposal} carries no `gapScore`, no `gapRank`, no
 * `instrumentId`, no due date and no scheduler state, so there is nothing on
 * it a composer could rank or a scheduler could advance — the same argument
 * `./explain-back.ts`'s module doc makes for `AcceptedExplainBack`.
 * `./build.ts`'s `BuildStudySessionInput` has no channel through which a
 * proposal could reach the greedy fill at all, and
 * `strong-recall-proposal.spec.ts` asserts both facts.
 *
 * A *proposed* explanation also sits outside the session's time budget
 * entirely (F2.14a) — only an **accepted** one is priced, by
 * `priceAcceptedExplainBacks` in `./explain-back.ts`. Nothing here estimates
 * or reserves a single second.
 *
 * ## Where this module sits, and what it deliberately does not do
 *
 * Follows `../misconception/confusion-routing.ts` (F2.12) and
 * `../misconception/scheduling-observation-routing.ts` (F5.3a) deliberately —
 * the same shape all three triggers share: a pure, synchronous decision over
 * a narrow input slice a caller already holds, plus a prompt-line builder
 * checked against the same `FORBIDDEN_VERDICT_PHRASES` mechanical floor. It
 * decides WHETHER to propose and WHAT the reason line says — never WHERE the
 * offer is shown, and never anything persisted. It does not read a review
 * log (`computeConceptMastery` / `readConceptVitality` in `../mastery/` do,
 * and a caller passes their results through unchanged), does not call the
 * grading pipeline, and writes nothing.
 *
 * **Declining is the caller's to record, not this module's.** The
 * `explain-back-offered` / `explain-back-declined` pair already exists
 * (`../review-log/write.ts`'s `appendExplainBackOfferRecord`,
 * `olea-contracts`' `explainBackOfferLogRecordV5`) and already carries the
 * `strong-recall-proposal` trigger literal this module's
 * {@link STRONG_RECALL_PROPOSAL_TRIGGER} names — so a decline is recorded
 * through the existing shape, with **no new persisted schema**. That record
 * deliberately has no reason field at all (`[D-095]`'s restraint, restated in
 * `explainBackOfferLogRecordV5`'s own doc), so {@link StrongRecallReason}
 * below lives in memory for the surface that shows the offer and is never
 * written down. That is not a gap: the reason is a pure function of evidence
 * the log already holds, re-derivable by re-running this module.
 *
 * **INV-1 / §7.1.** Pure. No `obsidian`, no vault I/O, no clock, nothing
 * stored.
 */

import type { MasteryState } from 'olea-contracts';
import type { ConceptMasteryEvidence } from '../mastery/rollup.js';
import { MIN_SPACED_RETRIEVAL_DAYS } from '../mastery/rollup.js';
import type { Vitality } from '../mastery/vitality.js';

/**
 * **DECLARED — the strong-recall margin.** How many
 * distinct successful days beyond the spacing gate
 * (`MIN_SPACED_RETRIEVAL_DAYS`, 3, `[D-145]`) a concept must show before its
 * recall counts as *strong* rather than merely *sufficient*.
 *
 * **Plain-English defence, never fitted.** `sapling` answers "has she
 * recalled this across spaced attempts at all" — it turns true on the third
 * distinct successful day, the smallest number that is unambiguously more
 * than one sitting. F2.21 asks a strictly stronger question: is recall
 * evidence *strong*, strong enough that Olea should interrupt a concept that
 * is going fine and ask for work. A concept sitting exactly on the sapling
 * line has cleared a floor, not demonstrated strength, and proposing off the
 * bare minimum would fire on the same day the stage first turns — every
 * concept, the moment it qualifies, which is a firehose rather than a
 * proposal. One extra distinct day is the smallest margin that makes the
 * proposal say something the stage does not already say, and it is a day she
 * has to actually live through, so it costs the concept nothing but time it
 * was spending anyway. It is deliberately not two or more: past the point
 * where the trigger fires at all, a larger margin only delays the top stage
 * for the concepts F2.21 exists to rescue.
 *
 * **Not fitted, and not fittable.** No review corpus can say what "strong"
 * means here — the question is what warrants an interruption, which is a
 * judgement about her attention, not a rate in data (the same reason
 * `MIN_SPACED_RETRIEVAL_DAYS` and `DEPTH_GATE_SOLO_LEVEL` are declared). It
 * therefore ships in the client fold like its two neighbours; moving it is a
 * decision bead.
 */
export const STRONG_RECALL_MARGIN_DAYS = 1;

/**
 * The `explainBackOfferTrigger` literal a caller records for an offer this
 * module produced (`olea-contracts`' `explainBackOfferLogRecordV5`, D7.1's
 * "a strong-recall proposal" trigger). Named here so the surface that logs
 * the offer never hand-types the string, and so a rename in contracts fails
 * at this one site.
 */
export const STRONG_RECALL_PROPOSAL_TRIGGER = 'strong-recall-proposal';

/**
 * The narrow evidence slice this decision needs — every field a fact a
 * caller already computed, none of it re-derived here.
 */
export interface StrongRecallProposalInput {
  /** The concept the proposal would be about. Opaque id; never a display name (D-005). */
  readonly conceptId: string;
  /** `computeConceptMastery(...).state` — the high-water growth stage. */
  readonly state: MasteryState;
  /** `computeConceptMastery(...).evidence` — the fold's own evidence record, unmodified. */
  readonly evidence: ConceptMasteryEvidence;
  /** `readConceptVitality(...).value` — the second axis. F2.21 names `holding` explicitly. */
  readonly vitality: Vitality;
  /**
   * F2.21: *"A fresh misconception surfacing on a concept already at the top
   * stage is the strongest version of this same signal and reopens
   * eligibility for another explain-back the same way."* True when a
   * misconception has been observed for this concept since its last graded
   * explain-back — a fact the caller supplies (the review log's
   * `misconception-observed` records answer it), the same posture
   * `scheduling-observation-routing.ts` takes toward its `liveObservations`.
   * Defaults to `false`.
   */
  readonly misconceptionSinceLastGradedExplainBack?: boolean;
  /**
   * The spacing gate the mastery fold was run with, when a caller passed a
   * non-default `MasteryRollupOptions.minSpacedRetrievalDays`. The margin
   * above is added to *this*, so the two numbers cannot drift apart.
   * Defaults to `MIN_SPACED_RETRIEVAL_DAYS`.
   */
  readonly minSpacedRetrievalDays?: number;
}

/**
 * Why Olea is asking — F2.21's *"and says why it is asking"*, in a structured
 * form a surface can render and a test can assert on. **In memory only**: the
 * offer record deliberately has no reason field (see the module doc).
 */
export interface StrongRecallReason {
  /**
   * `strong-recall` — the ordinary case, a `sapling` concept holding across
   * spaced attempts with no depth evidence. `reopened-by-misconception` —
   * F2.21's reopening branch on a concept already at `tree`.
   */
  readonly kind: 'strong-recall' | 'reopened-by-misconception';
  /** `ConceptMasteryEvidence.successfulScoredDays` — the spaced-attempt count the reason rests on. */
  readonly successfulScoredDays: number;
  /** The threshold `successfulScoredDays` had to clear: spacing gate + {@link STRONG_RECALL_MARGIN_DAYS}. */
  readonly strongRecallDays: number;
}

export interface StrongRecallProposal {
  readonly shouldPropose: true;
  readonly conceptId: string;
  /** Always {@link STRONG_RECALL_PROPOSAL_TRIGGER}; the literal a caller logs. */
  readonly trigger: typeof STRONG_RECALL_PROPOSAL_TRIGGER;
  readonly reason: StrongRecallReason;
  /** F2.21's offer sentence, built by {@link strongRecallPromptLine}. */
  readonly promptText: string;
}

/**
 * Which condition stopped the proposal. Not a state and not persisted —
 * F2.14a rules that nothing about a proposal (or a decline) is a state she is
 * in. This exists so a test, and a health check, can tell "not strong yet"
 * from "already deep" rather than reading one silent `false`.
 */
export type NoProposalReason =
  | 'stage-below-sapling'
  | 'recall-not-holding'
  | 'recognition-only'
  | 'recall-not-yet-strong'
  | 'depth-evidence-present';

export interface StrongRecallNoProposal {
  readonly shouldPropose: false;
  readonly because: NoProposalReason;
}

export type StrongRecallProposalDecision = StrongRecallProposal | StrongRecallNoProposal;

/**
 * F2.21's offer sentence — the same shape F2.12's line has, from the opposite
 * side of the evidence, and the same V3 order: fact ("you've recalled this
 * across N different days"), evidence-grounded reinterpretation ("that's
 * usually a sign it's ready to be put into words"), one available action
 * ("want to explain it back?").
 *
 * Nothing here is a verdict on her effort or discipline (principle 12) — no
 * praise either, which would be an invented progress claim (F6.8); the line
 * states what the log holds and what it usually means.
 * `strong-recall-proposal.spec.ts` checks every generated line against
 * `FORBIDDEN_VERDICT_PHRASES` (`../misconception/framing.js`), the same
 * mechanical floor `confusion-routing.spec.ts` applies.
 *
 * Deliberately names no concept: this module receives an opaque `conceptId`
 * and no human-readable name, the same content-free discipline
 * `confusionRoutingPromptLine` and `schedulingObservationPromptLine` keep.
 */
export function strongRecallPromptLine(reason: StrongRecallReason): string {
  if (reason.kind === 'reopened-by-misconception') {
    return (
      'This came up differently again, after it had settled. ' +
      "That's usually a sign there is more to it — want to explain it back?"
    );
  }
  return (
    `You've recalled this on ${spellDayCount(reason.successfulScoredDays)} different days. ` +
    "That's usually a sign it's ready to be put into words — want to explain it back?"
  );
}

/**
 * Spelled out for the counts this trigger realistically reaches; a numeral is
 * the honest fallback past that rather than inventing more words. Mirrors
 * `confusion-routing.ts`'s `spellLapseCount` exactly, for the same reason.
 */
const SMALL_NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

function spellDayCount(days: number): string {
  if (Number.isInteger(days) && days >= 0 && days < SMALL_NUMBER_WORDS.length) {
    const word = SMALL_NUMBER_WORDS[days];
    if (word !== undefined) return word;
  }
  return String(days);
}

/**
 * F2.21's whole decision, in one pure function: is recall evidence strong and
 * depth evidence absent, and if so, what does the offer say?
 *
 * The conditions, each traceable to a phrase in the clause:
 *
 * 1. **`sapling`** — F2.21 names the stage. `seed`/`sprout` have not recalled
 *    anything across spaced attempts; `tree` has already cleared the depth
 *    gate and needs no proposal (except through the reopening branch below).
 * 2. **`holding`** — F2.21 names the vitality reading. A concept that needs
 *    tending is F2.12's territory, not this one; `early` has too little to
 *    read.
 * 3. **Not recognition-only** — F2.21 says *recall* evidence. A concept whose
 *    scored evidence is all MCQ is recognition-tier (R7,
 *    `../mastery/vitality.ts`'s `isRecallTier`), which is why such a concept
 *    is capped at `sapling` in the first place; proposing off it would call
 *    recognition "strong recall".
 * 4. **Strong, not merely spaced** — `successfulScoredDays` at or past the
 *    spacing gate plus {@link STRONG_RECALL_MARGIN_DAYS}. See that constant's
 *    plain-English defence.
 * 5. **Depth evidence absent** — the depth gate uncleared *and* no graded
 *    explain-back on record. Both, deliberately: a graded explain-back that
 *    fell short of `relational` is depth evidence that exists and did not
 *    clear, which is a different situation from never having been asked, and
 *    F2.21's trigger is about the second.
 *
 * **The reopening branch** (F2.21): a fresh misconception on a concept
 * already at `tree` reopens eligibility, and the stage does not fall —
 * `computeConceptMastery` is a high-water mark and this module never writes,
 * so F2.11's monotonic guarantee is untouched by construction.
 *
 * **A concept whose whole extent is a single definition gets no special
 * case** (F2.21, `[D-080]`): nothing here reads concept size, so a
 * definition-only concept is evaluated on exactly these five conditions like
 * any other.
 */
export function evaluateStrongRecallProposal(
  input: StrongRecallProposalInput,
): StrongRecallProposalDecision {
  if (input.conceptId.length === 0) {
    throw new Error('evaluateStrongRecallProposal: conceptId must be non-empty');
  }
  const minSpacedRetrievalDays = input.minSpacedRetrievalDays ?? MIN_SPACED_RETRIEVAL_DAYS;
  const strongRecallDays = minSpacedRetrievalDays + STRONG_RECALL_MARGIN_DAYS;
  const { evidence } = input;

  const depthEvidencePresent = evidence.depthGateCleared || evidence.gradedExplainBackCount > 0;

  // F2.21's reopening branch: a fresh misconception on a top-stage concept is
  // the strongest version of the same signal, and outranks the depth evidence
  // that got the concept to `tree` in the first place.
  if (input.state === 'tree' && input.misconceptionSinceLastGradedExplainBack === true) {
    const reason: StrongRecallReason = {
      kind: 'reopened-by-misconception',
      successfulScoredDays: evidence.successfulScoredDays,
      strongRecallDays,
    };
    return {
      shouldPropose: true,
      conceptId: input.conceptId,
      trigger: STRONG_RECALL_PROPOSAL_TRIGGER,
      reason,
      promptText: strongRecallPromptLine(reason),
    };
  }

  if (input.state !== 'sapling') {
    return {
      shouldPropose: false,
      because: input.state === 'tree' ? 'depth-evidence-present' : 'stage-below-sapling',
    };
  }
  if (input.vitality !== 'holding') return { shouldPropose: false, because: 'recall-not-holding' };
  if (evidence.recognitionOnly) return { shouldPropose: false, because: 'recognition-only' };
  if (evidence.successfulScoredDays < strongRecallDays) {
    return { shouldPropose: false, because: 'recall-not-yet-strong' };
  }
  if (depthEvidencePresent) return { shouldPropose: false, because: 'depth-evidence-present' };

  const reason: StrongRecallReason = {
    kind: 'strong-recall',
    successfulScoredDays: evidence.successfulScoredDays,
    strongRecallDays,
  };
  return {
    shouldPropose: true,
    conceptId: input.conceptId,
    trigger: STRONG_RECALL_PROPOSAL_TRIGGER,
    reason,
    promptText: strongRecallPromptLine(reason),
  };
}
