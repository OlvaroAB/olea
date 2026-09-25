/**
 * `buildStudyPlan` — a `RankOracleResult` (P5-T04) as a `StudyPlanEnvelope`,
 * the shared versioned-artifact envelope A2.5 and C7.6 describe
 * (`[D-122]`/`[BND-3b]`).
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
 * `policyVersion` (the envelope's field for what this module used to call
 * `planVersion` — `[D-122]`'s mechanical mapping) is a SHA-256 over the
 * **policy body** — the courses, the cross-course allocation and the
 * ranking-weight factors that produced them, when the caller has them in
 * hand, in their canonical form — and deliberately not over `computedAt` or
 * the D7.3 `stamp`.
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
  ARTIFACT_ENVELOPE_VERSION,
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  type PlannedConcept,
  type ResponseStamp,
  STUDY_PLAN_BODY_VERSION,
  STUDY_PLAN_KIND,
  type StudyPlanAllocationEntry,
  type StudyPlanCourse,
  type StudyPlanEnvelope,
  studyPlanEnvelope,
} from 'olea-contracts';
import { hashText } from '../ingestion/hash.js';
import type { ConceptPriority, RankOracleOptions, RankOracleResult } from '../oracle/types.js';

/**
 * Prefix on every `policyVersion`, so a value found in a log line six months
 * from now identifies its own derivation. `sp1` is "study plan, body format
 * 1": if the study-plan body's `bodyVersion` ever moves, the prefix moves with
 * it and two versions from different body formats can never collide.
 *
 * Deliberately keyed on `STUDY_PLAN_BODY_VERSION`, not `ARTIFACT_ENVELOPE_VERSION`
 * — the wrapper and the body are versioned independently (see
 * `artifact-envelope.ts`'s module doc), and this identity is about the body's
 * shape, not the wrapper's.
 */
const PLAN_VERSION_PREFIX = `sp${STUDY_PLAN_BODY_VERSION}`;

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
  /**
   * `ol-v7r5.25` — component 3.5's cross-course allocation, when
   * `POST /v1/plan-policy` (`ol-v7r5.23`) answered this refresh. Landed
   * verbatim onto `StudyPlanBody.allocation` (`artifact-envelope.ts`):
   * absence here means "no allocation policy travelled with this plan,"
   * never "every course got zero" — the same reading that field's own doc
   * states, carried through by simply not fabricating an entry when there
   * is nothing to carry.
   */
  readonly allocation?: readonly StudyPlanAllocationEntry[];
  /**
   * `[D-110]`'s delivered-or-fallback ranking-weight factors (proximity
   * half-life, assessment weight divisor, mastery-need ladder), when the
   * caller has them in hand — `plan/provider.ts`'s own `readRankWeights`
   * result, the same `RankOracleOptions` already passed to
   * `composeOracleRanking`. **Not landed onto `body`** (that is a contract
   * change outside this module's reach, `ol-egov.141.89.10.23`'s proposed
   * decision) — folded only into `policyVersion`'s hash, so two plans that
   * differ only in which weights produced them are never read as the same
   * policy. Omitted has the same "no policy travelled" reading `allocation`
   * above documents: a plan built before this field existed, or with
   * `readRankWeights` absent (F7.8), hashes exactly as it did before this
   * bead.
   */
  readonly rankWeights?: RankOracleOptions;
  /**
   * Component 3.5's infeasible-floors health signal, when `POST
   * /v1/plan-policy` answered this refresh (`plan-policy-provider.ts`'s
   * `PlanPolicyResult.floorsFundable`). Landed verbatim onto
   * `StudyPlanBody.floorsFundable` (`artifact-envelope.ts`) and folded into
   * `policyVersion`'s hash beside `allocation` and `rankWeights`
   * (`ol-egov.141.89.10.51`), so a plan whose floors stopped (or started)
   * being fundable gets a new version even if `courses`/`allocation`/
   * `rankWeights` numerically coincide. Omitted has the same "no policy
   * travelled" reading `allocation` documents: a plan built before this
   * field existed, or with no delivered policy at all, hashes exactly as it
   * did before this bead. Nothing renders it — see the field's own doc on
   * `studyPlanBody`.
   */
  readonly floorsFundable?: boolean;
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
    // The opaque join key (`ol-63e1`, `[D-088]`/`[D-109]`), not the display
    // name — `plan/execute.ts`'s `indexPlan` is joined against a queue item's
    // `conceptIds`, which a review-log-derived instrument now carries as the
    // same opaque key (`session/enumerate.ts`). The display name she reads
    // stays available in `reasoning` below, mechanically assembled from the
    // same entry (`oracle/rank.ts`'s `buildReasoning`) — this field itself was
    // never rendered to her.
    conceptId: entry.conceptKey,
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
 * `policyVersion` for a policy body — exported so a caller can ask "is the
 * plan I am about to save the same plan I already have?" without building one
 * twice. Still named `studyPlanVersion`: the identity it derives has not
 * moved, only the envelope field it fills has (`planVersion` → `policyVersion`,
 * `[D-122]`'s mechanical mapping).
 *
 * The `asOf` day is inside the derivation because exam proximity is measured
 * from it: the identical ranking read from a different day is a different
 * policy, even when every score happens to coincide.
 *
 * **`allocation` and `rankWeights` are in the hash too (`ol-egov.141.89.10.23`).**
 * Component 3.5's cross-course split and `[D-110]`'s ranking-weight factors
 * both change what she is actually served without necessarily moving a single
 * `courses` entry — two plans that would divide her time differently, or that
 * were ranked under different weights, must not share one version just
 * because the ranked list happens to read the same. Both are optional and
 * `canonicalise` drops an `undefined` key entirely, so a plan built with
 * neither (every plan before this bead, and every plan built today with no
 * allocation policy and no delivered weights) hashes exactly as it always
 * has — this is additive to the derivation, not a reshuffle of it.
 *
 * **`floorsFundable` is in the hash too (`ol-egov.141.89.10.51`).** Same
 * reasoning: whether the courses' forced floors would have summed within
 * budget changes what she is actually served without moving `courses` or
 * `allocation`. Optional, and `canonicalise` drops it when absent, so a plan
 * built before this field existed, or with no delivered policy at all,
 * hashes exactly as it always has.
 */
export async function studyPlanVersion(
  asOf: string,
  courses: readonly StudyPlanCourse[],
  allocation?: readonly StudyPlanAllocationEntry[],
  rankWeights?: RankOracleOptions,
  floorsFundable?: boolean,
): Promise<string> {
  const digest = await hashText(
    JSON.stringify(canonicalise({ asOf, courses, allocation, rankWeights, floorsFundable })),
  );
  return `${PLAN_VERSION_PREFIX}-${digest.slice(0, PLAN_VERSION_HEX_LENGTH)}`;
}

/**
 * Build the envelope. Async only because hashing is (`SubtleCrypto`, the one
 * primitive available on desktop *and* mobile — see `ingestion/hash.ts`).
 *
 * The result is validated against the contract schema before it is returned, so
 * a plan that would fail on the way into the cache fails here instead, at the
 * point where the inputs that produced it are still in hand.
 *
 * `freshForSeconds`/`governsForSeconds` are the envelope's **governing** class
 * constants (`GOVERNING_FRESH_FOR_SECONDS`/`GOVERNING_GOVERNS_FOR_SECONDS`,
 * `artifact-envelope.ts`'s "Declared constants" section) — the study plan
 * tells her what to do, which is exactly the class those constants were
 * argued for, not the operating class `[D-110]`'s ranking weights use.
 */
export async function buildStudyPlan(input: BuildStudyPlanInput): Promise<StudyPlanEnvelope> {
  const courses = input.ranking.courses.map(toStudyPlanCourse);
  const policyVersion = await studyPlanVersion(
    input.ranking.asOf,
    courses,
    input.allocation,
    input.rankWeights,
    input.floorsFundable,
  );
  const envelope: StudyPlanEnvelope = {
    envelopeVersion: ARTIFACT_ENVELOPE_VERSION,
    kind: STUDY_PLAN_KIND,
    bodyVersion: STUDY_PLAN_BODY_VERSION,
    policyVersion,
    computedAt: input.computedAt,
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    ...(input.stamp === undefined ? {} : { stamp: input.stamp }),
    body: {
      asOf: input.ranking.asOf,
      courses,
      ...(input.allocation === undefined ? {} : { allocation: [...input.allocation] }),
      ...(input.floorsFundable === undefined ? {} : { floorsFundable: input.floorsFundable }),
    },
  };
  return studyPlanEnvelope.parse(envelope);
}
