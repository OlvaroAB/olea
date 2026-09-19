import { describe, expect, it } from 'vitest';
import type { AssessmentRecord } from '../assessment/types.js';
import type { ConceptRecord } from '../concept/types.js';
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

function concept(overrides: Partial<ConceptRecord> = {}): ConceptRecord {
  return {
    key: 'concept-a',
    name: 'Concept A',
    tier: 2,
    courses: ['COURSE-A'],
    sourcePaths: ['01 Courses/COURSE-A/note.md'],
    ...overrides,
  };
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
            conceptPriority({
              factors: {
                ...conceptPriority().factors,
                masteryState: 'tree',
                retrievabilityWeight: 1,
              },
            }),
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

  it('[D-264]/ol-v7r5.53: a defined retrievabilityWeight — even a genuine near-zero — counts as eligible for evidenceVolume and contributes its real value to readiness, never a policy zero', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([
        {
          course: 'COURSE-A',
          status: 'ranked',
          ranked: [
            conceptPriority({
              conceptName: 'weak-but-eligible',
              factors: { ...conceptPriority().factors, retrievabilityWeight: 0.02 },
            }),
          ],
        },
      ]),
      [],
    );

    // A real (if very low) reading is NOT the same fact as "no eligible
    // evidence" — it must still count toward evidenceVolume and must
    // contribute its own value to readiness, not the `undefined` case's
    // policy zero.
    expect(result[0]?.evidenceVolume).toBe(1);
    expect(result[0]?.readiness).toBe(0.02);
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

  it('[D-264]/ol-v7r5.53: readiness is the mean of retrievabilityWeight (policy-zeroed on absence); evidenceVolume is the defined-vs-undefined (recall-tier-eligible) fraction', () => {
    const result = resolvePlanPolicyCourseInputs(
      '2026-09-01',
      ranking([
        {
          course: 'COURSE-A',
          status: 'ranked',
          ranked: [
            // A defined, full reading (e.g. a recall-tier instrument last
            // reviewed at full confidence).
            conceptPriority({
              conceptName: 'c1',
              factors: { ...conceptPriority().factors, retrievabilityWeight: 1 },
            }),
            // `'seed'` — no evidence at all — has no retrievabilityWeight
            // producer to read; still `undefined` under the new fold, same
            // policy-zero outcome the `[D-264]` audit (`ol-v7r5.47`) already
            // established for this case.
            conceptPriority({
              conceptName: 'c2',
              factors: { ...conceptPriority().factors, masteryState: 'seed' },
            }),
            // `'unknown'` (no mastery data supplied at all) is likewise
            // `undefined` here — no eligible recall-tier evidence.
            conceptPriority({
              conceptName: 'c3',
              factors: { ...conceptPriority().factors, masteryState: 'unknown' },
            }),
            // A defined, partial reading.
            conceptPriority({
              conceptName: 'c4',
              factors: { ...conceptPriority().factors, retrievabilityWeight: 0.5 },
            }),
            // R7's gap this reconciliation closes: a concept practised only
            // through a recognition-tier (MCQ) instrument can still reach
            // `sapling`/`sprout` on `masteryState` alone, but produces no
            // recall-tier retrievability reading — `undefined` here, where
            // the old `masteryState`-based fold would have counted it as
            // evidenced.
            conceptPriority({
              conceptName: 'c5',
              factors: { ...conceptPriority().factors, masteryState: 'sprout' },
            }),
          ],
        },
      ]),
      [],
    );

    // readiness: (1 + 0 + 0 + 0.5 + 0) / 5 = 0.3 — c2/c3/c5's absence each
    // contributes the policy zero, never a measured value.
    // evidenceVolume: defined for c1, c4 only → 2/5 = 0.4.
    expect(result[0]?.readiness).toBe(0.3);
    expect(result[0]?.evidenceVolume).toBe(0.4);
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

  // HARD-2c (`ol-3ux7.5.57.14.34`): F4.7's fallback also has to reach a course
  // `rankOracle` never even reported on — see the module doc.
  describe('F4.7 fallback — courses rankOracle never reported on', () => {
    it('a course with material arrived but no assessment record at all still gets a running-course entry', () => {
      const result = resolvePlanPolicyCourseInputs(
        '2026-09-01',
        ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
        [assessment({ course: 'COURSE-A', due: '2026-09-10' })],
        [concept({ courses: ['COURSE-A', 'COURSE-B'] })],
      );

      expect(result.map((r) => r.courseId)).toEqual(['COURSE-A', 'COURSE-B']);
      expect(result[1]).toEqual({
        courseId: 'COURSE-B',
        daysToNextAssessment: null,
        assessmentWorth: 1,
        readiness: 0,
        evidenceVolume: 0,
      });
    });

    it('a course with material arrived and only passed assessments on file also still gets an entry', () => {
      const result = resolvePlanPolicyCourseInputs(
        '2026-09-01',
        ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
        [assessment({ course: 'COURSE-A', due: '2026-08-01' })],
        [concept({ courses: ['COURSE-A'] })],
      );

      // COURSE-A is already in the ranking (its passed assessment never dropped
      // it from `rankOracle`'s own course set) — the fallback path is inert here,
      // and `daysToNextAssessment` still falls to null via the ordinary path.
      expect(result).toHaveLength(1);
      expect(result[0]?.courseId).toBe('COURSE-A');
      expect(result[0]?.daysToNextAssessment).toBeNull();
    });

    it('a course with neither material nor an assessment record is not running', () => {
      const result = resolvePlanPolicyCourseInputs(
        '2026-09-01',
        ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
        [assessment({ course: 'COURSE-A' })],
        [concept({ courses: ['COURSE-A'] })],
      );

      expect(result.map((r) => r.courseId)).toEqual(['COURSE-A']);
      expect(result.some((r) => r.courseId === 'COURSE-C')).toBe(false);
    });

    it('a caller passing no concepts at all reproduces the pre-fix behaviour exactly', () => {
      const withDefault = resolvePlanPolicyCourseInputs(
        '2026-09-01',
        ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
        [assessment({ course: 'COURSE-A' })],
      );
      const withEmpty = resolvePlanPolicyCourseInputs(
        '2026-09-01',
        ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
        [assessment({ course: 'COURSE-A' })],
        [],
      );

      expect(withDefault).toEqual(withEmpty);
      expect(withDefault).toHaveLength(1);
    });
  });
});
