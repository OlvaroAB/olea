import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ARTIFACT_ENVELOPE_VERSION,
  type ClaimBasis,
  claim,
  claimBasis,
  envelopeFreshness,
  evidenceRef,
  GOVERNING_FRESH_FOR_SECONDS,
  GOVERNING_GOVERNS_FOR_SECONDS,
  MISCONCEPTION_MERGE_CONTRACT_ID,
  misconceptionMergeEnvelope,
  OPERATING_FRESH_FOR_SECONDS,
  OPERATING_GOVERNS_FOR_SECONDS,
  plannedConceptBasis,
  RANK_WEIGHTS_CONTRACT_ID,
  RANK_WEIGHTS_ENDPOINT_PATH,
  rankWeightsEnvelope,
  readArtifactEnvelope,
  STUDY_PLAN_ENVELOPE_CONTRACT_ID,
  STUDY_PLAN_KIND,
  type StudyPlanEnvelope,
  studyPlanEnvelope,
  VISION_ROUTE_CONTRACT_ID,
  visionRouteEnvelope,
} from './artifact-envelope.js';
import { contracts } from './registry.js';
import type { PlannedConcept, StudyPlanArtifact } from './study-plan.js';

/**
 * Fixture vocabulary is deliberately synthetic and non-vault (INV-3): course
 * codes, concept names and paths here are placeholders, never anything from her
 * material.
 */
function validPlanEnvelope(): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion: 'sp1-0123456789abcdef',
    computedAt: '2026-08-16T09:00:00.000Z',
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
    body: {
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
      ],
    },
  };
}

function firstRankedConcept(): PlannedConcept {
  const course = validPlanEnvelope().body.courses[0];
  if (course === undefined || course.status !== 'ranked') {
    throw new Error('fixture must open with a ranked course');
  }
  const concept = course.concepts[0];
  if (concept === undefined) throw new Error('fixture must rank at least one concept');
  return concept;
}

describe('the versioned-artifact envelope', () => {
  it('accepts a well-formed artifact of a known kind', () => {
    expect(studyPlanEnvelope.safeParse(validPlanEnvelope()).success).toBe(true);
  });

  it('registers every delivered surface under its own contract id', () => {
    for (const id of [
      STUDY_PLAN_ENVELOPE_CONTRACT_ID,
      VISION_ROUTE_CONTRACT_ID,
      MISCONCEPTION_MERGE_CONTRACT_ID,
      RANK_WEIGHTS_CONTRACT_ID,
    ]) {
      expect(contracts.has(id)).toBe(true);
    }
  });

  it('refuses an artifact that would expire before it goes stale', () => {
    const bad = { ...validPlanEnvelope(), governsForSeconds: GOVERNING_FRESH_FOR_SECONDS - 1 };
    expect(studyPlanEnvelope.safeParse(bad).success).toBe(false);
  });
});

describe('unknown versions are discarded, never migrated and never rendered', () => {
  it('reads a known artifact', () => {
    const result = readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, validPlanEnvelope());
    expect(result.status).toBe('ok');
  });

  it('refuses an unknown envelope version without looking at the body', () => {
    const future = { ...validPlanEnvelope(), envelopeVersion: ARTIFACT_ENVELOPE_VERSION + 1 };
    const result = readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, future);
    expect(result).toEqual({ status: 'unreadable', reason: 'unknown-envelope-version' });
  });

  it('distinguishes an unknown body version from a corrupt artifact', () => {
    const future = { ...validPlanEnvelope(), bodyVersion: 99 };
    expect(readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, future)).toEqual({
      status: 'unreadable',
      reason: 'unknown-body-version',
    });

    const corrupt = { ...validPlanEnvelope(), policyVersion: '' };
    expect(readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, corrupt)).toEqual({
      status: 'unreadable',
      reason: 'malformed',
    });
  });

  it('refuses an artifact of another kind rather than coercing it', () => {
    const result = readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, {
      ...validPlanEnvelope(),
      kind: 'vision-route',
    });
    expect(result).toEqual({ status: 'unreadable', reason: 'wrong-kind' });
  });

  it('never reports an unknown version as merely stale', () => {
    // The distinction the module doc turns on: staleness is a statement about a
    // known artifact. An unreadable one has no freshness at all.
    const future = { ...validPlanEnvelope(), envelopeVersion: 99 };
    const result = readArtifactEnvelope(studyPlanEnvelope, STUDY_PLAN_KIND, future);
    expect(result.status).toBe('unreadable');
    expect(result).not.toHaveProperty('artifact');
  });
});

describe('staleness is visible, and expiry stops the artifact governing', () => {
  const header = {
    computedAt: '2026-08-16T09:00:00.000Z',
    freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
    governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
  };

  it('is fresh inside the freshness horizon', () => {
    expect(envelopeFreshness(header, new Date('2026-08-16T20:00:00.000Z')).state).toBe('fresh');
  });

  it('goes stale — still governing — the day after it was computed', () => {
    // Yesterday's plan, not no plan. The surface must say which.
    expect(envelopeFreshness(header, new Date('2026-08-17T10:00:00.000Z')).state).toBe('stale');
  });

  it('expires at the governing horizon', () => {
    expect(envelopeFreshness(header, new Date('2026-08-23T10:00:00.000Z')).state).toBe('expired');
  });

  it('reports both instants so a surface can say when it stops', () => {
    const { freshUntil, governsUntil } = envelopeFreshness(header, new Date(header.computedAt));
    expect(freshUntil.toISOString()).toBe('2026-08-17T09:00:00.000Z');
    expect(governsUntil.toISOString()).toBe('2026-08-23T09:00:00.000Z');
  });

  it('keeps an operating constant usable far longer than a governing one', () => {
    // A stale routing threshold costs an unnecessary upload; a stale ranking
    // would tell her what to study on evidence about another week.
    expect(OPERATING_FRESH_FOR_SECONDS).toBeGreaterThan(GOVERNING_FRESH_FOR_SECONDS);
    expect(OPERATING_GOVERNS_FOR_SECONDS).toBeGreaterThan(GOVERNING_GOVERNS_FOR_SECONDS);
  });
});

describe('the evidentiary basis travels inside the artifact', () => {
  it('accepts a locator into her material and a selector over her log', () => {
    expect(
      evidenceRef.safeParse({ kind: 'source', sourcePath: 'papers/2024.md', locator: 'Q1' })
        .success,
    ).toBe(true);
    expect(
      evidenceRef.safeParse({
        kind: 'events',
        conceptId: 'concept-alpha',
        eventKinds: ['review'],
        since: '2026-08-01',
      }).success,
    ).toBe(true);
  });

  it('refuses a claim that cites nothing — an abstention is a different shape', () => {
    const basis = {
      reasoning: 'ranked first',
      factors: [{ name: 'weight', value: 0.5 }],
      evidence: [],
    };
    expect(claimBasis.safeParse(basis).success).toBe(false);
  });

  it('attaches a basis to any claim shape, and refuses the shape without one', () => {
    const ranked = claim({ conceptId: z.string().min(1) });
    expect(ranked.safeParse({ conceptId: 'concept-alpha' }).success).toBe(false);
    expect(
      ranked.safeParse({
        conceptId: 'concept-alpha',
        basis: {
          reasoning: 'ranked first',
          factors: [{ name: 'weight', value: 0.5 }],
          evidence: [{ kind: 'source', sourcePath: 'papers/2024.md', locator: 'Q1' }],
        },
      }).success,
    ).toBe(true);
  });

  it('derives the shared basis from what the study plan already carried', () => {
    const basis: ClaimBasis = plannedConceptBasis(firstRankedConcept());
    expect(claimBasis.safeParse(basis).success).toBe(true);
    expect(basis.evidence).toEqual([
      { kind: 'source', sourcePath: 'papers/2024.md', locator: 'Q1' },
    ]);
    expect(basis.factors.map((f) => f.name)).toEqual(['weight', 'rank', 'examProximityDays']);
  });
});

describe('the delivered-threshold surfaces share this envelope', () => {
  it('carries the vision route threshold', () => {
    const parsed = visionRouteEnvelope.safeParse({
      envelopeVersion: 1,
      kind: 'vision-route',
      bodyVersion: 1,
      policyVersion: 'vr1-abc',
      computedAt: '2026-08-16T09:00:00.000Z',
      freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
      governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
      body: { minTextLayerChars: 10 },
    });
    expect(parsed.success).toBe(true);
  });

  it('carries the misconception merge threshold', () => {
    const parsed = misconceptionMergeEnvelope.safeParse({
      envelopeVersion: 1,
      kind: 'misconception-merge',
      bodyVersion: 1,
      policyVersion: 'mm1-abc',
      computedAt: '2026-08-16T09:00:00.000Z',
      freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
      governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
      body: { minSimilarity: 0.92 },
    });
    expect(parsed.success).toBe(true);
  });

  it('carries the ranking-weights policy', () => {
    const parsed = rankWeightsEnvelope.safeParse({
      envelopeVersion: 1,
      kind: 'rank-weights',
      bodyVersion: 1,
      policyVersion: 'rw1-abc',
      computedAt: '2026-08-16T09:00:00.000Z',
      freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
      governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
      body: {
        proximityHalfLifeDays: 14,
        assessmentWeightDivisor: 100,
        masteryNeedWeight: { seed: 1, sprout: 0.7, sapling: 0.35, tree: 0.15, unknown: 1 },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('names a fixed GET endpoint for the ranking-weights artifact', () => {
    expect(RANK_WEIGHTS_ENDPOINT_PATH).toBe('/v1/rank-weights');
  });

  it('maps the shipped study-plan artifact onto the envelope, totally', () => {
    // Compile-time evidence that the generalisation is real: every field of the
    // shipped artifact has a home, and nothing is invented to fill a gap.
    const toEnvelope = (plan: StudyPlanArtifact): StudyPlanEnvelope => ({
      envelopeVersion: 1,
      kind: 'study-plan',
      bodyVersion: plan.formatVersion,
      policyVersion: plan.planVersion,
      computedAt: plan.computedAt,
      freshForSeconds: GOVERNING_FRESH_FOR_SECONDS,
      governsForSeconds: GOVERNING_GOVERNS_FOR_SECONDS,
      ...(plan.stamp === undefined ? {} : { stamp: plan.stamp }),
      body: { asOf: plan.asOf, courses: plan.courses },
    });

    const plan: StudyPlanArtifact = {
      formatVersion: 1,
      planVersion: 'sp1-0123456789abcdef',
      computedAt: '2026-08-16T09:00:00.000Z',
      asOf: '2026-08-16',
      courses: validPlanEnvelope().body.courses,
    };
    expect(studyPlanEnvelope.safeParse(toEnvelope(plan)).success).toBe(true);
  });
});
