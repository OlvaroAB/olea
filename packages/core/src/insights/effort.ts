/**
 * F6.5(b) — effort imbalance: where the time went, against what the plan's
 * own window accounting says this course is owed.
 *
 * ## Re-specified against window accounting (`ol-v7r5.33`), not raw weight
 *
 * This detector used to compare her time share against a course's raw
 * assessment-weight share (grade points in, grade points out). `[D-081]` and
 * `[D-092]` since ruled that cross-course fairness is not a grade-weight
 * ratio at all: component 3.5 (`computeAttentionShares`, `olea-service`'s
 * `src/plan/allocation.ts`) computes a **windowed floor** per course — a
 * guaranteed minimum share of her attention over a rolling window of her
 * sittings, honoured once a course goes too long without meeting it
 * (`[D-092]`'s starvation bound), and already blending worth, proximity,
 * readiness and tempo far more carefully than a bare weight ratio ever did.
 * Re-deriving that formula here would duplicate a component the register
 * marks `boundary: service` (`docs/Olea_component_register.md` row 3.5) —
 * the same "a signal belongs in exactly one layer" rule `allocation.ts`'s own
 * doc states about the proximity half-life. So this module does not compute
 * a floor; it reads the one the plan already computed, carried in the cached
 * study-plan artifact (`StudyPlanAllocationEntry.contributions`, the entry
 * named `'floor'`, `packages/contracts/src/study-plan.ts`) and restated here
 * as a per-course fraction rather than a contribution-array lookup a caller
 * would otherwise have to know how to perform.
 *
 * `docs/Olea_semester_narrative.md` §9 (seam S1) states the corrected claim
 * precisely: *"a course at or above its floor while the other dominates is
 * correct concentration; a course below its floor is the real problem... So
 * 'most of your time went to X' is a problem precisely when the window says
 * Y is owed, and never otherwise."* That is exactly what comparing
 * `timeShare` against `floorShare` (rather than against a grade-weight
 * share) now says, and nothing more.
 *
 * **What did not change:** the course-naming rule (`ol-7j54` / ARC-1,
 * `../insights/index.ts`'s module doc), the never-fires-in-the-negative
 * shape, the "a course with a floor and no time is included at zero, never
 * dropped" honesty property, and the sufficiency floor on sample size
 * (`MIN_TIMED_REVIEWS`). Only the meaning of the *other* share changed.
 *
 * ## This one is validated, and that was not a given
 *
 * The counting primitives for this insight have existed in
 * `packages/synthetic/src/measures.ts` since SYN-1 (`reviewCountByCourse`,
 * `timeSpentMsByCourse`) — but for a long time there was **no persona carrying
 * a planted effort imbalance**, only spacing/cramming and instrument-skip. A
 * detector can be written against primitives; it cannot be *validated* against
 * a corpus that contains no instance of what it detects, and "the arithmetic is
 * obviously right" is precisely the argument this project has stopped
 * accepting.
 *
 * So the persona was built first (`olea-synthetic`'s `lopsided-effort`, whose
 * `Behaviour.courseTakeRate` starves one course of her attention while leaving
 * every other knob at its neutral value), and this detector is held to the same
 * standard as the crammer's: it must fire on that persona's stream and go
 * quiet on the stream generated from the same seed with
 * `planted.neutralise` applied. That pair is asserted in
 * `packages/workbench/test/trends-scenarios.spec.ts`; the persona's own
 * planted pattern is asserted independently, in the generator's vocabulary, in
 * `packages/synthetic/test/personas.spec.ts`. **That workbench pairing lives
 * outside this bead's owned paths (`ol-v7r5.33` owns `packages/core/src/
 * insights/` and `packages/plugin/src/today/copy.ts`), and was updated
 * pragmatically rather than left broken by the rename: `TRENDS_ASSESSMENTS`
 * now builds `CourseFloorShare[]` by summing and normalising the synthetic
 * curriculum's assessment weights per course — the exact arithmetic
 * `detectEffortImbalance` itself used to perform internally before this
 * re-spec moved it out to the caller — so every number the workbench already
 * showed (the 57%/43% split, the 40/40 and 0/40 firing counts) is
 * byte-identical. It is a labelled placeholder, not a real
 * `computeAttentionShares` output (component 3.5 is server-only); see
 * `trends-scenarios.ts`'s own doc on `TRENDS_ASSESSMENTS`.**
 *
 * ## What it compares
 *
 * Two shares, per course:
 *
 * - **time share** — milliseconds of review time attributed to the course,
 *   over the total across the courses being compared. A record's `durationMs`
 *   is attributed **in full to every distinct course among its concepts**, not
 *   split between them (v3's many-to-many evidence, D-020/`ol-t3sd`): the time
 *   really was spent, and it really is evidence for each of them. The same rule
 *   `timeSpentMsByCourse` already documents.
 * - **floor share** — the course's own windowed-floor fraction from the plan's
 *   most recent computation (`[D-092]`), `0..1`, **taken as given, never
 *   renormalised across the compared courses.** Unlike the old weight share,
 *   a floor share is already an absolute fraction of the whole plan's window —
 *   renormalising it against only the courses this detector happens to have a
 *   floor for would inflate it the moment any running course's floor is
 *   unknown, which is exactly the silent-narrowing the honesty properties
 *   below refuse to do to `timeShare`'s own count.
 *
 * The finding is the *gap* between them, `floorShare - timeShare`, and it is
 * signed on purpose: a positive gap is a course that has logged less time
 * than its own guaranteed minimum — the "below its floor" case the semester
 * narrative names as the real problem. The negative direction (logging more
 * than the floor) is measured too and deliberately **not** surfaced as a
 * finding: a course sitting above its floor while another dominates is, in
 * the ruling's own words, "correct concentration," not an imbalance.
 *
 * ## The parameter, and that it was not swept
 *
 * `MIN_GAP` is one declared constant: twenty percentage points, chosen before
 * any stream was measured because it is the smallest gap that survives being
 * described out loud ("a fifth of the window's attention short of what the
 * course was guaranteed"). Nothing fitted it (N-015), and the margin it
 * clears on the planted persona and her neutralised twin is reported by the
 * workbench spec rather than asserted here. **Its practical bite changed with
 * this re-spec, worth stating rather than discovering later:** a floor share
 * is typically smaller than a grade-weight share ever was (D-092's own
 * regime assumption is roughly one viable sitting per course per window, so a
 * floor is often in the 0.15–0.3 range rather than a grade's 0.3–0.6), so a
 * 0.2-point shortfall is a proportionally larger miss under this definition
 * than it was under the old one. `MIN_GAP` was not moved to compensate —
 * moving a threshold because the redefinition changed what it bites on would
 * be exactly the post-hoc tuning N-015 forbids. Whether 0.2 is still the
 * right operating point under the new definition is for whoever revalidates
 * the workbench health check once real floor-share fixtures replace the
 * pre-rename ones.
 *
 * Below this many timed reviews across the courses with a known floor share,
 * a split between them is noise and the detector declines.
 *
 * **A count, not a duration, and the first version of this was a duration.** It
 * was `30 * 60 * 1000` — half an hour of attributed review time — which reads
 * as a sensible floor and measures the wrong thing: it conflates "too few
 * observations to estimate a share" with "her answers are quick". A student
 * with two hundred fast MCQ answers has a perfectly stable split and under a
 * millisecond floor could be refused; a student with six long explain-backs has
 * no split worth reporting and could pass. Sample size is the property that
 * makes a share trustworthy, so sample size is what is counted.
 *
 * The change was made after the floor blocked every persona on a synthetic
 * corpus whose whole deck is 24 instruments — recorded here rather than
 * smoothed over, because "a threshold moved after it inconvenienced a test" is
 * the exact shape N-015 exists to catch. What makes this one legitimate is that
 * it is a **sufficiency** floor and not a detection threshold: it decides
 * whether the question is answerable, never which way the answer goes.
 * `MIN_GAP` is the detection threshold, and it has not moved.
 *
 * ## Two honesty properties built into the shape
 *
 * 1. **A course with a floor share and no time is included, at time share
 *    zero.** Dropping it would make the loudest possible finding the one
 *    thing this detector cannot say.
 * 2. **Courses with no known floor share are excluded from BOTH totals**, and
 *    counted in `coursesWithoutFloorShare` so a caller can say what was left
 *    out. Folding them in at floor-share zero would report every course the
 *    plan has not (yet) allocated for as under-served, which is an artefact
 *    of the plan cache's own coverage and not a fact about her term.
 *
 * ## Why this reports one named course, never an aggregate (`ol-7j54` / ARC-1)
 *
 * `widestGapCourse` is deliberately a single course, not a summary over all of
 * them: "your courses are imbalanced" would be an unscoped claim that could be
 * correct behaviour for a course just starting and a real problem for a course
 * near its end at the very same moment (the three phases are per-course, not
 * per-student). Naming the one course the widest gap belongs to is what lets
 * the copy layer meet `../insights/index.ts`'s course-naming rule — see its
 * doc — instead of presenting a fact whose truth silently depends on a phase
 * this module does not compute.
 *
 * ## Reachability note (`[D-072]` clause 5)
 *
 * `packages/plugin/src/today/data-source.ts`'s `TodayTrendsSource` now carries
 * a `listCourseFloorShares` method (renamed from `listAssessmentWeights`,
 * outside this bead's owned paths but touched pragmatically so the rename
 * compiles), and its real implementation (`createVaultTrendsSource`) returns
 * `[]` unconditionally — there is no client-side way to produce a real
 * windowed floor honestly, since component 3.5 is `boundary: service`
 * (`docs/Olea_component_register.md` row 3.5). So this re-spec has **no
 * production caller supplying real floor shares today** — the honest state,
 * named rather than papered over: the shape this module now expects
 * (`CourseFloorShare`, read from the cached study-plan artifact's
 * `contributions` array) is correct and ready for a producer, exactly the
 * posture `resolvePlanPolicyCourseInputs`'s own doc already uses for
 * `tempoWeight`/`steeringWeight`/`sittingsSinceFloorMet`. Wiring
 * `createVaultTrendsSource` to read the cached plan's floors — most likely via
 * `packages/core/src/plan/cache.ts`'s already-cached `StudyPlanArtifact` — is
 * the follow-up this bead's close notes name; until then the effort insight
 * reports `not-enough-history` in the shipped app, which is the true
 * statement for "no floor share is known yet."
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import type { ConceptCourses, InsightResult } from './types.js';

/**
 * The smallest gap between a course's windowed floor share and its share of
 * the hours that this reports as a pattern. Expressed as a share, not a
 * percentage: `0.2` is twenty points. See the module doc's note on how this
 * threshold's practical bite changed under the window-accounting re-spec.
 */
export const MIN_GAP = 0.2;

/**
 * Below this many timed reviews across the courses with a known floor share,
 * a split between them is noise and the detector declines.
 *
 * **A count, not a duration** — see the module doc for the full argument;
 * unchanged by the window-accounting re-spec.
 */
export const MIN_TIMED_REVIEWS = 40;

/** The minimum a comparison needs to exist at all. */
export const MIN_COURSES_WITH_FLOOR_SHARE = 2;

/**
 * The structural subset of `StudyPlanAllocationEntry`
 * (`packages/contracts/src/study-plan.ts`, A2.5/component 3.5) this detector
 * reads — a course's own windowed-floor fraction, restated as a plain field
 * so a caller does not have to know the `contributions`-array shape (the
 * entry named `'floor'`) to supply this detector. `undefined` means "the plan
 * has nothing to say about this course's floor right now" (no cached plan, a
 * course the plan has not run for, or a stale plan predating this course) —
 * the same "absence, never a guessed number" convention the rest of A2.5's
 * own schema already uses.
 */
export interface CourseFloorShare {
  readonly course: string | undefined;
  /** This course's windowed floor, `0..1` (`[D-092]`) — taken as given, never renormalised here. */
  readonly floorShare: number | undefined;
}

export interface CourseEffort {
  readonly course: string;
  /** Milliseconds of review time attributed to this course. */
  readonly timeMs: number;
  /** This course's share of the attributed time, across courses with a known floor share only. */
  readonly timeShare: number;
  /** This course's windowed floor share, exactly as the plan's own computation stated it (`[D-092]`). */
  readonly floorShare: number;
  /** `floorShare - timeShare`. Positive when the course has logged less time than its own guaranteed minimum. */
  readonly gap: number;
}

export interface EffortMeasured {
  /** Every course with a known floor share, sorted by `gap` descending — the widest first. */
  readonly courses: readonly CourseEffort[];
  /** The widest positive gap, or `0` when none is positive. */
  readonly widestGap: number;
  /** The course carrying `widestGap`, or `null` when no gap is positive. */
  readonly widestGapCourse: string | null;
  readonly totalTimeMs: number;
  /** Reviews that contributed time to any course. Reviews with a `null` duration contribute none. */
  readonly timedReviewCount: number;
  /** Of those, the ones on a course with a known floor share — the sample size behind the split. */
  readonly weightedReviewCount: number;
  /**
   * Courses that appear in her review history but have no known floor share
   * from the plan, so are in neither total. Surfaced so a caller can say what
   * was left out rather than quietly narrowing the claim.
   */
  readonly coursesWithoutFloorShare: readonly string[];
}

export type EffortInsight = InsightResult<EffortMeasured>;

export interface EffortInput {
  readonly entries: readonly ReviewLogEntry[];
  readonly concepts: readonly ConceptCourses[];
  readonly floorShares: readonly CourseFloorShare[];
}

function reviewsOf(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return entries.filter((entry): entry is ReviewLogRecord => entry.kind === 'review');
}

function abstain(reason: string): EffortInsight {
  return { id: 'effort-balance', status: 'not-enough-history', measured: null, reason };
}

/** Pure. Reads no clock and no vault. */
export function detectEffortImbalance(input: EffortInput): EffortInsight {
  const floorShareByCourse = new Map<string, number>();
  for (const entry of input.floorShares) {
    const { course, floorShare } = entry;
    if (course === undefined || course === '') continue;
    if (floorShare === undefined || !Number.isFinite(floorShare) || floorShare <= 0) continue;
    // One floor share per course from the plan, not summed across records —
    // a later entry for the same course (a plan re-read, say) replaces
    // rather than accumulates.
    floorShareByCourse.set(course, floorShare);
  }
  if (floorShareByCourse.size < MIN_COURSES_WITH_FLOOR_SHARE) {
    return abstain(`fewer than ${MIN_COURSES_WITH_FLOOR_SHARE} courses have a known floor share`);
  }

  const coursesOfConcept = new Map<string, readonly string[]>();
  for (const concept of input.concepts) coursesOfConcept.set(concept.conceptId, concept.courses);

  const timeByCourse = new Map<string, number>();
  const seenCourses = new Set<string>();
  let timedReviewCount = 0;
  let weightedReviewCount = 0;
  for (const record of reviewsOf(input.entries)) {
    if (record.durationMs === null) continue;
    // Set semantics: two of a record's concepts sharing a course must not
    // attribute that record's time to it twice.
    const courses = new Set<string>();
    for (const conceptId of record.conceptIds) {
      for (const course of coursesOfConcept.get(conceptId) ?? []) courses.add(course);
    }
    if (courses.size === 0) continue;
    timedReviewCount += 1;
    let countsTowardWeighted = false;
    for (const course of courses) {
      seenCourses.add(course);
      if (!floorShareByCourse.has(course)) continue;
      countsTowardWeighted = true;
      timeByCourse.set(course, (timeByCourse.get(course) ?? 0) + record.durationMs);
    }
    // Counted once per record, however many floor-share courses it touches:
    // this is the sample size behind the split, not another attribution.
    if (countsTowardWeighted) weightedReviewCount += 1;
  }

  const totalTimeMs = [...timeByCourse.values()].reduce((sum, ms) => sum + ms, 0);
  if (weightedReviewCount < MIN_TIMED_REVIEWS || totalTimeMs <= 0) {
    return abstain(
      `fewer than ${MIN_TIMED_REVIEWS} timed reviews on a course with a known floor share`,
    );
  }

  const courses: CourseEffort[] = [...floorShareByCourse.entries()]
    .map(([course, floorShare]) => {
      const timeMs = timeByCourse.get(course) ?? 0;
      const timeShare = timeMs / totalTimeMs;
      return { course, timeMs, timeShare, floorShare, gap: floorShare - timeShare };
    })
    .sort((a, b) => (b.gap !== a.gap ? b.gap - a.gap : a.course < b.course ? -1 : 1));

  const widest = courses[0];
  const widestGap = widest !== undefined && widest.gap > 0 ? widest.gap : 0;
  const widestGapCourse = widest !== undefined && widest.gap > 0 ? widest.course : null;

  const coursesWithoutFloorShare = [...seenCourses]
    .filter((c) => !floorShareByCourse.has(c))
    .sort();

  const measured: EffortMeasured = {
    courses,
    widestGap,
    widestGapCourse,
    totalTimeMs,
    timedReviewCount,
    weightedReviewCount,
    coursesWithoutFloorShare,
  };

  return widestGap >= MIN_GAP
    ? {
        id: 'effort-balance',
        status: 'observed',
        measured,
        reason: `widest floor-minus-time gap ${widestGap.toFixed(3)} reaches ${MIN_GAP}`,
      }
    : {
        id: 'effort-balance',
        status: 'not-observed',
        measured,
        reason: `widest floor-minus-time gap ${widestGap.toFixed(3)} is below ${MIN_GAP}`,
      };
}
