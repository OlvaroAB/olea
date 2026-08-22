import type { StudyPlanArtifact } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { loadCachedStudyPlan, saveCachedStudyPlan } from './cache.js';
import type { StudyPlanStore } from './types.js';

/** The in-memory fake every test here injects — the plugin's Obsidian-backed store is INV-1's problem, not core's. */
function memoryStore(initial: unknown = null): StudyPlanStore & {
  readonly saved: StudyPlanArtifact[];
  value: unknown;
} {
  const saved: StudyPlanArtifact[] = [];
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

function samplePlan(overrides: Partial<StudyPlanArtifact> = {}): StudyPlanArtifact {
  return {
    formatVersion: 1,
    planVersion: 'sp1-aaaaaaaaaaaaaaaa',
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
            weight: 0.5,
            examProximityDays: 7,
            reasoning: 'concept-alpha (COURSE-A): derived reasoning.',
            citations: [{ sourcePath: 'papers/2024.md', questionLabel: 'Q1' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('loadCachedStudyPlan', () => {
  it('returns the cached plan when the store holds a current-format one', async () => {
    const store = memoryStore(samplePlan());
    const result = await loadCachedStudyPlan(store);
    expect(result.plan?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.rejection).toBeUndefined();
  });

  it('distinguishes "never cached" from "cached but unreadable"', async () => {
    expect(await loadCachedStudyPlan(memoryStore(null))).toEqual({
      plan: null,
      rejection: 'absent',
    });
    expect(await loadCachedStudyPlan(memoryStore(undefined))).toEqual({
      plan: null,
      rejection: 'absent',
    });
    expect(await loadCachedStudyPlan(memoryStore({ formatVersion: 99 }))).toEqual({
      plan: null,
      rejection: 'unreadable',
    });
  });

  it('treats an unknown formatVersion as absent rather than throwing or migrating', async () => {
    const future = { ...samplePlan(), formatVersion: 2 };
    const result = await loadCachedStudyPlan(memoryStore(future));
    expect(result.plan).toBeNull();
    expect(result.rejection).toBe('unreadable');
  });

  it('treats a structurally broken blob as absent — the cache is rebuildable (D-006)', async () => {
    const broken = { ...samplePlan(), courses: [{ course: 'COURSE-A', status: 'ranked' }] };
    const result = await loadCachedStudyPlan(memoryStore(broken));
    expect(result.plan).toBeNull();
    expect(result.rejection).toBe('unreadable');
  });

  it('does not confuse an empty plan with no plan', async () => {
    // A vault with no assessments legitimately produces a plan with no courses.
    // A caller that read this as "nothing cached" would refresh forever.
    const empty = samplePlan({ courses: [] });
    const result = await loadCachedStudyPlan(memoryStore(empty));
    expect(result.plan?.courses).toEqual([]);
    expect(result.rejection).toBeUndefined();
  });
});

describe('saveCachedStudyPlan', () => {
  it('writes a valid plan through to the store', async () => {
    const store = memoryStore();
    await saveCachedStudyPlan(store, samplePlan());
    expect(store.saved).toHaveLength(1);
    expect((await loadCachedStudyPlan(store)).plan?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
  });

  it('refuses to persist an invalid plan, and writes nothing when it refuses', async () => {
    const store = memoryStore();
    const invalid = { ...samplePlan(), planVersion: '' } as StudyPlanArtifact;
    await expect(saveCachedStudyPlan(store, invalid)).rejects.toThrow();
    expect(store.saved).toHaveLength(0);
    expect(store.value).toBeNull();
  });
});
