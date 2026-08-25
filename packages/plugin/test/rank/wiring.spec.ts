/**
 * `buildRankWeightsWiring` tests (`[D-110]`, `ol-v7r5.3`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `RankWeightsHttpGet`) — no `obsidian` import anywhere
 * in this file, mirroring `test/concept/wiring.spec.ts`.
 */
import { OPERATING_FRESH_FOR_SECONDS, OPERATING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { RankWeightsHttpGet } from '../../src/rank/rank-weights-provider.js';
import { buildRankWeightsWiring } from '../../src/rank/wiring.js';
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

function bodyEnvelope() {
  return {
    envelopeVersion: 1,
    kind: 'rank-weights',
    bodyVersion: 1,
    policyVersion: 'rw1-test0123456789',
    computedAt: '2026-08-20T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: {
      proximityHalfLifeDays: 14,
      assessmentWeightDivisor: 100,
      masteryNeedWeight: { seed: 1, sprout: 0.7, sapling: 0.35, tree: 0.15, unknown: 1 },
    },
  };
}

describe('buildRankWeightsWiring — F7.8 grey-out', () => {
  it('returns a null readRankWeights when no Worker config has ever been saved', async () => {
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(bodyEnvelope()),
    });
    const wiring = await buildRankWeightsWiring({ dataHost: new FakeDataHost(), httpGet });
    expect(wiring.readRankWeights).toBeNull();
  });

  it('returns a null readRankWeights when the config is present but blank', async () => {
    const httpGet: RankWeightsHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(bodyEnvelope()),
    });
    const wiring = await buildRankWeightsWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      httpGet,
    });
    expect(wiring.readRankWeights).toBeNull();
  });
});

describe('buildRankWeightsWiring — a configured Worker builds a real, usable reader', () => {
  it('constructs requests with the persisted config and the reader actually reaches it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
    const httpGet: RankWeightsHttpGet = async (params) => {
      calls.push(params);
      return { status: 200, text: JSON.stringify(bodyEnvelope()) };
    };

    const wiring = await buildRankWeightsWiring({
      dataHost: host,
      httpGet,
      now: () => new Date('2026-08-25T09:00:00.000Z'),
    });

    expect(wiring.readRankWeights).not.toBeNull();
    const options = await wiring.readRankWeights?.();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.authorization).toBe('Bearer secret-token');
    expect(options).toEqual(bodyEnvelope().body);
  });

  it('re-fetches on every call, unlike the once-resolved wiring shape used elsewhere', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let callCount = 0;
    const httpGet: RankWeightsHttpGet = async () => {
      callCount++;
      return { status: 200, text: JSON.stringify(bodyEnvelope()) };
    };
    const wiring = await buildRankWeightsWiring({ dataHost: host, httpGet });

    await wiring.readRankWeights?.();
    await wiring.readRankWeights?.();
    expect(callCount).toBe(2);
  });
});
