/**
 * `plan-policy-provider.ts` tests (`ol-v7r5.23`).
 *
 * Obsidian-free by design (see that file's module doc), so this exercises
 * `fetchPlanPolicy`/`buildPlanPolicyUrl` against a fake `PlanPolicyHttpPost`
 * — no real network, no Obsidian host. Mirrors
 * `test/rank/rank-weights-provider.spec.ts`'s structure for the POST-shaped
 * twin. Synthetic course ids only (INV-3).
 */
import { describe, expect, it } from 'vitest';
import {
  buildPlanPolicyUrl,
  fetchPlanPolicy,
  PLAN_POLICY_ENDPOINT_PATH,
  type PlanPolicyHttpPost,
  type PlanPolicyRequest,
} from '../../src/plan/plan-policy-provider.js';

const CONFIG = { baseUrl: 'https://olea-service.example.workers.dev', token: 'SECRET-TOKEN-VALUE' };

function validRequest(): PlanPolicyRequest {
  return {
    asOf: '2026-09-01',
    courses: [
      {
        courseId: 'course-a',
        daysToNextAssessment: 9,
        assessmentWorth: 0.4,
        readiness: 0.2,
        evidenceVolume: 1,
      },
      {
        courseId: 'course-b',
        daysToNextAssessment: 20,
        assessmentWorth: 0.6,
        readiness: 0.5,
        evidenceVolume: 0.5,
      },
    ],
  };
}

function validResult() {
  return {
    asOf: '2026-09-01',
    rankWeights: {
      proximityHalfLifeDays: 14,
      assessmentWeightDivisor: 100,
      masteryNeedWeight: { seed: 1, sprout: 0.7, sapling: 0.35, tree: 0.15, unknown: 1 },
    },
    allocation: [
      {
        courseId: 'course-a',
        share: 0.6,
        minBlockSeconds: 180,
        contributions: [{ name: 'risk', value: 0.5 }],
        reason: 'course-a is closer to its next assessment.',
      },
      {
        courseId: 'course-b',
        share: 0.4,
        minBlockSeconds: 180,
        contributions: [{ name: 'risk', value: 0.3 }],
        reason: 'course-b has less evidence yet.',
      },
    ],
    floorsFundable: true,
  };
}

describe('buildPlanPolicyUrl', () => {
  it('joins the base URL and the frozen plan-policy endpoint path', () => {
    expect(buildPlanPolicyUrl('https://example.com')).toBe(
      `https://example.com${PLAN_POLICY_ENDPOINT_PATH}`,
    );
  });

  it('does not double a trailing slash on the base URL', () => {
    expect(buildPlanPolicyUrl('https://example.com/')).toBe(
      `https://example.com${PLAN_POLICY_ENDPOINT_PATH}`,
    );
  });
});

describe('fetchPlanPolicy — the delivered path', () => {
  it('POSTs the request body and decodes a valid response', async () => {
    const httpPost: PlanPolicyHttpPost = async ({ url, headers, body }) => {
      expect(url).toBe(buildPlanPolicyUrl(CONFIG.baseUrl));
      expect(headers.authorization).toBe(`Bearer ${CONFIG.token}`);
      expect(JSON.parse(body)).toEqual(validRequest());
      return { status: 200, text: JSON.stringify(validResult()) };
    };

    const result = await fetchPlanPolicy(httpPost, CONFIG, validRequest());
    expect(result).toEqual(validResult());
  });

  it('a request with an empty course list decodes an empty allocation, not an error', async () => {
    const httpPost: PlanPolicyHttpPost = async () => ({
      status: 200,
      text: JSON.stringify({ ...validResult(), allocation: [] }),
    });

    const result = await fetchPlanPolicy(httpPost, CONFIG, { asOf: '2026-09-01', courses: [] });
    expect(result?.allocation).toEqual([]);
  });
});

describe('fetchPlanPolicy — every failure collapses to undefined (F7.8)', () => {
  it('a transport-level failure (offline, DNS) — undefined, does not throw', async () => {
    const httpPost: PlanPolicyHttpPost = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await expect(fetchPlanPolicy(httpPost, CONFIG, validRequest())).resolves.toBeUndefined();
  });

  it('a non-2xx response (unauthenticated, 401) — undefined', async () => {
    const httpPost: PlanPolicyHttpPost = async () => ({
      status: 401,
      text: JSON.stringify({ ok: false, code: 'unauthenticated', message: 'nope' }),
    });
    await expect(fetchPlanPolicy(httpPost, CONFIG, validRequest())).resolves.toBeUndefined();
  });

  it('a body that is not JSON — undefined', async () => {
    const httpPost: PlanPolicyHttpPost = async () => ({ status: 200, text: '<html>nope</html>' });
    await expect(fetchPlanPolicy(httpPost, CONFIG, validRequest())).resolves.toBeUndefined();
  });

  it('a body missing a required field — undefined, never a partially-trusted object', async () => {
    const { floorsFundable: _drop, ...incomplete } = validResult();
    const httpPost: PlanPolicyHttpPost = async () => ({
      status: 200,
      text: JSON.stringify(incomplete),
    });
    await expect(fetchPlanPolicy(httpPost, CONFIG, validRequest())).resolves.toBeUndefined();
  });

  it('an allocation entry with the wrong shape — undefined', async () => {
    const malformed = { ...validResult(), allocation: [{ courseId: 'course-a' }] };
    const httpPost: PlanPolicyHttpPost = async () => ({
      status: 200,
      text: JSON.stringify(malformed),
    });
    await expect(fetchPlanPolicy(httpPost, CONFIG, validRequest())).resolves.toBeUndefined();
  });
});
