/**
 * F6.5(b) — effort imbalance: where the time went, against what the
 * assessments are worth.
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
 * `packages/synthetic/test/personas.spec.ts`.
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
 * - **weight share** — the course's assessment weight over the total, from her
 *   own assignment notes (F1.1's `AssessmentRecord.weight`).
 *
 * The finding is the *gap* between them, `weightShare - timeShare`, and it is
 * signed on purpose: a positive gap is a course carrying more of the grade than
 * of the hours. The negative direction is measured too and deliberately **not**
 * surfaced as a finding — "you are over-studying X" is a verdict, and it is
 * also frequently wrong (a course can be worth more attention than its weight).
 *
 * ## The parameter, and that it was not swept
 *
 * `MIN_GAP` is one declared constant: twenty percentage points, chosen before
 * any stream was measured because it is the smallest gap that survives being
 * described out loud ("a fifth of the grade away from a fifth of the time").
 * Nothing fitted it (N-015), and the margin it clears on the planted persona
 * and her neutralised twin is reported by the workbench spec rather than
 * asserted here.
 *
 * ## Two honesty properties built into the shape
 *
 * 1. **A course with a weight and no time is included, at time share zero.**
 *    Dropping it would make the loudest possible finding the one thing this
 *    detector cannot say.
 * 2. **Courses with no stated weight are excluded from BOTH totals**, and
 *    counted in `coursesWithoutWeight` so a caller can say what was left out.
 *    Folding them in at weight zero would report every unweighted course as
 *    over-studied, which is an artefact of her note-keeping and not a fact
 *    about her term.
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
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import type { ConceptCourses, InsightResult } from './types.js';

/**
 * The smallest gap between a course's share of the grade and its share of the
 * hours that this reports as a pattern. Expressed as a share, not a
 * percentage: `0.2` is twenty points.
 */
export const MIN_GAP = 0.2;

/**
 * Below this many timed reviews across the weighted courses, a split between
 * them is noise and the detector declines.
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
 */
export const MIN_TIMED_REVIEWS = 40;

/** The minimum a comparison needs to exist at all. */
export const MIN_WEIGHTED_COURSES = 2;

/** The structural subset of F1.1's `AssessmentRecord` this detector reads. */
export interface WeightedAssessment {
  readonly course: string | undefined;
  readonly weight: number | undefined;
}

export interface CourseEffort {
  readonly course: string;
  /** Milliseconds of review time attributed to this course. */
  readonly timeMs: number;
  /** This course's share of the attributed time, across weighted courses only. */
  readonly timeShare: number;
  /** Summed assessment weight, exactly as her notes state it. */
  readonly weight: number;
  readonly weightShare: number;
  /** `weightShare - timeShare`. Positive when the course carries more of the grade than of the hours. */
  readonly gap: number;
}

export interface EffortMeasured {
  /** Every weighted course, sorted by `gap` descending — the widest first. */
  readonly courses: readonly CourseEffort[];
  /** The widest positive gap, or `0` when none is positive. */
  readonly widestGap: number;
  /** The course carrying `widestGap`, or `null` when no gap is positive. */
  readonly widestGapCourse: string | null;
  readonly totalTimeMs: number;
  /** Reviews that contributed time to any course. Reviews with a `null` duration contribute none. */
  readonly timedReviewCount: number;
  /** Of those, the ones on a course that states a weight — the sample size behind the split. */
  readonly weightedReviewCount: number;
  /**
   * Courses that appear in her review history but state no assessment weight,
   * so are in neither total. Surfaced so a caller can say what was left out
   * rather than quietly narrowing the claim.
   */
  readonly coursesWithoutWeight: readonly string[];
}

export type EffortInsight = InsightResult<EffortMeasured>;

export interface EffortInput {
  readonly entries: readonly ReviewLogEntry[];
  readonly concepts: readonly ConceptCourses[];
  readonly assessments: readonly WeightedAssessment[];
}

function reviewsOf(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return entries.filter((entry): entry is ReviewLogRecord => entry.kind === 'review');
}

function abstain(reason: string): EffortInsight {
  return { id: 'effort-balance', status: 'not-enough-history', measured: null, reason };
}

/** Pure. Reads no clock and no vault. */
export function detectEffortImbalance(input: EffortInput): EffortInsight {
  const weightByCourse = new Map<string, number>();
  for (const assessment of input.assessments) {
    const { course, weight } = assessment;
    if (course === undefined || course === '') continue;
    if (weight === undefined || !Number.isFinite(weight) || weight <= 0) continue;
    weightByCourse.set(course, (weightByCourse.get(course) ?? 0) + weight);
  }
  if (weightByCourse.size < MIN_WEIGHTED_COURSES) {
    return abstain(`fewer than ${MIN_WEIGHTED_COURSES} courses state an assessment weight`);
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
      if (!weightByCourse.has(course)) continue;
      countsTowardWeighted = true;
      timeByCourse.set(course, (timeByCourse.get(course) ?? 0) + record.durationMs);
    }
    // Counted once per record, however many weighted courses it touches: this
    // is the sample size behind the split, not another attribution.
    if (countsTowardWeighted) weightedReviewCount += 1;
  }

  const totalTimeMs = [...timeByCourse.values()].reduce((sum, ms) => sum + ms, 0);
  if (weightedReviewCount < MIN_TIMED_REVIEWS || totalTimeMs <= 0) {
    return abstain(`fewer than ${MIN_TIMED_REVIEWS} timed reviews on a weighted course`);
  }

  const totalWeight = [...weightByCourse.values()].reduce((sum, w) => sum + w, 0);
  const courses: CourseEffort[] = [...weightByCourse.entries()]
    .map(([course, weight]) => {
      const timeMs = timeByCourse.get(course) ?? 0;
      const timeShare = timeMs / totalTimeMs;
      const weightShare = weight / totalWeight;
      return { course, timeMs, timeShare, weight, weightShare, gap: weightShare - timeShare };
    })
    .sort((a, b) => (b.gap !== a.gap ? b.gap - a.gap : a.course < b.course ? -1 : 1));

  const widest = courses[0];
  const widestGap = widest !== undefined && widest.gap > 0 ? widest.gap : 0;
  const widestGapCourse = widest !== undefined && widest.gap > 0 ? widest.course : null;

  const coursesWithoutWeight = [...seenCourses].filter((c) => !weightByCourse.has(c)).sort();

  const measured: EffortMeasured = {
    courses,
    widestGap,
    widestGapCourse,
    totalTimeMs,
    timedReviewCount,
    weightedReviewCount,
    coursesWithoutWeight,
  };

  return widestGap >= MIN_GAP
    ? {
        id: 'effort-balance',
        status: 'observed',
        measured,
        reason: `widest weight-minus-time gap ${widestGap.toFixed(3)} reaches ${MIN_GAP}`,
      }
    : {
        id: 'effort-balance',
        status: 'not-observed',
        measured,
        reason: `widest weight-minus-time gap ${widestGap.toFixed(3)} is below ${MIN_GAP}`,
      };
}
