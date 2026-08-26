/**
 * F4.2 — the oracle's high-yield concept ranking (P5-T04).
 *
 * See `./rank.ts`'s module doc for the algorithm and, most importantly, for
 * why every number here is a **provisional, unratified parameter** rather
 * than a tuned threshold. Nothing in this module or its defaults has been
 * ratified against real data — see `RankOracleOptions` field-by-field.
 */

import type { MasteryState } from 'olea-contracts';
import type { AssessmentReadReport } from '../assessment/types.js';
import type { ConceptAssessmentEdge, EvidenceQuestionCitation } from '../evidence-edge/types.js';
import type { ConceptMasteryResult } from '../mastery/rollup.js';
import type { VaultPath } from '../vault/types.js';

/**
 * A concept's mastery for ranking purposes, widened with `'unknown'` for the
 * two cases `MasteryState` itself cannot express: no mastery join was
 * supplied at all, or (distinctly) mastery was joined but this concept has
 * never appeared in her review log. See `./rank.ts`'s `resolveMasteryState`
 * for which case produces which value — they are deliberately NOT the same.
 */
export type OracleMasteryState = MasteryState | 'unknown';

/**
 * Why a concept↔assessment edge is DISQUALIFIED outright rather than merely
 * weighted down — C5.10's veto list (`docs/Olea_alpha_functional_scope.md`,
 * `[D-076]` round 4): "a short list of facts that genuinely disqualify a
 * concept act as vetoes... A veto removes the concept from consideration and
 * is not a weight." **Only `'assessment-passed'` has a producer today** — see
 * `./rank.ts`'s `checkEdgeVeto` doc for exactly what data this module has and
 * does not have for the other two. They are reserved here, not invented,
 * because a caller/report needs somewhere to name them the moment a producer
 * exists, and widening this union later is additive.
 */
export type EdgeVetoReason = 'assessment-passed' | 'out-of-course-scope' | 'suspended';

/**
 * One concept↔assessment edge REMOVED from the blend by a veto, reported
 * rather than silently dropped — C5.10: "a fallback that silently vanishes is
 * the next [defect]." Never appears in `OracleConceptFactors.contributions`;
 * it lives in `vetoedEdges` instead, which is the structural half of "vetoes
 * are separated from the blend."
 */
export interface OracleVetoedEdge {
  readonly assessmentPath: VaultPath;
  readonly reason: EdgeVetoReason;
  /** Whole calendar days from `asOf` to `due` — always negative for `'assessment-passed'`. `null` for a veto reason that is not date-derived. */
  readonly daysUntilDue: number | null;
}

/**
 * A concept every one of whose edges was vetoed this pass — C5.10's "a veto
 * removes the concept from consideration," taken to its conclusion. Reported
 * on `CourseOracleRanking`'s `'ranked'` branch (`vetoedConcepts`) rather than
 * silently producing a `ConceptPriority`-shaped hole, and distinct from
 * `'abstained'`: abstention is "this course had no evidence at all" (P5-T03);
 * this is "this one concept's evidence was all disqualified," a per-concept
 * fact a whole-course status cannot carry.
 */
export interface OracleVetoedConcept {
  readonly conceptName: string;
  readonly conceptKey: string;
  readonly vetoedEdges: readonly OracleVetoedEdge[];
}

/**
 * Why a `due` value did not resolve to a usable date. `'unparseable'` means
 * `due` was PRESENT but did not match the expected `YYYY-MM-DD` calendar-day
 * shape — deliberately distinct from `due` being absent altogether, which is
 * the ordinary, unremarkable "no date recorded" case. This is the loud,
 * structured half of the fix for the defect this module's history flagged: a
 * malformed date must show up somewhere a caller can see it, never win by
 * going unnoticed.
 */
export type DueDateReadIssue = 'unparseable';

/**
 * One assessment's contribution to a concept's priority score — the
 * per-edge arithmetic, kept individually inspectable rather than folded
 * away, because "why is this ranked here" has to be answerable down to a
 * single assessment and a single citation. Only SURVIVING edges (not vetoed
 * — see `OracleVetoedEdge`) are represented here.
 */
export interface OracleEdgeContribution {
  readonly assessmentPath: VaultPath;
  /** From the concept↔assessment edge (P5-T03) — 1-based, lower is more salient. */
  readonly yieldRank: number;
  /** `1 / yieldRank`. See `./rank.ts` for why this shape and not another. */
  readonly yieldScore: number;
  /** From the edge, verbatim — `(0, 1]`. */
  readonly confidence: number;
  /** `false` when the assessment's `weight` field did not resolve to a number — `assessmentWeightScore` is neutral (1) in that case, never a silent zero. */
  readonly assessmentWeightKnown: boolean;
  /** `weight / options.assessmentWeightDivisor`, clamped to `[0, 1]`; `1` (neutral) when unknown. */
  readonly assessmentWeightScore: number;
  /** Whole calendar days from `asOf` to the assessment's `due`, or `null` when `due` was absent or did not parse. Never negative here — a passed assessment is a VETO, not a contribution (see `OracleVetoedEdge`). */
  readonly daysUntilDue: number | null;
  /** Set when `due` was present but unparseable (see `DueDateReadIssue`) — `undefined` when `due` was absent or parsed cleanly. */
  readonly dueDateIssue?: DueDateReadIssue;
  /** `0` when `due` was absent or unparseable — DECLARED: treated the same as the half-life decay's own floor as a date recedes to infinity, so "no known deadline" can never tie or outrank a real, dated deadline; otherwise the half-life decay — see `./rank.ts`'s `computeExamProximityScore`. */
  readonly examProximityScore: number;
  /** `yieldScore * confidence` — the evidence signal alone, before assessment weight or timing. */
  readonly evidenceStrength: number;
  /** `evidenceStrength * assessmentWeightScore * examProximityScore` — this edge's share of the concept's pre-mastery score. */
  readonly contribution: number;
}

/** Every number that fed a concept's `priorityScore`, kept alongside it so the score is never asserted without its arithmetic on hand. */
export interface OracleConceptFactors {
  /** Every citation across every SURVIVING contributing edge, deduplicated by (sourcePath, questionLabel) and deterministically sorted. Never empty for a `ranked` entry — a concept with none survives no further than `OracleVetoedConcept`. */
  readonly citations: readonly EvidenceQuestionCitation[];
  /** Distinct past-paper sources across `citations`. */
  readonly distinctSourceCount: number;
  /** One entry per SURVIVING (non-vetoed) assessment this concept has an edge to in this course, sorted by `contribution` descending (ties by `assessmentPath` ascending). */
  readonly contributions: readonly OracleEdgeContribution[];
  /** Edges REMOVED by a veto rather than folded into `contributions` — see `OracleVetoedEdge`. Always present (empty when nothing on this concept was vetoed) from `rankOracle` itself; optional only so object literals built before this field existed still typecheck. */
  readonly vetoedEdges?: readonly OracleVetoedEdge[];
  /** Sum of `contributions[*].contribution` — the score before the mastery and retrievability multipliers. */
  readonly preMasteryScore: number;
  readonly masteryState: OracleMasteryState;
  /** `options.masteryNeedWeight[masteryState]` — see `./rank.ts` for the ladder and why it is never zero. */
  readonly masteryNeedWeight: number;
  /**
   * Per-concept retrievability (FSRS recall probability at `asOf`) as a
   * blend multiplier — C5.10 names retrievability as one of the SIGNALS,
   * never a gate. `1` (neutral) whenever `RankOracleInput.retrievability`
   * omitted this concept or was omitted entirely, which is every caller
   * today (see that field's doc for the reachability gap). Optional only so
   * object literals built before this field existed still typecheck.
   */
  readonly retrievabilityWeight?: number;
  /** `preMasteryScore * masteryNeedWeight * (retrievabilityWeight ?? 1)` — restated on the entry itself as `ConceptPriority.priorityScore`. */
  readonly priorityScore: number;
}

/** One ranked concept within a course. */
export interface ConceptPriority {
  /** Display only (R2, verbatim) — see {@link ConceptAssessmentEdge.conceptName}. Never a join key; use {@link conceptKey}. */
  readonly conceptName: string;
  /** The opaque join key (`ol-63e1`, `[D-088]`/`[D-109]`) — what a review-log `conceptIds` entry, `GapRow`, and a study plan's `PlannedConcept.conceptId` all key on. */
  readonly conceptKey: string;
  readonly course: string;
  /** 1-based, within this course's ranking only. */
  readonly rank: number;
  readonly priorityScore: number;
  readonly factors: OracleConceptFactors;
  /** Every citation backing this entry — restated from `factors.citations` at the top level, since acceptance is judged on "carries reasoning + citations" and both should be reachable without a second hop. */
  readonly citations: readonly EvidenceQuestionCitation[];
  /**
   * Mechanically assembled from `factors` — see `./rank.ts`'s `buildReasoning`.
   * Never hand-written prose, and never touched by an LLM: this is the
   * ranking's own accounting of itself, which is what makes "reasoning
   * matches what actually drove the order" a testable property rather than
   * a hope. (`oracle.rank.v1`, the Worker task, may ask an LLM to produce
   * additional citation-grounded narrative from the same evidence — see
   * `olea-service/src/tasks/oracleRank.ts` — but that is a separate,
   * unratified pass and never a substitute for this field.)
   */
  readonly reasoning: string;
}

/** Why a course produced no ranking. */
export type OracleAbstainReason = 'no-evidence';

/** One course's ranking, or its abstention — never both, never neither. */
export type CourseOracleRanking =
  | {
      readonly course: string;
      readonly status: 'ranked';
      readonly ranked: readonly ConceptPriority[];
      /** Concepts every one of whose evidence was vetoed away this pass — see `OracleVetoedConcept`. Always present (empty when nothing was vetoed) from `rankOracle` itself; optional only so object literals built before this field existed still typecheck. */
      readonly vetoedConcepts?: readonly OracleVetoedConcept[];
    }
  | {
      readonly course: string;
      readonly status: 'abstained';
      readonly reason: OracleAbstainReason;
      /**
       * Mechanically assembled, citing the specific assessment paths behind
       * the abstention (from P5-T03's `assessmentsWithNoEvidence`) — the
       * abstain-path analogue of `ConceptPriority.reasoning`.
       */
      readonly detail: string;
      /** The assessment paths this course abstained over — `assessmentsWithNoEvidence`, filtered to this course. Never empty when `status: 'abstained'`. */
      readonly assessmentPaths: readonly VaultPath[];
    };

/**
 * Tunable parameters. **Every default is provisional (Class B) and none is
 * ratified** — v0.9 has no measured relationship yet between these numbers
 * and what actually mattered to her exam prep. See `./rank.ts`'s module doc
 * for what would ratify each one. Never tuned from synthetic data
 * (`eval/CLAUDE.md`), and never a lane's call to ratify.
 */
export interface RankOracleOptions {
  /**
   * Days until an assessment is due at which its exam-proximity score has
   * decayed to 0.5 (`1 / (1 + daysUntilDue / proximityHalfLifeDays)`).
   * Default 14 — "about two weeks feels urgent" is the entire justification;
   * unmeasured against her actual study rhythm.
   */
  readonly proximityHalfLifeDays?: number;
  /**
   * Divisor normalizing `AssessmentRecord.weight` (assumed a percentage of
   * course grade, per the Bases table's own `Sum` summary) into `[0, 1]`.
   * Default 100. If a course's weights are entered on a different scale
   * this silently under- or over-weights that course relative to others —
   * flagged rather than guarded against, since nothing in the contract
   * states the scale is always 0–100.
   */
  readonly assessmentWeightDivisor?: number;
  /**
   * How much a concept's mastery state discounts its pre-mastery score.
   * Never 0 for any state — F4.9 requires the oracle to "always advise
   * covering the full syllabus", so a `yours`-mastered concept still
   * contributes a residual 0.15, not nothing. The ladder itself (which
   * states get which discount, and by how much) is invented for v0.9 and
   * needs a real semester of her review log, read against what she actually
   * needed to revisit, before any value here can be called measured.
   */
  readonly masteryNeedWeight?: Readonly<Record<OracleMasteryState, number>>;
}

/**
 * Everything one oracle ranking pass needs. Deliberately typed against the
 * exact result shapes P5-T03 and P4-T06 already produce, rather than a
 * re-derived subset — composing their outputs directly is what "import it,
 * do not edit it" is for.
 */
export interface RankOracleInput {
  /** `buildConceptAssessmentEdges`'s result (P5-T03), unmodified. */
  readonly evidence: {
    readonly edges: readonly ConceptAssessmentEdge[];
    readonly assessmentsRead: AssessmentReadReport;
    readonly assessmentsWithNoEvidence: readonly VaultPath[];
  };
  /**
   * Per-concept mastery (P4-T06), keyed by concept id. **Omit entirely**
   * (vs. supplying a map that simply lacks an entry) to get
   * `masteryState: 'unknown'` for every concept instead of `'seed'` — see
   * `./rank.ts`'s `resolveMasteryState` for why those two absences are
   * deliberately not the same value.
   *
   * **Keyed by `ConceptAssessmentEdge.conceptKey` — the opaque, stable id
   * (`ol-il6m`, `[D-088]`/`[D-109]`), never `conceptName`.** The canonical-id
   * layer this module's earlier doc flagged as a future reversal has now
   * landed: `session/enumerate.ts` mints review-log `conceptIds` from
   * `ConceptRecord.key`, so a mastery map still keyed by display name would
   * silently miss every join (`ol-63e1`, the coordinated flip that corrected
   * this).
   */
  readonly mastery?: ReadonlyMap<string, ConceptMasteryResult>;
  /**
   * Per-concept retrievability (FSRS recall probability at `asOf`), keyed
   * exactly like `mastery` above (`ConceptAssessmentEdge.conceptKey`). C5.10
   * names retrievability as one of the SIGNALS that trades off smoothly in
   * the blend — never a gate — and this is that signal's seam into
   * `rankOracle`. **Omitted entirely reads as neutral (1, no adjustment)**
   * for every concept, the same "an absent signal is neutral, never the
   * worst case" rule every other factor in this module follows; a value
   * present for one concept but not another applies only to the one it
   * names.
   *
   * **Known gap (reachability, plan §2.7 clause 5): nothing supplies this
   * today.** `ConceptMasteryResult` (`../mastery/rollup.ts`) does not carry
   * retrievability — that module's own doc says so outright ("forgetting…
   * is not modelled in mastery at all today") — and no vitality-fold output
   * (`../mastery/vitality.ts`'s `retrievability` port) is threaded into
   * `composeOracleRanking` yet. Wiring an actual producer touches
   * `mastery/`/`session/`, outside this bead's owned files (`oracle/`,
   * `gap/`); this field exists so the blend has a structurally correct,
   * never-a-gate place for it the moment one lands, rather than that arrival
   * needing to re-litigate veto-vs-signal from scratch.
   */
  readonly retrievability?: ReadonlyMap<string, number>;
  /**
   * The calendar day exam proximity is measured from, `YYYY-MM-DD`.
   * **Explicit, never read from a clock inside this module** — unlike
   * `computeConceptMastery` (which has no wall-clock concept at all),
   * exam proximity is inescapably wall-clock-relative, so purity here means
   * "no internal `Date.now()`", not "no dependency on real time". Same
   * `evidence`/`mastery`/`asOf` in ⇒ same ranking out, forever — the
   * rebuild property holds; it is simply a function of one more explicit
   * argument than mastery's is.
   */
  readonly asOf: string;
  readonly options?: RankOracleOptions;
}

export interface RankOracleResult {
  /** One entry per course any assessment names, sorted by course ascending. */
  readonly courses: readonly CourseOracleRanking[];
  /** `assessmentsWithoutCourse`-rooted assessments can't be attributed to any course ranking — surfaced here rather than silently dropped. */
  readonly unattributableAssessments: readonly VaultPath[];
  readonly asOf: string;
}
