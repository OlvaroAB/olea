import type { StudyPlanEnvelope } from 'olea-contracts';
import { GOVERNING_FRESH_FOR_SECONDS, GOVERNING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
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
const NOW = () => new Date(COMPUTED_AT);

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
    const result = await refreshStudyPlan({ store, now: NOW });

    expect(result.plan?.policyVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
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
      now: NOW,
    });

    expect(result.plan?.policyVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
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
      now: NOW,
    });

    expect(result.plan?.policyVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
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
      now: NOW,
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
          return { envelopeVersion: 1, kind: 'study-plan', bodyVersion: 1, policyVersion: '' };
        },
      },
      now: NOW,
    });

    expect(result.plan?.policyVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
    expect(result.source).toBe('cache');
    expect(result.reason).toMatch(/envelope could not read/);
    // The load-bearing assertion: the cache is untouched. The obvious
    // implementation — save first, validate later — loses her plan here.
    expect(store.saved).toHaveLength(0);
    expect(store.value).toEqual(samplePlan());
  });

  it(
    'never treats a provider answer in the retired pre-envelope studyPlanArtifact shape as ' +
      'usable — discarded, not migrated ([D-122])',
    async () => {
      const store = memoryStore(samplePlan());
      const result = await refreshStudyPlan({
        store,
        provider: {
          async fetchPlan() {
            // The exact shape `packages/contracts/src/study-plan.ts`'s retired
            // `studyPlanArtifact` produced — no `envelopeVersion` at all.
            return {
              formatVersion: 1,
              planVersion: 'sp1-bbbbbbbbbbbbbbbb',
              computedAt: COMPUTED_AT,
              asOf: '2026-08-16',
              courses: samplePlan().body.courses,
            };
          },
        },
        now: NOW,
      });

      expect(result.source).toBe('cache');
      expect(result.plan?.policyVersion).toBe('sp1-aaaaaaaaaaaaaaaa');
      expect(store.saved).toHaveLength(0);
    },
  );

  it('reports no plan at all when nothing is cached and the provider fails', async () => {
    const store = memoryStore(null);
    const result = await refreshStudyPlan({
      store,
      provider: throwingProvider('offline'),
      now: NOW,
    });

    expect(result.plan).toBeNull();
    expect(result.source).toBe('none');
    expect(result.offline).toBe(true);
    expect(result.reason).toBe('offline');
  });

  it('reports no plan when nothing is cached and no provider is supplied', async () => {
    const result = await refreshStudyPlan({ store: memoryStore(null), now: NOW });
    expect(result).toEqual({ plan: null, source: 'none', offline: true });
  });

  it('accepts, caches and reports a valid plan from the provider', async () => {
    const store = memoryStore(null);
    const fresh = samplePlan({ policyVersion: 'sp1-bbbbbbbbbbbbbbbb' });
    const result = await refreshStudyPlan({
      store,
      provider: {
        async fetchPlan() {
          return fresh;
        },
      },
      now: NOW,
    });

    expect(result.plan?.policyVersion).toBe('sp1-bbbbbbbbbbbbbbbb');
    expect(result.source).toBe('provider');
    expect(result.offline).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(store.saved).toEqual([fresh]);
  });

  it('replaces an older cached plan when a valid newer one arrives', async () => {
    const store = memoryStore(samplePlan());
    const fresh = samplePlan({ policyVersion: 'sp1-cccccccccccccccc' });
    const result = await refreshStudyPlan({
      store,
      provider: {
        async fetchPlan() {
          return fresh;
        },
      },
      now: NOW,
    });

    expect(result.source).toBe('provider');
    expect(store.value).toEqual(fresh);
  });

  it('treats an expired cached plan as no plan at all when the provider also fails', async () => {
    const store = memoryStore(samplePlan());
    const pastGovernsHorizon = () =>
      new Date(new Date(COMPUTED_AT).getTime() + (GOVERNING_GOVERNS_FOR_SECONDS + 1) * 1000);
    const result = await refreshStudyPlan({
      store,
      provider: throwingProvider('offline'),
      now: pastGovernsHorizon,
    });

    expect(result.plan).toBeNull();
    expect(result.source).toBe('none');
  });
});
