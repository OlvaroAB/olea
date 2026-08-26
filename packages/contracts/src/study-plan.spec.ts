import { describe, expect, it } from 'vitest';
import { contracts } from './registry.js';
import {
  STUDY_PLAN_CONTRACT_ID,
  STUDY_PLAN_FORMAT_VERSION,
  type StudyPlanArtifact,
  studyPlanArtifact,
} from './study-plan.js';

/**
 * Fixture vocabulary is deliberately synthetic and non-vault (INV-3): course
 * codes and concept names here are placeholders, never anything from her
 * material.
 */
function validPlan(): StudyPlanArtifact {
  return {
    formatVersion: 1,
    planVersion: 'sp1-0123456789abcdef',
    computedAt: '2026-08-16T09:00:00.000Z',
    asOf: '2026-08-16',
    courses: [
      {
        course: 'COURSE-A',
        status: 'ranked',
        concepts: [
          {
            conceptId: 'concept-alpha',
            rank: 1,
            weight: 0.72,
            examProximityDays: 9,
            reasoning: 'concept-alpha (COURSE-A): 2 citations across 1 past paper.',
            citations: [{ sourcePath: 'papers/2024.md', questionLabel: 'Q1' }],
          },
        ],
      },
      {
        course: 'COURSE-B',
        status: 'abstained',
        reason: 'no-evidence',
        detail: 'COURSE-B: 1 assessment registered with zero evidence edges.',
        assessmentPaths: ['assessments/b-final.md'],
      },
    ],
  };
}

describe('studyPlanArtifact', () => {
  it('accepts a well-formed plan carrying both a ranking and an abstention', () => {
    const parsed = studyPlanArtifact.parse(validPlan());
    expect(parsed.planVersion).toBe('sp1-0123456789abcdef');
    expect(parsed.courses.map((c) => c.status)).toEqual(['ranked', 'abstained']);
  });

  it('pins formatVersion as a literal discriminant, so an unknown version cannot parse', () => {
    expect(STUDY_PLAN_FORMAT_VERSION).toBe(1);
    const future = { ...validPlan(), formatVersion: 2 };
    expect(studyPlanArtifact.safeParse(future).success).toBe(false);
    // ...and an untagged blob is not a plan either. This is the property the
    // whole discriminant exists for: a reader never has to guess what an
    // on-disk blob meant.
    const untagged: Record<string, unknown> = { ...validPlan() };
    delete untagged.formatVersion;
    expect(studyPlanArtifact.safeParse(untagged).success).toBe(false);
  });

  it('requires a non-empty planVersion — C7.6 has nothing to record without one', () => {
    expect(studyPlanArtifact.safeParse({ ...validPlan(), planVersion: '' }).success).toBe(false);
  });

  it('rejects a ranked concept with no citations (G5: cites or abstains)', () => {
    const plan = validPlan();
    const ranked = plan.courses[0];
    if (ranked?.status !== 'ranked') throw new Error('fixture drift');
    const broken = {
      ...plan,
      courses: [{ ...ranked, concepts: [{ ...ranked.concepts[0], citations: [] }] }],
    };
    expect(studyPlanArtifact.safeParse(broken).success).toBe(false);
  });

  it('rejects a ranked course with an empty concept list — that case abstains instead', () => {
    const plan = validPlan();
    const ranked = plan.courses[0];
    if (ranked?.status !== 'ranked') throw new Error('fixture drift');
    const broken = { ...plan, courses: [{ ...ranked, concepts: [] }] };
    expect(studyPlanArtifact.safeParse(broken).success).toBe(false);
  });

  it('rejects an abstention with nothing to cite', () => {
    const plan = validPlan();
    const abstained = plan.courses[1];
    if (abstained?.status !== 'abstained') throw new Error('fixture drift');
    const broken = { ...plan, courses: [{ ...abstained, assessmentPaths: [] }] };
    expect(studyPlanArtifact.safeParse(broken).success).toBe(false);
  });

  it('rejects an abstention wearing a ranking’s fields, and vice versa', () => {
    const plan = validPlan();
    // status drives the discriminated union: a course claiming to abstain while
    // carrying concepts is not a shape any reader has to reconcile.
    const muddled = {
      ...plan,
      courses: [{ course: 'COURSE-C', status: 'abstained', concepts: [] }],
    };
    expect(studyPlanArtifact.safeParse(muddled).success).toBe(false);
  });

  it('requires asOf to be a calendar day and computedAt to carry an offset', () => {
    expect(studyPlanArtifact.safeParse({ ...validPlan(), asOf: '2026-8-16' }).success).toBe(false);
    expect(
      studyPlanArtifact.safeParse({ ...validPlan(), computedAt: '2026-08-16T09:00:00' }).success,
    ).toBe(false);
  });

  it('accepts an optional D7.3 stamp when a Worker contributed, and its absence when none did', () => {
    expect(studyPlanArtifact.safeParse(validPlan()).success).toBe(true);
    const stamped = {
      ...validPlan(),
      stamp: {
        contractVersion: 1,
        promptVersion: '2026-08-16.1',
        modelId: 'test/model',
        usage: {
          inputTokens: 0,
          inputTokensSource: 'unreported' as const,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
        },
      },
    };
    expect(studyPlanArtifact.safeParse(stamped).success).toBe(true);
  });

  it('registers itself in the shared contract registry under a stable id', () => {
    expect(contracts.has(STUDY_PLAN_CONTRACT_ID)).toBe(true);
    expect(contracts.get(STUDY_PLAN_CONTRACT_ID)?.schema.parse(validPlan())).toBeDefined();
  });
});
