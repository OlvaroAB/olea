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
 * One assessment's contribution to a concept's priority score — the
 * per-edge arithmetic, kept individually inspectable rather than folded
 * away, because "why is this ranked here" has to be answerable down to a
 * single assessment and a single citation.
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
  /** Whole calendar days from `asOf` to the assessment's `due`, or `null` when `due` did not parse. Negative means already past. */
  readonly daysUntilDue: number | null;
  /** `0` when the assessment has already passed (`daysUntilDue < 0`); `1` (neutral) when `due` did not parse; otherwise the half-life decay — see `./rank.ts`. */
  readonly examProximityScore: number;
  /** `yieldScore * confidence` — the evidence signal alone, before assessment weight or timing. */
  readonly evidenceStrength: number;
  /** `evidenceStrength * assessmentWeightScore * examProximityScore` — this edge's share of the concept's pre-mastery score. */
  readonly contribution: number;
}

/** Every number that fed a concept's `priorityScore`, kept alongside it so the score is never asserted without its arithmetic on hand. */
export interface OracleConceptFactors {
  /** Every citation across every contributing edge, deduplicated by (sourcePath, questionLabel) and deterministically sorted. Never empty for a `ranked` entry. */
  readonly citations: readonly EvidenceQuestionCitation[];
  /** Distinct past-paper sources across `citations`. */
  readonly distinctSourceCount: number;
  /** One entry per assessment this concept has an edge to in this course, sorted by `contribution` descending (ties by `assessmentPath` ascending). */
  readonly contributions: readonly OracleEdgeContribution[];
  /** Sum of `contributions[*].contribution` — the score before the mastery multiplier. */
  readonly preMasteryScore: number;
  readonly masteryState: OracleMasteryState;
  /** `options.masteryNeedWeight[masteryState]` — see `./rank.ts` for the ladder and why it is never zero. */
  readonly masteryNeedWeight: number;
  /** `preMasteryScore * masteryNeedWeight` — restated on the entry itself as `ConceptPriority.priorityScore`. */
  readonly priorityScore: number;
}

/** One ranked concept within a course. */
export interface ConceptPriority {
  readonly conceptName: string;
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
   * `masteryState: 'unknown'` for every concept instead of `'new'` — see
   * `./rank.ts`'s `resolveMasteryState` for why those two absences are
   * deliberately not the same value.
   *
   * Keyed on the assumption that a concept's `conceptName`
   * (`ConceptAssessmentEdge.conceptName`, R2's verbatim display name) IS
   * the review log's `conceptId` — v0.9 has no separate canonical-id layer
   * (knowledge model §4's "leave the rest null, key nothing on them"; R1/R2
   * name display identity as the only identity concepts have). This is a
   * Class B reading of a contract silence, reversible if a canonical id
   * layer ever lands — flagged in the task report rather than assumed
   * silently.
   */
  readonly mastery?: ReadonlyMap<string, ConceptMasteryResult>;
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
