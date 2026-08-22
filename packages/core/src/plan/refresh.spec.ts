import type { StudyPlanArtifact } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { refreshStudyPlan } from './refresh.js';
import type { StudyPlanProvider, StudyPlanStore } from './types.js';

/**
 * Fixtures are duplicated from `cache.spec.ts` rather than imported from it, on
 * purpose: importing one spec file into another re-executes its `describe`
 * blocks, so the suite would report the cache's tests twice and a failure would
 * be attributed to the wrong file.
 */
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

/**
 * The offline clause of P5-T05's acceptance is proved here with providers that
 * are ABSENT and providers that THROW — not merely with one that returns
 * nothing. A provider returning an empty answer exercises a happy path with a
 * boring value; a provider that is gone, or that blows up, is what "offline"
 * actually looks like on her laptop.
 */
function throwingProvider(message: string): StudyPlanProvider {
  return {
    fetchPlan() {
      throw new Error(message);
    },
  };
}

function rejectingProvider(message: string): StudyPlanProvider {
  return {
    async fetchPlan() {
      throw new Error(message);
    },
  };
}

describe('refreshStudyPlan — offline execution against the cached plan', () => {
  it('serves the cached plan when NO provider is supplied at all', async () => {
    const store = memoryStore(samplePlan());
    const result = await refreshStudyPlan({ store });

    expect(result.plan?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.source).toBe('cache');
    expect(result.offline).toBe(true);
    // Not a failure: no provider is a configuration (AI switched off, F7.8).
    expect(result.reason).toBeUndefined();
    expect(store.saved).toHaveLength(0);
  });

  it('serves the cached plan when the provider THROWS synchronously, and never throws itself', async () => {
    const store = memoryStore(samplePlan());
    const result = await refreshStudyPlan({
      store,
      provider: throwingProvider('network is down'),
    });

    expect(result.plan?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.source).toBe('cache');
    expect(result.offline).toBe(true);
    expect(result.reason).toBe('network is down');
    expect(store.saved).toHaveLength(0);
  });

  it('serves the cached plan when the provider REJECTS, and reports the reason', async () => {
    const store = memoryStore(samplePlan());
    const result = await refreshStudyPlan({
      store,
      provider: rejectingProvider('fetch failed'),
    });

    expect(result.plan?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.source).toBe('cache');
    expect(result.reason).toBe('fetch failed');
  });

  it('reports a thrown non-Error without letting it escape', async () => {
    const store = memoryStore(samplePlan());
    const result = await refreshStudyPlan({
      store,
      provider: {
        async fetchPlan() {
          // A provider implementor outside this package can throw anything at
          // all; the report must still be a string and must still not escape.
          throw 'a bare string';
        },
      },
    });
    expect(result.plan).not.toBeNull();
    expect(result.reason).toMatch(/non-Error value of type string/);
  });

  it('never overwrites a good cache with a malformed provider answer', async () => {
    const store = memoryStore(samplePlan());
    const result = await refreshStudyPlan({
      store,
      provider: {
        async fetchPlan() {
          return { formatVersion: 1, planVersion: '', courses: 'not an array' };
        },
      },
    });

    expect(result.plan?.planVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.source).toBe('cache');
    expect(result.reason).toMatch(/contract schema rejected/);
    // The load-bearing assertion: the cache is untouched. The obvious
    // implementation — save first, validate later — loses her plan here.
    expect(store.saved).toHaveLength(0);
    expect(store.value).toEqual(samplePlan());
  });

  it('reports no plan at all when nothing is cached and the provider fails', async () => {
    const store = memoryStore(null);
    const result = await refreshStudyPlan({ store, provider: throwingProvider('offline') });

    expect(result.plan).toBeNull();
    expect(result.source).toBe('none');
    expect(result.offline).toBe(true);
    expect(result.reason).toBe('offline');
  });

  it('reports no plan when nothing is cached and no provider is supplied', async () => {
    const result = await refreshStudyPlan({ store: memoryStore(null) });
    expect(result).toEqual({ plan: null, source: 'none', offline: true });
  });

  it('accepts, caches and reports a valid plan from the provider', async () => {
    const store = memoryStore(null);
    const fresh = samplePlan({ planVersion: 'sp1-bbbbbbbbbbbbbbbb' });
    const result = await refreshStudyPlan({
      store,
      provider: {
        async fetchPlan() {
          return fresh;
        },
      },
    });

    expect(result.plan?.planVersion).toBe('sp1-bbbbbbbbbbbbbbbb');
    expect(result.source).toBe('provider');
    expect(result.offline).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(store.saved).toEqual([fresh]);
  });

  it('replaces an older cached plan when a valid newer one arrives', async () => {
    const store = memoryStore(samplePlan());
    const fresh = samplePlan({ planVersion: 'sp1-cccccccccccccccc' });
    const result = await refreshStudyPlan({
      store,
      provider: {
        async fetchPlan() {
          return fresh;
        },
      },
    });

    expect(result.source).toBe('provider');
    expect(store.value).toEqual(fresh);
  });
});
