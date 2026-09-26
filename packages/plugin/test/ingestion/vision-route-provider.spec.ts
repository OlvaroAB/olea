/**
 * `vision-route-provider.ts` tests (component 1.6, `[ILB-PER-4]`
 * §8 item 2).
 *
 * Obsidian-free by design (see that file's module doc), so this exercises
 * `fetchVisionRouteOptions`/`buildVisionRouteUrl` against a fake
 * `VisionRouteHttpGet` — no real network, no Obsidian host. Mirrors
 * `test/rank/rank-weights-provider.spec.ts`'s structure one field down.
 */
import { OPERATING_FRESH_FOR_SECONDS, OPERATING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  buildVisionRouteUrl,
  fetchVisionRouteOptions,
  VISION_ROUTE_ENDPOINT_PATH,
  type VisionRouteHttpGet,
} from '../../src/ingestion/vision-route-provider.js';

const CONFIG = { baseUrl: 'https://olea-service.example.workers.dev', token: 'SECRET-TOKEN-VALUE' };
const NOW = new Date('2026-09-26T09:00:00.000Z');

function validBody() {
  return { minTextLayerChars: 10 };
}

function validEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeVersion: 1,
    kind: 'vision-route',
    bodyVersion: 1,
    policyVersion: 'vr1-test0123456789',
    computedAt: '2026-09-01T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: validBody(),
    ...overrides,
  };
}

describe('buildVisionRouteUrl', () => {
  it('joins the base URL and the frozen vision-route endpoint path', () => {
    expect(buildVisionRouteUrl('https://example.com')).toBe(
      `https://example.com${VISION_ROUTE_ENDPOINT_PATH}`,
    );
  });

  it('does not double a trailing slash on the base URL', () => {
    expect(buildVisionRouteUrl('https://example.com/')).toBe(
      `https://example.com${VISION_ROUTE_ENDPOINT_PATH}`,
    );
  });
});

describe('fetchVisionRouteOptions — the delivered path', () => {
  it('decodes a fresh envelope into ExtractOptions, mapping minTextLayerChars to textLayerCharThreshold', async () => {
    const httpGet: VisionRouteHttpGet = async ({ url, headers }) => {
      expect(url).toBe(buildVisionRouteUrl(CONFIG.baseUrl));
      expect(headers.authorization).toBe(`Bearer ${CONFIG.token}`);
      return { status: 200, text: JSON.stringify(validEnvelope()) };
    };

    const options = await fetchVisionRouteOptions(httpGet, CONFIG, NOW);
    expect(options).toEqual({ textLayerCharThreshold: 10 });
  });

  it('still applies a STALE-but-governing envelope — only expired degrades', async () => {
    // computedAt is well past freshForSeconds (30 days) but well within
    // governsForSeconds (365 days) relative to NOW.
    const stale = validEnvelope({ computedAt: '2026-07-01T09:00:00.000Z' });
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(stale),
    });

    const options = await fetchVisionRouteOptions(httpGet, CONFIG, NOW);
    expect(options).toEqual({ textLayerCharThreshold: 10 });
  });
});

describe('fetchVisionRouteOptions — every failure collapses to undefined (F7.8)', () => {
  it('a transport-level failure (offline, DNS) — undefined, does not throw', async () => {
    const httpGet: VisionRouteHttpGet = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await expect(fetchVisionRouteOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('a non-2xx response (unauthenticated, 401) — undefined', async () => {
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 401,
      text: JSON.stringify({ ok: false, code: 'unauthenticated', message: 'nope' }),
    });
    await expect(fetchVisionRouteOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('a body that is not JSON — undefined', async () => {
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: '<html>not json</html>',
    });
    await expect(fetchVisionRouteOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('the wrong kind — undefined (readArtifactEnvelope: unreadable, not stale-but-usable)', async () => {
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ kind: 'rank-weights' })),
    });
    await expect(fetchVisionRouteOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an unknown envelope version — undefined', async () => {
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(validEnvelope({ envelopeVersion: 99 })),
    });
    await expect(fetchVisionRouteOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });

  it('an EXPIRED envelope — undefined, the declared fallback (DEFAULT_TEXT_LAYER_CHAR_THRESHOLD) applies', async () => {
    // computedAt far enough in the past that governsForSeconds has elapsed too.
    const expired = validEnvelope({ computedAt: '2020-01-01T09:00:00.000Z' });
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(expired),
    });
    await expect(fetchVisionRouteOptions(httpGet, CONFIG, NOW)).resolves.toBeUndefined();
  });
});
