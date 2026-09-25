/**
 * `rankOracle` — F4.2's high-yield concept ranking (P5-T04), a pure
 * projection over `buildConceptAssessmentEdges` (P5-T03) and
 * `computeConceptMastery` (P4-T06). Neither upstream module is edited by
 * this one; both are composed exactly as their own reports asked for:
 * P5-T03 deliberately left out assessment weight, exam proximity and
 * mastery — this is where those join.
 *
 * ## What this function is, and what it deliberately is not
 *
 * This is **the whole of F4.2's inspectable ranking**: order, score,
 * reasoning and citations, computed with no model call and no network —
 * every acceptance criterion this bead can prove without spending is proved
 * here. It is not the Slot O Worker task (`olea-service/src/tasks/
 * oracleRank.ts`), which is a separate, unratified, LLM-driven pass over
 * raw source text per the cost model's §5.2 description ("every oracle run
 * re-sends the same past papers, learning objectives, and topic list").
 * That task's job — if and when a model is pinned — is citation-grounded
 * *narrative* synthesis across long context; it is deliberately barred from
 * inventing which concepts rank at all (see that file's module doc). This
 * function is the authority on order and on "reasoning matches what
 * actually drove it", and it needs Slot O for neither.
 *
 * ## Vetoes are separated from the blend (C5.10, `[D-076]` round 4, `ol-plxu`)
 *
 * Before any weighing happens, each concept↔assessment edge is checked
 * against a short, closed list of **vetoes** — facts that disqualify it
 * outright rather than merely discount it: `checkEdgeVeto` below. A vetoed
 * edge is REMOVED from the blend entirely (`buildEdgeOutcome` returns it
 * tagged `'vetoed'` before any weighing happens, and it never appears in
 * `contributions`) and is reported instead in
 * `OracleConceptFactors.vetoedEdges`, with a stated reason. If every edge a concept has is vetoed, the concept itself is
 * removed from `ranked` and reported in `CourseOracleRanking.vetoedConcepts`
 * — C5.10's own words: "A veto removes the concept from consideration and is
 * not a weight." **This is a structural distinction, not a numeric one**: no
 * combination of the SIGNALS below can reproduce a veto's effect (removal +
 * a stated reason), and a veto is never expressed as a weight of zero mixed
 * into the blend. Only `checkEdgeVeto`'s doc, not this one, is the source of
 * truth for which facts are wired as vetoes today.
 *
 * ## The scoring shape, and where its weights actually come from
 *
 * For each SURVIVING (non-vetoed) concept↔assessment edge, this module
 * computes a `contribution` — how much that one assessment's evidence should
 * weigh in the concept's overall priority — from four signals, each
 * normalized to roughly `[0, 1]` so they combine by multiplication without
 * one signal silently dominating by scale:
 *
 *   contribution = yieldScore * confidence * assessmentWeightScore * examProximityScore
 *
 * A concept's `preMasteryScore` is the **sum** of its contributions across
 * every surviving assessment that has an edge to it in the same course — a
 * concept examined by three assessments accumulates more priority than one
 * examined by a single low-weight quiz, which is the plain reading of
 * "likelihood and weight of examination" (F4.2). The final `priorityScore`
 * multiplies that by a mastery-need factor (`masteryNeedWeight`) — so a
 * concept she has already got to `yours` still shows up (F4.9 forbids ever
 * implying full coverage is unnecessary, but ranks below an equally-evidenced
 * concept she hasn't touched) — and, when supplied, a retrievability factor
 * (`retrievabilityWeight`, `RankOracleInput.retrievability`'s doc). Both are
 * SIGNALS in C5.10's sense: they trade off smoothly and never remove a
 * concept the way a veto does.
 *
 * **Two outputs, named apart (`ol-v7r5.55` [IL-D7]; see `./types.ts`'s own
 * section of that name for the full argument).** `preMasteryScore` IS
 * assessment relevance — the evidence question, "how strongly does this
 * concept's evidence say it will be examined," computed only from the
 * assessment side and never from anything about her. `priorityScore` IS
 * learner priority — that relevance with her mastery-need (and
 * retrievability) folded in, the policy question of how much of her time it
 * should get. Naming stays doc-only (no field renamed, so `./compose.ts` and
 * every plugin caller keep reading `priorityScore` unchanged): a caller that
 * wants relevance alone reads `preMasteryScore` directly rather than trying
 * to divide it back out of `priorityScore`, which is exactly the reasoning
 * that risks counting the mastery-need discount twice under two different
 * names (`./gap/build.ts`'s `GapRow.assessmentRelevance` does this for the
 * gap view specifically).
 *
 * **Per `[D-110]` (`ol-egov.28`), the proximity half-life, the assessment
 * weight divisor and the mastery-need ladder are DERIVED, not declared: the
 * component register's boundary column names them service-boundary, so their
 * fitting and tuning source live privately in `olea-service`
 * (`src/tasks/oracleRank.ts`), and only the resulting numbers are delivered
 * to the client — inside the versioned-artifact envelope
 * (`packages/contracts/src/artifact-envelope.ts`), the same pattern
 * components 1.6 and 2.5 already use. This module never fits, tunes or
 * reasons about that derivation; `rankOracle` simply applies whichever
 * `RankOracleOptions` its caller hands it via `RankOracleInput.options` — in
 * production that is a decoded delivered artifact's body where one is
 * wired (see the module-level note beside `resolveOptions` below for which
 * caller does, and which still don't).
 *
 * The `DECLARED_FALLBACK_*` constants below are a **different, narrower
 * thing**: this module's own client-side default for when no delivered
 * artifact is available yet — first run, offline, no cache. Each is
 * DECLARED per the component register's declared/derived line (defensible
 * in plain English, never fitted) and carries its own argued sentence where
 * it is defined, so the client degrades sanely rather than refusing to rank
 * at all. They are not a placeholder for the derived numbers and are never
 * tuned to approximate them.
 *
 * What IS proved here, by test and by mutation, regardless of which weights
 * were supplied: the reasoning text this module emits for every ranked
 * entry is mechanically DERIVED from these exact numbers, never a
 * separately-composed description that could drift from what actually
 * produced the order.
 *
 * ## The abstain path
 *
 * A course whose assessments have zero edges — every one of them landed in
 * P5-T03's `assessmentsWithNoEvidence` — produces no `ranked` entries and
 * no synthesized reasoning about "nothing to show". It produces an explicit
 * `status: 'abstained'` entry, citing exactly which assessments had no
 * evidence, so a course that abstains is never rendered as a course that
 * simply came back empty. This is the same "evidential, not membership"
 * discipline P5-T03 enforces, one layer up: an oracle that ranked concepts
 * for a course with no evidence would be inferring a ranking from course
 * membership alone, which is exactly what P5-T03's edges refuse to do and
 * what this module must not undo.
 *
 * ## The comparable-observation tiebreak (C5.10 ruling 1, `[D-265]`,
 * `ol-egov.141.52`)
 *
 * C5.10 was amended Sep 2026 to add one narrow rule ON TOP of the ordinary
 * name-ascending tie-break above: "Where the blend leaves two concepts
 * tied, a concept whose recent recall observations disagree — comparable in
 * tier, support level shown, source version and recency, with nothing in
 * the record explaining the split — may be served ahead of a tied concept
 * whose evidence is tidy, but only where a different eligible ordinary
 * instrument on the concept exists to resolve it." Two things this module
 * does and does not do about that:
 *
 * **This module never decides WHETHER a concept qualifies.** Reading recent
 * recall observations for tier/support-level/source-version/recency
 * comparability, telling a genuine disagreement apart from an ordinary
 * probabilistic pattern (the clause's own example: "a recall success
 * followed by a failure on a harder instrument is not a conflict"), and
 * checking whether a different eligible ordinary instrument still exists on
 * the concept all require reading `review-log/` and instrument-eligibility
 * state this module is never handed — `RankOracleInput` composes only
 * evidence edges, mastery and (optionally) retrievability, none of which
 * carry review-log history. That computation is a producer's job, outside
 * `oracle/rank.ts` (this bead's one owned file), exactly the same
 * "known gap, reachability" shape `RankOracleInput.retrievability`'s doc
 * already carries: nothing supplies it today, and wiring one is a follow-on
 * bead's reachability work, not this one's.
 *
 * **What this module DOES do is apply the tiebreak mechanically, once told
 * which concepts qualify.** `RankOracleTiebreakInput.tiebreakEligible` (see
 * below) is an opaque set of `conceptKey`s a caller has already determined
 * satisfy BOTH halves of the clause (comparable-observation disagreement,
 * AND a different eligible instrument to resolve it) — this module treats
 * that determination as a single fact and never re-derives it. The rule it
 * applies is exactly the clause's own bound: **it fires ONLY where
 * `compareContributions`'s ordinary sort already left two concepts'
 * `priorityScore` exactly tied**, so it can never move a concept ahead of
 * one the blend actually preferred (never a re-weighting), it never adds a
 * review or any new evidence (it only re-orders two already-eligible,
 * already-scored `ConceptPriority` entries), and a concept absent from
 * `tiebreakEligible` — including every concept when the field itself is
 * omitted — reads as "tidy" and falls through to the ordinary
 * conceptName-ascending tie-break unchanged. This is deliberately the
 * NARROWEST possible reading of "may be served first": a boolean precedence
 * among already-tied entries, nothing more.
 *
 * **This is not a new number.** Unlike every `DECLARED_FALLBACK_*` constant
 * above, the tiebreak introduces no threshold, weight or magnitude of its
 * own to declare or derive — it is a structural ordering rule, the same
 * category as the veto/blend separation (C5.10's first half) rather than a
 * tunable. Any NUMBER a future producer needs to decide "comparable" or
 * "recency" (e.g. a recency window) is that producer's to declare or derive
 * when it lands, and is explicitly out of this bead's scope.
 */

import type { MasteryState } from 'olea-contracts';
import type { AssessmentRecord } from '../assessment/types.js';
import { normalizeAssessmentWeight } from '../assessment/weight.js';
import { daysBetween } from '../dates.js';
import type {
  ConceptAssessmentEdge,
  EvidenceObjectivesCitation,
  EvidenceQuestionCitation,
} from '../evidence-edge/types.js';
import type { VaultPath } from '../vault/types.js';
import type {
  ConceptPriority,
  CourseOracleRanking,
  DueDateReadIssue,
  EdgeVetoReason,
  OracleConceptFactors,
  OracleEdgeContribution,
  OracleMasteryState,
  OracleVetoedConcept,
  OracleVetoedEdge,
  RankOracleInput,
  RankOracleOptions,
  RankOracleResult,
} from './types.js';

/**
 * DECLARED FALLBACK (`[D-110]`, `ol-egov.28`) — used only when
 * `RankOracleInput.options` does not supply `proximityHalfLifeDays`, i.e. no
 * delivered artifact was available. **Plain-English defense:** two weeks is
 * a plain, undebatable point at which an assessment starts to feel urgent to
 * a student planning ahead. It needs no fitting to defend and is not itself
 * a claim about her, only a shape for the decay curve — which is exactly
 * what makes it safe to declare rather than derive.
 */
const DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS = 14;

/**
 * DECLARED FALLBACK (`[D-110]`, re-derived and re-classified by `[D-143]` /
 * `ol-3ux7.30`) — used only when `options` does not supply
 * `assessmentWeightDivisor`.
 *
 * **It was 100, and 100 stopped being right once the basis was fixed.** The
 * old value assumed weights arrive as percentages (`ol-3ux7.17`). `[D-143]`
 * rules the canonical basis to be **fractions of the course grade, `0..1`**,
 * normalised at ingest (`../assessment/weight.ts`). Against fraction-basis
 * inputs a divisor of 100 pushed the whole weight factor into roughly
 * `[1e-4, 5e-3]` of its `[0, 1]` range — muted, and visible to her, because
 * `buildReasoning` renders this score at two decimal places and nearly every
 * assessment then read as `weight score 0.00`.
 *
 * **Why 1, and why this is DECLARED rather than derived.** Once the input is
 * a fraction of the course grade, the score this factor wants *is* that
 * fraction: an assessment worth half the grade should score 0.5 on a
 * `[0, 1]` factor. The divisor becomes an identity, defensible in one
 * sentence with no corpus behind it — which is the register's own test for a
 * declared constant rather than a derived one. The `assessmentWeightDivisor`
 * seam stays exactly as it was (the envelope still carries it, a delivered
 * value still overrides), so nothing about the artifact contract changes.
 *
 * **What the corpus was asked, and what it could NOT answer.** Within a
 * course the ranking sums `evidenceStrength × weightScore × proximity`, and
 * no consumer thresholds on the magnitude — every downstream use of
 * `priorityScore`/`gapScore` is a comparison. So while no weight clamps, the
 * divisor is a uniform positive scale and the ordering is **identical for
 * every divisor at or above the largest normalised weight**: an unbounded
 * plateau, on which order-based evidence discriminates nothing at all. Below
 * that point the clamp starts tying genuinely different weights together and
 * destroys distinctions. The measured derivation is therefore about
 * *fidelity*, not order, and 1 is picked out of that plateau by the
 * plain-English argument above rather than by a fit. The measurement itself
 * stays private — it was run against her vault (`ol-3ux7.30`).
 */
const DECLARED_FALLBACK_ASSESSMENT_WEIGHT_DIVISOR = 1;

/**
 * DECLARED FALLBACK (`[D-110]`) — used only when `options` does not supply
 * `masteryNeedWeight`. **Plain-English defense:** the ladder only has to be
 * monotonically decreasing and never zero (F4.9 forbids ever implying full
 * coverage is unnecessary); seed/sprout/sapling/tree space four stages
 * roughly evenly between "no discount" and "small residual discount", and
 * `'unknown'` is neutral (1, no discount) because "no mastery data was
 * supplied" is not evidence she has mastered nothing — it is the absence of
 * a signal, and this module's rule throughout is that an absent signal never
 * silently reads as the worst case OR the best case; it reads as neutral and
 * is flagged (`assessmentWeightKnown`, `masteryState === 'unknown'`,
 * `daysUntilDue === null`). None of that needs measurement to defend, which
 * is what makes it a legitimate declared value rather than a stand-in for a
 * derived one.
 *
 * **Re-bucketed for D-049's four-stage vocabulary (`VOC-1`, `ol-7efk`).** The
 * retired ladder's `shaky` (0.85) and `coming` (0.6) rungs merge into
 * `sprout`'s single rung; `seed`, `sapling` and `tree` keep the old `new`,
 * `solid` and `yours` values unchanged.
 */
const DECLARED_FALLBACK_MASTERY_NEED_WEIGHT: Readonly<Record<OracleMasteryState, number>> = {
  seed: 1,
  sprout: 0.7,
  sapling: 0.35,
  tree: 0.15,
  unknown: 1,
};

/**
 * C5.10 ruling 1's tiebreak input (`[D-265]`, `ol-egov.141.52`) — additive to
 * `RankOracleInput`, and deliberately typed HERE rather than in `./types.js`
 * so this bead's edits stay inside its one owned file. A follow-on bead may
 * fold this into `RankOracleInput` proper once a real producer exists to
 * wire it (see this file's module doc, "The comparable-observation
 * tiebreak").
 */
export interface RankOracleTiebreakInput {
  /**
   * `conceptKey`s (never `conceptName` — the same opaque-join-key rule
   * `RankOracleInput.mastery`/`retrievability` follow) for which C5.10's
   * comparable-observation tiebreak is ELIGIBLE this pass. **Both halves of
   * the clause are already folded into this one flag by whoever computes
   * it**: the concept's recent recall observations disagree in a way that
   * is comparable in tier, support level shown, source version and
   * recency, with nothing in the record explaining the split — AND a
   * different eligible ordinary instrument on the concept exists to
   * resolve it. This module never inspects review-log entries, observation
   * tiers or instrument eligibility itself; that reading is a producer's
   * job outside `oracle/` (see the module doc).
   *
   * Omitted entirely, or a concept key absent from it, reads as **not
   * eligible** — the ordinary, tidy case — so absence can never itself win
   * a tie. Consulted ONLY where the blend has already tied two concepts'
   * `priorityScore` exactly: this can never change the order of two
   * concepts the blend did not tie, and it is never folded into
   * `priorityScore` itself — a tiebreak, not a weight, matching C5.10's
   * veto/blend separation.
   */
  readonly tiebreakEligible?: ReadonlySet<string>;
}

interface ResolvedOptions {
  readonly proximityHalfLifeDays: number;
  readonly assessmentWeightDivisor: number;
  readonly masteryNeedWeight: Readonly<Record<OracleMasteryState, number>>;
}

/**
 * Resolves the weights this ranking pass runs with. **This is the seam
 * `[D-110]`'s derived-delivered weights arrive through**: `options` is
 * `RankOracleInput.options`, and in production it is meant to be a decoded
 * delivered artifact's body (`olea-service`'s `deriveRankWeights` /
 * `buildRankWeightsEnvelope`, `src/tasks/oracleRank.ts`) rather than
 * hand-authored client values. Falling back per-field (not all-or-nothing)
 * means a partial or first-generation delivered body still improves on the
 * declared fallback wherever it has an opinion.
 *
 * **Reachability (plan §2.7 clause 5), closed by `ol-v7r5.3`:** the
 * `rank-weights` envelope kind is registered in `packages/contracts/src/
 * artifact-envelope.ts`, and one production path decodes and passes it —
 * `main.ts` wires `rank/wiring.ts`'s `buildRankWeightsWiring` (which fetches
 * and decodes the delivered envelope) into `deps.readRankWeights`, which
 * `plan/provider.ts` awaits and threads onto `composeOracleRanking`'s
 * `options`. **Corrected — no longer the only one.** `gap/provider.ts` and
 * `session-builder/provider.ts` (`main.ts` wires the same `readRankWeights`
 * thunk into both) now thread it through too, `[D-110]` (`ol-v7r5.55`
 * [IL-D7]) — all three of `composeOracleRanking`'s production callers read
 * the delivered artifact when one is available and fall back to the
 * declared constants below otherwise.
 */
function resolveOptions(options: RankOracleOptions | undefined): ResolvedOptions {
  const proximityHalfLifeDays =
    options?.proximityHalfLifeDays ?? DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS;
  const assessmentWeightDivisor =
    options?.assessmentWeightDivisor ?? DECLARED_FALLBACK_ASSESSMENT_WEIGHT_DIVISOR;
  const masteryNeedWeight = options?.masteryNeedWeight ?? DECLARED_FALLBACK_MASTERY_NEED_WEIGHT;
  if (!(proximityHalfLifeDays > 0)) {
    throw new Error(`rankOracle: proximityHalfLifeDays must be > 0, got ${proximityHalfLifeDays}`);
  }
  if (!(assessmentWeightDivisor > 0)) {
    throw new Error(
      `rankOracle: assessmentWeightDivisor must be > 0, got ${assessmentWeightDivisor}`,
    );
  }
  for (const state of ['seed', 'sprout', 'sapling', 'tree', 'unknown'] as const) {
    const value = masteryNeedWeight[state];
    if (!(value >= 0)) {
      throw new Error(`rankOracle: masteryNeedWeight.${state} must be >= 0, got ${value}`);
    }
  }
  return { proximityHalfLifeDays, assessmentWeightDivisor, masteryNeedWeight };
}

const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateFromCalendarDay(day: string): Date | null {
  if (!CALENDAR_DAY_RE.test(day)) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `1 / yieldRank` — rank 1 (most salient) scores 1.0, rank 2 scores 0.5, and so on. Simple and monotonic; not measured against anything. */
function computeYieldScore(yieldRank: number): number {
  return 1 / yieldRank;
}

/**
 * Assessment weight normalized to `[0, 1]`. Unknown weight is **neutral**
 * (1), never a silent 0 — a missing `weight` field must not zero out a
 * concept's otherwise-real evidence.
 *
 * **`[D-143]` is re-applied here, and that is belt-and-braces rather than a
 * second opinion.** `../assessment/read.ts` already normalises on ingest, and
 * `normalizeAssessmentWeight` is idempotent over every realistic value, so
 * for a record that came through the reader this is the identity. It is here
 * for the records that did NOT: a fixture, a synthetic corpus or a test
 * builds `AssessmentRecord` by hand and is under no obligation to know about
 * the ruling. Without it, the divisor's move from 100 to 1 would silently
 * clamp every such percentage-basis weight to exactly 1.0 and tie them all
 * together — the ranking would still *run*, and the weight factor would be
 * dead in precisely the way `ol-3ux7.17` found it dead, which is the failure
 * mode worth spending three lines to make impossible.
 */
function computeAssessmentWeightScore(
  weight: number | undefined,
  divisor: number,
): { readonly known: boolean; readonly score: number } {
  const { value } = normalizeAssessmentWeight(weight);
  if (value === undefined) {
    return { known: false, score: 1 };
  }
  return { known: true, score: Math.max(0, Math.min(1, value / divisor)) };
}

/**
 * Resolves `due` to a days-until-due reading and, separately, whether the
 * value read as an actual data-quality problem. **Three cases, not two:**
 * `due` absent (ordinary — most assessments in the fixture and the real
 * vault alike simply have a date), `due` present but unparseable (a data
 * problem worth surfacing loudly — `dueDateIssue: 'unparseable'`), and `due`
 * present and parseable. The first two both yield `daysUntilDue: null` —
 * neither can place the assessment on the timeline — but only the second is
 * flagged, because "no date recorded" is not itself news.
 */
function resolveDueTiming(
  asOf: Date,
  due: string | undefined,
): { readonly daysUntilDue: number | null; readonly dueDateIssue: DueDateReadIssue | undefined } {
  if (due === undefined) return { daysUntilDue: null, dueDateIssue: undefined };
  const dueDate = dateFromCalendarDay(due);
  if (dueDate === null) return { daysUntilDue: null, dueDateIssue: 'unparseable' };
  return { daysUntilDue: daysBetween(asOf, dueDate), dueDateIssue: undefined };
}

/**
 * C5.10's veto list, structurally separated from the weighted blend below:
 * "A short list of facts that genuinely disqualify a concept act as
 * vetoes... A veto removes the concept from consideration and is not a
 * weight." **Exactly one of the three is computable from data this module
 * has today.**
 *
 *  - `'assessment-passed'` — `daysUntilDue < 0`. Wired here. A passed
 *    assessment cannot inform *future* study priority, whatever its
 *    evidence, so it is REMOVED from the blend rather than merely scored
 *    low — previously this floored `examProximityScore` to 0 in place (a
 *    weight indistinguishable from any other), which is exactly the
 *    gate-that-should-have-been-a-weight-or-vice-versa confusion C5.10 warns
 *    against; separating it here is this bead's structural half.
 *  - `'out-of-course-scope'` and `'suspended'` — **reserved, not wired.**
 *    Neither fact is an input `rankOracle` receives today:
 *    `AssessmentRecord.status` (`../assessment/types.js`) is free text the
 *    contract does not define values for at this key (F1.7/F4.8 key on
 *    `type`, never `status`), and concept-level suspension is a different
 *    mechanism from `../review-log/suspension.ts`'s per-INSTRUMENT
 *    projection — neither is threaded into `RankOracleInput`. Guessing a
 *    mapping from `status` strings would be inventing contract vocabulary
 *    this module does not own; wiring either is a reachability gap for a
 *    follow-on bead, tracked structurally by `EdgeVetoReason` already
 *    naming both so a producer has somewhere to report into.
 *
 * Never called for an edge whose `due` was merely absent or unparseable —
 * "we don't know when this is due" is a SIGNAL (see
 * `computeExamProximityScore`), not one of the disqualifying facts above.
 */
function checkEdgeVeto(daysUntilDue: number | null): { readonly reason: EdgeVetoReason } | null {
  if (daysUntilDue !== null && daysUntilDue < 0) return { reason: 'assessment-passed' };
  return null;
}

/**
 * Exam-proximity SIGNAL score for a SURVIVING edge — never called for an
 * edge `checkEdgeVeto` disqualified. `daysUntilDue === null` (missing or
 * unparseable `due`) scores **0**.
 *
 * **DECLARED semantics, and the defect this replaces.** `daysUntilDue` was
 * previously scored **1 — this function's maximum, identical to "due
 * today"** — whenever `due` failed to parse, so a malformed date could
 * outrank a real, dated deadline (`ol-plxu`). The fix: treat "no known
 * deadline" the same way the decay formula's own floor treats a date
 * receding to infinity (`1 / (1 + daysUntilDue / halfLifeDays) → 0` as
 * `daysUntilDue → ∞`) — an assessment we cannot place on the timeline is
 * never *more* urgent than one we can, however far away, so it can never
 * tie or outrank any real dated assessment on this factor. This is argued
 * in plain English, not fitted: it needs no corpus, only the shape of the
 * decay curve it already uses.
 *
 * **This is a SIGNAL, never a gate** — the edge is NOT removed, unlike an
 * `'assessment-passed'` veto. It stays in `contributions`, fully reported
 * (`daysUntilDue: null`, `dueDateIssue` when the value was outright
 * unparseable rather than merely absent), and the concept it belongs to can
 * still rank on its other evidence, or even on this edge alone if it has no
 * other — scoring 0 discounts this one edge's share, it does not disqualify
 * the concept.
 */
function computeExamProximityScore(daysUntilDue: number | null, halfLifeDays: number): number {
  if (daysUntilDue === null) return 0;
  return 1 / (1 + daysUntilDue / halfLifeDays);
}

function compareCitations(a: EvidenceQuestionCitation, b: EvidenceQuestionCitation): number {
  if (a.sourcePath !== b.sourcePath) return a.sourcePath < b.sourcePath ? -1 : 1;
  if (a.questionLabel !== b.questionLabel) return a.questionLabel < b.questionLabel ? -1 : 1;
  return 0;
}

/** Union of citations across `edges`, deduplicated by (sourcePath, questionLabel), deterministically sorted. */
function unionCitations(
  edges: readonly ConceptAssessmentEdge[],
): readonly EvidenceQuestionCitation[] {
  const seen = new Map<string, EvidenceQuestionCitation>();
  for (const edge of edges) {
    for (const citation of edge.citations) {
      const key = `${citation.sourcePath}\u0000${citation.questionLabel}`;
      if (!seen.has(key)) seen.set(key, citation);
    }
  }
  return [...seen.values()].sort(compareCitations);
}

function compareObjectivesCitations(
  a: EvidenceObjectivesCitation,
  b: EvidenceObjectivesCitation,
): number {
  return a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0;
}

/**
 * `unionCitations`'s `'objectives'`-basis sibling (`[D-226]` ruling 2,
 * `ol-af3j`). Deduplicated by `sourcePath` alone — an objectives mention
 * carries no `questionLabel` to dedupe on, unlike its past-paper sibling —
 * and deterministically sorted the same way.
 */
function unionObjectivesCitations(
  edges: readonly ConceptAssessmentEdge[],
): readonly EvidenceObjectivesCitation[] {
  const seen = new Map<string, EvidenceObjectivesCitation>();
  for (const edge of edges) {
    for (const citation of edge.objectivesCitations ?? []) {
      if (!seen.has(citation.sourcePath)) seen.set(citation.sourcePath, citation);
    }
  }
  return [...seen.values()].sort(compareObjectivesCitations);
}

/**
 * `masteryState` for one concept. **Deliberately two different absences**:
 * `mastery` entirely omitted (the caller opted the whole ranking out of a
 * mastery join) reads as `'unknown'` — neutral, flagged, no claim made.
 * `mastery` supplied but this concept has no entry in it reads as `'seed'`
 * — P4-T06's own contract for zero scored evidence, which is a real,
 * contract-backed answer rather than an absence this module invented.
 *
 * Looked up by `conceptKey` — the opaque join key (`ol-63e1`) — never by the
 * display name; `mastery` is `RankOracleInput.mastery`, which is keyed the
 * same way (see that field's doc).
 */
function resolveMasteryState(
  mastery: ReadonlyMap<string, { readonly state: MasteryState }> | undefined,
  conceptKey: string,
): OracleMasteryState {
  if (mastery === undefined) return 'unknown';
  return mastery.get(conceptKey)?.state ?? 'seed';
}

/**
 * `retrievabilityWeight` for one concept — see `RankOracleInput.retrievability`'s
 * doc for what this is and why nothing supplies it today.
 *
 * **Returns `undefined`, never a defaulted `1`, when this concept has no
 * supplied retrievability** (the map itself omitted, or this concept missing
 * from it) — C5.6/`[D-264]`'s producer work (`ol-v7r5.52`). The two facts
 * "no eligible recall evidence for this concept" and "eligible evidence
 * whose measured value happens to be a genuinely neutral `1`" used to
 * collapse to the identical stored number, which left a reader of
 * `OracleConceptFactors.retrievabilityWeight` unable to tell them apart —
 * exactly the distinction readiness's supported-only exclusion needs to
 * apply a real policy zero rather than a measured one. The BLEND this
 * feeds (`priorityScore`, below) still treats absence as neutral, per
 * C5.10 ("retrievability is a signal, never a gate") — only the STORED
 * factor now preserves the distinction; `resolveMasteryState`'s `'unknown'`
 * and `computeAssessmentWeightScore`'s unresolved-weight case still default
 * at the point they're consumed, the same as this one now does.
 *
 * A supplied value must be a genuine probability, `(0, 1]` — never negative,
 * never a silent >1 that would inflate a concept's priority beyond what it
 * earned from evidence alone.
 */
function resolveRetrievabilityWeight(
  retrievability: ReadonlyMap<string, number> | undefined,
  conceptKey: string,
): number | undefined {
  const value = retrievability?.get(conceptKey);
  if (value === undefined) return undefined;
  if (!(value > 0 && value <= 1)) {
    throw new Error(`rankOracle: retrievability.${conceptKey} must be within (0, 1], got ${value}`);
  }
  return value;
}

/** Deterministic order for `vetoedEdges`, matching `compareContributions`'s tie-break so purity/rebuild equivalence holds regardless of `Map` iteration order. */
function compareVetoedEdges(a: OracleVetoedEdge, b: OracleVetoedEdge): number {
  return a.assessmentPath < b.assessmentPath ? -1 : a.assessmentPath > b.assessmentPath ? 1 : 0;
}

/** One edge's outcome: REMOVED by a veto, or a surviving contribution to the blend — never both, matching C5.10's "a veto removes... and is not a weight." */
type EdgeOutcome =
  | { readonly kind: 'vetoed'; readonly vetoedEdge: OracleVetoedEdge }
  | { readonly kind: 'contribution'; readonly contribution: OracleEdgeContribution };

function buildEdgeOutcome(
  edge: ConceptAssessmentEdge,
  assessment: AssessmentRecord | undefined,
  asOf: Date,
  resolved: ResolvedOptions,
): EdgeOutcome {
  const { daysUntilDue, dueDateIssue } = resolveDueTiming(asOf, assessment?.due);
  const veto = checkEdgeVeto(daysUntilDue);
  if (veto !== null) {
    return {
      kind: 'vetoed',
      vetoedEdge: { assessmentPath: edge.assessmentPath, reason: veto.reason, daysUntilDue },
    };
  }
  const yieldScore = computeYieldScore(edge.yieldRank);
  const weight = computeAssessmentWeightScore(assessment?.weight, resolved.assessmentWeightDivisor);
  const examProximityScore = computeExamProximityScore(
    daysUntilDue,
    resolved.proximityHalfLifeDays,
  );
  const evidenceStrength = yieldScore * edge.confidence;
  const contribution = evidenceStrength * weight.score * examProximityScore;
  return {
    kind: 'contribution',
    contribution: {
      assessmentPath: edge.assessmentPath,
      yieldRank: edge.yieldRank,
      yieldScore,
      confidence: edge.confidence,
      assessmentWeightKnown: weight.known,
      assessmentWeightScore: weight.score,
      daysUntilDue,
      ...(dueDateIssue !== undefined ? { dueDateIssue } : {}),
      examProximityScore,
      evidenceStrength,
      contribution,
    },
  };
}

function compareContributions(a: OracleEdgeContribution, b: OracleEdgeContribution): number {
  if (a.contribution !== b.contribution) return b.contribution - a.contribution;
  return a.assessmentPath < b.assessmentPath ? -1 : a.assessmentPath > b.assessmentPath ? 1 : 0;
}

/**
 * The reasoning string — mechanically assembled from `factors` and nothing
 * else. This is the property the bead's caution names directly: reasoning
 * that is DERIVED, not decorated. Every number quoted below is read off
 * `factors` itself, never recomputed or approximated, so a test that
 * independently recomputes `factors` and checks these exact substrings can
 * only pass if this function actually reports what drove the score.
 *
 * **The opening evidence clause is basis-aware (`[D-226]` ruling 2,
 * `ol-oxa2`).** Before this bead, it always read `"N citations across M past
 * papers"`; for an objectives-only concept (`ol-af3j`'s admission of
 * objectives citations on their own basis) that produced a literal `"0
 * citations across 0 past papers"` — internally consistent, but it silently
 * dropped the objectives evidence that actually drove the score, which is
 * exactly the "reasoning matches what actually drove it" property this
 * function exists to guarantee. `buildEvidenceClause` below states each
 * basis present (past-paper as citation frequency; objectives as declared
 * scope, per its own attribution — never borrowing the past-paper clause's
 * frequency framing, "never wears a past paper's clothes") and states BOTH
 * when a concept is cited by both (F4.2: "each basis is stated for what it
 * is").
 */
function buildEvidenceClause(factors: OracleConceptFactors): string {
  const objectivesCitations = factors.objectivesCitations ?? [];
  const distinctObjectivesSourceCount = factors.distinctObjectivesSourceCount ?? 0;
  const pastPaperClause =
    factors.citations.length > 0
      ? `${factors.citations.length} citation${factors.citations.length === 1 ? '' : 's'} ` +
        `across ${factors.distinctSourceCount} past paper` +
        `${factors.distinctSourceCount === 1 ? '' : 's'}`
      : null;
  // Never a citation count for objectives — an objectives document declares
  // what is IN SCOPE, it does not evidence HOW OFTEN something is examined
  // (F4.2, `[D-226]` ruling 2), so this names the document count only, never
  // a mention/citation frequency that would read as examiner behaviour.
  const objectivesClause =
    objectivesCitations.length > 0
      ? `declared in scope by ${distinctObjectivesSourceCount} objectives document` +
        `${distinctObjectivesSourceCount === 1 ? '' : 's'}`
      : null;
  if (pastPaperClause !== null && objectivesClause !== null) {
    return `${pastPaperClause}, and ${objectivesClause}`;
  }
  // The `?? ` fallback is unreachable in practice: `evidence-edge/build.ts`
  // never emits an edge with no evidence at all (its own "evidential, not
  // membership" rule), so a concept that reaches `buildReasoning` always has
  // at least one non-empty clause. Typed defensively rather than asserted
  // away, matching `top === undefined`'s handling just below.
  return pastPaperClause ?? objectivesClause ?? 'no evidence recorded';
}

function buildReasoning(
  conceptName: string,
  course: string,
  factors: OracleConceptFactors,
): string {
  const top = factors.contributions[0];
  if (top === undefined) {
    // Unreachable in practice — a ConceptPriority is only ever built from a
    // non-empty edge group — but typed defensively rather than asserted
    // away, matching this codebase's "no silent empty" discipline.
    throw new Error(`buildReasoning: ${conceptName} (${course}) has no contributing edges`);
  }
  const assessmentCount = factors.contributions.length;
  const dueClause =
    top.daysUntilDue === null
      ? 'due date unknown'
      : top.daysUntilDue < 0
        ? 'already past'
        : `due in ${top.daysUntilDue} day${top.daysUntilDue === 1 ? '' : 's'}`;
  const weightClause = top.assessmentWeightKnown
    ? `weight score ${top.assessmentWeightScore.toFixed(2)}`
    : 'weight unknown';
  return (
    `${conceptName} (${course}): ${buildEvidenceClause(factors)}, spanning ${assessmentCount} ` +
    `assessment${assessmentCount === 1 ? '' : 's'}. Strongest link: ${top.assessmentPath} ` +
    `(yield rank ${top.yieldRank}, confidence ${top.confidence.toFixed(2)}, ${weightClause}, ` +
    `${dueClause}). Mastery: ${factors.masteryState} (need weight ` +
    `${factors.masteryNeedWeight.toFixed(2)}). Priority score ${factors.priorityScore.toFixed(3)}.`
  );
}

function buildAbstainDetail(course: string, assessmentPaths: readonly VaultPath[]): string {
  return (
    `${course}: ${assessmentPaths.length} assessment${assessmentPaths.length === 1 ? '' : 's'} ` +
    `registered with zero evidence edges (P5-T03 assessmentsWithNoEvidence) — ` +
    `${assessmentPaths.slice().sort().join(', ')}. Abstaining rather than ranking from course ` +
    'membership alone.'
  );
}

function rankOneCourse(
  course: string,
  edgesForCourse: readonly ConceptAssessmentEdge[],
  noEvidencePathsForCourse: readonly VaultPath[],
  assessmentsByPath: ReadonlyMap<VaultPath, AssessmentRecord>,
  mastery: ReadonlyMap<string, { readonly state: MasteryState }> | undefined,
  retrievability: ReadonlyMap<string, number> | undefined,
  asOf: Date,
  resolved: ResolvedOptions,
  tiebreakEligible: ReadonlySet<string> | undefined,
): CourseOracleRanking {
  if (edgesForCourse.length === 0) {
    const paths = noEvidencePathsForCourse.slice().sort();
    return {
      course,
      status: 'abstained',
      reason: 'no-evidence',
      detail: buildAbstainDetail(course, paths),
      assessmentPaths: paths,
    };
  }

  // Grouped by the opaque join key (`ol-63e1`), never by display name — two
  // edges naming the SAME concept always share one `conceptKey` by
  // construction (`evidence-edge/build.ts` resolves it from the same
  // `ConceptRecord`), so grouping by key or by name partitions identically in
  // the honest case; grouping by key is what stays correct if two distinct
  // vocabulary strings ever resolved to the same record (never today, but the
  // key is the actual identity and the name is not).
  const edgesByConcept = new Map<string, ConceptAssessmentEdge[]>();
  for (const edge of edgesForCourse) {
    const list = edgesByConcept.get(edge.conceptKey);
    if (list === undefined) edgesByConcept.set(edge.conceptKey, [edge]);
    else list.push(edge);
  }

  const entries: ConceptPriority[] = [];
  const vetoedConcepts: OracleVetoedConcept[] = [];
  for (const [conceptKey, edges] of edgesByConcept) {
    // Every edge in this group shares one conceptName by construction (see
    // above) — restated from the first for display purposes only.
    const conceptName = edges[0]?.conceptName ?? conceptKey;

    const outcomes = edges.map((edge) =>
      buildEdgeOutcome(edge, assessmentsByPath.get(edge.assessmentPath), asOf, resolved),
    );
    const vetoedEdges = outcomes
      .filter((o): o is Extract<EdgeOutcome, { kind: 'vetoed' }> => o.kind === 'vetoed')
      .map((o) => o.vetoedEdge)
      .sort(compareVetoedEdges);
    const survivingEdges = edges.filter((_, index) => outcomes[index]?.kind === 'contribution');
    const contributions = outcomes
      .filter((o): o is Extract<EdgeOutcome, { kind: 'contribution' }> => o.kind === 'contribution')
      .map((o) => o.contribution)
      .sort(compareContributions);

    if (contributions.length === 0) {
      // C5.10: "a veto removes the concept from consideration" — every edge
      // this concept had was disqualified, so no `ConceptPriority` is built
      // for it. Reported here rather than silently absent from `ranked`.
      vetoedConcepts.push({ conceptName, conceptKey, vetoedEdges });
      continue;
    }

    const preMasteryScore = contributions.reduce((sum, c) => sum + c.contribution, 0);
    const masteryState = resolveMasteryState(mastery, conceptKey);
    const masteryNeedWeight = resolved.masteryNeedWeight[masteryState];
    const retrievabilityWeight = resolveRetrievabilityWeight(retrievability, conceptKey);
    // Citations reflect only SURVIVING evidence — a vetoed edge contributed
    // nothing to this concept's score, so its citations are not offered as
    // evidence for it either (reasoning matches what actually drove it).
    const citations = unionCitations(survivingEdges);
    const distinctSourceCount = new Set(citations.map((c) => c.sourcePath)).size;
    // `[D-226]` ruling 2's own-basis sibling — computed the same way, from
    // the same SURVIVING edges, never mixed with the past-paper pair above.
    const objectivesCitations = unionObjectivesCitations(survivingEdges);
    const distinctObjectivesSourceCount = new Set(objectivesCitations.map((c) => c.sourcePath))
      .size;

    const factors: OracleConceptFactors = {
      citations,
      distinctSourceCount,
      objectivesCitations,
      distinctObjectivesSourceCount,
      contributions,
      vetoedEdges,
      preMasteryScore,
      masteryState,
      masteryNeedWeight,
      // `exactOptionalPropertyTypes` — the key must be OMITTED, not set to
      // `undefined`, for absence to read the same way an object literal
      // that never mentioned this field would (see the field's own doc).
      ...(retrievabilityWeight !== undefined ? { retrievabilityWeight } : {}),
      // Neutral (1) exactly when no eligible retrievability evidence was
      // supplied for this concept — the blend's own default, applied here
      // rather than baked into `retrievabilityWeight` itself so the stored
      // factor can stay absent (see `resolveRetrievabilityWeight`'s doc).
      priorityScore: preMasteryScore * masteryNeedWeight * (retrievabilityWeight ?? 1),
    };

    entries.push({
      conceptName,
      conceptKey,
      course,
      rank: 0, // assigned below, after sorting
      priorityScore: factors.priorityScore,
      factors,
      citations,
      reasoning: buildReasoning(conceptName, course, factors),
    });
  }

  entries.sort((a, b) => {
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    // C5.10 ruling 1 (`[D-265]`) — fires ONLY inside an exact tie the blend
    // above already produced. A concept flagged eligible is served ahead of
    // a tied concept that is not; absence (either field entirely) reads as
    // "tidy", falling through to the ordinary name-ascending tie-break
    // unchanged. See this file's module doc, "The comparable-observation
    // tiebreak", for why the eligibility check itself is not this module's.
    const aEligible = tiebreakEligible?.has(a.conceptKey) ?? false;
    const bEligible = tiebreakEligible?.has(b.conceptKey) ?? false;
    if (aEligible !== bEligible) return aEligible ? -1 : 1;
    return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
  });
  const ranked = entries.map((entry, index) => ({ ...entry, rank: index + 1 }));
  // Deterministic order — same reason `ranked` sorts, so two calls with the
  // same input produce byte-identical output (the purity/rebuild property).
  vetoedConcepts.sort((a, b) =>
    a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0,
  );

  return { course, status: 'ranked', ranked, vetoedConcepts };
}

/**
 * F4.2's ranking, computed fresh from `input` every time — no cache, no
 * clock, no I/O. See this file's module doc for the scoring shape and the
 * abstain rule.
 */
export function rankOracle(input: RankOracleInput & RankOracleTiebreakInput): RankOracleResult {
  const asOfDate = dateFromCalendarDay(input.asOf);
  if (asOfDate === null) {
    throw new Error(
      `rankOracle: asOf must be a YYYY-MM-DD calendar day, got ${JSON.stringify(input.asOf)}`,
    );
  }
  const resolved = resolveOptions(input.options);

  const assessmentsByPath = new Map<VaultPath, AssessmentRecord>();
  for (const record of input.evidence.assessmentsRead.records) {
    assessmentsByPath.set(record.path, record);
  }

  const coursesInOrder: string[] = [];
  const seenCourses = new Set<string>();
  for (const record of input.evidence.assessmentsRead.records) {
    if (record.course === undefined) continue;
    if (seenCourses.has(record.course)) continue;
    seenCourses.add(record.course);
    coursesInOrder.push(record.course);
  }
  coursesInOrder.sort();

  const edgesByCourse = new Map<string, ConceptAssessmentEdge[]>();
  for (const edge of input.evidence.edges) {
    const list = edgesByCourse.get(edge.course);
    if (list === undefined) edgesByCourse.set(edge.course, [edge]);
    else list.push(edge);
  }

  const noEvidenceByCourse = new Map<string, VaultPath[]>();
  for (const path of input.evidence.assessmentsWithNoEvidence) {
    const course = assessmentsByPath.get(path)?.course;
    if (course === undefined) continue;
    const list = noEvidenceByCourse.get(course);
    if (list === undefined) noEvidenceByCourse.set(course, [path]);
    else list.push(path);
  }

  const courses = coursesInOrder.map((course) =>
    rankOneCourse(
      course,
      edgesByCourse.get(course) ?? [],
      noEvidenceByCourse.get(course) ?? [],
      assessmentsByPath,
      input.mastery,
      input.retrievability,
      asOfDate,
      resolved,
      input.tiebreakEligible,
    ),
  );

  return {
    courses,
    unattributableAssessments: input.evidence.assessmentsRead.records
      .filter((r) => r.course === undefined)
      .map((r) => r.path)
      .sort(),
    asOf: input.asOf,
  };
}
