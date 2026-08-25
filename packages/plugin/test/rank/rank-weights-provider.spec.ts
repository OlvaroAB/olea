/**
 * `rank-weights-provider.ts` tests (`[D-110]`, `ol-v7r5.3`).
 *
 * Obsidian-free by design (see that file's module doc), so this exercises
 * `fetchRankWeightsOptions`/`buildRankWeightsUrl` against a fake
 * `RankWeightsHttpGet` — no real network, no Obsidian host. Mirrors
 * `test/worker/transport.spec.ts`'s structure for the GET-shaped twin.
 */
import {
  OPERATING_FRESH_FOR_SECONDS,
  OPERATING_GOVERNS_FOR_SECONDS,
  RANK_WEIGHTS_ENDPOINT_PATH,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  buildRankWeightsUrl,
  fetchRankWeightsOptions,
  type RankWeightsHttpGet,
} from '../../src/rank/rank-weights-provider.js';

const CONFIG = { baseUrl: 'https://olea-service.example.workers.dev', token: 'SECRET-TOKEN-VALUE' };
const NOW = new Date('2026-08-25T09:00:00.000Z');

function validBody() {
  return {
    proximityHalfLifeDays: 14,
    assessmentWeightDivisor: 100,
    masteryNeedWeight: { seed: 1, sprout: 0.7, sapling: 0.35, tree: 0.15, unknown: 1 },
  };
}

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeVersion: 1,
    kind: 'rank-weights',
    bodyVersion: 1,
    policyVersion: 'rw1-test0123456789',
    computedAt: '2026-08-20T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: validBody(),
    ...overrides,
  };
}

describe('buildRankWeightsUrl', () => {
  it('joins the base URL and the frozen rank-weights endpoint path', () => {
    expect(buildRankWeightsUrl('https://example.com')).toBe(
      `https://example.com${RANK_WEIGHTS_ENDPOINT_PATH}`,
    );
  });

  it('does not double a trailing slash on the base URL', () => {
    expect(buildRankWeightsUrl('https://example.com/')).toBe(
      `https://example.com${RANK_WEIGHTS_ENDPOINT_PATH}`,
    );
  });
});

describe('fetchRankWeightsOptions — the delivered path', () => {
  it('decodes a fresh envelope into RankOracleOptions, field-for-field', async () => {
    const httpGet: RankWeightsHttpGet = async ({ url, headers }) => {
      expect(url).toBe(buildRankWeightsUrl(CONFIG.baseUrl));
      expect(headers.authorization).toBe(`Bearer ${CONFIG.token}`);
      return { status: 200, text: JSON.stringify(validEnvelope()) };
    };

    const options = await fetchRankWeightsOptions(httpGet, CONFIG, NOW);
    expect(options).toEqual(validBody());
  });

  it('still applies a STALE-but-governing envelope — only expired degrades', async () => {
    // computedAt is well past freshForSeconds (30 days) but well within
    // governsForSeconds (365 days) relative to NOW.
    const stale = validEnvelope({ computedAt: '2026-07-01T09:00:00.000Z' });
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(stale),
    });

    const options = await fetchRankWeightsOptions(httpGet, CONFIG, NOW);
    expect(options).toEqual(validBody());
  });
});

describe('fetchRankWeightsOptions — every failure collapses to undefined (F7.8)', () => {
  it('a transport-level failure (offline, DNS) — undefined, does not throw', async () => {
    const httpGet: RankWeightsHttpGet = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await expect(fetchRankWeightsOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('a non-2xx response (unauthenticated, 401) — undefined', async () => {
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 401,
      text: JSON.stringify({ ok: false, code: 'unauthenticated', message: 'nope' }),
    });
    await expect(fetchRankWeightsOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('a body that is not JSON — undefined', async () => {
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: '<html>not json</html>',
    });
    await expect(fetchRankWeightsOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('the wrong kind — undefined (readArtifactEnvelope: unreadable, not stale-but-usable)', async () => {
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ kind: 'vision-route' })),
    });
    await expect(fetchRankWeightsOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an unknown envelope version — undefined', async () => {
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ envelopeVersion: 99 })),
    });
    await expect(fetchRankWeightsOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an EXPIRED envelope — undefined, the declared fallback applies', async () => {
    // computedAt far enough in the past that governsForSeconds has elapsed too.
    const expired = validEnvelope({ computedAt: '2020-01-01T09:00:00.000Z' });
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(expired),
    });
    await expect(fetchRankWeightsOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });
});
