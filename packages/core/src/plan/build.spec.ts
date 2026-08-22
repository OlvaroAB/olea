import { describe, expect, it } from 'vitest';
import type { EvidenceQuestionCitation } from '../evidence-edge/types.js';
import type {
  ConceptPriority,
  CourseOracleRanking,
  OracleEdgeContribution,
  RankOracleResult,
} from '../oracle/types.js';
import type { VaultPath } from '../vault/types.js';
import { buildStudyPlan, studyPlanVersion } from './build.js';

/**
 * Synthetic vocabulary throughout (INV-3): nothing here is from her vault, and
 * nothing here calibrates anything — these are shape fixtures, not data.
 */
function citation(sourcePath: string, questionLabel: string): EvidenceQuestionCitation {
  return {
    sourcePath: sourcePath as VaultPath,
    questionLabel,
    questionText: 'synthetic question text',
    provenance: {
      sourcePath: sourcePath as VaultPath,
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
  };
}

function contribution(overrides: Partial<OracleEdgeContribution> = {}): OracleEdgeContribution {
  return {
    assessmentPath: 'assessments/exam.md' as VaultPath,
    yieldRank: 1,
    yieldScore: 1,
    confidence: 0.8,
    assessmentWeightKnown: true,
    assessmentWeightScore: 0.4,
    daysUntilDue: 12,
    examProximityScore: 0.5,
    evidenceStrength: 0.8,
    contribution: 0.16,
    ...overrides,
  };
}

function conceptPriority(overrides: Partial<ConceptPriority> = {}): ConceptPriority {
  const citations = overrides.citations ?? [citation('papers/2024.md', 'Q1')];
  return {
    conceptName: 'concept-alpha',
    course: 'COURSE-A',
    rank: 1,
    priorityScore: 0.16,
    factors: {
      citations,
      distinctSourceCount: new Set(citations.map((c) => c.sourcePath)).size,
      contributions: [contribution()],
      preMasteryScore: 0.16,
      masteryState: 'new',
      masteryNeedWeight: 1,
      priorityScore: 0.16,
    },
    citations,
    reasoning: 'concept-alpha (COURSE-A): derived reasoning.',
    ...overrides,
  };
}

function ranking(courses: readonly CourseOracleRanking[], asOf = '2026-08-16'): RankOracleResult {
  return { courses, unattributableAssessments: [], asOf };
}

const COMPUTED_AT = '2026-08-16T09:00:00.000Z';

describe('buildStudyPlan', () => {
  it('carries rank, weight, reasoning and citations through for every ranked concept', async () => {
    const plan = await buildStudyPlan({
      ranking: ranking([
        {
          course: 'COURSE-A',
          status: 'ranked',
          ranked: [
            conceptPriority(),
            conceptPriority({
              conceptName: 'concept-beta',
              rank: 2,
              priorityScore: 0.05,
              citations: [citation('papers/2023.md', 'Q4')],
              reasoning: 'concept-beta (COURSE-A): derived reasoning.',
            }),
          ],
        },
      ]),
      computedAt: COMPUTED_AT,
    });

    const course = plan.courses[0];
    if (course?.status !== 'ranked') throw new Error('expected a ranked course');
    expect(course.concepts.map((c) => [c.conceptId, c.rank, c.weight])).toEqual([
      ['concept-alpha', 1, 0.16],
      ['concept-beta', 2, 0.05],
    ]);
    for (const concept of course.concepts) {
      expect(concept.reasoning).toContain('derived reasoning');
      expect(concept.citations.length).toBeGreaterThan(0);
    }
    expect(course.concepts[0]?.citations).toEqual([
      { sourcePath: 'papers/2024.md', questionLabel: 'Q1' },
    ]);
  });

  it('preserves an abstention as an abstention, never as an empty ranking', async () => {
    const plan = await buildStudyPlan({
      ranking: ranking([
        {
          course: 'COURSE-B',
          status: 'abstained',
          reason: 'no-evidence',
          detail: 'COURSE-B: 2 assessments with zero evidence edges.',
          assessmentPaths: ['assessments/b1.md' as VaultPath, 'assessments/b2.md' as VaultPath],
        },
      ]),
      computedAt: COMPUTED_AT,
    });

    const course = plan.courses[0];
    expect(course?.status).toBe('abstained');
    if (course?.status !== 'abstained') throw new Error('expected an abstention');
    expect(course.assessmentPaths).toEqual(['assessments/b1.md', 'assessments/b2.md']);
    expect(course.detail).toContain('zero evidence edges');
    // The failure this guards: a builder that mapped `ranked` over every course
    // would emit `{ status: 'ranked', concepts: [] }` here, which reads as
    // "considered and found nothing" rather than "declined to guess".
    expect(Object.hasOwn(course, 'concepts')).toBe(false);
  });

  it('refuses a ranked course with no entries rather than emitting an empty ranking', async () => {
    await expect(
      buildStudyPlan({
        ranking: ranking([{ course: 'COURSE-C', status: 'ranked', ranked: [] }]),
        computedAt: COMPUTED_AT,
      }),
    ).rejects.toThrow(/must abstain, never rank empty/);
  });

  describe('planVersion', () => {
    it('is identical for the same policy computed at two different instants', async () => {
      const source = ranking([
        { course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] },
      ]);
      const first = await buildStudyPlan({ ranking: source, computedAt: COMPUTED_AT });
      const second = await buildStudyPlan({
        ranking: source,
        computedAt: '2026-08-17T23:45:00.000Z',
      });

      expect(second.planVersion).toBe(first.planVersion);
      // ...and the two plans are genuinely different documents, so this is not
      // passing because nothing changed at all.
      expect(second.computedAt).not.toBe(first.computedAt);
    });

    it('differs when the ranking differs — a changed weight is a changed plan', async () => {
      const base = await buildStudyPlan({
        ranking: ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] }]),
        computedAt: COMPUTED_AT,
      });
      const reweighted = await buildStudyPlan({
        ranking: ranking([
          {
            course: 'COURSE-A',
            status: 'ranked',
            ranked: [conceptPriority({ priorityScore: 0.17 })],
          },
        ]),
        computedAt: COMPUTED_AT,
      });

      expect(reweighted.planVersion).not.toBe(base.planVersion);
    });

    it('differs when only the order of two equally-weighted concepts differs', async () => {
      const alpha = conceptPriority({ conceptName: 'concept-alpha', rank: 1 });
      const beta = conceptPriority({ conceptName: 'concept-beta', rank: 2 });
      const forward = await buildStudyPlan({
        ranking: ranking([{ course: 'COURSE-A', status: 'ranked', ranked: [alpha, beta] }]),
        computedAt: COMPUTED_AT,
      });
      const reversed = await buildStudyPlan({
        ranking: ranking([
          {
            course: 'COURSE-A',
            status: 'ranked',
            ranked: [
              { ...beta, rank: 1 },
              { ...alpha, rank: 2 },
            ],
          },
        ]),
        computedAt: COMPUTED_AT,
      });

      expect(reversed.planVersion).not.toBe(forward.planVersion);
    });

    it('differs when only asOf differs — the same scores read from a different day are a different policy', async () => {
      const courses = [
        { course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] },
      ] as const;
      const monday = await buildStudyPlan({
        ranking: ranking(courses, '2026-08-16'),
        computedAt: COMPUTED_AT,
      });
      const tuesday = await buildStudyPlan({
        ranking: ranking(courses, '2026-08-17'),
        computedAt: COMPUTED_AT,
      });

      expect(tuesday.planVersion).not.toBe(monday.planVersion);
    });

    it('is not moved by the D7.3 stamp — provenance is not policy', async () => {
      const source = ranking([
        { course: 'COURSE-A', status: 'ranked', ranked: [conceptPriority()] },
      ]);
      const bare = await buildStudyPlan({ ranking: source, computedAt: COMPUTED_AT });
      const stamped = await buildStudyPlan({
        ranking: source,
        computedAt: COMPUTED_AT,
        stamp: { contractVersion: 1, promptVersion: '2026-08-16.1', modelId: 'test/model' },
      });

      expect(stamped.planVersion).toBe(bare.planVersion);
      expect(stamped.stamp?.modelId).toBe('test/model');
      expect(bare.stamp).toBeUndefined();
    });

    it('names its own format, so versions from two formats can never collide', async () => {
      const version = await studyPlanVersion('2026-08-16', []);
      expect(version).toMatch(/^sp1-[0-9a-f]{16}$/);
    });
  });

  describe('examProximityDays', () => {
    it('is the nearest still-future assessment, not the strongest-contributing one', async () => {
      const plan = await buildStudyPlan({
        ranking: ranking([
          {
            course: 'COURSE-A',
            status: 'ranked',
            ranked: [
              conceptPriority({
                factors: {
                  ...conceptPriority().factors,
                  contributions: [
                    // The strongest contributor is the distant one; the nearest
                    // relevant assessment is the weak one three days out.
                    contribution({ contribution: 0.4, daysUntilDue: 30 }),
                    contribution({
                      assessmentPath: 'assessments/quiz.md' as VaultPath,
                      contribution: 0.01,
                      daysUntilDue: 3,
                    }),
                  ],
                },
              }),
            ],
          },
        ]),
        computedAt: COMPUTED_AT,
      });

      const course = plan.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected a ranked course');
      expect(course.concepts[0]?.examProximityDays).toBe(3);
    });

    it('ignores assessments already past, and reports null when nothing future is readable', async () => {
      const plan = await buildStudyPlan({
        ranking: ranking([
          {
            course: 'COURSE-A',
            status: 'ranked',
            ranked: [
              conceptPriority({
                factors: {
                  ...conceptPriority().factors,
                  contributions: [
                    contribution({ daysUntilDue: -5 }),
                    contribution({
                      assessmentPath: 'assessments/unparsed.md' as VaultPath,
                      daysUntilDue: null,
                    }),
                  ],
                },
              }),
            ],
          },
        ]),
        computedAt: COMPUTED_AT,
      });

      const course = plan.courses[0];
      if (course?.status !== 'ranked') throw new Error('expected a ranked course');
      expect(course.concepts[0]?.examProximityDays).toBeNull();
    });
  });
});
