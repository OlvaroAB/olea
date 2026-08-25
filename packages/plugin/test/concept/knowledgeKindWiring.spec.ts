/**
 * `buildKnowledgeKindWiring` / `classifyConceptKnowledgeKind` tests
 * (`[KCT-2]`, `ol-fx1k`, `[D-114]`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `WorkerTaskTransport`) — no `obsidian` import anywhere
 * in this file, mirroring `wiring.spec.ts` (the read-stage sibling in this
 * same directory).
 */
import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeKindWiring,
  classifyConceptKnowledgeKind,
} from '../../src/concept/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

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

function fakeTransport(reply: (request: WorkerTaskRequest) => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return reply(request);
    },
  };
}

const sourceMaterial = [
  {
    text: 'A concept explained in prose.',
    anchor: { sourcePath: 'a.md', location: { page: 1, charRange: { start: 0, end: 1 } } },
  },
];

describe('buildKnowledgeKindWiring — F7.8 grey-out', () => {
  it('returns a null classifier when no Worker config has ever been saved', async () => {
    const wiring = await buildKnowledgeKindWiring({
      dataHost: new FakeDataHost(),
      createTransport: () =>
        fakeTransport(() => ({ ok: true, result: { kind: 'fact', confidence: 0.5 } })),
    });
    expect(wiring.classifier).toBeNull();
  });

  it('returns a null classifier when the config is present but blank', async () => {
    const wiring = await buildKnowledgeKindWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      createTransport: () =>
        fakeTransport(() => ({ ok: true, result: { kind: 'fact', confidence: 0.5 } })),
    });
    expect(wiring.classifier).toBeNull();
  });
});

describe('buildKnowledgeKindWiring — a configured Worker builds a real, usable KnowledgeKindClassifierPort', () => {
  it('constructs the transport with the persisted config and the classifier actually reaches it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let seenConfig: WorkerConfig | null = null;
    const transport = fakeTransport(() => ({
      ok: true,
      result: { kind: 'principle', confidence: 0.7 },
    }));

    const wiring = await buildKnowledgeKindWiring({
      dataHost: host,
      createTransport: (config) => {
        seenConfig = config;
        return transport;
      },
    });

    expect(seenConfig).toEqual({ baseUrl: 'https://worker.example', token: 'secret-token' });
    expect(wiring.classifier).not.toBeNull();

    const result = await wiring.classifier?.classify({ conceptName: 'X', sourceMaterial });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('concepts.classify.v1');
    expect(result?.kind).toBe('principle');
  });
});

describe('classifyConceptKnowledgeKind', () => {
  it('returns null rather than throwing when the Worker is unconfigured', async () => {
    const wiring = await buildKnowledgeKindWiring({
      dataHost: new FakeDataHost(),
      createTransport: () =>
        fakeTransport(() => ({ ok: true, result: { kind: 'fact', confidence: 0.5 } })),
    });

    const result = await classifyConceptKnowledgeKind(
      wiring,
      { conceptName: 'X', sourceMaterial },
      { confidenceFloor: 0.6 },
    );

    expect(result).toBeNull();
  });

  it('reaches classifyKnowledgeKind through the real, configured classifier — the caller-supplied confidence floor applies', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport(() => ({
      ok: true,
      result: { kind: 'fact', confidence: 0.4 },
    }));
    const wiring = await buildKnowledgeKindWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    const result = await classifyConceptKnowledgeKind(
      wiring,
      { conceptName: 'X', sourceMaterial },
      { confidenceFloor: 0.6 },
    );

    expect(transport.calls).toHaveLength(1);
    expect(result?.outcome).toBe('classified');
    // Below the caller's floor — gated to unclassified by core's own
    // gateKnowledgeKindConfidence, proving the floor actually reached the call.
    expect(
      result && result.outcome === 'classified' ? result.classification.status : undefined,
    ).toBe('unclassified');
  });

  it('a concept classified above the floor commits to the label', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport(() => ({
      ok: true,
      result: { kind: 'category', confidence: 0.9 },
    }));
    const wiring = await buildKnowledgeKindWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    const result = await classifyConceptKnowledgeKind(
      wiring,
      { conceptName: 'X', sourceMaterial },
      { confidenceFloor: 0.6 },
    );

    expect(result?.outcome).toBe('classified');
    expect(result && result.outcome === 'classified' ? result.classification : undefined).toEqual({
      status: 'classified',
      kind: 'category',
      confidence: 0.9,
      method: 'model',
    });
  });

  it('INV-5: empty sourceMaterial never reaches the Worker', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeTransport(() => ({
      ok: true,
      result: { kind: 'fact', confidence: 0.9 },
    }));
    const wiring = await buildKnowledgeKindWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    const result = await classifyConceptKnowledgeKind(
      wiring,
      { conceptName: 'X', sourceMaterial: [] },
      { confidenceFloor: 0.6 },
    );

    expect(transport.calls).toHaveLength(0);
    expect(result?.outcome).toBe('not-run');
    expect(result && result.outcome === 'not-run' ? result.reason : undefined).toBe(
      'no-source-material',
    );
  });
});
