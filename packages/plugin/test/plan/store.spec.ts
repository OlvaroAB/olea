/**
 * `ObsidianStudyPlanStore` tests. Runs against a fake `ObsidianDataHost` —
 * this file never imports `obsidian` itself, same convention as
 * `test/worker/config-store.spec.ts` and `test/ingestion/queue-store.spec.ts`.
 *
 * Scenario: `features/F2-review.md`, "F2.8 — The switch-on: a cached plan
 * actually reaches a real session (P5-T07)" — the plan has to be persisted
 * somewhere before `open-session.ts` can read it back, and this is that
 * somewhere.
 */
import type { StudyPlanEnvelope } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  type ObsidianDataHost,
  ObsidianStudyPlanStore,
  STUDY_PLAN_STORAGE_KEY,
} from '../../src/plan/store.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const samplePlan: StudyPlanEnvelope = {
  envelopeVersion: 1,
  kind: 'study-plan',
  bodyVersion: 1,
  policyVersion: 'sp1-test0000000003',
  computedAt: '2026-08-20T09:00:00-04:00',
  freshForSeconds: 3600,
  governsForSeconds: 86_400,
  body: {
    asOf: '2026-08-20',
    courses: [],
  },
};

describe('ObsidianStudyPlanStore.load', () => {
  it('returns null when nothing has ever been saved', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianStudyPlanStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null when data.json holds an object but no studyPlan key yet', async () => {
    const host = new FakeDataHost();
    host.blob = { deviceId: 'olea-abc123' };
    const store = new ObsidianStudyPlanStore(host);
    expect(await store.load()).toBeNull();
  });

  it('hands back whatever is under its key, unvalidated — schema checking is loadCachedStudyPlan’s job', async () => {
    const host = new FakeDataHost();
    host.blob = { [STUDY_PLAN_STORAGE_KEY]: { not: 'a valid plan' } };
    const store = new ObsidianStudyPlanStore(host);
    expect(await store.load()).toEqual({ not: 'a valid plan' });
  });

  it('round-trips a plan saved by this same store', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianStudyPlanStore(host);
    await store.save(samplePlan);
    expect(await store.load()).toEqual(samplePlan);
  });
});

describe('ObsidianStudyPlanStore.save — namespacing inside the shared data.json blob', () => {
  it('writes under its own key without touching an empty/absent blob', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianStudyPlanStore(host);
    await store.save(samplePlan);
    expect(host.blob).toEqual({ [STUDY_PLAN_STORAGE_KEY]: samplePlan });
  });

  it('preserves unrelated keys already present in data.json — never clobbers another writer', async () => {
    const host = new FakeDataHost();
    host.blob = {
      deviceId: 'olea-abc123',
      ingestionQueue: { version: 1, jobs: [], headroom: null },
    };
    const store = new ObsidianStudyPlanStore(host);
    await store.save(samplePlan);
    expect(host.blob).toEqual({
      deviceId: 'olea-abc123',
      ingestionQueue: { version: 1, jobs: [], headroom: null },
      [STUDY_PLAN_STORAGE_KEY]: samplePlan,
    });
  });

  it('re-reads before writing, so a key written by another part of the plugin between two saves survives', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianStudyPlanStore(host);
    await store.save(samplePlan);

    host.blob = { ...(host.blob as Record<string, unknown>), otherFeature: 'value' };

    const updated: StudyPlanEnvelope = { ...samplePlan, policyVersion: 'sp1-test0000000004' };
    await store.save(updated);

    expect(host.blob).toEqual({
      otherFeature: 'value',
      [STUDY_PLAN_STORAGE_KEY]: updated,
    });
  });
});
