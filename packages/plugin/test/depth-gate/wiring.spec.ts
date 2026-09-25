/**
 * `buildDepthGateWiring` tests (`[D-352]`, `ol-egov.141.89.9.55`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `DepthGateHttpGet`) — no `obsidian` import anywhere
 * in this file, mirroring `test/rank/wiring.spec.ts`.
 */
import { OPERATING_FRESH_FOR_SECONDS, OPERATING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { DepthGateHttpGet } from '../../src/depth-gate/depth-gate-provider.js';
import { buildDepthGateWiring } from '../../src/depth-gate/wiring.js';
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
    kind: 'depth-gate',
    bodyVersion: 1,
    policyVersion: 'dg1-test0123456789',
    computedAt: '2026-08-20T09:00:00.000Z',
    freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
    governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
    body: { depthGate: 'relational' },
  };
}

describe('buildDepthGateWiring — F7.8 grey-out', () => {
  it('returns a null readDepthGate when no Worker config has ever been saved', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(bodyEnvelope()),
    });
    const wiring = await buildDepthGateWiring({ dataHost: new FakeDataHost(), httpGet });
    expect(wiring.readDepthGate).toBeNull();
  });

  it('returns a null readDepthGate when the config is present but blank', async () => {
    const httpGet: DepthGateHttpGet = async () => ({
      status: 200,
      text: JSON.stringify(bodyEnvelope()),
    });
    const wiring = await buildDepthGateWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      httpGet,
    });
    expect(wiring.readDepthGate).toBeNull();
  });
});

describe('buildDepthGateWiring — a configured Worker builds a real, usable reader', () => {
  it('constructs requests with the persisted config and the reader actually reaches it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const calls: { url: string; headers: Readonly<Record<string, string>> }[] = [];
    const httpGet: DepthGateHttpGet = async (params) => {
      calls.push(params);
      return { status: 200, text: JSON.stringify(bodyEnvelope()) };
    };

    const wiring = await buildDepthGateWiring({
      dataHost: host,
      httpGet,
      now: () => new Date('2026-08-25T09:00:00.000Z'),
    });

    expect(wiring.readDepthGate).not.toBeNull();
    const depthGate = await wiring.readDepthGate?.();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.authorization).toBe('Bearer secret-token');
    expect(depthGate).toBe('relational');
  });

  it('re-fetches on every call, unlike the once-resolved wiring shape used elsewhere', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let callCount = 0;
    const httpGet: DepthGateHttpGet = async () => {
      callCount++;
      return { status: 200, text: JSON.stringify(bodyEnvelope()) };
    };
    const wiring = await buildDepthGateWiring({ dataHost: host, httpGet });

    await wiring.readDepthGate?.();
    await wiring.readDepthGate?.();
    expect(callCount).toBe(2);
  });

  it('the route unavailable (offline) — readDepthGate resolves undefined, the declared fallback then applies in rollup.ts', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const httpGet: DepthGateHttpGet = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const wiring = await buildDepthGateWiring({ dataHost: host, httpGet });

    expect(wiring.readDepthGate).not.toBeNull();
    await expect(wiring.readDepthGate?.()).resolves.toBeUndefined();
  });
});
