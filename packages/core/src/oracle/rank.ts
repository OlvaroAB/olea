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
 * ## `[D-404]`: a concept's veto fires once no eligible practice instrument remains
 *
 * D-404 rules that a concept is vetoed only when it HAS practice
 * instruments and none of them is eligible (suspended or withdrawn by her,
 * note missing, cited passage changed or pending revalidation) — one
 * suspended instrument never removes a concept that still has an eligible
 * one, and a concept with no instruments yet is never vetoed by this rule.
 * An instrument is a practice item on the concept (a card, a quiz item),
 * never an assessment: a concept↔assessment edge is exam evidence, and one
 * assessment typically carries many concepts. So the input is keyed by
 * CONCEPT ({@link RankOracleEligibilityInput}, below): per `conceptKey`, the
 * concept's instruments and each one's eligibility. {@link conceptEligibilityVeto}
 * rolls that list up to one verdict per concept, and when it vetoes, every
 * edge of that concept is removed with the veto's reason — the existing
 * "no surviving contributions ⇒ the concept is vetoed" rule
 * (`rankOneCourse`) then reports it in `vetoedConcepts`, with the reason on
 * `OracleVetoedConcept.eligibilityVeto` too. A concept with at least one
 * eligible instrument ranks EXACTLY as it would with no eligibility input
 * at all: suspending a card is a statement about that card, and the
 * session's own fill already skips it. No other concept is touched, even
 * one that shares every assessment with the vetoed one. This is purely a
 * function of the current call — nothing here is recorded against her, and
 * a concept un-vetoes itself the moment one of its instruments reads
 * eligible again.
 *
 * (Corrected by `ol-egov.141.89.10.5`: the first wiring of this input keyed
 * it by `assessmentPath`, so marking a concept's instrument ineligible
 * removed that ASSESSMENT's edge from every concept it examines, and a
 * concept with one of two assessments marked lost that assessment's share of
 * its relevance. The concept-keyed input replaces it; no production caller
 * had passed the old one.)
 *
 * ## The scoring shape, and where its weights actually come from
 *
 * For each SURVIVING (non-vetoed) concept↔assessment edge, this module
 * computes a `contribution` — how strongly that one assessment's evidence
 * says the concept will be examined — from three signals, each normalized to
 * roughly `[0, 1]`:
 *
 *   contribution = yieldScore * confidence * assessmentWeightScore
 *
 * A concept's `preMasteryScore` is the **sum** of its contributions across
 * every surviving assessment that has an edge to it in the same course — a
 * concept examined by three assessments accumulates more relevance than one
 * examined by a single low-weight quiz, which is the plain reading of
 * "likelihood and weight of examination" (F4.2).
 *
 * **Proximity is not in that product (`[D-410]`, `ol-egov.141.89.10.82`).**
 * It used to be a fourth factor inside every edge's contribution, so an
 * assessment with no date (proximity 0) took that edge's whole evidence to
 * zero, and a concept whose evidence sat only on undated assessments ranked
 * at relevance exactly 0 — below a concept with no evidence at all. C5.10
 * ("no factor takes another to zero") and `[D-329]` rule that out. Each
 * edge still reports its own `examProximityScore`; the concept's
 * {@link OracleProximityFactors.proximityScore} is the HIGHEST of those
 * across its surviving edges — how soon the soonest dated assessment that
 * examines it falls — and it enters the blend as its own term. A missing or
 * unreadable date scores 0 on that edge and so adds nothing to the term (it
 * can never outrank a real deadline, `pln.md` §2.1), while the edge's
 * evidence still counts in full toward relevance. A concept with no dated
 * edge, and a `[D-329]` concept with no edge at all, has proximity 0. The
 * final `priorityScore` is the blend, described in the next section.
 *
 * ## The `[D-332]` blend (`ol-egov.141.89.10.78`)
 *
 *   priorityScore = w_relevance * preMasteryScore + w_need * needOrderingInput
 *                 + w_proximity * proximityScore          (`[D-410]`)
 *
 * **The terms add; nothing multiplies them.** C5.10 names the
 * all-multiplying formula as the shape it rules out, and the one this
 * replaced was that shape: relevance × a stage-keyed ladder × current
 * recall, under which the less she recalled a concept the LOWER it ranked,
 * and a faded concept at the top stage was held down twice (by the 0.15
 * rung and by its low recall). `[D-332]` rules the need input:
 *
 *  - **need rises as current recall falls**: `need = 1 − recall`, the
 *    weakest eligible recall-tier instrument's probability now
 *    (`RankOracleInput.retrievability`, produced by `./compose.ts` from
 *    `readAllConceptReadiness`) — the same value `../mastery/attainment.ts`'s
 *    `readNeed` computes;
 *  - **demand-aware readiness replaces recall when supplied**
 *    ({@link RankOracleNeedInput.demandAwareReadiness}): `need = 1 −
 *    readiness`, and recall is then NOT read — readiness already
 *    incorporates it, so recall is counted once (`[D-332]`'s check,
 *    `pln.md` §5 R11);
 *  - **no reading is unknown need** (`[D-348]`): `need` is absent (never a
 *    number), `needBasis` is `'unknown'`, and the blend orders it at the
 *    declared provisional maximum `UNKNOWN_NEED_VALUE` (1) — a ranking
 *    mechanism about what she has not yet shown, never a reading of her
 *    knowledge, and never worded as weakness (registry §22). This is
 *    `[D-332]`'s explicit starting policy for a learner with no history;
 *  - **the growth stage never enters** (`[D-281]`: the stage records what
 *    happened and never predicts now). `masteryState` and
 *    `masteryNeedWeight` are still reported, because the delivered envelope
 *    still carries the ladder, and move nothing.
 *
 * The weights are `RankOracleOptions.blendWeights`, or
 * {@link DECLARED_FALLBACK_BLEND_WEIGHTS}; a supplied object without a
 * `proximity` weight (the `[D-332]` two-weight shape, see
 * {@link RankBlendWeightsWithProximity}) takes the declared proximity weight.
 * Only their ratios change the order. **How the uncertainty factor enters**
 * (`pln.md` §2.1's remaining term, the evidence volume behind relevance and
 * need): it does not — no ruling states it, and the shipped ranking never
 * had one; recorded as such in the planning targets manifest before any
 * held-out read.
 *
 * **Two outputs, named apart (`ol-v7r5.55` [IL-D7]; see `./types.ts`'s own
 * section of that name for the full argument).** `preMasteryScore` IS
 * assessment relevance — the evidence question, "how strongly does this
 * concept's evidence say it will be examined," computed only from the
 * assessment side and never from anything about her. `priorityScore` IS
 * learner priority — that relevance blended with her current need, the
 * policy question of how much of her time it should get. Naming stays
 * doc-only (no field renamed, so `./compose.ts` and every plugin caller keep
 * reading `priorityScore` unchanged): a caller that wants relevance alone
 * reads `preMasteryScore` directly rather than trying to take it back out of
 * `priorityScore`, which is exactly the reasoning that risks counting need
 * twice under two different names (`./gap/build.ts`'s `GapRow.assessmentRelevance` does this for the
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
 * ## The abstain path, and `[D-329]`'s "unknown relevance" exception
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
 * what this module must not undo — **when the caller supplies no
 * {@link RankOracleCourseConceptsInput.courseConcepts}**, which is every
 * scope and coverage caller, so this path is byte-identical to before for
 * them. The one production supplier is `./compose.ts`'s
 * `serveCoursesWithoutAssessmentsOnNeed` (`ol-76pt`, `[D-373]`), opted into
 * by the session composition only, and only for a course with no
 * assessment record at all.
 *
 * `[D-329]` (`ol-egov.141.89.10.8`, proposal 2) rules that abstaining is the
 * wrong answer once a concept's course membership is known independently of
 * its assessment evidence (`SCP`/`CPT`'s job, not this module's): "unknown
 * relevance stays unknown rather than low", and a course with no assessment
 * evidence anywhere is served **on need alone** rather than refused. A
 * caller that supplies `courseConcepts` for a course opts that course INTO
 * this: a concept in the map with no real edge — `edgesByConcept` never
 * gained an entry for it, whether because the course has no edges at all or
 * because this ONE concept has none while its course-mates do (the R2
 * "concept with no evidence edge in a course that has some" half of the
 * proposal) — is still ranked, via {@link buildUnknownRelevanceEntry}: its
 * relevance reads {@link DECLARED_FALLBACK_UNKNOWN_RELEVANCE}, never `0`
 * (which would silence it exactly as C5.10 already names a defect) and
 * never the scale's top (which would let the ABSENCE of evidence win over a
 * concept with real, weighted evidence — proposal 2's own mirror-image
 * worry). It is flagged implicitly, not by a new stored field this module
 * cannot add without editing `./types.ts` (outside this bead's one owned
 * file, `ol-egov.141.89.10.4`'s `owns`): a synthesized entry is the only
 * `ConceptPriority` this module ever builds with both `factors.contributions`
 * and `factors.citations` empty — every concept surviving from a real edge
 * always has at least one non-empty basis (`evidence-edge/build.ts`'s
 * "evidential, not membership" rule) — so `contributions.length === 0 &&
 * (factors.vetoedEdges ?? []).length === 0` is a safe, exhaustive test a
 * caller (this chain's harness, or a future producer) can use to tell a
 * `[D-329]` entry apart from an ordinary one, and is exactly what
 * `scripts/harness/ilb-pln/` reads it through.
 *
 * A course present in `courseConcepts` with a concept universe of size zero
 * (known to exist, no concepts named for it yet) is served on need alone
 * with an EMPTY `ranked` array rather than abstaining — `status: 'ranked'`,
 * not `'abstained'`, is itself the signal that this course was not refused.
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
  ConceptEvidenceBasis,
  EvidenceObjectivesCitation,
  EvidenceQuestionCitation,
} from '../evidence-edge/types.js';
import { type NeedBasis, UNKNOWN_NEED_VALUE } from '../mastery/attainment.js';
import type { VaultPath } from '../vault/types.js';
import type {
  ConceptPriority,
  CourseOracleRanking,
  DueDateReadIssue,
  EdgeVetoReason,
  InstrumentEligibilityVetoReason,
  OracleConceptFactors,
  OracleEdgeContribution,
  OracleMasteryState,
  OracleProximityFactors,
  OracleVetoedConcept,
  OracleVetoedEdge,
  RankBlendWeightsWithProximity,
  RankOracleInput,
  RankOracleOptions,
  RankOracleResult,
} from './types.js';

// Re-exported for compatibility: `OracleProximityFactors` and
// `RankBlendWeightsWithProximity` used to be declared in this module
// (`[D-410]`) and are imported from `'./rank.js'` elsewhere (`./rank.spec.ts`,
// outside this bead's owns); they now live in `./types.js`, next to the
// `[D-332]` `RankBlendWeights` the second extends.
export type { OracleProximityFactors, RankBlendWeightsWithProximity } from './types.js';

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
 * `buildReasoning` then rendered this score at two decimal places and nearly every
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
 * `masteryNeedWeight`. **Reported only since `[D-332]`**: the ladder left the
 * blend (module doc, "The `[D-332]` blend") and this value now moves no
 * order; it stays because the delivered envelope still carries the ladder.
 * Its original **plain-English defense:** the ladder only has to be
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
 * DECLARED (`[D-329]`, `ol-egov.141.89.10.8`) — the relevance
 * ({@link OracleConceptFactors.preMasteryScore}) a concept reads when the
 * caller knows it belongs to the course but no assessment edge names it at
 * all, or the course has no assessment evidence anywhere.
 *
 * **Plain-English defense of 1/8 (`[D-410]`, `ol-egov.141.89.10.82`):** a
 * concept with no evidence yet is placed as if one assessment examined it at
 * the middle of each of relevance's three factors — a yield score of 1/2
 * (the second most salient concept), confidence 1/2, and half the course
 * grade — so `(1/2)³`. Not `0`, which would read "no evidence yet" as
 * "nothing to examine here" (`[D-329]` names that defect); low enough that
 * the ABSENCE of evidence does not outrank middling real evidence at equal
 * need (the mirror defect). It is a pin, not a fit: the development-set sweep
 * of this constant jointly with the three blend weights (`olea-service`,
 * `findings/ilb-pln-blend-sweep.md`) found every invariant holding for any
 * value strictly between 0 and the relevance its constructed evidenced
 * concepts carry (0.3), at every weight tried, and cannot choose inside that
 * band. It was 0.5, which outranked that evidence at every weight. Frozen in
 * the planning targets manifest before the held-out set is read; a
 * provisional baseline, revisited when her assessment records carry grade
 * weights into the ranking (the scale a real edge's relevance then runs on).
 */
const DECLARED_FALLBACK_UNKNOWN_RELEVANCE = 0.125;

/**
 * DECLARED FALLBACK (`[D-332]`, `ol-egov.141.89.10.78`; the proximity weight
 * `[D-410]`, `ol-egov.141.89.10.82`) — the blend weights used when
 * `options.blendWeights` is absent, which is every caller until the
 * `rank-weights` envelope carries them. **Plain-English defense:** equal
 * weights on three terms that each run over roughly `[0, 1]` — one edge's
 * contribution, need, and proximity — so neither the evidence that a concept
 * will be examined, nor how much of it she currently owes, nor how soon it
 * is examined counts for more than the others, and nothing of hers yet says
 * otherwise. It is a pin, not a fit: the development-set sweep (`olea-service`,
 * `findings/ilb-pln-blend-sweep.md`), run jointly with the declared middle
 * relevance, found every invariant holding across the whole grid of both
 * weight ratios (four orders of magnitude either side of equal) and failing
 * only where a term becomes numerically invisible, so the data rules those
 * ends out and cannot choose inside. Frozen in the planning targets manifest
 * before the held-out set is read; a provisional baseline, revisited when one
 * term of her review log exists (`[D-332]`).
 */
const DECLARED_FALLBACK_BLEND_WEIGHTS: RankBlendWeightsWithProximity = {
  relevance: 1,
  need: 1,
  proximity: 1,
};

/**
 * `[D-410]` — the blend's three weights, and the per-concept proximity term:
 * `RankBlendWeightsWithProximity` and `OracleProximityFactors`, both typed in
 * `./types.js` now (moved there, `ol-egov.141.89.10.82` follow-up), next to
 * the `[D-332]` two-weight `RankBlendWeights` they extend/accompany.
 */

/**
 * `[D-329]` — additive to `RankOracleInput`, typed HERE (not `./types.js`)
 * for the same reason {@link RankOracleTiebreakInput} is: this bead owns only
 * `rank.ts`. Omitted entirely — every caller but the session composition's
 * `./compose.ts` opt-in (`ol-76pt`) — the abstain path and per-concept
 * invisibility for a no-edge concept are BYTE-IDENTICAL to before this
 * decision; see the module doc's "The abstain path, and `[D-329]`'s
 * 'unknown relevance' exception".
 */
export interface RankOracleCourseConceptsInput {
  /**
   * Course id to that course's known concept universe (`conceptKey` →
   * `conceptName`), independent of assessment evidence — `SCP`/`CPT`'s job
   * to supply, never re-derived here from `input.evidence`. A course key
   * present here (even with an empty inner map) opts that course INTO
   * `[D-329]`'s "served on need alone" reading instead of abstaining. A
   * concept key present here that already has a real edge is a no-op: the
   * real edge's ordinary contribution wins, never overridden or duplicated.
   */
  readonly courseConcepts?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

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

/**
 * `[D-404]` — one practice instrument on a concept, and whether it can be
 * served now, per the planning spec's instrument eligibility table
 * (`pln.md` §4). `ineligible` absent means eligible.
 *
 * **Two reported reasons, not four or five** (`EdgeVetoReason`'s own
 * union): `'suspended'` when the cause is her own suspension or withdrawal
 * (both write the same `suspend` event, `../review-log/suspension.ts`) —
 * the one cause `pln.md`'s R4 target names by that exact word — and
 * `'instrument-ineligible'` for every other named cause (note missing,
 * cited passage changed, pending revalidation), kept apart from
 * `'suspended'` on purpose: reporting a changed citation AS "suspended"
 * would misname what actually happened.
 */
export interface ConceptInstrumentEligibilityFact {
  readonly instrumentId: string;
  readonly ineligible?: InstrumentEligibilityVetoReason;
}

/**
 * `[D-404]` — additive to `RankOracleInput`, typed HERE for the same reason
 * {@link RankOracleCourseConceptsInput}/{@link RankOracleTiebreakInput} are.
 * Keyed by `conceptKey` (the opaque join key edges and mastery use,
 * `ol-63e1`): the concept's practice instruments, each with its
 * eligibility. See the module doc's `[D-404]` section for the rule and
 * {@link conceptEligibilityVeto} for the rollup.
 *
 * **Absence is neutral, never a veto** — a concept missing from this map,
 * or present with an empty list (no instruments yet: "not built yet", kept
 * apart from "built and not eligible", `[D-404]` condition 4), or the map
 * omitted entirely (the gap view and the note offer, which read the
 * ranking for scope and coverage, `[D-404]` condition 3), reads as not
 * vetoed — the same "an absent signal never silently reads as the worst
 * case" rule this file applies throughout.
 *
 * **Production caller:** `./compose.ts`'s `composeOracleRanking`, which
 * builds this map from its caller's instrument inventory and the review
 * log's suspension fold (`ol-egov.141.89.10.5`).
 */
export interface RankOracleEligibilityInput {
  readonly conceptInstrumentEligibility?: ReadonlyMap<
    string,
    readonly ConceptInstrumentEligibilityFact[]
  >;
}

/**
 * `[D-332]` — additive to `RankOracleInput`, typed HERE for the same reason
 * the other additive inputs above are. Keyed by `conceptKey`.
 */
export interface RankOracleNeedInput {
  /**
   * Per-concept demand-aware readiness in `[0, 1]` (`ol-v7r5.65`'s reading:
   * the concept's current readiness for the operation its assessment
   * demands). **When present for a concept, need reads it and NOT current
   * recall** — readiness already incorporates recall, so reading both would
   * count it twice (`[D-332]`'s clarification). Absent, or a concept missing
   * from it, falls back to current recall, then to unknown.
   *
   * **No production caller supplies it yet**: `./compose.ts` would fold it
   * from `../gap/demand.ts`'s producer; that splice is a follow-on bead.
   */
  readonly demandAwareReadiness?: ReadonlyMap<string, number>;
}

interface ResolvedOptions {
  readonly proximityHalfLifeDays: number;
  readonly assessmentWeightDivisor: number;
  readonly masteryNeedWeight: Readonly<Record<OracleMasteryState, number>>;
  readonly blendWeights: RankBlendWeightsWithProximity;
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
  const supplied = options?.blendWeights as Partial<RankBlendWeightsWithProximity> | undefined;
  const blendWeights: RankBlendWeightsWithProximity =
    supplied === undefined
      ? DECLARED_FALLBACK_BLEND_WEIGHTS
      : {
          relevance: supplied.relevance as number,
          need: supplied.need as number,
          proximity: supplied.proximity ?? DECLARED_FALLBACK_BLEND_WEIGHTS.proximity,
        };
  for (const term of ['relevance', 'need', 'proximity'] as const) {
    const value = blendWeights[term];
    // Above zero, and finite: a zero weight makes its term decoration, which
    // is exactly the endpoint the development-set sweep rules out.
    if (!(Number.isFinite(value) && value > 0)) {
      throw new Error(`rankOracle: blendWeights.${term} must be finite and > 0, got ${value}`);
    }
  }
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
  return { proximityHalfLifeDays, assessmentWeightDivisor, masteryNeedWeight, blendWeights };
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
 * C5.10's due-date veto, structurally separated from the weighted blend
 * below: "A short list of facts that genuinely disqualify a concept act as
 * vetoes... A veto removes the concept from consideration and is not a
 * weight." This is the DATE-DERIVED half only — see
 * {@link conceptEligibilityVeto} just below for the concept-level
 * eligibility half `[D-404]` wired in.
 *
 *  - `'assessment-passed'` — `daysUntilDue < 0`. Wired here. A passed
 *    assessment cannot inform *future* study priority, whatever its
 *    evidence, so it is REMOVED from the blend rather than merely scored
 *    low — previously this floored `examProximityScore` to 0 in place (a
 *    weight indistinguishable from any other), which is exactly the
 *    gate-that-should-have-been-a-weight-or-vice-versa confusion C5.10 warns
 *    against; separating it here is this bead's structural half.
 *  - `'out-of-course-scope'` — **still reserved, not wired.** Not an input
 *    `rankOracle` receives today: it is SCP's declared-course-scope
 *    mechanism, unrelated to instrument eligibility, and no producer
 *    threads it into `RankOracleInput` yet. Guessing a mapping from
 *    `AssessmentRecord.status` free text (`../assessment/types.js`) would be
 *    inventing contract vocabulary this module does not own; wiring it is a
 *    reachability gap for a follow-on bead, tracked structurally by
 *    `EdgeVetoReason` already naming it so a producer has somewhere to
 *    report into.
 *  - `'suspended'` / `'instrument-ineligible'` — **wired, `[D-404]`,** via
 *    {@link conceptEligibilityVeto} and {@link RankOracleEligibilityInput},
 *    not here: a fact about the concept's practice instruments, rolled up
 *    from `../review-log/suspension.ts`'s per-instrument projection by
 *    `./compose.ts`, and applied to every edge of that concept.
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
 * `[D-404]` — the concept-level eligibility veto, rolled up from the
 * concept's own practice instruments (see {@link RankOracleEligibilityInput}'s
 * doc for what "ineligible" means and why absence is never a veto). Vetoes
 * only when the concept has at least one instrument and every one of them
 * is ineligible; the reason is `'suspended'` when every instrument is
 * ineligible by her own suspension or withdrawal, and
 * `'instrument-ineligible'` as soon as any other cause is among them.
 * Returns `null` — not vetoed — for `undefined` (no inventory known) and
 * for an empty list (no instruments yet, `[D-404]` condition 4).
 *
 * Independent of {@link checkEdgeVeto}: that one is a date fact about one
 * edge, this one a fact about the concept, applied to every edge of it.
 */
export function conceptEligibilityVeto(
  facts: readonly ConceptInstrumentEligibilityFact[] | undefined,
): InstrumentEligibilityVetoReason | null {
  if (facts === undefined || facts.length === 0) return null;
  let everyOneSuspended = true;
  for (const fact of facts) {
    if (fact.ineligible === undefined) return null;
    if (fact.ineligible !== 'suspended') everyOneSuspended = false;
  }
  return everyOneSuspended ? 'suspended' : 'instrument-ineligible';
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
 * unparseable rather than merely absent). Since `[D-410]` this score is no
 * longer a factor of the edge's `contribution`: it feeds only the concept's
 * own proximity term (the highest across its edges, `conceptProximityScore`),
 * so scoring 0 adds nothing to that term and leaves the edge's evidence
 * counting in full toward relevance.
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
 * apply a real policy zero rather than a measured one. Since `[D-332]` the
 * blend reads this only through {@link resolveNeed} (need = 1 − recall), and
 * absence there is unknown need, ordered at the declared provisional
 * maximum — never a gate, per C5.10 ("retrievability is a signal, never a
 * gate").
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

/** `[D-332]` need for one concept, with its `[D-348]` basis and the value the blend orders by. */
interface NeedResolution {
  readonly need?: number;
  readonly needBasis: NeedBasis;
  readonly needSource?: 'current-recall' | 'demand-aware-readiness';
  readonly needOrderingInput: number;
}

/**
 * `[D-332]`'s need input — see the module doc's "The `[D-332]` blend".
 * Demand-aware readiness first (and then recall is not read), current
 * recall second, unknown last. Unknown carries NO `need` number: its
 * ordering input is the declared provisional maximum, for ordering only.
 */
function resolveNeed(
  retrievabilityWeight: number | undefined,
  demandAwareReadiness: ReadonlyMap<string, number> | undefined,
  conceptKey: string,
): NeedResolution {
  const readiness = demandAwareReadiness?.get(conceptKey);
  if (readiness !== undefined) {
    if (!(Number.isFinite(readiness) && readiness >= 0 && readiness <= 1)) {
      throw new Error(
        `rankOracle: demandAwareReadiness.${conceptKey} must be within [0, 1], got ${readiness}`,
      );
    }
    const need = 1 - readiness;
    return {
      need,
      needBasis: 'estimated',
      needSource: 'demand-aware-readiness',
      needOrderingInput: need,
    };
  }
  if (retrievabilityWeight !== undefined) {
    const need = 1 - retrievabilityWeight;
    return { need, needBasis: 'estimated', needSource: 'current-recall', needOrderingInput: need };
  }
  return { needBasis: 'unknown', needOrderingInput: UNKNOWN_NEED_VALUE };
}

/** `[D-332]`'s blend with `[D-410]`'s proximity term: the three terms add, weighted; see the module doc. */
function blendPriority(
  relevance: number,
  needOrderingInput: number,
  proximityScore: number,
  weights: RankBlendWeightsWithProximity,
): number {
  return (
    weights.relevance * relevance +
    weights.need * needOrderingInput +
    weights.proximity * proximityScore
  );
}

/**
 * `[D-410]` — the concept's proximity term: the highest `examProximityScore`
 * across its surviving contributions (see {@link OracleProximityFactors}).
 * The soonest dated assessment, not a sum: how many assessments examine the
 * concept is already counted once, by relevance.
 */
function conceptProximityScore(contributions: readonly OracleEdgeContribution[]): number {
  return contributions.reduce((max, c) => Math.max(max, c.examProximityScore), 0);
}

/** Deterministic order for `vetoedEdges`, matching `compareContributions`'s tie-break so purity/rebuild equivalence holds regardless of `Map` iteration order. */
function compareVetoedEdges(a: OracleVetoedEdge, b: OracleVetoedEdge): number {
  return a.assessmentPath < b.assessmentPath ? -1 : a.assessmentPath > b.assessmentPath ? 1 : 0;
}

/**
 * `(assessmentPath, basis)` — `./types.js`'s own words for `assessmentPath`
 * ("the natural key, matching how the rest of this package identifies a
 * note-backed record"), paired with `basis` because `evidence-edge/build.ts`
 * deliberately gives one concept TWO edges on the SAME assessment when both
 * a past-paper and an objectives source cite it (`[D-226]` ruling 2) — those
 * are genuinely different evidence and must both survive. `basis` defaults
 * to `'past-paper'` exactly as `ConceptAssessmentEdge.basis`'s own doc states,
 * so an edge that never set the field still gets a stable identity.
 */
function edgeIdentity(edge: ConceptAssessmentEdge): string {
  return `${edge.assessmentPath}\u0000${edge.basis ?? 'past-paper'}`;
}

/**
 * R5 (`pln.md` §5, `ol-egov.141.89.10.4` part 3) — a verbatim-duplicate edge
 * (same concept, same {@link edgeIdentity}) is dropped rather than counted
 * twice toward `preMasteryScore`. **This is deduplication of an accidental
 * repeat, never a combination rule for genuinely distinct evidence**: two
 * edges that name different assessments (or the same assessment under
 * different bases) keep their own separate contributions and still sum, per
 * this file's "accumulation across multiple assessments" section — only an
 * exact repeat of the same edge identity is collapsed, keeping the first
 * occurrence (repeats are byte-identical by construction, so which copy
 * survives is never observable).
 */
function dedupeVerbatimEdges(
  edges: readonly ConceptAssessmentEdge[],
): readonly ConceptAssessmentEdge[] {
  const seen = new Set<string>();
  const deduped: ConceptAssessmentEdge[] = [];
  for (const edge of edges) {
    const identity = edgeIdentity(edge);
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(edge);
  }
  return deduped;
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
  // `[D-404]`: this edge's CONCEPT's eligibility veto, already rolled up by
  // `conceptEligibilityVeto`; `null` keeps this byte-identical to before.
  conceptVeto: InstrumentEligibilityVetoReason | null,
): EdgeOutcome {
  const { daysUntilDue, dueDateIssue } = resolveDueTiming(asOf, assessment?.due);
  const dateVeto = checkEdgeVeto(daysUntilDue);
  if (dateVeto !== null) {
    return {
      kind: 'vetoed',
      vetoedEdge: { assessmentPath: edge.assessmentPath, reason: dateVeto.reason, daysUntilDue },
    };
  }
  if (conceptVeto !== null) {
    return {
      kind: 'vetoed',
      vetoedEdge: { assessmentPath: edge.assessmentPath, reason: conceptVeto, daysUntilDue },
    };
  }
  const yieldScore = computeYieldScore(edge.yieldRank);
  const weight = computeAssessmentWeightScore(assessment?.weight, resolved.assessmentWeightDivisor);
  const examProximityScore = computeExamProximityScore(
    daysUntilDue,
    resolved.proximityHalfLifeDays,
  );
  const evidenceStrength = yieldScore * edge.confidence;
  // `[D-410]`: proximity is reported on the edge and blended as its own
  // term (`conceptProximityScore`), never multiplied in here — an undated
  // assessment's evidence counts in full.
  const contribution = evidenceStrength * weight.score;
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
 * `[D-417]` (ruled 2026-09-28) and rows 32 and 33 of
 * `docs/direction/20260929_decision_sheet_responses.md` (ruled 2026-09-29),
 * `ol-egov.141.89.10.92`: the phrases the ranking reason is built from. **Signed** 2026-09-30 (decision
 * sheet 19; registry section 29, `docs/design/copy-pass-2026-09/planning-sentences.md` in the
 * service repo). A re-wording may change the words, never which fact each one states.
 *
 * Each phrase states only what the ranking actually holds (rows 32 and 33):
 * - `need` is observed recall (a reading, from eligible recall evidence); `needUnknown` says there
 *   is none, and an unknown need is worded as unknown, never as a deficit (registry section 22,
 *   `[D-348]`). Wording follows the fact, not the planning benchmark: the benchmark reads the
 *   phrases each factor is declared to use (`scripts/harness/ilb-pln`), never a fixed word.
 * - `relevance` ("counts for more in your assessments") is used only when the concept's link to
 *   an assessment has a CURRENT basis (its objectives, or that assessment's own declared scope, a
 *   brief) and every such assessment has a recorded weight (`ol-egov.141.89.10.102`). A past-paper
 *   edge is history attached to every assessment in its course, so a link that is only that never
 *   carries the weight claim, whatever weights are recorded (row 32: "requires actual
 *   assessment-weight evidence"; row 33: historical evidence never becomes a prediction of
 *   current scope). Otherwise the reason describes what drove the ranking: `relevanceEvidence`
 *   when the assessment evidence alone is stronger (also the past-paper-only phrase),
 *   `relevanceAssumed` when the relevance edge exists only because an unrecorded weight is
 *   counted in full (a planning assumption, never evidence). A past-paper-only concept whose lead
 *   is not stronger evidence has no drafted phrase that is true of it, so its reason carries no
 *   because clause for relevance and the evidence sentence stands alone (the gap is recorded on
 *   `ol-egov.141.89.10.95`). `relevanceUnknown` is a concept with no assessment link: the middle
 *   place is a default, said to be one (`[D-329]`).
 * - `proximity` needs a date on both sides; `proximityDated` is the entry having one and the
 *   next concept not.
 * - Objectives: `evidenceObjectives` ("name it") only for an explicit name match;
 *   `evidenceObjectivesCovered` where alignment is semantic (row 33).
 *
 * No phrase carries a score, a decimal, a weight or a count (F8.3, F6.7; the registry's voice
 * rules keep engineering numbers out of a reason). Past-paper evidence is stated as history
 * ("appears in"), never as a prediction of current scope.
 */
export const RANK_REASON_PHRASES = Object.freeze({
  /** Need decided, from an observed reading (current recall, or the readiness fold, which today is that same recall). */
  need: 'Olea estimates your recall of it is lower',
  /** Need decided because this concept's need is unknown, ordered at `[D-348]`'s provisional maximum for ordering only. */
  needUnknown: 'there is no evidence yet of how well you recall it',
  /** Relevance decided, its link to an assessment is current (objectives or a brief), and every such assessment has a recorded weight. Never a past-paper-only link. */
  relevance: 'it counts for more in your assessments',
  /** Relevance decided, and the assessment evidence alone is stronger: where a current link's weight is not recorded, and for a concept linked only through past papers. */
  relevanceEvidence: 'the assessment evidence for it is stronger',
  /** Relevance decided only through an unrecorded weight counted in full: a planning assumption. */
  relevanceAssumed:
    'the weight of an assessment it appears in is not recorded, so it is counted in full',
  /** Relevance decided for a concept with no assessment link: it sits at `[D-329]`'s declared middle, a default. */
  relevanceUnknown: 'with no assessment link it is placed in the middle by default',
  /** Proximity decided: its soonest dated assessment is sooner (`[D-410]`). */
  proximity: 'its assessment comes sooner',
  /** Proximity decided because it has a dated assessment and the next concept has none. */
  proximityDated: 'it has a dated assessment and the next concept does not',
  /** The concept ties the next one exactly; `rankOneCourse`'s tie-break ordered them. */
  tie: 'is level with the next concept, and a fixed tie-break puts it first',
  /** Last of several ranked concepts: nothing below it to have been placed above. */
  last: 'is ranked last in this course',
  /** The course's only ranked concept. */
  only: 'is the only concept ranked in this course',
  /** Evidence sentences — what the relevance reading rests on, never how much of it. */
  evidencePastPapers: 'It appears in past papers.',
  /** An explicit name match in the objectives (row 33). */
  evidenceObjectives: 'Its course objectives name it.',
  /** Semantic alignment with the objectives (row 33). */
  evidenceObjectivesCovered: 'It is covered by the course objectives.',
  evidenceBoth: 'It appears in past papers, and its course objectives name it.',
  evidenceBothCovered: 'It appears in past papers, and it is covered by the course objectives.',
  evidenceOther: 'Its assessments point to it.',
  evidenceNone: 'It has no assessment evidence recorded yet.',
  /** Stated when need is unknown and the position clause has not already said so. */
  recallUnknown: 'How well you recall it is not known yet.',
});

/** A ranked entry as `rankOneCourse` builds it: its `factors` carry the proximity term and weights the reason reads. */
type RankedEntry = ConceptPriority & {
  readonly factors: OracleConceptFactors & OracleProximityFactors;
};

/** The three blended factors, in the blend's own order. */
type BlendFactor = 'relevance' | 'need' | 'proximity';

/** One blended term's weighted value for `factors` — exactly the addend `blendPriority` sums. */
function blendTerm(
  factor: BlendFactor,
  factors: OracleConceptFactors & OracleProximityFactors,
): number {
  const w = factors.blendWeights;
  switch (factor) {
    case 'relevance':
      return w.relevance * factors.preMasteryScore;
    case 'need':
      return w.need * (factors.needOrderingInput ?? UNKNOWN_NEED_VALUE);
    case 'proximity':
      return w.proximity * factors.proximityScore;
  }
}

/**
 * Which factors put `entry` above `next`, the concept ranked immediately after it, read from the
 * actual factor values. For each blended term the difference `term(entry) - term(next)` is taken;
 * a factor **favours** the entry when that difference is above zero. The priority difference is
 * the sum of the three, so an entry ranked strictly above `next` has at least one favouring
 * factor. `'tie'` when the two priority scores are equal: the blend put neither ahead and
 * `rankOneCourse`'s tie-break decided.
 *
 * **One factor decides exactly when it is the only one favouring the entry** — every other term
 * is equal or weighs against it, so without that one factor's difference the entry would not be
 * ahead. With two or more favouring, they decide jointly and all of them are named. Uncertainty is
 * not a term of the blend, so it is never named.
 */
export function decidingFactors(
  entry: OracleConceptFactors & OracleProximityFactors,
  next: OracleConceptFactors & OracleProximityFactors,
): readonly BlendFactor[] | 'tie' {
  if (entry.priorityScore === next.priorityScore) return 'tie';
  const favouring = (['relevance', 'need', 'proximity'] as const).filter(
    (factor) => blendTerm(factor, entry) > blendTerm(factor, next),
  );
  return favouring;
}

/**
 * The evidence sentence's own strength for a concept, without the weight: the sum of yield and
 * confidence across its surviving contributions. What "the assessment evidence for it is
 * stronger" is compared on.
 */
function evidenceStrengthOf(factors: OracleConceptFactors): number {
  return factors.contributions.reduce((sum, c) => sum + c.evidenceStrength, 0);
}

/**
 * The evidence bases whose link to an assessment is about her CURRENT term: an objectives
 * document and an assessment's own declared scope (a brief, `[D-247]`). A past-paper edge is
 * history: it says the concept appeared before, and the evidence-edge builder attaches it to every
 * assessment in its course (course-level coarse-graining), so it says nothing about how that
 * assessment weighs the concept (`[D-433]`: historical alignment can inform ranking without
 * becoming proof of current assessment scope).
 */
const CURRENT_EVIDENCE_BASES: ReadonlySet<ConceptEvidenceBasis> = new Set([
  'objectives',
  'assessment-brief',
]);

/** The assessments a concept has a surviving edge to whose basis is current, out of `edges`. */
function currentBasisAssessments(edges: readonly ConceptAssessmentEdge[]): ReadonlySet<VaultPath> {
  const paths = new Set<VaultPath>();
  for (const edge of edges) {
    if (CURRENT_EVIDENCE_BASES.has(edge.basis ?? 'past-paper')) paths.add(edge.assessmentPath);
  }
  return paths;
}

/**
 * The relevance phrase (rows 32 and 33): "counts for more in your assessments" only where a
 * CURRENT basis links the concept to an assessment and the weight of every such assessment is
 * recorded (`ol-egov.141.89.10.102`). Both halves are needed: the weight says how much the
 * assessment counts, the current basis says the concept is in it now. A past-paper-only link never
 * carries the claim: the past-paper edge attaches to every assessment in its course, so every
 * weight being recorded is not evidence that the concept is weighted by her assessments. An
 * unrecorded weight is counted in full (declared neutral, never a silent 0), which is a planning
 * assumption; a reason resting on it says what actually drove the ranking instead.
 *
 * `undefined` is a real answer: a concept linked only through past papers, ahead on the weights of
 * the assessments its history is attached to rather than on stronger evidence, has no drafted
 * phrase that is true of it (none is invented here), so its reason carries no clause for
 * relevance and the evidence sentence stands alone.
 *
 * @param currentLinks the assessments the concept has a current-basis edge to (`currentBasisAssessments`).
 */
function relevancePhrase(
  entry: OracleConceptFactors & OracleProximityFactors,
  next: OracleConceptFactors & OracleProximityFactors,
  currentLinks: ReadonlySet<VaultPath>,
): string | undefined {
  if (entry.contributions.length === 0) return RANK_REASON_PHRASES.relevanceUnknown;
  // Compared on the weight-free evidence strength (yield rank and confidence): the assessment
  // evidence is only called stronger when it is, with any weight taken out. An unlinked next
  // concept has none.
  const evidenceIsStronger = evidenceStrengthOf(entry) > evidenceStrengthOf(next);
  const currentContributions = entry.contributions.filter((c) =>
    currentLinks.has(c.assessmentPath),
  );
  if (currentContributions.length === 0) {
    return evidenceIsStronger ? RANK_REASON_PHRASES.relevanceEvidence : undefined;
  }
  if (currentContributions.every((c) => c.assessmentWeightKnown)) {
    return RANK_REASON_PHRASES.relevance;
  }
  return evidenceIsStronger
    ? RANK_REASON_PHRASES.relevanceEvidence
    : RANK_REASON_PHRASES.relevanceAssumed;
}

/** One factor's phrase, or `undefined` where no drafted phrase is true of it (only relevance, see {@link relevancePhrase}). */
function factorPhrase(
  factor: BlendFactor,
  entry: OracleConceptFactors & OracleProximityFactors,
  next: OracleConceptFactors & OracleProximityFactors,
  currentLinks: ReadonlySet<VaultPath>,
): string | undefined {
  switch (factor) {
    case 'need':
      return entry.needBasis === 'unknown'
        ? RANK_REASON_PHRASES.needUnknown
        : RANK_REASON_PHRASES.need;
    case 'relevance':
      return relevancePhrase(entry, next, currentLinks);
    case 'proximity':
      // A proximity of exactly 0 is an undated assessment (`computeExamProximityScore`): "sooner"
      // would compare a date with none.
      return next.proximityScore === 0
        ? RANK_REASON_PHRASES.proximityDated
        : RANK_REASON_PHRASES.proximity;
  }
}

/** The position clause's fixed head, before any because clause. */
const RANK_ABOVE_NEXT = 'is ranked above the next concept';

/** `a`, `a and b`, `a, b and c`. */
function joinPhrases(phrases: readonly string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? '';
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/**
 * How an objectives citation aligned the concept to the objectives: `'name'` for an explicit name
 * match, `'semantic'` for a reading-based alignment (`[D-432]`). **The only producer today is the
 * exact-name scan** (`tier3-evidence/build.ts`), so a citation that carries no marker is a name
 * match; the semantic alignment lane must set `alignment: 'semantic'` on the citations it adds, or
 * this reads them as names. Row 33: "objectives name it" is reserved for a name match.
 */
type ObjectivesAlignment = 'name' | 'semantic';

function objectivesAlignmentOf(factors: OracleConceptFactors): ObjectivesAlignment {
  const citations = (factors.objectivesCitations ?? []) as readonly {
    readonly alignment?: ObjectivesAlignment;
  }[];
  // Named when at least one citation is an explicit name match; covered only when every one is a
  // semantic alignment.
  return citations.some((c) => c.alignment !== 'semantic') ? 'name' : 'semantic';
}

/** What the relevance reading rests on, by basis present, never how much of it. */
function evidenceSentence(factors: OracleConceptFactors): string {
  if (factors.contributions.length === 0) return RANK_REASON_PHRASES.evidenceNone;
  const pastPapers = factors.citations.length > 0;
  const objectives = (factors.objectivesCitations ?? []).length > 0;
  const named = objectives && objectivesAlignmentOf(factors) === 'name';
  if (pastPapers && objectives) {
    return named ? RANK_REASON_PHRASES.evidenceBoth : RANK_REASON_PHRASES.evidenceBothCovered;
  }
  if (pastPapers) return RANK_REASON_PHRASES.evidencePastPapers;
  if (objectives) {
    return named
      ? RANK_REASON_PHRASES.evidenceObjectives
      : RANK_REASON_PHRASES.evidenceObjectivesCovered;
  }
  return RANK_REASON_PHRASES.evidenceOther;
}

/**
 * The reasoning string (`[D-417]`, `ol-egov.141.89.10.92`): why this concept sits where it does
 * in its course's order, and what that rests on. Built after the course is sorted, because the
 * claim is relative: it names what put the concept above the one ranked immediately after it
 * ({@link decidingFactors}), a single factor only when that factor alone decided, every
 * favouring factor when several did, and the tie-break when the blend tied. The last concept
 * (nothing below it) says so rather than inventing a reason. Then one sentence on the evidence's
 * basis (past papers, objectives, or none yet — F4.2's "each basis is stated for what it is"),
 * and, when her need on it is unknown and not already said, that it is unknown.
 *
 * **Each claim is checked against the evidence it would rest on (rows 32 and 33,
 * `ol-egov.141.89.10.92`)**: relevance is said to "count for more in your assessments" only where
 * a current basis links the concept to an assessment and the weights are recorded, and otherwise
 * says what drove the ranking, or nothing where no drafted phrase is true of it
 * ({@link relevancePhrase}, `ol-egov.141.89.10.102`); an unknown value given a default is worded as a default, never as
 * importance; a concept with no assessment link is worded from what it has (its recall, and a
 * middle place said to be a default), never from an assessment it does not have; and objectives
 * are said to "name" a concept only for an explicit name match ({@link objectivesAlignmentOf}).
 *
 * **Derived, not decorated.** Every claim is read off `factors` of the two concepts; nothing is
 * recomputed from anything else. What it no longer carries, by the ruling: the per-factor
 * numbers, the blend weights, the priority score, the counts of citations, past papers and
 * assessments, the strongest assessment's path and due-day count. They remain on `factors`
 * (and `citations`) for any caller that audits a ranking; they are not part of the reason.
 */
function buildReasoning(
  conceptName: string,
  course: string,
  factors: OracleConceptFactors & OracleProximityFactors,
  next: (OracleConceptFactors & OracleProximityFactors) | undefined,
  rankedCount: number,
  // The assessments this concept has a current-basis edge to; see `currentBasisAssessments`.
  currentLinks: ReadonlySet<VaultPath>,
): string {
  let position: string;
  let namesUnknownNeed = false;
  if (next === undefined) {
    position = rankedCount === 1 ? RANK_REASON_PHRASES.only : RANK_REASON_PHRASES.last;
  } else {
    const deciding = decidingFactors(factors, next);
    if (deciding === 'tie') {
      position = RANK_REASON_PHRASES.tie;
    } else if (deciding.length === 0) {
      // Unreachable while priorityScore is the sum of the three terms (a strictly higher score
      // needs a strictly higher term); stated rather than guessed if the blend ever changes.
      position = 'is ranked just above the next concept, on everything taken together';
    } else {
      namesUnknownNeed = deciding.includes('need') && factors.needBasis === 'unknown';
      // A factor with no drafted phrase true of it is left out, never given a false one; when
      // none is left the reason names no cause and the evidence sentence carries what it rests on.
      const phrases = deciding
        .map((factor) => factorPhrase(factor, factors, next, currentLinks))
        .filter((phrase): phrase is string => phrase !== undefined);
      position =
        phrases.length === 0
          ? RANK_ABOVE_NEXT
          : `${RANK_ABOVE_NEXT} because ${joinPhrases(phrases)}`;
    }
  }
  const recall =
    factors.needBasis === 'unknown' && !namesUnknownNeed
      ? ` ${RANK_REASON_PHRASES.recallUnknown}`
      : '';
  return `${conceptName} (${course}) ${position}. ${evidenceSentence(factors)}${recall}`;
}

function buildAbstainDetail(course: string, assessmentPaths: readonly VaultPath[]): string {
  return (
    `${course}: ${assessmentPaths.length} assessment${assessmentPaths.length === 1 ? '' : 's'} ` +
    `registered with zero evidence edges (P5-T03 assessmentsWithNoEvidence) — ` +
    `${assessmentPaths.slice().sort().join(', ')}. Abstaining rather than ranking from course ` +
    'membership alone.'
  );
}

/**
 * `[D-329]` — one entry for a concept the caller knows belongs to `course`
 * but that has no real assessment edge at all. See the module doc's "The
 * abstain path, and `[D-329]`'s 'unknown relevance' exception" for the
 * `contributions`/`citations`-both-empty signal this deliberately produces,
 * and `DECLARED_FALLBACK_UNKNOWN_RELEVANCE`'s own doc for the value and its
 * pin. Its proximity is 0: no edge, so no dated assessment (`[D-410]`).
 */
function buildUnknownRelevanceEntry(
  conceptKey: string,
  conceptName: string,
  course: string,
  mastery: ReadonlyMap<string, { readonly state: MasteryState }> | undefined,
  retrievability: ReadonlyMap<string, number> | undefined,
  demandAwareReadiness: ReadonlyMap<string, number> | undefined,
  resolved: ResolvedOptions,
): RankedEntry {
  const masteryState = resolveMasteryState(mastery, conceptKey);
  const masteryNeedWeight = resolved.masteryNeedWeight[masteryState];
  const retrievabilityWeight = resolveRetrievabilityWeight(retrievability, conceptKey);
  const need = resolveNeed(retrievabilityWeight, demandAwareReadiness, conceptKey);
  const preMasteryScore = DECLARED_FALLBACK_UNKNOWN_RELEVANCE;
  // No edge, so no dated assessment: proximity adds nothing ([D-410]).
  const proximityScore = 0;
  const factors: OracleConceptFactors & OracleProximityFactors = {
    citations: [],
    distinctSourceCount: 0,
    objectivesCitations: [],
    distinctObjectivesSourceCount: 0,
    contributions: [],
    vetoedEdges: [],
    preMasteryScore,
    masteryState,
    masteryNeedWeight,
    ...(retrievabilityWeight !== undefined ? { retrievabilityWeight } : {}),
    ...need,
    proximityScore,
    blendWeights: resolved.blendWeights,
    priorityScore: blendPriority(
      preMasteryScore,
      need.needOrderingInput,
      proximityScore,
      resolved.blendWeights,
    ),
  };
  return {
    conceptName,
    conceptKey,
    course,
    rank: 0, // assigned by the caller's sort, same as every other entry
    priorityScore: factors.priorityScore,
    factors,
    citations: [],
    // Filled once the course is sorted: the reason is relative to the next concept.
    reasoning: '',
  };
}

function rankOneCourse(
  course: string,
  edgesForCourse: readonly ConceptAssessmentEdge[],
  noEvidencePathsForCourse: readonly VaultPath[],
  assessmentsByPath: ReadonlyMap<VaultPath, AssessmentRecord>,
  mastery: ReadonlyMap<string, { readonly state: MasteryState }> | undefined,
  retrievability: ReadonlyMap<string, number> | undefined,
  // `[D-332]`: see `RankOracleNeedInput`. `undefined` reads need from recall.
  demandAwareReadiness: ReadonlyMap<string, number> | undefined,
  asOf: Date,
  resolved: ResolvedOptions,
  tiebreakEligible: ReadonlySet<string> | undefined,
  // `[D-329]`: the course's known concept universe, independent of evidence.
  // `undefined` (every caller before this bead) keeps the abstain path
  // byte-identical to before — see the module doc.
  courseConceptUniverse: ReadonlyMap<string, string> | undefined,
  // `[D-404]`: per-concept instrument eligibility — see
  // `RankOracleEligibilityInput`'s doc. `undefined` keeps every outcome
  // byte-identical to before.
  conceptInstrumentEligibility:
    | ReadonlyMap<string, readonly ConceptInstrumentEligibilityFact[]>
    | undefined,
): CourseOracleRanking {
  if (edgesForCourse.length === 0 && courseConceptUniverse === undefined) {
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
  // R5: a verbatim-duplicate edge (same concept, same edgeIdentity) is
  // dropped here, before veto-checking or contribution-building ever sees
  // it — see dedupeVerbatimEdges's doc.
  for (const [conceptKey, edgesForConcept] of edgesByConcept) {
    edgesByConcept.set(conceptKey, [...dedupeVerbatimEdges(edgesForConcept)]);
  }

  const entries: RankedEntry[] = [];
  const vetoedConcepts: OracleVetoedConcept[] = [];
  // Per concept, the assessments it has a surviving current-basis edge to: what the weight clause of
  // its reason may rest on (`relevancePhrase`). Kept beside `entries`, not on `factors`, so the
  // delivered ranking carries no new field.
  const currentLinksByConcept = new Map<string, ReadonlySet<VaultPath>>();
  for (const [conceptKey, edges] of edgesByConcept) {
    // Every edge in this group shares one conceptName by construction (see
    // above) — restated from the first for display purposes only.
    const conceptName = edges[0]?.conceptName ?? conceptKey;
    const conceptVeto = conceptEligibilityVeto(conceptInstrumentEligibility?.get(conceptKey));

    const outcomes = edges.map((edge) =>
      buildEdgeOutcome(
        edge,
        assessmentsByPath.get(edge.assessmentPath),
        asOf,
        resolved,
        conceptVeto,
      ),
    );
    const vetoedEdges = outcomes
      .filter((o): o is Extract<EdgeOutcome, { kind: 'vetoed' }> => o.kind === 'vetoed')
      .map((o) => o.vetoedEdge)
      .sort(compareVetoedEdges);
    const survivingEdges = edges.filter((_, index) => outcomes[index]?.kind === 'contribution');
    currentLinksByConcept.set(conceptKey, currentBasisAssessments(survivingEdges));
    const contributions = outcomes
      .filter((o): o is Extract<EdgeOutcome, { kind: 'contribution' }> => o.kind === 'contribution')
      .map((o) => o.contribution)
      .sort(compareContributions);

    if (contributions.length === 0) {
      // C5.10: "a veto removes the concept from consideration" — every edge
      // this concept had was disqualified, so no `ConceptPriority` is built
      // for it. Reported here rather than silently absent from `ranked`.
      vetoedConcepts.push({
        conceptName,
        conceptKey,
        vetoedEdges,
        ...(conceptVeto !== null ? { eligibilityVeto: conceptVeto } : {}),
      });
      continue;
    }

    const preMasteryScore = contributions.reduce((sum, c) => sum + c.contribution, 0);
    const proximityScore = conceptProximityScore(contributions);
    const masteryState = resolveMasteryState(mastery, conceptKey);
    const masteryNeedWeight = resolved.masteryNeedWeight[masteryState];
    const retrievabilityWeight = resolveRetrievabilityWeight(retrievability, conceptKey);
    const need = resolveNeed(retrievabilityWeight, demandAwareReadiness, conceptKey);
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

    const factors: OracleConceptFactors & OracleProximityFactors = {
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
      // `[D-332]`: need (unknown ordered at the declared provisional
      // maximum, `[D-348]`) ADDED to relevance, never multiplied into it;
      // the stage ladder above is reported and moves nothing. `[D-410]`:
      // proximity added the same way, as its own term.
      ...need,
      proximityScore,
      blendWeights: resolved.blendWeights,
      priorityScore: blendPriority(
        preMasteryScore,
        need.needOrderingInput,
        proximityScore,
        resolved.blendWeights,
      ),
    };

    entries.push({
      conceptName,
      conceptKey,
      course,
      rank: 0, // assigned below, after sorting
      priorityScore: factors.priorityScore,
      factors,
      citations,
      // Filled once the course is sorted: the reason is relative to the next concept.
      reasoning: '',
    });
  }

  // `[D-329]`: any concept the caller knows belongs to this course but that
  // matched no real edge above — `edgesByConcept` never gained an entry for
  // it, whether because the whole course has no evidence or because this
  // one concept's course-mates do and it does not — is ranked at unknown
  // relevance rather than staying invisible. A concept already handled
  // above (with a real edge, contributing or fully vetoed) is skipped here:
  // the real edge's ordinary outcome always wins, never overridden.
  if (courseConceptUniverse !== undefined) {
    for (const [conceptKey, conceptName] of courseConceptUniverse) {
      if (edgesByConcept.has(conceptKey)) continue;
      // `[D-404]` applies to the concept, not to its evidence: a concept of
      // unknown relevance whose every instrument is ineligible is removed
      // and listed with its reason (no edges to list), never ranked.
      const conceptVeto = conceptEligibilityVeto(conceptInstrumentEligibility?.get(conceptKey));
      if (conceptVeto !== null) {
        vetoedConcepts.push({
          conceptName,
          conceptKey,
          vetoedEdges: [],
          eligibilityVeto: conceptVeto,
        });
        continue;
      }
      entries.push(
        buildUnknownRelevanceEntry(
          conceptKey,
          conceptName,
          course,
          mastery,
          retrievability,
          demandAwareReadiness,
          resolved,
        ),
      );
    }
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
  const ranked = entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    reasoning: buildReasoning(
      entry.conceptName,
      course,
      entry.factors,
      entries[index + 1]?.factors,
      entries.length,
      // A concept with no edge (the unknown-relevance entry) has no current link and never reads it.
      currentLinksByConcept.get(entry.conceptKey) ?? new Set<VaultPath>(),
    ),
  }));
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
export function rankOracle(
  input: RankOracleInput &
    RankOracleTiebreakInput &
    RankOracleCourseConceptsInput &
    RankOracleEligibilityInput &
    RankOracleNeedInput,
): RankOracleResult {
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
  // `[D-329]`: a course named in `courseConcepts` but with no assessment
  // record at all (never even reaching the abstain path today) still gets a
  // ranking pass — `undefined` (every caller before this bead) adds nothing
  // here, so this loop is a no-op then.
  for (const course of input.courseConcepts?.keys() ?? []) {
    if (seenCourses.has(course)) continue;
    seenCourses.add(course);
    coursesInOrder.push(course);
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
      input.demandAwareReadiness,
      asOfDate,
      resolved,
      input.tiebreakEligible,
      input.courseConcepts?.get(course),
      input.conceptInstrumentEligibility,
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
