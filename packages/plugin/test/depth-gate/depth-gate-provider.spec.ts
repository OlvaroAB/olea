/**
 * `depth-gate-provider.ts` tests (`[D-352]`, `ol-egov.141.89.9.55`).
 *
 * Obsidian-free by design (see that file's module doc), so this exercises
 * `fetchDepthGateOptions`/`buildDepthGateUrl` against a fake
 * `DepthGateHttpGet` — no real network, no Obsidian host. Mirrors
 * `test/rank/rank-weights-provider.spec.ts`'s structure field-for-field.
 */
import {
  DEPTH_GATE_ENDPOINT_PATH,
  OPERATING_FRESH_FOR_SECONDS,
  OPERATING_GOVERNS_FOR_SECONDS,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  buildDepthGateUrl,
  type DepthGateHttpGet,
  fetchDepthGateOptions,
} from '../../src/depth-gate/depth-gate-provider.js';

const CONFIG = { baseUrl: 'https://olea-service.example.workers.dev', token: 'SECRET-TOKEN-VALUE' };
const NOW = new Date('2026-08-25T09:00:00.000Z');

function validBody() {
  return { depthGate: 'relational' as const };
}

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeVersion: 1,
    kind: 'depth-gate',
    bodyVersion: 1,
    policyVersion: 'dg1-test0123456789',
    computedAt: '2026-08-20T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: validBody(),
    ...overrides,
  };
}

describe('buildDepthGateUrl', () => {
  it('joins the base URL and the frozen depth-gate endpoint path', () => {
    expect(buildDepthGateUrl('https://example.com')).toBe(
      `https://example.com${DEPTH_GATE_ENDPOINT_PATH}`,
    );
  });

  it('does not double a trailing slash on the base URL', () => {
    expect(buildDepthGateUrl('https://example.com/')).toBe(
      `https://example.com${DEPTH_GATE_ENDPOINT_PATH}`,
    );
  });
});

describe('fetchDepthGateOptions — the delivered path', () => {
  it('decodes a fresh envelope into the SoloLevel field', async () => {
    const httpGet: DepthGateHttpGet = async ({ url, headers }) => {
      expect(url).toBe(buildDepthGateUrl(CONFIG.baseUrl));
      expect(headers.authorization).toBe(`Bearer ${CONFIG.token}`);
      return { status: 200, text: JSON.stringify(validEnvelope()) };
    };

    const depthGate = await fetchDepthGateOptions(httpGet, CONFIG, NOW);
    expect(depthGate).toBe('relational');
  });

  it('still applies a STALE-but-governing envelope — only expired degrades', async () => {
    // computedAt is well past freshForSeconds (30 days) but well within
    // governsForSeconds (365 days) relative to NOW.
    const stale = validEnvelope({ computedAt: '2026-07-01T09:00:00.000Z' });
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(stale),
    });

    const depthGate = await fetchDepthGateOptions(httpGet, CONFIG, NOW);
    expect(depthGate).toBe('relational');
  });
});

describe('fetchDepthGateOptions — every failure collapses to undefined, so the declared fallback applies (D-352, F7.8)', () => {
  it('a transport-level failure (offline, DNS) — undefined, does not throw', async () => {
    const httpGet: DepthGateHttpGet = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('a non-2xx response (unauthenticated, 401) — undefined', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 401,
      text: JSON.stringify({ ok: false, code: 'unauthenticated', message: 'nope' }),
    });
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('a body that is not JSON — undefined', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: '<html>not json</html>',
    });
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('the wrong kind — undefined (readArtifactEnvelope: unreadable, not stale-but-usable)', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ kind: 'rank-weights' })),
    });
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an unknown envelope version — undefined, D-352\'s "discarded, declared fallback used"', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ envelopeVersion: 99 })),
    });
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an unknown body version — undefined, same discard-and-fallback rule', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ bodyVersion: 99 })),
    });
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an EXPIRED envelope — undefined, the declared fallback DEPTH_GATE_SOLO_LEVEL applies', async () => {
    // computedAt far enough in the past that governsForSeconds has elapsed too.
    const expired = validEnvelope({ computedAt: '2020-01-01T09:00:00.000Z' });
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(expired),
    });
    await expect(fetchDepthGateOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('offline/unreadable, the route unavailable entirely — undefined, never an improvised value', async () => {
    const httpGet: DepthGateHttpGet = async () => {
      throw new Error('network unreachable');
    };
    const depthGate = await fetchDepthGateOptions(httpGet, CONFIG, NOW);
    expect(depthGate).toBeUndefined();
  });
});
