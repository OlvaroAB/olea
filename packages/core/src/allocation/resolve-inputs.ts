/**
 * `resolvePlanPolicyCourseInputs` — component 3.5's client-side input
 * resolution (`ol-v7r5.25`, follow-up to `ol-v7r5.23`/`ol-v7r5.17`
 * [ALLOC-2]).
 *
 * `docs/Olea_component_register.md` row 3.5 names four inputs, "in, four and
 * only four": (1) days to the course's next unpassed assessment weighted by
 * demonstrated readiness against that assessment's scope, (2) what that
 * assessment is worth, (3) tempo (credit weight + expected weekly hours,
 * **"with no producer today"** — the register's own words), and (4) her
 * stated steering. This module resolves what a client-side fold can
 * honestly produce from what already exists on this device — `rankOracle`'s
 * result (component 3.3/3.4) and the raw assessments table (F1.1) — and
 * omits the rest rather than fabricating a number. `PlanPolicyCourseInput`
 * (the wire shape this feeds, `plan-policy-provider.ts`) makes exactly this
 * shape optional-by-field for the same reason.
 *
 * ## Every fold here is DECLARED, and each earns its own sentence
 *
 * **`daysToNextAssessment`** — the whole-day gap from `asOf` to the
 * course's nearest still-future `due` among its own assessment records,
 * read straight off `AssessmentRecord.due` (F1.1). This is a raw calendar
 * fact, not a derived score, so it does not collide with the "do not
 * duplicate the proximity half-life... from 3.3" rule the register states
 * for this row: 3.3's half-life curve is never applied here, only the
 * un-decayed day count. `null` when the course has no assessment with a
 * readable future due date.
 *
 * **`assessmentWorth`** — `AssessmentRecord.weight` for that SAME nearest
 * assessment, already normalised to `[0, 1]` by `./weight.ts`'s own
 * percentage/fraction reading (`[D-143]`) — a different normalisation from
 * 3.3's `assessmentWeightDivisor`, so reusing it does not duplicate that
 * signal either (the register's rule is about the divisor specifically, not
 * about "worth" being unusable twice). When the nearest assessment's weight
 * did not resolve, or no assessment exists at all, this defaults to `1`
 * (neutral) — the same "unknown reads as neutral, never as a guessed
 * number" precedent `oracle/rank.ts`'s own `assessmentWeightScore` sets for
 * an unresolved weight.
 *
 * **`readiness` / `evidenceVolume`** — aggregated over the course's ranked
 * concepts (`CourseOracleRanking['ranked']`), which is the set of concepts
 * `rankOracle` already found edged to one of the course's assessments. This
 * is a coarser scope than the clause's ideal ("that assessment's scope"
 * singular) — it is every concept edged to ANY of the course's assessments,
 * not narrowed to the single nearest one, because narrowing would need a
 * per-assessment concept-scope join this pipeline does not yet expose to a
 * caller outside `oracle/rank.ts`. Declared as the honest approximation
 * available today, not a derived fit; sharpening it to the single-assessment
 * scope is a real follow-up, not silently assumed done here.
 *   - `readiness`: the fraction of ranked concepts whose `masteryState` is
 *     `'sapling'` or `'tree'` — R7/mastery's own words for "demonstrably
 *     solid" (`'seed'`/`'sprout'` read as not yet solid, `'unknown'` as no
 *     evidence at all, counted in the denominator either way since
 *     readiness is a fraction of the whole scope).
 *   - `evidenceVolume`: the fraction of ranked concepts whose `masteryState`
 *     is anything other than `'unknown'` — literally "has any evidence at
 *     all", the register's own phrase for this input.
 *   - An **abstained** course (`status: 'abstained'`, P5-T03's "no evidence
 *     this pass") reads `readiness: 0, evidenceVolume: 0` — not a fallback
 *     guess but the honest floor: an abstained course by definition has
 *     produced no ranked concepts to average over, and "no evidence" is
 *     exactly what abstention already asserts. The confidence ramp
 *     (`[D-081]`, service-side) is what turns a low `evidenceVolume` into
 *     "fall back to tempo", not this module.
 *
 * **`tempoWeight`, `steeringWeight`, `sittingsSinceFloorMet`** — omitted
 * outright, never defaulted:
 *   - `tempoWeight` has no client-side producer today (the register's own
 *     words, verbatim) — nothing in this pipeline reads a course document's
 *     credit weight or expected weekly hours yet.
 *   - `steeringWeight` — F4.6's stated steering is a per-SESSION filter
 *     (`SessionSteeringRequest`, `study-session/compose.ts`), resolved at
 *     composition time from her live input, not a persisted per-course
 *     number available at plan-computation time. There is nothing to read
 *     here without inventing a caching layer this bead does not own.
 *   - `sittingsSinceFloorMet` — the windowed-floor bookkeeping (`[D-092]`)
 *     is service-side per the component register's own "boundary: service"
 *     line, and no client-side session-count-since-floor producer exists to
 *     hand it a starting value.
 * `PlanPolicyRequest.courses[number]` marks all three optional for exactly
 * this reason: their absence is a documented gap, not a bug, and the
 * service side's own confidence-ramp defaults (`[D-081]`) are what carries
 * week one before any of these three ever gets a producer.
 *
 * INV-1: pure, no `obsidian`, no I/O, no clock — `asOf` is caller-supplied,
 * same discipline as `rankOracle`/`buildStudyPlan`.
 */

import type { AssessmentRecord } from '../assessment/types.js';
import type { CourseOracleRanking, RankOracleResult } from '../oracle/types.js';

/** Mirrors `plan-policy-provider.ts`'s `PlanPolicyCourseInput` field-for-field (the plugin package cannot import from here without an ownership crossing, so the two are kept in sync by hand — same discipline `PLAN_POLICY_ENDPOINT_PATH` already uses). */
export interface PlanPolicyCourseInput {
  readonly courseId: string;
  readonly daysToNextAssessment: number | null;
  readonly assessmentWorth: number;
  readonly readiness: number;
  readonly evidenceVolume: number;
  readonly tempoWeight?: number;
  readonly steeringWeight?: number;
  readonly sittingsSinceFloorMet?: number;
}

/** Unresolved-weight neutral default — see the module doc's `assessmentWorth` section. */
const NEUTRAL_ASSESSMENT_WORTH = 1;

const MSEC_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days from `asOf` to `due`, or `null` when `due` is absent, unparseable, or already past. */
function daysUntil(asOf: string, due: string | undefined): number | null {
  if (due === undefined) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00.000Z`);
  const dueMs = Date.parse(`${due}T00:00:00.000Z`);
  if (Number.isNaN(asOfMs) || Number.isNaN(dueMs)) return null;
  const days = Math.round((dueMs - asOfMs) / MSEC_PER_DAY);
  return days < 0 ? null : days;
}

/** The course's nearest still-future assessment record, or `undefined` when none has a readable future due date. */
function nearestUpcomingAssessment(
  asOf: string,
  records: readonly AssessmentRecord[],
): { readonly record: AssessmentRecord; readonly days: number } | undefined {
  let nearest: { readonly record: AssessmentRecord; readonly days: number } | undefined;
  for (const record of records) {
    const days = daysUntil(asOf, record.due);
    if (days === null) continue;
    if (nearest === undefined || days < nearest.days) nearest = { record, days };
  }
  return nearest;
}

/** `readiness`/`evidenceVolume` aggregated over a ranked course's concepts — see the module doc. */
function readinessAndEvidenceVolume(course: CourseOracleRanking): {
  readonly readiness: number;
  readonly evidenceVolume: number;
} {
  if (course.status === 'abstained' || course.ranked.length === 0) {
    return { readiness: 0, evidenceVolume: 0 };
  }
  let solid = 0;
  let evidenced = 0;
  for (const concept of course.ranked) {
    if (concept.factors.masteryState === 'sapling' || concept.factors.masteryState === 'tree') {
      solid += 1;
    }
    if (concept.factors.masteryState !== 'unknown') evidenced += 1;
  }
  return {
    readiness: solid / course.ranked.length,
    evidenceVolume: evidenced / course.ranked.length,
  };
}

/**
 * Resolve component 3.5's per-course inputs for every course `rankOracle`
 * reported on (ranked or abstained — both are "running"). `assessments` is
 * the full, unfiltered read of her assignments table (`readAssessments`'
 * `records`); this function does the per-course narrowing itself so a
 * caller hands it the same report it already read for `composeOracleRanking`.
 */
export function resolvePlanPolicyCourseInputs(
  asOf: string,
  ranking: RankOracleResult,
  assessments: readonly AssessmentRecord[],
): readonly PlanPolicyCourseInput[] {
  return ranking.courses.map((course) => {
    const courseRecords = assessments.filter((record) => record.course === course.course);
    const nearest = nearestUpcomingAssessment(asOf, courseRecords);
    const { readiness, evidenceVolume } = readinessAndEvidenceVolume(course);
    return {
      courseId: course.course,
      daysToNextAssessment: nearest?.days ?? null,
      assessmentWorth: nearest?.record.weight ?? NEUTRAL_ASSESSMENT_WORTH,
      readiness,
      evidenceVolume,
    };
  });
}
