import type { StudyPlanEnvelope } from 'olea-contracts';
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { loadCachedStudyPlan, saveCachedStudyPlan } from './cache.js';
import type { StudyPlanStore } from './types.js';

/** The in-memory fake every test here injects — the plugin's Obsidian-backed store is INV-1's problem, not core's. */
function memoryStore(initial: unknown = null): StudyPlanStore & {
  readonly saved: StudyPlanEnvelope[];
  value: unknown;
} {
  const saved: StudyPlanEnvelope[] = [];
  return {
    value: initial,
    saved,
    async load() {
      return this.value;
    },
    async save(plan) {
      saved.push(plan);
      this.value = plan;
    },
  };
}

const COMPUTED_AT = '2026-08-16T09:00:00.000Z';
const NOW = new Date(COMPUTED_AT);

function samplePlan(overrides: Partial<StudyPlanEnvelope> = {}): StudyPlanEnvelope {
  return {
    envelopeVersion: 1,
    kind: 'study-plan',
    bodyVersion: 1,
    policyVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: COMPUTED_AT,
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
              weight: 0.5,
              examProximityDays: 7,
              reasoning: 'concept-alpha (COURSE-A): derived reasoning.',
              citations: [{ sourcePath: 'papers/2024.md', questionLabel: 'Q1' }],
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

/**
 * The retired pre-envelope shape (`packages/contracts/src/study-plan.ts`'s
 * `studyPlanArtifact`), reconstructed by hand rather than imported — the
 * schema that produced it is gone from this module's dependency graph on
 * purpose, and a blob this shape is exactly what a real device still holds
 * the first time this build runs against it.
 */
function legacyArtifactShapedBlob(): unknown {
  return {
    formatVersion: 1,
    planVersion: 'sp1-aaaaaaaaaaaaaaaa',
    computedAt: COMPUTED_AT,
    asOf: '2026-08-16',
    courses: samplePlan().body.courses,
  };
}

describe('loadCachedStudyPlan', () => {
  it('returns the cached plan when the store holds a current, fresh envelope', async () => {
    const store = memoryStore(samplePlan());
    const result = await loadCachedStudyPlan(store, NOW);
    expect(result.plan?.policyVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.rejection).toBeUndefined();
    expect(result.freshness?.state).toBe('fresh');
  });

  it('distinguishes "never cached" from "cached but unreadable"', async () => {
    expect(await loadCachedStudyPlan(memoryStore(null), NOW)).toEqual({
      plan: null,
      rejection: 'absent',
    });
    expect(await loadCachedStudyPlan(memoryStore(undefined), NOW)).toEqual({
      plan: null,
      rejection: 'absent',
    });
    expect(await loadCachedStudyPlan(memoryStore({ envelopeVersion: 99 }), NOW)).toEqual({
      plan: null,
      rejection: 'unreadable',
    });
  });

  it('treats an unknown envelopeVersion as absent rather than throwing or migrating', async () => {
    const future = { ...samplePlan(), envelopeVersion: 2 };
    const result = await loadCachedStudyPlan(memoryStore(future), NOW);
    expect(result.plan).toBeNull();
    expect(result.rejection).toBe('unreadable');
  });

  it('treats an unknown bodyVersion as absent rather than throwing or migrating', async () => {
    const future = { ...samplePlan(), bodyVersion: 99 };
    const result = await loadCachedStudyPlan(memoryStore(future), NOW);
    expect(result.plan).toBeNull();
    expect(result.rejection).toBe('unreadable');
  });

  it('treats a structurally broken blob as absent — the cache is rebuildable (D-006)', async () => {
    const broken = {
      ...samplePlan(),
      body: { asOf: '2026-08-16', courses: [{ course: 'COURSE-A', status: 'ranked' }] },
    };
    const result = await loadCachedStudyPlan(memoryStore(broken), NOW);
    expect(result.plan).toBeNull();
    expect(result.rejection).toBe('unreadable');
  });

  it(
    'treats a blob in the retired pre-envelope studyPlanArtifact shape as absent — ' +
      'discarded and rebuilt, never migrated onto the envelope ([D-122], [BND-3b])',
    async () => {
      const result = await loadCachedStudyPlan(memoryStore(legacyArtifactShapedBlob()), NOW);
      expect(result.plan).toBeNull();
      expect(result.rejection).toBe('unreadable');
      // The mechanical mapping ([D-122]) is never *run* here: nothing about this
      // result carries `policyVersion: 'sp1-aaaaaaaaaaaaaaaa'` or any other field
      // lifted from the legacy blob. It is simply gone, same as any other
      // unreadable blob.
      expect(result).toEqual({ plan: null, rejection: 'unreadable' });
    },
  );

  it('does not confuse an empty plan with no plan', async () => {
    // A vault with no assessments legitimately produces a plan with no courses.
    // A caller that read this as "nothing cached" would refresh forever.
    const empty = samplePlan({ body: { asOf: '2026-08-16', courses: [] } });
    const result = await loadCachedStudyPlan(memoryStore(empty), NOW);
    expect(result.plan?.body.courses).toEqual([]);
    expect(result.rejection).toBeUndefined();
  });

  describe('freshness ([D-122]: moving onto envelopeFreshness)', () => {
    it('reports "stale" — still returned as the plan in force — the day after computedAt', async () => {
      const dayAfter = new Date(new Date(COMPUTED_AT).getTime() + 25 * 60 * 60 * 1000);
      const result = await loadCachedStudyPlan(memoryStore(samplePlan()), dayAfter);
      expect(result.plan).not.toBeNull();
      expect(result.rejection).toBeUndefined();
      expect(result.freshness?.state).toBe('stale');
    });

    it('treats an expired envelope as absent — a governing artifact stops governing', async () => {
      const pastGovernsHorizon = new Date(
        new Date(COMPUTED_AT).getTime() + (GOVERNING_GOVERNS_FOR_SECONDS + 1) * 1000,
      );
      const result = await loadCachedStudyPlan(memoryStore(samplePlan()), pastGovernsHorizon);
      expect(result).toEqual({ plan: null, rejection: 'expired' });
    });
  });
});

describe('saveCachedStudyPlan', () => {
  it('writes a valid plan through to the store', async () => {
    const store = memoryStore();
    await saveCachedStudyPlan(store, samplePlan());
    expect(store.saved).toHaveLength(1);
    expect((await loadCachedStudyPlan(store, NOW)).plan?.policyVersion).toBe(
      'sp1-aaaaaaaaaaaaaaaa',
    );
  });

  it('refuses to persist an invalid plan, and writes nothing when it refuses', async () => {
    const store = memoryStore();
    const invalid = { ...samplePlan(), policyVersion: '' } as StudyPlanEnvelope;
    await expect(saveCachedStudyPlan(store, invalid)).rejects.toThrow();
    expect(store.saved).toHaveLength(0);
    expect(store.value).toBeNull();
  });
});
