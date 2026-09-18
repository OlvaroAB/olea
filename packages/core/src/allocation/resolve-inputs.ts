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
 *
 * **This is a growth-stage proxy, not C5.6's fold — and it carries that
 * qualifier rather than dropping it (`[D-264]` / `ol-v7r5.47`).** C5.6
 * defines readiness as the average, over scope, of each concept's *weakest
 * eligible recall estimate* (R3's tier filter — recall-tier instruments
 * only, minimum retrievability — further narrowed by `[D-264]`: an
 * instrument whose only successes were supported is not eligible either).
 * What this function actually reads is `masteryState`, a rollup over the
 * whole evidence log with no retrievability, no per-instrument tier, and no
 * support level anywhere in it. The two readings are related — a `sapling`
 * concept has produced spaced-out successes — but they are not the same
 * quantity, and neither the recall-tier exclusion nor `[D-264]`'s
 * supported-only exclusion is expressible from `masteryState` alone.
 *   - `readiness`: the fraction of ranked concepts whose `masteryState` is
 *     `'sapling'` or `'tree'` — R7/mastery's own words for "demonstrably
 *     solid" (`'seed'`/`'sprout'` read as not yet solid, `'unknown'` as no
 *     evidence at all, counted in the denominator either way since
 *     readiness is a fraction of the whole scope). **Unchanged by this
 *     reconciliation** — `sapling`/`tree` already exclude every concept
 *     with no evidence or below the spacing gate, which is the one part of
 *     the policy-zero requirement expressible at this grain.
 *   - `evidenceVolume`: the fraction of ranked concepts with *any scored
 *     review at all* — `masteryState` is `'sprout'`, `'sapling'` or
 *     `'tree'`. **Fixed by this reconciliation** (`[D-264]` audit): this
 *     used to also count `'seed'`, which `mastery/rollup.ts`'s own module
 *     doc defines as "no evidence at all: no scored review, and no graded
 *     explain-back" — the exact case C5.6 names as contributing "no credited
 *     evidence... a policy zero, never a measured zero." A `'seed'` concept
 *     was silently read as evidenced; it no longer is.
 *   - **What remains unreconciled, and why it cannot be closed inside this
 *     file.** Two gaps survive the fix above, both blocked on data this
 *     module's inputs (`CourseOracleRanking` → `ConceptPriority.factors`)
 *     do not carry:
 *     1. **No recognition-tier exclusion.** R7: "a concept may reach
 *        `sapling` on any evidence mix" — recognition-only (MCQ) practice
 *        can produce `sapling`/`sprout` by itself, but C5.6 requires
 *        recognition evidence to be excluded "explicitly, not incidentally."
 *        `OracleConceptFactors` (`../oracle/types.js`) carries only
 *        `masteryState`, never the per-tier `ConceptMasteryEvidence` the
 *        rollup already computes internally (`tiersPracticed.recall`) — so
 *        there is nothing here to filter on.
 *     2. **No `[D-264]` supported-only exclusion, and no real per-concept
 *        retrievability at all.** The closer signal,
 *        `OracleConceptFactors.retrievabilityWeight`, cannot serve this
 *        purpose as built: `oracle/rank.ts`'s `resolveRetrievabilityWeight`
 *        (around line 434) collapses "no eligible evidence for this
 *        concept" and "a genuinely neutral value" to the same `1`, which is
 *        the opposite of the policy-zero requirement. And even where it is
 *        populated, its producer — `mastery/vitality.ts`'s `readVitality`
 *        fold, threaded through `oracle/compose.ts`'s optional
 *        `retrievability` input — has no support-level awareness at all
 *        (`VitalityInstrument` carries no support field), so it cannot
 *        implement `[D-264]`'s exclusion even if wired through; `[D-264]`
 *        ruling 1 leaves vitality's own arithmetic unchanged, so this needs
 *        a readiness-specific fold, not an edit to `vitality.ts`. On top of
 *        that, **no production caller wires it today**: `oracle/compose.ts`'s
 *        own module doc says outright that none of its three production
 *        callers passes `retrievability` yet, and
 *        `packages/plugin/src/plan/provider.ts`'s `composeOracleRanking`
 *        call (the one call site that feeds this function) confirms it —
 *        no `retrievability` field in the call. Closing this needs new
 *        producer work in `oracle/types.ts`, `oracle/rank.ts`, a new
 *        readiness-eligibility fold, and that plugin call site — none of
 *        them owned by this bead. Filed rather than attempted here: see
 *        `ol-v7r5.47`'s close evidence.
 *   - An **abstained** course (`status: 'abstained'`, P5-T03's "no evidence
 *     this pass") reads `readiness: 0, evidenceVolume: 0` — not a fallback
 *     guess but the honest floor: an abstained course by definition has
 *     produced no ranked concepts to average over, and "no evidence" is
 *     exactly what abstention already asserts. The confidence ramp
 *     (`[D-081]`, service-side) is what turns a low `evidenceVolume` into
 *     "fall back to tempo", not this module.
 *
 * ## F4.7's fallback also has to reach courses `rankOracle` never sees at all
 * (`ol-3ux7.5.57.14.34` / HARD-2c)
 *
 * `rankOracle`'s own course set (`RankOracleResult.courses`) is built purely
 * from courses named in her assessments table (`oracle/rank.ts`'s
 * `coursesInOrder`) — a course with no assessment record on file at all,
 * ever, never appears there, ranked or abstained. That is fine for F4.7's
 * literal case (an assessment whose date has passed still leaves its course
 * in the table, so `daysToNextAssessment` correctly falls to `null` for it,
 * same as any other course below) — but a course with **no** assessment
 * record would otherwise vanish from this function's output entirely,
 * taking it out of the cross-course allocation (C5.6) even though her
 * material for it has arrived. F4.7's own argument ("the material is still
 * hers") does not stop at "no assessment left" — it covers "no assessment
 * ever". So this function's course universe is the union of `rankOracle`'s
 * courses AND every course named in `concepts[number].courses` (F1.3's own
 * course-attribution field — "material has arrived" read the same way F4.10
 * and F8.2 already read it). A course present only via `concepts` gets the
 * same treatment an abstained course gets: `readiness: 0, evidenceVolume: 0`
 * (no ranked evidence exists for it, full stop) and
 * `daysToNextAssessment`/`assessmentWorth` resolved off the same assessments
 * table every other course uses — `null`/neutral when, as here, none exists.
 * A course present in NEITHER set is not running and gets no entry, same as
 * before this fix.
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
import type { ConceptRecord } from '../concept/types.js';
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

/**
 * `readiness`/`evidenceVolume` aggregated over a ranked course's concepts —
 * a `masteryState` proxy for C5.6's fold, not the fold itself; see the
 * module doc's `[D-264]` section for exactly what is and is not reconciled
 * here and why.
 */
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
    const { masteryState } = concept.factors;
    if (masteryState === 'sapling' || masteryState === 'tree') {
      solid += 1;
    }
    // `'seed'` is `mastery/rollup.ts`'s own word for "no evidence at all: no
    // scored review, and no graded explain-back" — it must read as no
    // credited evidence here too (C5.6's policy zero), same as `'unknown'`.
    // Fixed by `[D-264]`'s audit (`ol-v7r5.47`): this used to count `'seed'`
    // as evidenced, which is the exact case the clause says contributes
    // nothing.
    if (masteryState !== 'unknown' && masteryState !== 'seed') evidenced += 1;
  }
  return {
    readiness: solid / course.ranked.length,
    evidenceVolume: evidenced / course.ranked.length,
  };
}

/** Every course id named by any concept's `courses` attribution (F1.3) — "her material has arrived" for that course, the same reading F4.10/F8.2 already give it. */
function coursesWithMaterial(concepts: readonly ConceptRecord[]): ReadonlySet<string> {
  const courses = new Set<string>();
  for (const concept of concepts) {
    for (const course of concept.courses) courses.add(course);
  }
  return courses;
}

/** Resolves one course's `PlanPolicyCourseInput`, whether or not `rankOracle` reported on it — see the module doc's F4.7 fallback section. */
function resolveCourseInput(
  asOf: string,
  courseId: string,
  ranked: CourseOracleRanking | undefined,
  assessments: readonly AssessmentRecord[],
): PlanPolicyCourseInput {
  const courseRecords = assessments.filter((record) => record.course === courseId);
  const nearest = nearestUpcomingAssessment(asOf, courseRecords);
  const { readiness, evidenceVolume } =
    ranked === undefined ? { readiness: 0, evidenceVolume: 0 } : readinessAndEvidenceVolume(ranked);
  return {
    courseId,
    daysToNextAssessment: nearest?.days ?? null,
    assessmentWorth: nearest?.record.weight ?? NEUTRAL_ASSESSMENT_WORTH,
    readiness,
    evidenceVolume,
  };
}

/**
 * Resolve component 3.5's per-course inputs for every course that is
 * "running": every course `rankOracle` reported on (ranked or abstained —
 * both are "running"), UNION every course named by `concepts`' own course
 * attribution (F1.3) — F4.7's fallback reaching the courses `rankOracle`
 * never sees at all (see the module doc). `rankOracle`'s own courses keep
 * their existing order first; any course present only via `concepts` is
 * appended after, sorted, so an existing caller iterating just the ranked
 * courses sees no reordering of what it already had.
 *
 * `assessments` is the full, unfiltered read of her assignments table
 * (`readAssessments`' `records`); this function does the per-course
 * narrowing itself so a caller hands it the same report it already read for
 * `composeOracleRanking`. `concepts` is the same extraction a caller already
 * ran for `composeOracleRanking`'s own `concepts` input (F1.3's course
 * attribution) — passing `[]` (the default) reproduces this function's
 * pre-fix behaviour exactly, for a caller not yet passing it.
 */
export function resolvePlanPolicyCourseInputs(
  asOf: string,
  ranking: RankOracleResult,
  assessments: readonly AssessmentRecord[],
  concepts: readonly ConceptRecord[] = [],
): readonly PlanPolicyCourseInput[] {
  const rankedById = new Map(ranking.courses.map((course) => [course.course, course]));
  const materialOnlyIds = [...coursesWithMaterial(concepts)]
    .filter((courseId) => !rankedById.has(courseId))
    .sort();

  return [
    ...ranking.courses.map((course) =>
      resolveCourseInput(asOf, course.course, course, assessments),
    ),
    ...materialOnlyIds.map((courseId) =>
      resolveCourseInput(asOf, courseId, undefined, assessments),
    ),
  ];
}
