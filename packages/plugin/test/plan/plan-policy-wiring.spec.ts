import { describe, expect, it, vi } from 'vitest';
import type { PlanPolicyRequest, PlanPolicyResult } from '../../src/plan/plan-policy-provider.js';
import {
  buildPlanPolicyWiring,
  type ObsidianDataHost,
  ObsidianPlanPolicyCacheStore,
} from '../../src/plan/plan-policy-wiring.js';
import type { HttpResponseLike } from '../../src/worker/transport.js';

/** `ol-v7r5.25`. Synthetic vocabulary throughout (INV-3). */
function fakeDataHost(initial: Record<string, unknown> = {}): ObsidianDataHost {
  let data: Record<string, unknown> = { ...initial };
  return {
    loadData: async () => data,
    saveData: async (next) => {
      data = next as Record<string, unknown>;
    },
  };
}

function workerConfigBlob() {
  return { workerConfig: { version: 1, baseUrl: 'https://worker.example', token: 'tok' } };
}

const REQUEST_COURSE = {
  courseId: 'COURSE-A',
  daysToNextAssessment: 9,
  assessmentWorth: 0.2,
  readiness: 0.5,
  evidenceVolume: 0.75,
};

const REQUEST: PlanPolicyRequest = {
  asOf: '2026-09-01',
  courses: [REQUEST_COURSE],
};

function resultOf(share: number): PlanPolicyResult {
  return {
    asOf: '2026-09-01',
    rankWeights: {
      proximityHalfLifeDays: 14,
      assessmentWeightDivisor: 40,
      masteryNeedWeight: { seed: 1, sprout: 1, sapling: 1, tree: 1, unknown: 1 },
    },
    allocation: [
      {
        courseId: 'COURSE-A',
        share,
        minBlockSeconds: 180,
        contributions: [{ name: 'risk', value: share }],
        reason: 'synthetic',
      },
    ],
    floorsFundable: true,
  };
}

function okResponse(body: PlanPolicyResult): HttpResponseLike {
  return { status: 200, text: JSON.stringify(body) };
}

describe('buildPlanPolicyWiring', () => {
  it('returns readPlanPolicy: null when the Worker is not configured — F7.8', async () => {
    const wiring = await buildPlanPolicyWiring({
      dataHost: fakeDataHost(),
      httpPost: vi.fn(),
    });
    expect(wiring.readPlanPolicy).toBeNull();
  });

  it('calls the Worker on the first request — no cache exists yet', async () => {
    const httpPost = vi.fn().mockResolvedValue(okResponse(resultOf(0.6)));
    const wiring = await buildPlanPolicyWiring({
      dataHost: fakeDataHost(workerConfigBlob()),
      httpPost,
    });

    const result = await wiring.readPlanPolicy?.(REQUEST);

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(result?.allocation[0]?.share).toBe(0.6);
  });

  it('[D-167] reuses the cached result and never calls the Worker when the fingerprint is unchanged', async () => {
    const httpPost = vi.fn().mockResolvedValue(okResponse(resultOf(0.6)));
    const dataHost = fakeDataHost(workerConfigBlob());

    const first = await buildPlanPolicyWiring({ dataHost, httpPost });
    await first.readPlanPolicy?.(REQUEST);

    const second = await buildPlanPolicyWiring({ dataHost, httpPost });
    const result = await second.readPlanPolicy?.(REQUEST);

    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(result?.allocation[0]?.share).toBe(0.6);
  });

  it('[D-167] calls the Worker again once the request fingerprint changes', async () => {
    const httpPost = vi
      .fn()
      .mockResolvedValueOnce(okResponse(resultOf(0.6)))
      .mockResolvedValueOnce(okResponse(resultOf(0.9)));
    const dataHost = fakeDataHost(workerConfigBlob());

    const wiring = await buildPlanPolicyWiring({ dataHost, httpPost });
    await wiring.readPlanPolicy?.(REQUEST);
    const changed: PlanPolicyRequest = {
      ...REQUEST,
      courses: [{ ...REQUEST_COURSE, readiness: 0.9 }],
    };
    const result = await wiring.readPlanPolicy?.(changed);

    expect(httpPost).toHaveBeenCalledTimes(2);
    expect(result?.allocation[0]?.share).toBe(0.9);
  });

  it('a failed call leaves the previous cache entry standing rather than erasing it', async () => {
    const httpPost = vi
      .fn()
      .mockResolvedValueOnce(okResponse(resultOf(0.6)))
      .mockResolvedValueOnce({
        status: 500,
        text: 'boom',
      });
    const dataHost = fakeDataHost(workerConfigBlob());
    const wiring = await buildPlanPolicyWiring({ dataHost, httpPost });
    await wiring.readPlanPolicy?.(REQUEST);

    const changed: PlanPolicyRequest = {
      ...REQUEST,
      courses: [{ ...REQUEST_COURSE, readiness: 0.9 }],
    };
    const failed = await wiring.readPlanPolicy?.(changed);
    expect(failed).toBeUndefined();

    const cache = await new ObsidianPlanPolicyCacheStore(dataHost).load();
    expect(cache?.result.allocation[0]?.share).toBe(0.6);
  });
});
