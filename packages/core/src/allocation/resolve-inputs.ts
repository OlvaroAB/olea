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
 * **This IS C5.6's fold now, reshaped from the `masteryState` proxy this
 * function used to read (`[D-264]` / `ol-v7r5.47` audit, closed by
 * `ol-v7r5.53` items 3-4).** C5.6 defines readiness as the average, over
 * scope, of each concept's *weakest eligible recall estimate* (R3's tier
 * filter — recall-tier instruments only, minimum retrievability — further
 * narrowed by `[D-264]`: an instrument whose only successes were supported
 * is not eligible either). `OracleConceptFactors.retrievabilityWeight`
 * (`../oracle/types.js`) is now that estimate, per concept, with the
 * undefined-vs-defined distinction `oracle/rank.ts`'s
 * `resolveRetrievabilityWeight` preserves (`ol-v7r5.52`): `undefined` means
 * "no eligible recall-tier evidence for this concept" (a policy zero for
 * readiness, never a measured one); a defined number means a real reading,
 * including a genuine `1`.
 *   - `readiness`: the mean of `retrievabilityWeight ?? 0` over the course's
 *     ranked concepts — `[D-264]`'s own "average... of each concept's
 *     weakest eligible recall estimate", with an ineligible concept
 *     contributing exactly the policy zero the ruling names, never the
 *     `retrievabilityWeight ?? 1` neutral fallback `rankOracle`'s own blend
 *     applies at the point of computing `priorityScore` — that fallback is
 *     deliberately local to the ranking blend (C5.10: a signal, never a
 *     gate) and does not apply to this fold's readiness value.
 *   - `evidenceVolume`: the fraction of ranked concepts with a *defined*
 *     `retrievabilityWeight` — i.e. recall-tier eligibility, not "any scored
 *     review". **Closes both gaps the previous `masteryState` proxy left
 *     open:** recognition-only (MCQ) practice never produces a
 *     `retrievabilityWeight` reading (`mastery/vitality.ts`'s `isRecallTier`
 *     filter, reused by the vitality fold this value is threaded from), so
 *     R7's "a concept may reach `sapling` on any evidence mix" can no longer
 *     count as readiness evidence here; and a `'seed'` concept (no evidence
 *     at all) was already excluded by the prior fix and stays excluded, now
 *     for the same underlying reason (no eligible instrument to read).
 *   - **What is still open, named rather than silently assumed closed.**
 *     `oracle/compose.ts`'s `resolveRetrievabilityScores` (the producer this
 *     value is threaded from, as of `ol-v7r5.53`) still folds through
 *     `mastery/rollup.ts`'s `readAllConceptVitality` — the plain
 *     `readVitality` fold, not `mastery/vitality.ts`'s new
 *     `readReadinessRecall` sibling (`ol-v7r5.52`) that applies `[D-264]`'s
 *     supported-only exclusion. So a concept whose only successes were
 *     supported (`'prompted'`/`'guided'`) still reads as eligible here today
 *     — the recall-tier filter is applied, the supported-only filter is
 *     not yet. Swapping `oracle/compose.ts`'s producer to
 *     `readReadinessRecall` closes this; it touches `oracle/compose.ts` and
 *     `mastery/rollup.ts`, neither owned by `ol-v7r5.53`, so it is filed
 *     rather than done here (see that bead's close evidence for the id).
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
 * **`tempoWeight`** — omitted outright, never defaulted: it has no
 * client-side producer today (the register's own words, verbatim) — nothing
 * in this pipeline reads a course document's credit weight or expected
 * weekly hours yet.
 *
 * **`steeringWeight` now HAS one client-side producer (`ol-egov.141.64`
 * [INTERV-15]), and one deliberately does not exist yet.** C5.6 names "her
 * stated steering (F4.6)" as the allocation's fourth input, honoured exactly
 * like the other three — this had no producer here before because the three
 * ORIGINAL steering inputs (time budget, course-or-topic filter, stated
 * interest) are all per-SESSION, resolved live at composition time
 * (`SessionSteeringRequest`, `study-session/compose.ts`), with nothing
 * persisted for this module to read at plan-computation time. F4.6's
 * once-asked course-avoidance question (`[D-265]`) is different: her answer
 * IS a persisted, durable per-course record
 * (`packages/plugin/src/home/avoidance.ts`'s `ObsidianHomeAvoidanceStore`,
 * built by `ol-egov.141.54` [INTERV-5]) — exactly the kind of caching layer
 * the note above used to say did not exist. `avoidanceAnswersByCourse`
 * (below) reads it back:
 *   - `'leave-for-now'` resolves to `COURSE_AVOIDANCE_LEAVE_FOR_NOW_STEERING_WEIGHT`
 *     — a soft deprioritising MULTIPLIER on the course's discretionary
 *     desire, never an exclusion (the allocation has no exclusion primitive
 *     today, and C5.6's windowed floor is computed independently of
 *     steering and keeps being paid regardless of this weight — "the floor
 *     is honoured over a rolling window" holds unchanged). Declared, not
 *     derived: see that constant's own doc for the reasoning and its Class B
 *     status.
 *   - `'practise-differently'` resolves to no `steeringWeight` at all
 *     (omitted, same as an unanswered course) — this bead found no clause or
 *     ruling defining a concrete allocation or within-course-ranking
 *     mechanism for it that does not collide with F4.8's own `[D-187]`
 *     amendment ("format matching... never changes the instrument mix
 *     itself"), so nothing is built for it here. Filed as a proposed
 *     decision rather than guessed at — see `ol-egov.141.64`'s close
 *     evidence.
 *   - No avoidance answer on file for a course (the common case: most
 *     courses are never asked, per F4.6's own trigger gates) — omitted,
 *     byte-for-byte the same as this module's behaviour before this bead.
 *
 * **What THIS bead does NOT close**, named rather than papered over: wiring
 * a PRODUCTION caller to actually hand this function real avoidance answers
 * is outside `resolve-inputs.ts`'s own file — the one call site is
 * `packages/plugin/src/plan/provider.ts:272`
 * (`resolvePlanPolicyCourseInputs(today, ranking, ...)`), inside
 * `packages/plugin/src/plan/`, not owned by this bead (owns:
 * `packages/plugin/src/session-builder/`, `packages/core/src/oracle/`,
 * `packages/core/src/allocation/`). That caller would need to load
 * `ObsidianHomeAvoidanceStore` (or an equivalent read already threaded to
 * it) and pass a `courseId → answer` map as this function's new last
 * argument. Until that lands, `avoidanceAnswersByCourse` defaults to empty
 * and every existing call site keeps compiling and behaving exactly as
 * before this bead.
 *
 * **`sittingsSinceFloorMet` now HAS a client-side producer (`ol-v7r5.63` /
 * `[DOS-C4]`), pure and self-contained.** The windowed-floor bookkeeping
 * itself (`[D-092]`'s forcing decision) stays service-side, per the
 * component register's own "boundary: service" line — this module does not
 * re-derive the floor or the forcing rule. What it DOES now compute: given a
 * caller-supplied sittings history (`PastSessionRecord[]`, the same shape
 * `../study-session/window.js`'s `computeWindowDeficit` already reads —
 * `[SESS-13]`'s local session projection over her review log, a vault fact,
 * never server state) and the previous plan's per-course floor shares, `
 * sittingsSinceFloorMet(courseId)` walks the history backward from the most
 * recent sitting, counting sittings in which the course was eligible but its
 * received share of that sitting stayed below its floor share, and stops
 * counting at the first (most recent) eligible sitting where the received
 * share met or exceeded the floor. `undefined` — never a guessed `0` — when
 * the floor share is unknown, or the course never appears as eligible
 * anywhere in the supplied history (the same "absence, not a fabricated
 * number" convention `CourseFloorShare.floorShare` itself uses).
 *
 * **What this bead does NOT close**, named rather than papered over: wiring
 * a PRODUCTION caller to actually hand this function real sittings history
 * and real floor shares is outside `resolve-inputs.ts`'s own file (it would
 * touch `plan-policy-provider.ts`, not owned by this bead) — filed as a
 * follow-up (`ol-feza` [DOS-C4-a]), the exact posture
 * `studyPlanStore` was in before `ol-v7r5.38` closed that gap for
 * `listCourseFloorShares`. Until that caller lands, `sittingsSinceFloorMet`
 * is omitted here exactly as before (both new parameters default to empty),
 * so every existing call site keeps compiling and behaving unchanged.
 * `PlanPolicyRequest.courses[number]` marks all three optional for exactly
 * this reason: their absence is a documented gap, not a bug, and the
 * service side's own confidence-ramp defaults (`[D-081]`) are what carries
 * week one before `tempoWeight` ever gets a producer, and before
 * `sittingsSinceFloorMet` or `steeringWeight` get a production caller.
 *
 * INV-1: pure, no `obsidian`, no I/O, no clock — `asOf` is caller-supplied,
 * same discipline as `rankOracle`/`buildStudyPlan`.
 */

import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptRecord } from '../concept/types.js';
import type { CourseOracleRanking, RankOracleResult } from '../oracle/types.js';
import type { PastSessionRecord } from '../study-session/window.js';

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

/**
 * The two answers F4.6's course-avoidance question can record (`[D-265]`).
 * Mirrors `packages/plugin/src/home/avoidance.ts`'s own
 * `CourseAvoidanceAnswer` field-for-field — kept in sync by hand rather than
 * imported, same discipline `PlanPolicyCourseInput`'s own doc above already
 * uses for `plan-policy-provider.ts` (this package cannot depend on the
 * plugin package). Only `'leave-for-now'` has a defined effect in this
 * module today — see `resolveCourseInput`'s own comment for why
 * `'practise-differently'` deliberately resolves to nothing here.
 */
export type CourseAvoidanceSteeringAnswer = 'leave-for-now' | 'practise-differently';

/**
 * F4.6/`[D-265]`'s "leave the course for now" answer, read back as a soft
 * deprioritising MULTIPLIER on `steeringWeight` — see the module doc's
 * `steeringWeight` section for the full argument. `1` is neutral
 * (`DEFAULT_STEERING_WEIGHT`, `olea-service/src/plan/allocation.ts`); this
 * is deliberately well below `1` so the course visibly recedes from the
 * session's discretionary desire (`risk + tempo`) without being multiplied
 * away to zero, and deliberately well above `0` because the allocation has
 * no exclusion primitive and this bead does not invent one — the course's
 * windowed floor share is computed independently of this weight and keeps
 * being paid regardless (C5.6: "the floor is honoured over a rolling
 * window"). Declared, not derived: no replay corpus exists yet for how a
 * real student's allocation should move after this specific answer, so
 * `0.25` is a plain-English choice ("costs the course three quarters of its
 * ordinary pull for more time, without erasing it") rather than a fitted
 * number. Class B (reversible default) — flagged for David's retroactive
 * review and a sensitivity sweep once a real avoidance answer exists to
 * replay against.
 */
export const COURSE_AVOIDANCE_LEAVE_FOR_NOW_STEERING_WEIGHT = 0.25;

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
 * C5.6's own fold as of `ol-v7r5.53` (items 3-4): the mean per-concept
 * `retrievabilityWeight`, policy-zeroed on absence, and the fraction of
 * concepts with a defined (recall-tier-eligible) reading. See the module
 * doc's `[D-264]` section for what is and is not reconciled and why.
 */
function readinessAndEvidenceVolume(course: CourseOracleRanking): {
  readonly readiness: number;
  readonly evidenceVolume: number;
} {
  if (course.status === 'abstained' || course.ranked.length === 0) {
    return { readiness: 0, evidenceVolume: 0 };
  }
  let readinessSum = 0;
  let recallEligible = 0;
  for (const concept of course.ranked) {
    const { retrievabilityWeight } = concept.factors;
    // `[D-264]`: absence means no eligible recall-tier evidence for this
    // concept — a policy zero for readiness, never the neutral `1`
    // `rankOracle`'s own blend falls back to when computing `priorityScore`
    // (`oracle/rank.ts`'s `resolveRetrievabilityWeight` doc). A defined
    // value, including a genuine `1`, is a real reading and counts as
    // eligible for `evidenceVolume` below.
    readinessSum += retrievabilityWeight ?? 0;
    if (retrievabilityWeight !== undefined) recallEligible += 1;
  }
  return {
    readiness: readinessSum / course.ranked.length,
    evidenceVolume: recallEligible / course.ranked.length,
  };
}

/**
 * `sittingsSinceFloorMet`'s pure computation (`ol-v7r5.63` / `[DOS-C4]`): walk
 * `history` backward from the most recent sitting, counting eligible sittings
 * in which `courseId`'s received share stayed below `floorShare`, stopping
 * (not counting) at the first eligible sitting — most recent first — where
 * the received share met or exceeded it. See the module doc's own section
 * for the full argument and what remains a follow-up.
 *
 * `undefined` when the floor share itself is unknown (mirrors
 * `CourseFloorShare.floorShare`'s own absence convention) or when the course
 * never appears as an eligible course anywhere in the supplied history —
 * both are "no signal", never a guessed `0`.
 */
function sittingsSinceFloorMet(
  courseId: string,
  history: readonly PastSessionRecord[],
  floorShare: number | undefined,
): number | undefined {
  if (floorShare === undefined || !Number.isFinite(floorShare) || floorShare <= 0) return undefined;

  let count = 0;
  let sawEligibleSitting = false;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const sitting = history[i];
    if (sitting === undefined || !sitting.eligibleCourses.includes(courseId)) continue;
    sawEligibleSitting = true;

    let totalReceived = 0;
    for (const seconds of sitting.received.values()) totalReceived += seconds;
    const receivedShare =
      totalReceived > 0 ? (sitting.received.get(courseId) ?? 0) / totalReceived : 0;

    // This sitting paid the floor — the count stops here, not counting it.
    if (receivedShare >= floorShare) break;
    count += 1;
  }
  return sawEligibleSitting ? count : undefined;
}

/** Every course id named by any concept's `courses` attribution (F1.3) — "her material has arrived" for that course, the same reading F4.10/F8.2 already give it. */
function coursesWithMaterial(concepts: readonly ConceptRecord[]): ReadonlySet<string> {
  const courses = new Set<string>();
  for (const concept of concepts) {
    for (const course of concept.courses) courses.add(course);
  }
  return courses;
}

/**
 * `[D-265]`'s two answers resolved to a `steeringWeight`, or `undefined`
 * when there is none to apply — see the module doc's `steeringWeight`
 * section. `'practise-differently'` deliberately resolves to `undefined`
 * here: this bead found no clause or ruling defining a concrete allocation
 * or within-course-ranking mechanism for it that does not collide with
 * F4.8's `[D-187]` amendment ("format matching... never changes the
 * instrument mix itself"), so nothing is guessed at in its place.
 */
function steeringWeightForAvoidanceAnswer(
  answer: CourseAvoidanceSteeringAnswer | undefined,
): number | undefined {
  return answer === 'leave-for-now' ? COURSE_AVOIDANCE_LEAVE_FOR_NOW_STEERING_WEIGHT : undefined;
}

/** Resolves one course's `PlanPolicyCourseInput`, whether or not `rankOracle` reported on it — see the module doc's F4.7 fallback section. */
function resolveCourseInput(
  asOf: string,
  courseId: string,
  ranked: CourseOracleRanking | undefined,
  assessments: readonly AssessmentRecord[],
  sittingsHistory: readonly PastSessionRecord[],
  floorSharesByCourse: ReadonlyMap<string, number>,
  avoidanceAnswer: CourseAvoidanceSteeringAnswer | undefined,
): PlanPolicyCourseInput {
  const courseRecords = assessments.filter((record) => record.course === courseId);
  const nearest = nearestUpcomingAssessment(asOf, courseRecords);
  const { readiness, evidenceVolume } =
    ranked === undefined ? { readiness: 0, evidenceVolume: 0 } : readinessAndEvidenceVolume(ranked);
  const sittingsSince = sittingsSinceFloorMet(
    courseId,
    sittingsHistory,
    floorSharesByCourse.get(courseId),
  );
  const steeringWeight = steeringWeightForAvoidanceAnswer(avoidanceAnswer);
  return {
    courseId,
    daysToNextAssessment: nearest?.days ?? null,
    assessmentWorth: nearest?.record.weight ?? NEUTRAL_ASSESSMENT_WORTH,
    readiness,
    evidenceVolume,
    ...(sittingsSince === undefined ? {} : { sittingsSinceFloorMet: sittingsSince }),
    ...(steeringWeight === undefined ? {} : { steeringWeight }),
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
 *
 * `sittingsHistory` and `floorSharesByCourse` (`ol-v7r5.63` / `[DOS-C4]`)
 * feed `sittingsSinceFloorMet` — see the module doc's own section. Both
 * default to empty, reproducing this function's pre-this-bead behaviour
 * exactly for a caller not yet passing them (no production caller does yet
 * — see the module doc for the filed follow-up).
 *
 * `avoidanceAnswersByCourse` (`ol-egov.141.64` [INTERV-15]) feeds
 * `steeringWeight` — see the module doc's own `steeringWeight` section for
 * which answer does what and why. Defaults to empty, reproducing this
 * function's pre-this-bead behaviour exactly for a caller not yet passing it
 * (no production caller does yet — see the module doc for the filed
 * follow-up).
 */
export function resolvePlanPolicyCourseInputs(
  asOf: string,
  ranking: RankOracleResult,
  assessments: readonly AssessmentRecord[],
  concepts: readonly ConceptRecord[] = [],
  sittingsHistory: readonly PastSessionRecord[] = [],
  floorSharesByCourse: ReadonlyMap<string, number> = new Map(),
  avoidanceAnswersByCourse: ReadonlyMap<string, CourseAvoidanceSteeringAnswer> = new Map(),
): readonly PlanPolicyCourseInput[] {
  const rankedById = new Map(ranking.courses.map((course) => [course.course, course]));
  const materialOnlyIds = [...coursesWithMaterial(concepts)]
    .filter((courseId) => !rankedById.has(courseId))
    .sort();

  return [
    ...ranking.courses.map((course) =>
      resolveCourseInput(
        asOf,
        course.course,
        course,
        assessments,
        sittingsHistory,
        floorSharesByCourse,
        avoidanceAnswersByCourse.get(course.course),
      ),
    ),
    ...materialOnlyIds.map((courseId) =>
      resolveCourseInput(
        asOf,
        courseId,
        undefined,
        assessments,
        sittingsHistory,
        floorSharesByCourse,
        avoidanceAnswersByCourse.get(courseId),
      ),
    ),
  ];
}
