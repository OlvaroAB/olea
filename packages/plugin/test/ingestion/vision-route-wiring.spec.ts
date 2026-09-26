/**
 * `buildVisionRouteWiring` tests (`[ILB-PER-4]`, component 1.6's delivered
 * vision-routing threshold).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `VisionRouteHttpGet`) — no `obsidian` import anywhere
 * in this file, mirroring `test/rank/wiring.spec.ts`.
 */
import { OPERATING_FRESH_FOR_SECONDS, OPERATING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { VisionRouteHttpGet } from '../../src/ingestion/vision-route-provider.js';
import { buildVisionRouteWiring } from '../../src/ingestion/vision-route-wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';

class FakeDataHost {
  blob: unknown = null;
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

function configuredHost(config: PersistedWorkerConfig): FakeDataHost {
  const host = new FakeDataHost();
  host.blob = { [WORKER_CONFIG_STORAGE_KEY]: config };
  return host;
}

function bodyEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    envelopeVersion: 1,
    kind: 'vision-route',
    bodyVersion: 1,
    policyVersion: 'vr1-test0123456789',
    computedAt: '2026-09-26T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: { minTextLayerChars: 10 },
    ...overrides,
  };
}

describe('buildVisionRouteWiring — F7.8 grey-out', () => {
  it('returns a null readVisionRouteOptions when no Worker config has ever been saved', async () => {
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(bodyEnvelope()),
    });
    const wiring = await buildVisionRouteWiring({ dataHost: new FakeDataHost(), httpGet });
    expect(wiring.readVisionRouteOptions).toBeNull();
  });

  it('returns a null readVisionRouteOptions when the config is present but blank', async () => {
    const httpGet: VisionRouteHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(bodyEnvelope()),
    });
    const wiring = await buildVisionRouteWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      httpGet,
    });
    expect(wiring.readVisionRouteOptions).toBeNull();
  });
});

describe('buildVisionRouteWiring — a configured Worker builds a real, usable reader', () => {
  it('constructs requests with the persisted config and maps the delivered threshold onto ExtractOptions', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
    const httpGet: VisionRouteHttpGet = async (params) => {
      calls.push(params);
      return { status: 200, text: JSON.stringify(bodyEnvelope()) };
    };

    const wiring = await buildVisionRouteWiring({
      dataHost: host,
      httpGet,
      now: () => new Date('2026-09-26T09:00:00.000Z'),
    });

    expect(wiring.readVisionRouteOptions).not.toBeNull();
    const options = await wiring.readVisionRouteOptions?.();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/v1/vision-route');
    expect(calls[0]?.headers.authorization).toBe('Bearer secret-token');
    expect(options).toEqual({ textLayerCharThreshold: 10 });
  });

  it('degrades to undefined (never throws) when the Worker call fails — F7.8', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const httpGet: VisionRouteHttpGet = async () => {
      throw new Error('offline');
    };
    const wiring = await buildVisionRouteWiring({ dataHost: host, httpGet });

    expect(wiring.readVisionRouteOptions).not.toBeNull();
    await expect(wiring.readVisionRouteOptions?.()).resolves.toBeUndefined();
  });
});
