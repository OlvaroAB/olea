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
 * ## The scoring shape, and why every constant in it is provisional
 *
 * For each concept↔assessment edge (P5-T03), this module computes a
 * `contribution` — how much that one assessment's evidence should weigh in
 * the concept's overall priority — from four signals, each normalized to
 * roughly `[0, 1]` so they combine by multiplication without one signal
 * silently dominating by scale:
 *
 *   contribution = yieldScore * confidence * assessmentWeightScore * examProximityScore
 *
 * A concept's `preMasteryScore` is the **sum** of its contributions across
 * every assessment that has an edge to it in the same course — a concept
 * examined by three assessments accumulates more priority than one examined
 * by a single low-weight quiz, which is the plain reading of "likelihood
 * and weight of examination" (F4.2). The final `priorityScore` multiplies
 * that by a mastery-need factor (`masteryNeedWeight`) so a concept she has
 * already got to `yours` still shows up — F4.9 forbids ever implying full
 * coverage is unnecessary — but ranks below an equally-evidenced concept
 * she hasn't touched.
 *
 * **None of the four signals, none of the combination shape, and none of
 * the mastery ladder is measured against her real exam outcomes or her real
 * study rhythm.** `RankOracleOptions`'s doc comments say what would ratify
 * each one; per `eval/CLAUDE.md`, none of them may be tuned from synthetic
 * data, and ratifying any of them is a decision-bead call, never a lane's.
 * What IS proved here, by test and by mutation, is narrower and load-
 * bearing on its own: the reasoning text this module emits for every
 * ranked entry is mechanically DERIVED from these exact numbers, never a
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
 */

import type { MasteryState } from 'olea-contracts';
import type { AssessmentRecord } from '../assessment/types.js';
import { daysBetween } from '../dates.js';
import type { ConceptAssessmentEdge, EvidenceQuestionCitation } from '../evidence-edge/types.js';
import type { VaultPath } from '../vault/types.js';
import type {
  ConceptPriority,
  CourseOracleRanking,
  OracleConceptFactors,
  OracleEdgeContribution,
  OracleMasteryState,
  RankOracleInput,
  RankOracleOptions,
  RankOracleResult,
} from './types.js';

const DEFAULT_PROXIMITY_HALF_LIFE_DAYS = 14;
const DEFAULT_ASSESSMENT_WEIGHT_DIVISOR = 100;

/**
 * The mastery-need ladder's default. Monotonically decreasing with mastery,
 * never zero (F4.9) — see `types.ts`'s `RankOracleOptions.masteryNeedWeight`
 * doc for what would ratify these four numbers. `'unknown'` is neutral
 * (1, i.e. no discount at all) because "no mastery data was supplied" is not
 * evidence that she has mastered nothing — it is the absence of a signal,
 * and this module's rule throughout is that an absent signal never silently
 * reads as the worst case OR the best case; it reads as neutral and is
 * flagged (`assessmentWeightKnown`, `masteryState === 'unknown'`, `daysUntilDue === null`).
 *
 * **Re-bucketed for D-049's four-stage vocabulary (`VOC-1`, `ol-7efk`).** The
 * retired ladder's `shaky` (0.85) and `coming` (0.6) rungs merge into
 * `sprout`'s single rung; `seed`, `sapling` and `tree` keep the old `new`,
 * `solid` and `yours` values unchanged. Like every rung here, `sprout`'s
 * 0.7 is an unmeasured, provisional midpoint (F4.9's "never zero" is the
 * only ratified fact about this ladder), not a fitted or ratified number.
 */
const DEFAULT_MASTERY_NEED_WEIGHT: Readonly<Record<OracleMasteryState, number>> = {
  seed: 1,
  sprout: 0.7,
  sapling: 0.35,
  tree: 0.15,
  unknown: 1,
};

interface ResolvedOptions {
  readonly proximityHalfLifeDays: number;
  readonly assessmentWeightDivisor: number;
  readonly masteryNeedWeight: Readonly<Record<OracleMasteryState, number>>;
}

function resolveOptions(options: RankOracleOptions | undefined): ResolvedOptions {
  const proximityHalfLifeDays = options?.proximityHalfLifeDays ?? DEFAULT_PROXIMITY_HALF_LIFE_DAYS;
  const assessmentWeightDivisor =
    options?.assessmentWeightDivisor ?? DEFAULT_ASSESSMENT_WEIGHT_DIVISOR;
  const masteryNeedWeight = options?.masteryNeedWeight ?? DEFAULT_MASTERY_NEED_WEIGHT;
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
 */
function computeAssessmentWeightScore(
  weight: number | undefined,
  divisor: number,
): { readonly known: boolean; readonly score: number } {
  if (weight === undefined || !Number.isFinite(weight)) {
    return { known: false, score: 1 };
  }
  return { known: true, score: Math.max(0, Math.min(1, weight / divisor)) };
}

/**
 * Exam-proximity score. Unparseable `due` is neutral (1, same as "due
 * today") — an assessment whose date this reader could not parse must not
 * be silently deprioritized. An assessment that has genuinely already
 * passed (`daysUntilDue < 0`) scores 0: it cannot inform *future* study
 * priority, whatever its evidence.
 */
function computeExamProximity(
  asOf: Date,
  due: string | undefined,
  halfLifeDays: number,
): { readonly daysUntilDue: number | null; readonly score: number } {
  const dueDate = due === undefined ? null : dateFromCalendarDay(due);
  if (dueDate === null) return { daysUntilDue: null, score: 1 };
  const daysUntilDue = daysBetween(asOf, dueDate);
  if (daysUntilDue < 0) return { daysUntilDue, score: 0 };
  return { daysUntilDue, score: 1 / (1 + daysUntilDue / halfLifeDays) };
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
      const key = `${citation.sourcePath} ${citation.questionLabel}`;
      if (!seen.has(key)) seen.set(key, citation);
    }
  }
  return [...seen.values()].sort(compareCitations);
}

/**
 * `masteryState` for one concept. **Deliberately two different absences**:
 * `mastery` entirely omitted (the caller opted the whole ranking out of a
 * mastery join) reads as `'unknown'` — neutral, flagged, no claim made.
 * `mastery` supplied but this concept has no entry in it reads as `'seed'`
 * — P4-T06's own contract for zero scored evidence, which is a real,
 * contract-backed answer rather than an absence this module invented.
 */
function resolveMasteryState(
  mastery: ReadonlyMap<string, { readonly state: MasteryState }> | undefined,
  conceptName: string,
): OracleMasteryState {
  if (mastery === undefined) return 'unknown';
  return mastery.get(conceptName)?.state ?? 'seed';
}

function buildEdgeContribution(
  edge: ConceptAssessmentEdge,
  assessment: AssessmentRecord | undefined,
  asOf: Date,
  resolved: ResolvedOptions,
): OracleEdgeContribution {
  const yieldScore = computeYieldScore(edge.yieldRank);
  const weight = computeAssessmentWeightScore(assessment?.weight, resolved.assessmentWeightDivisor);
  const proximity = computeExamProximity(asOf, assessment?.due, resolved.proximityHalfLifeDays);
  const evidenceStrength = yieldScore * edge.confidence;
  const contribution = evidenceStrength * weight.score * proximity.score;
  return {
    assessmentPath: edge.assessmentPath,
    yieldRank: edge.yieldRank,
    yieldScore,
    confidence: edge.confidence,
    assessmentWeightKnown: weight.known,
    assessmentWeightScore: weight.score,
    daysUntilDue: proximity.daysUntilDue,
    examProximityScore: proximity.score,
    evidenceStrength,
    contribution,
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
 */
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
    `${conceptName} (${course}): ${factors.citations.length} citation` +
    `${factors.citations.length === 1 ? '' : 's'} across ${factors.distinctSourceCount} past ` +
    `paper${factors.distinctSourceCount === 1 ? '' : 's'}, spanning ${assessmentCount} ` +
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
  asOf: Date,
  resolved: ResolvedOptions,
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

  const edgesByConcept = new Map<string, ConceptAssessmentEdge[]>();
  for (const edge of edgesForCourse) {
    const list = edgesByConcept.get(edge.conceptName);
    if (list === undefined) edgesByConcept.set(edge.conceptName, [edge]);
    else list.push(edge);
  }

  const entries: ConceptPriority[] = [];
  for (const [conceptName, edges] of edgesByConcept) {
    const contributions = edges
      .map((edge) =>
        buildEdgeContribution(edge, assessmentsByPath.get(edge.assessmentPath), asOf, resolved),
      )
      .sort(compareContributions);
    const preMasteryScore = contributions.reduce((sum, c) => sum + c.contribution, 0);
    const masteryState = resolveMasteryState(mastery, conceptName);
    const masteryNeedWeight = resolved.masteryNeedWeight[masteryState];
    const citations = unionCitations(edges);
    const distinctSourceCount = new Set(citations.map((c) => c.sourcePath)).size;

    const factors: OracleConceptFactors = {
      citations,
      distinctSourceCount,
      contributions,
      preMasteryScore,
      masteryState,
      masteryNeedWeight,
      priorityScore: preMasteryScore * masteryNeedWeight,
    };

    entries.push({
      conceptName,
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
    return a.conceptName < b.conceptName ? -1 : a.conceptName > b.conceptName ? 1 : 0;
  });
  const ranked = entries.map((entry, index) => ({ ...entry, rank: index + 1 }));

  return { course, status: 'ranked', ranked };
}

/**
 * F4.2's ranking, computed fresh from `input` every time — no cache, no
 * clock, no I/O. See this file's module doc for the scoring shape and the
 * abstain rule.
 */
export function rankOracle(input: RankOracleInput): RankOracleResult {
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
      asOfDate,
      resolved,
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
