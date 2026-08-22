/**
 * F6.5 — the observed-pattern insights, composed (`ol-p6t04` / P6-T04).
 *
 * Two detectors, both pure functions of D7.1 plus (for the effort half) the
 * concept↔course map and her assessment weights. Neither writes, neither reads
 * a clock, and neither takes a control stream: see each module's doc for why
 * the statistics were chosen so that a real student's log is self-sufficient.
 *
 * **`buildInsights` never decides what to say — only what is true.** The
 * sentences live in `packages/plugin/src/today/copy.ts`, in one enumerable
 * list, because `ol-p6t04`'s acceptance criteria require David to review the
 * phrasing before ship and a sentence assembled inside a detector is a sentence
 * nobody can enumerate.
 */

export type {
  CourseEffort,
  EffortInput,
  EffortInsight,
  EffortMeasured,
  WeightedAssessment,
} from './effort.js';
export {
  detectEffortImbalance,
  MIN_GAP,
  MIN_TIMED_REVIEWS,
  MIN_WEIGHTED_COURSES,
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
import { detectEffortImbalance, type EffortInsight, type WeightedAssessment } from './effort.js';
import { detectSpacing, type SpacingInsight } from './spacing.js';
import type { ConceptCourses } from './types.js';

export interface InsightsInput {
  readonly entries: readonly ReviewLogEntry[];
  readonly concepts: readonly ConceptCourses[];
  /**
   * Her assignment notes' weights (F1.1). Empty is a real and common state —
   * a vault with no assignments table — and produces `not-enough-history` on
   * the effort half rather than a finding computed over nothing.
   */
  readonly assessments: readonly WeightedAssessment[];
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
      assessments: input.assessments,
    }),
  };
}
