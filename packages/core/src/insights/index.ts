/**
 * F6.5 — the observed-pattern insights, composed (`ol-p6t04` / P6-T04).
 *
 * Two detectors, both pure functions of D7.1 plus (for the effort half) the
 * concept↔course map and the plan's per-course windowed floor shares
 * (component 3.5, `[D-081]`/`[D-092]`, re-specified from raw assessment
 * weight by `ol-v7r5.33`). Neither writes, neither reads a clock, and neither
 * takes a control stream: see each module's doc for why the statistics were
 * chosen so that a real student's log is self-sufficient.
 *
 * **`buildInsights` never decides what to say — only what is true.** The
 * sentences live in `packages/plugin/src/today/copy.ts`, in one enumerable
 * list, because `ol-p6t04`'s acceptance criteria require David to review the
 * phrasing before ship and a sentence assembled inside a detector is a sentence
 * nobody can enumerate.
 *
 * ## The course-naming rule (`ol-7j54` / ARC-1) — binding on every insight this module gains
 *
 * The three phases of a course (early/mid/late) are a property of a COURSE,
 * not of the student: with two courses running, one can be in its Late phase
 * while the other is in its Early phase in the same five minutes on the same
 * panel. No detector here computes a phase — David's ruling (`ol-7j54`'s
 * notes, Cluster C paper §8) forbids contracting one, because assessment
 * proximity already carries the urgency a phase would encode, from real dates
 * in her log rather than a stage this module would have to define and detect.
 *
 * **The residue is a copy rule, not a data model: any insight whose truth
 * depends on where a course sits in its term MUST name that course
 * explicitly, in the emitted line.** "Most of your review time went to
 * course A" is correct behaviour early in a course and a real problem late in
 * it — the sentence is identical either way, so naming the course is what
 * lets the reader (who knows her own term) judge it herself, instead of being
 * handed a statement that is simultaneously true of one running course and
 * false about another.
 *
 * An insight that holds regardless of any single course's position is
 * **exempt** — the rule binds a course-*attributed* claim, not every claim.
 * `detectSpacing` is the worked exemption: it measures her rate of work
 * around *any* assessment, never attributes the finding to one course, and so
 * cannot be true of one running course and wrong about another.
 * `detectEffortImbalance` is the worked case the rule binds: `widestGapCourse`
 * names the single course a gap is about (never an aggregate "your courses are
 * imbalanced"), and `packages/plugin/src/today/copy.ts`'s `effortInsightLine`
 * takes a whole `CourseEffort` record rather than bare numbers, so a caller has
 * no way to reach the sentence without also holding the course it measures.
 * The next insight added here must clear the same bar: if its truth varies
 * with a course's position in its term, its result type must carry that
 * course, and the copy that renders it must name the course rather than
 * present an unscoped fact.
 */

export type {
  CourseEffort,
  CourseFloorShare,
  EffortInput,
  EffortInsight,
  EffortMeasured,
} from './effort.js';
export {
  detectEffortImbalance,
  MIN_COURSES_WITH_FLOOR_SHARE,
  MIN_GAP,
  MIN_TIMED_REVIEWS,
} from './effort.js';
export type { SpacingInsight, SpacingMeasured } from './spacing.js';
export {
  ATTENDANCE_RATIO,
  CONCENTRATION_RATIO,
  detectSpacing,
  impliedAssessmentDays,
  MIN_REVIEWS,
  MIN_SPAN_DAYS,
  PRE_ASSESSMENT_WINDOW_DAYS,
} from './spacing.js';
export type { ConceptCourses, InsightId, InsightResult, InsightStatus } from './types.js';

import type { ReviewLogEntry } from 'olea-contracts';
import { type CourseFloorShare, detectEffortImbalance, type EffortInsight } from './effort.js';
import { detectSpacing, type SpacingInsight } from './spacing.js';
import type { ConceptCourses } from './types.js';

export interface InsightsInput {
  readonly entries: readonly ReviewLogEntry[];
  readonly concepts: readonly ConceptCourses[];
  /**
   * The plan's per-course windowed floor shares (component 3.5,
   * `[D-081]`/`[D-092]`) — read from the cached study-plan artifact, never
   * recomputed here. Empty is a real and common state — no cached plan yet,
   * or one that predates this wiring — and produces `not-enough-history` on
   * the effort half rather than a finding computed over nothing. **No
   * production caller supplies this today** — see `effort.ts`'s module doc,
   * "Reachability note".
   */
  readonly floorShares: readonly CourseFloorShare[];
}

export interface InsightsSummary {
  readonly spacing: SpacingInsight;
  readonly effort: EffortInsight;
}

export function buildInsights(input: InsightsInput): InsightsSummary {
  return {
    spacing: detectSpacing(input.entries),
    effort: detectEffortImbalance({
      entries: input.entries,
      concepts: input.concepts,
      floorShares: input.floorShares,
    }),
  };
}
