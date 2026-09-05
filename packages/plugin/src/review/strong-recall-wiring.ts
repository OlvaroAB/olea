/**
 * F2.21's third trigger, joined to a real review session (`ol-v7r5.40`).
 *
 * `olea-core`'s `evaluateStrongRecallProposal`
 * (`packages/core/src/study-session/strong-recall-proposal.ts`) is the pure
 * decision: given one concept's growth stage, its evidence record, its
 * vitality reading and whether a misconception has surfaced since its last
 * graded explain-back, should Olea propose an explain-back, and what does the
 * offer say. It reads no log and computes no rollup — a caller passes those
 * four facts in. **This module is that caller**, and it is the only thing
 * between the decision and `ReviewSession`.
 *
 * ## The seam, and the clause line that picks it
 *
 * F2.21: *"this is a third **trigger** for the same on-demand instrument,
 * delivered through the existing on-demand channel (F2.7/F2.12), never
 * through queue composition."*
 *
 * "The existing on-demand channel" is, concretely,
 * `ReviewSession.logAndAdvance` raising a pending offer that `view.ts` draws
 * as a banner on the reveal screen — the seam F2.12's confusion routing and
 * F5.3a's reciprocal prompt both already use. So the trigger fires **at the
 * same reveal-screen moment**, from the same method, evaluated for the
 * concept the instrument she just graded teaches. The alternative seam — a
 * pre-session pass over every concept in the vault — was rejected on the
 * second half of the same sentence: a pass that ranks the vault's concepts to
 * pick which proposals to raise is queue composition wearing a different hat,
 * and it also has no moment at which to show its result that is not a new
 * surface (no clause defines one).
 *
 * That leaves exactly one problem, which is why this module exists: the
 * predicate needs the concept's **whole-log** mastery rollup and its vitality
 * reading, and `logAndAdvance` holds neither. It holds one instrument, one
 * rating and one scheduler result.
 *
 * ## What this module does about it, and what it costs
 *
 * It closes over the review log the session was **already composed from**
 * (`open-session.ts`'s `composed.entries` — no second vault read, no second
 * log parse) and answers one concept at a time, lazily:
 *
 * - `replaySchedulerStates` runs **once**, on the first grade of the session,
 *   never once per grade. An instrument's scheduler state is a property of
 *   its own history, not of which concept is asking (`conceptVitalityInstruments`'
 *   own doc), so one replay serves every concept.
 * - `computeAllConceptMastery(entries, [conceptId])` folds **one** concept —
 *   the same per-concept projection `today/data-source.ts` runs over the
 *   whole enumeration, asked for a single id.
 * - Every answer is memoised per concept id for the life of the session, so a
 *   concept reviewed twice in one sitting is folded once.
 *
 * ## What it deliberately does NOT do
 *
 * **It does not see the review she just gave.** `entries` is the log as it
 * stood when the session opened; the record `logAndAdvance` writes moments
 * before asking this reader is not in it. That is the same snapshot
 * `evaluateSchedulingObservationRouting` already reads
 * (`open-session.ts`'s `liveSchedulingObservations`), and it is correct
 * rather than merely convenient here: F2.21's predicate is about recall
 * accumulated *across spaced attempts* — days, not this answer — and its
 * reopening branch is about a misconception a *prior* review recorded. A
 * concept that crosses the strong-recall line on today's last review is
 * proposed at the next session, which costs nothing: declining changes
 * nothing and neither does waiting (F2.14a).
 *
 * **It writes nothing and stores nothing.** No projection is cached to the
 * vault, no proposal is persisted. The offer's own record is the existing
 * `explain-back-offered` / `explain-back-declined` pair, written by
 * `ReviewSession` through `ExplainBackOfferLogPort` — see
 * `session.ts`'s `recordStrongRecallOfferShown`.
 *
 * **INV-1.** No `obsidian` import; this is composed by `open-session.ts`,
 * which is itself Obsidian-free, so `strong-recall-wiring.spec.ts` drives it
 * against plain arrays.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { ReplayResult, Scheduler, StrongRecallProposalDecision } from 'olea-core';
import {
  computeAllConceptMastery,
  conceptVitalityInstruments,
  evaluateStrongRecallProposal,
  readVitality,
  replaySchedulerStates,
} from 'olea-core';

/**
 * F2.11/`[D-116]`'s vitality axis needs a holding cut it cannot compute
 * itself. `today/data-source.ts`, `registry/provider.ts` and
 * `retrospective/provider.ts` each already declare this identical fallback
 * independently rather than share one module (see the first of those for the
 * argument) — this is a fourth, for the review session, and it is a
 * plain-English default (Class B) rather than a derivation for exactly the
 * same reason: ratifying a real value needs a semester of her review log.
 *
 * Exported so a caller that has a better number can hand it in, the same
 * `?? DECLARED_FALLBACK_HOLDING_CUT` shape those three providers use.
 */
export const DECLARED_FALLBACK_HOLDING_CUT = 0.8;

export interface StrongRecallProposalReaderDeps {
  /**
   * The review log the session was composed from — passed, never re-read.
   * See the module doc for why the review being written right now is
   * deliberately not in it.
   */
  readonly entries: readonly ReviewLogEntry[];
  /** The same scheduler the session rates against; only `retrievability` is used here. */
  readonly scheduler: Scheduler;
  /** The session's own instant, read once by its caller — never `Date.now()` inside this module. */
  readonly now: Date;
  /** Overrides {@link DECLARED_FALLBACK_HOLDING_CUT}. */
  readonly holdingCut?: number;
}

/**
 * What `ReviewSession` calls after a grade: the concept ids the graded
 * instrument is evidence for, in the instrument's own order.
 */
export interface StrongRecallProposalReaderInput {
  readonly conceptIds: readonly string[];
}

/**
 * True when a `misconception-observed` record for this concept is more recent
 * than its last **graded** explain-back — F2.21's *"a fresh misconception
 * surfacing on a concept already at the top stage … reopens eligibility"*.
 *
 * "Fresh" is relative to the last graded explain-back rather than to a
 * window: the concept reached `tree` *because* of that explain-back, so a
 * misconception recorded before it is already accounted for in the stage,
 * and only one recorded after it is new information. A concept with no graded
 * explain-back at all cannot be at `tree`, so the `null` case below never
 * reaches the reopening branch in practice; it is written to be honest rather
 * than to be reachable.
 *
 * Timestamps are ISO-8601 **with offset**, so they are compared as instants
 * (`Date.parse`) and never as strings — two devices in different offsets
 * would otherwise order wrongly. An unparseable timestamp is skipped rather
 * than treated as epoch zero.
 */
function misconceptionSinceLastGradedExplainBack(
  entries: readonly ReviewLogEntry[],
  conceptId: string,
): boolean {
  let lastGradedExplainBackAt: number | null = null;
  let latestMisconceptionAt: number | null = null;

  for (const entry of entries) {
    if (entry.kind === 'review') {
      if (entry.instrumentType !== 'explain-back') continue;
      if (entry.explainBackGrade === undefined) continue;
      if (!entry.conceptIds.includes(conceptId)) continue;
      const at = Date.parse(entry.timestamp);
      if (!Number.isFinite(at)) continue;
      if (lastGradedExplainBackAt === null || at > lastGradedExplainBackAt) {
        lastGradedExplainBackAt = at;
      }
      continue;
    }
    if (entry.kind !== 'misconception-observed') continue;
    if (!entry.conceptIds.includes(conceptId)) continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at)) continue;
    if (latestMisconceptionAt === null || at > latestMisconceptionAt) latestMisconceptionAt = at;
  }

  if (latestMisconceptionAt === null) return false;
  if (lastGradedExplainBackAt === null) return true;
  return latestMisconceptionAt > lastGradedExplainBackAt;
}

/**
 * Builds the evaluator `open-session.ts` threads onto `ReviewSessionDeps`.
 *
 * Returns the FIRST concept that proposes, reading the graded instrument's
 * `conceptIds` in order (D-031: an instrument may be evidence for several).
 * When none proposes, the decision returned is the first concept's — an
 * honest `shouldPropose: false` carrying `because`, which is what
 * `NoProposalReason` exists for, rather than a bare `undefined` a caller
 * would have to interpret.
 *
 * Never throws: a fold over a malformed log is a diagnostic, not a reason to
 * break a review she is in the middle of, so a failure reads as "no
 * proposal" — the same "simply cannot offer it" posture every optional port
 * on `ReviewSessionDeps` already has.
 */
export function createStrongRecallProposalReader(
  deps: StrongRecallProposalReaderDeps,
): (input: StrongRecallProposalReaderInput) => StrongRecallProposalDecision {
  const holdingCut = deps.holdingCut ?? DECLARED_FALLBACK_HOLDING_CUT;
  const memo = new Map<string, StrongRecallProposalDecision>();
  let replayed: ReplayResult | null = null;

  function decide(conceptId: string): StrongRecallProposalDecision {
    const cached = memo.get(conceptId);
    if (cached !== undefined) return cached;

    // Once per session, on the first grade — never once per grade, and never
    // at open, so a session she never rates costs nothing.
    replayed ??= replaySchedulerStates(deps.entries, deps.scheduler);

    const mastery = computeAllConceptMastery(deps.entries, [conceptId]).get(conceptId);
    const decision: StrongRecallProposalDecision =
      mastery === undefined
        ? { shouldPropose: false, because: 'stage-below-sapling' }
        : evaluateStrongRecallProposal({
            conceptId,
            state: mastery.state,
            evidence: mastery.evidence,
            vitality: readVitality({
              instruments: conceptVitalityInstruments(deps.entries, conceptId, replayed),
              scheduler: deps.scheduler,
              now: deps.now,
              holdingCut,
            }).value,
            misconceptionSinceLastGradedExplainBack: misconceptionSinceLastGradedExplainBack(
              deps.entries,
              conceptId,
            ),
          });

    memo.set(conceptId, decision);
    return decision;
  }

  return (input) => {
    try {
      let first: StrongRecallProposalDecision | null = null;
      for (const conceptId of input.conceptIds) {
        if (conceptId.length === 0) continue;
        const decision = decide(conceptId);
        if (decision.shouldPropose) return decision;
        first ??= decision;
      }
      return first ?? { shouldPropose: false, because: 'stage-below-sapling' };
    } catch (error) {
      console.error('Olea: could not evaluate the strong-recall proposal (F2.21)', error);
      return { shouldPropose: false, because: 'stage-below-sapling' };
    }
  };
}
