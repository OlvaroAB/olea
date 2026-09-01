import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptPriority, CourseOracleRanking, RankOracleResult } from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import { resolvePlanPolicyCourseInputs } from './resolve-inputs.js';

/**
 * `ol-v7r5.25`. Synthetic vocabulary throughout (INV-3): course ids and
 * paths below are placeholders, never anything from her vault.
 */
function assessment(overrides: Partial<AssessmentRecord> & { course: string }): AssessmentRecord {
  return {
    path: 'assessments/a.md' as VaultPath,
    type: 'Test',
    weight: 0.2,
    weightRaw: '20',
    due: '2026-09-10',
    status: 'upcoming',
    ...overrides,
  };
}

function conceptPriority(overrides: Partial<ConceptPriority> = {}): ConceptPriority {
  const conceptName = overrides.conceptName ?? 'concept-alpha';
  return {
    conceptName,
    conceptKey: conceptName,
    course: 'COURSE-A',
    rank: 1,
    priorityScore: 0.16,
    factors: {
      citations: [],
      distinctSourceCount: 0,
      contributions: [],
      preMasteryScore: 0.16,
      masteryState: 'seed',
      masteryNeedWeight: 1,
      priorityScore: 0.16,
    },
    citations: [],
    reasoning: 'synthetic',
    ...overrides,
  };
}

function ranking(courses: readonly CourseOracleRanking[], asOf = '2026-09-01'): RankOracleResult {
  return { courses, unattributableAssessments: [], asOf };
}

describe('resolvePlanPolicyCourseInputs', () => {
  it('reads daysToNextAssessment and assessmentWorth straight off the nearest future assessment, un-decayed', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([
        {
          course: 'COURSE-A',
          status: 'ranked',
          ranked: [
            conceptPriority({ factors: { ...conceptPriority().factors, masteryState: 'tree' } }),
          ],
        },
      ]),
      [
        assessment({ course: 'COURSE-A', due: '2026-09-30', weight: 0.5 }),
        assessment({
          course: 'COURSE-A',
          path: 'assessments/near.md' as VaultPath,
          due: '2026-09-10',
          weight: 0.2,
        }),
      ],
    );

    expect(result).toEqual([
      {
        courseId: 'COURSE-A',
        daysToNextAssessment: 9,
        assessmentWorth: 0.2,
        readiness: 1,
        evidenceVolume: 1,
      },
    ]);
  });

  it('ignores assessments already past and reports null/neutral when nothing future is readable', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
      [assessment({ course: 'COURSE-A', due: '2026-08-01' })],
    );

    expect(result[0]?.daysToNextAssessment).toBeNull();
    expect(result[0]?.assessmentWorth).toBe(1);
  });

  it('defaults assessmentWorth to neutral (1) when the nearest assessment has no readable weight', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
      [assessment({ course: 'COURSE-A', weight: undefined, weightRaw: undefined })],
    );

    expect(result[0]?.assessmentWorth).toBe(1);
  });

  it('averages readiness (sapling/tree share) and evidenceVolume (not-unknown share) over the ranked concepts', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([
        {
          course: 'COURSE-A',
          status: 'ranked',
          ranked: [
            conceptPriority({
              conceptName: 'c1',
              factors: { ...conceptPriority().factors, masteryState: 'tree' },
            }),
            conceptPriority({
              conceptName: 'c2',
              factors: { ...conceptPriority().factors, masteryState: 'seed' },
            }),
            conceptPriority({
              conceptName: 'c3',
              factors: { ...conceptPriority().factors, masteryState: 'unknown' },
            }),
            conceptPriority({
              conceptName: 'c4',
              factors: { ...conceptPriority().factors, masteryState: 'sapling' },
            }),
          ],
        },
      ]),
      [],
    );

    // solid (sapling|tree): c1, c4 → 2/4 = 0.5; evidenced (not unknown): c1, c2, c4 → 3/4 = 0.75
    expect(result[0]?.readiness).toBe(0.5);
    expect(result[0]?.evidenceVolume).toBe(0.75);
  });

  it('reads an abstained course as zero readiness and zero evidence — abstention already asserts "no evidence"', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([
        {
          course: 'COURSE-B',
          status: 'abstained',
          reason: 'no-evidence',
          detail: 'synthetic',
          assessmentPaths: ['assessments/b.md' as VaultPath],
        },
      ]),
      [assessment({ course: 'COURSE-B', due: '2026-09-05', weight: 0.3 })],
    );

    expect(result).toEqual([
      {
        courseId: 'COURSE-B',
        daysToNextAssessment: 4,
        assessmentWorth: 0.3,
        readiness: 0,
        evidenceVolume: 0,
      },
    ]);
  });

  it("emits one entry per course reported by the ranking, in the ranking's own order", () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([
        { course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] },
        {
          course: 'COURSE-B',
          status: 'abstained',
          reason: 'no-evidence',
          detail: 'synthetic',
          assessmentPaths: [],
        },
      ]),
      [],
    );

    expect(result.map((r) => r.courseId)).toEqual(['COURSE-A', 'COURSE-B']);
  });
});
