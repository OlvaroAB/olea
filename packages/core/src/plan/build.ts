/**
 * `buildStudyPlan` — a `RankOracleResult` (P5-T04) as the versioned artifact
 * A2.5 and C7.6 describe.
 *
 * This module adds no judgment. Every rank, weight, reasoning string and
 * citation below is read straight off the ranking; nothing is recomputed,
 * re-scored, rounded, or explained a second time. That restraint is the point:
 * `rank.ts` proved by mutation that its reasoning is *derived* from the numbers
 * that produced the order, and a builder that re-derived anything here would
 * hand that property back — the artifact would be an explanation of a
 * calculation rather than a record of one.
 *
 * ## The plan version is a content hash, and `computedAt` is not in it
 *
 * C7.6 exists so that a review event can record which plan selected it. That is
 * only answerable if two plans that would order her queue differently have
 * different versions, and two that would order it identically share one. So
 * `planVersion` is a SHA-256 over the **policy body** — the courses, in their
 * canonical form — and deliberately not over `computedAt` or the D7.3 `stamp`.
 *
 * Recomputing an unchanged plan therefore produces the same version. That is
 * the property, not a side effect: A2.5 has the Worker recomputing "daily, or on
 * material change", so a clock-derived version would churn every day and the
 * A→B checkpoint's question — *did the prioritisation she was given actually
 * change?* — would be unanswerable from the log it was designed to be answered
 * from. It also makes the version stable across devices, which matters because
 * her vault syncs and her review log does not coordinate.
 *
 * The hash is taken over a **key-sorted** serialisation rather than
 * `JSON.stringify` of the object as built, so the version cannot move because
 * someone reordered a field in a struct literal. Object key order is
 * deterministic in JavaScript, which is exactly what makes relying on it a trap:
 * it would keep working right up until an unrelated edit silently invalidated
 * every version already written into her log.
 *
 * ## What it does not do
 *
 * It does not order courses by anything but name, does not drop abstentions,
 * and does not filter empty rankings into existence. A course that abstained
 * arrives here as an abstention and leaves as one — see the contract schema's
 * `studyPlanCourse` for why flattening it would undo P5-T04's whole abstain
 * path at the one layer that persists.
 */

import {
  type PlannedConcept,
  type ResponseStamp,
  STUDY_PLAN_FORMAT_VERSION,
  type StudyPlanArtifact,
  type StudyPlanCourse,
  studyPlanArtifact,
} from 'olea-contracts';
import { hashText } from '../ingestion/hash.js';
import type { ConceptPriority, RankOracleResult } from '../oracle/types.js';

/**
 * Prefix on every `planVersion`, so a value found in a log line six months from
 * now identifies its own derivation. `sp1` is "study plan, format 1": if the
 * artifact's `formatVersion` ever moves, the prefix moves with it and two
 * versions from different formats can never collide.
 */
const PLAN_VERSION_PREFIX = `sp${STUDY_PLAN_FORMAT_VERSION}`;

/**
 * How many hex characters of the digest the version carries.
 *
 * 16 hex characters is 64 bits. At the scale this artifact operates —
 * one student, a plan recomputed daily for a semester, so a few hundred
 * distinct plans — a collision is not a risk anyone needs to reason about, and
 * a short version stays readable in a log line she may end up looking at.
 * Class B: raising it later is a plan-version change, which is a new plan, which
 * is exactly what the mechanism already handles.
 */
const PLAN_VERSION_HEX_LENGTH = 16;

export interface BuildStudyPlanInput {
  /** `rankOracle`'s result, unmodified. Its `asOf` becomes the plan's. */
  readonly ranking: RankOracleResult;
  /**
   * When this plan was computed, ISO-8601 with offset. **Explicit, never read
   * from a clock in here** — same discipline as `rankOracle`'s `asOf`, and the
   * reason `planVersion` is reproducible in a test at all.
   */
  readonly computedAt: string;
  /** D7.3 provenance, when a Worker call contributed. Omitted for a locally computed plan. */
  readonly stamp?: ResponseStamp;
}

/**
 * The nearest still-future assessment behind a ranked concept, in whole days.
 *
 * D7.1's `examProximity` is "days to the nearest relevant assessment; null when
 * unknown or none", so this takes the **minimum non-negative** `daysUntilDue`
 * across the concept's contributing edges. An assessment already past is not
 * "nearest" in any sense she cares about — it cannot inform future study, which
 * is the same reading `rank.ts` gives it when it scores a passed assessment 0 —
 * and an unparseable due date contributes nothing rather than a zero.
 *
 * `null` therefore means "no contributing assessment has a readable future due
 * date", which is a statement, not a missing value.
 */
function nearestFutureDueDays(entry: ConceptPriority): number | null {
  let nearest: number | null = null;
  for (const contribution of entry.factors.contributions) {
    const days = contribution.daysUntilDue;
    if (days === null || days < 0) continue;
    if (nearest === null || days < nearest) nearest = days;
  }
  return nearest;
}

function toPlannedConcept(entry: ConceptPriority): PlannedConcept {
  return {
    conceptId: entry.conceptName,
    rank: entry.rank,
    weight: entry.priorityScore,
    examProximityDays: nearestFutureDueDays(entry),
    reasoning: entry.reasoning,
    citations: entry.citations.map((citation) => ({
      sourcePath: citation.sourcePath,
      questionLabel: citation.questionLabel,
    })),
  };
}

/**
 * A ranked course with zero entries cannot be represented as `ranked` (the
 * contract requires a non-empty concept list) and must not be silently dropped
 * either. It is unreachable from `rankOracle` — a course with no edges takes
 * the abstain branch there — so reaching it means an upstream invariant broke,
 * and this says so instead of producing an artifact that quietly lost a course.
 */
function toStudyPlanCourse(course: RankOracleResult['courses'][number]): StudyPlanCourse {
  if (course.status === 'abstained') {
    return {
      course: course.course,
      status: 'abstained',
      reason: course.reason,
      detail: course.detail,
      assessmentPaths: [...course.assessmentPaths],
    };
  }
  if (course.ranked.length === 0) {
    throw new Error(
      `buildStudyPlan: course ${JSON.stringify(course.course)} is 'ranked' with no entries — ` +
        'a course with no evidence must abstain, never rank empty',
    );
  }
  return {
    course: course.course,
    status: 'ranked',
    concepts: course.ranked.map(toPlannedConcept),
  };
}

/**
 * Deterministic serialisation for hashing: object keys sorted, arrays in order.
 *
 * Arrays are *not* sorted — their order is meaningful everywhere in this
 * artifact (rank order, her citation order), so reordering one is a different
 * plan and must produce a different version.
 */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalise(v)]));
  }
  return value;
}

/**
 * `planVersion` for a policy body — exported so a caller can ask "is the plan I
 * am about to save the same plan I already have?" without building one twice.
 *
 * The `asOf` day is inside the derivation because exam proximity is measured
 * from it: the identical ranking read from a different day is a different
 * policy, even when every score happens to coincide.
 */
export async function studyPlanVersion(
  asOf: string,
  courses: readonly StudyPlanCourse[],
): Promise<string> {
  const digest = await hashText(JSON.stringify(canonicalise({ asOf, courses })));
  return `${PLAN_VERSION_PREFIX}-${digest.slice(0, PLAN_VERSION_HEX_LENGTH)}`;
}

/**
 * Build the artifact. Async only because hashing is (`SubtleCrypto`, the one
 * primitive available on desktop *and* mobile — see `ingestion/hash.ts`).
 *
 * The result is validated against the contract schema before it is returned, so
 * a plan that would fail on the way into the cache fails here instead, at the
 * point where the inputs that produced it are still in hand.
 */
export async function buildStudyPlan(input: BuildStudyPlanInput): Promise<StudyPlanArtifact> {
  const courses = input.ranking.courses.map(toStudyPlanCourse);
  const planVersion = await studyPlanVersion(input.ranking.asOf, courses);
  const plan: StudyPlanArtifact = {
    formatVersion: STUDY_PLAN_FORMAT_VERSION,
    planVersion,
    computedAt: input.computedAt,
    asOf: input.ranking.asOf,
    ...(input.stamp === undefined ? {} : { stamp: input.stamp }),
    courses,
  };
  return studyPlanArtifact.parse(plan);
}
