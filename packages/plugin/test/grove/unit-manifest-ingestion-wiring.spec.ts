/**
 * The unit manifest's writers, through the real ingestion composition (`[D-445]`,
 * `ol-egov.141.89.8.43`): `buildIngestionRunner`'s `vision.onManifestEntry` is the seam
 * `vision-page-runner.ts` documented as "the seam a later wiring bead composes into" a durable
 * manifest, and the store's `recordReading` is what `main.ts` composes into it. This file proves the
 * threading (a drained vision-page job's reading lands as a record on that page's stable unit id) and
 * that the routing options the queue extracts with are the ones exposed for the store to enumerate by.
 *
 * Every string below is invented (INV-3).
 */
import { OPERATING_FRESH_FOR_SECONDS, OPERATING_GOVERNS_FOR_SECONDS } from 'olea-contracts';
import {
  isFullyRead,
  type PersistedQueue,
  type QueueStore,
  stableUnitId,
  type UnitManifest,
  type UnitManifestEntry,
  type VaultPath,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultUnitManifestStore } from '../../src/grove/unit-manifest-store.js';
import type { RenderedPage } from '../../src/ingestion/page-render/types.js';
import { buildIngestionRunner } from '../../src/ingestion/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';
import { eventedTestVault } from './unit-manifest-test-vault.js';

const NOW = new Date('2026-09-29T10:00:00Z');
const DECK = 'Lectures/deck.pdf' as VaultPath;
const CAN_DRAIN = { canDrain: true };

class MemoryQueueStore implements QueueStore {
  private state: PersistedQueue | null = null;
  async load(): Promise<PersistedQueue | null> {
    return this.state;
  }
  async save(queue: PersistedQueue): Promise<void> {
    this.state = queue;
  }
}

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

const CONFIG: PersistedWorkerConfig = {
  version: 1,
  baseUrl: 'https://worker.example',
  token: 't',
};

function visionTransport(reply: unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      return {
        ok: true,
        stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'synthetic-model' },
        result: reply,
      };
    },
  };
}

const PAGE_RENDERER = {
  async renderPage(): Promise<RenderedPage> {
    return {
      dataUrl: 'data:image/png;base64,ZmFrZS1yZW5kZXJlZC1wYWdl',
      mimeType: 'image/png',
      width: 100,
      height: 100,
    };
  },
};

function fourPageDeck() {
  return {
    sourcePath: DECK,
    format: 'pdf' as const,
    outcome: 'extracted' as const,
    pages: (['text', 'vision', 'vision', 'vision'] as const).map((route, index) => ({
      page: index + 1,
      charCount: route === 'text' ? 900 : 0,
      textLayer: route === 'text' ? ('readable' as const) : ('absent' as const),
      route: route === 'text' ? ('text-layer' as const) : ('vision' as const),
      units: [],
      furniture: false,
    })),
  };
}

describe('buildIngestionRunner — deps.vision.onManifestEntry ([D-445], ol-egov.141.89.8.43)', () => {
  it("receives one entry per reading, on that page's stable unit id, and the store records it", async () => {
    const vault = eventedTestVault({ [DECK]: 'deck bytes' });
    const store = createVaultUnitManifestStore({
      vault,
      deviceId: 'olea-testdevice1',
      now: () => NOW,
      extractSource: async () => fourPageDeck(),
    });
    await store.load();

    const seen: UnitManifestEntry[] = [];
    const transport = visionTransport({
      outcome: 'complete',
      extractedText: 'Rendered page text',
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
    });
    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      vision: {
        dataHost: configuredHost(CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
        onManifestEntry: (entry) => {
          seen.push(entry);
          store.recordReading(entry);
        },
      },
      pageRenderer: PAGE_RENDERER,
    });

    await engine.enqueue({
      contentHash: 'deck-page-3',
      label: 'deck page 3',
      payload: { kind: 'vision-page', sourcePath: DECK, format: 'pdf', page: 3 },
    });
    expect(await engine.tick()).toEqual({
      kind: 'ran',
      contentHash: 'deck-page-3',
      outcome: 'done',
    });
    await store.idle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      unitId: stableUnitId(DECK, 3),
      sourcePath: DECK,
      page: 3,
      readingState: { kind: 'read', method: 'image' },
      conceptExtractionState: 'not-started',
    });
    expect(seen[0]?.readingState).toMatchObject({
      provenance: { modelIdentity: 'synthetic-model' },
    });

    const manifest = store.manifests().get(DECK) as UnitManifest;
    expect(manifest.entries.map((e) => [e.page, e.readingState.kind])).toEqual([
      [1, 'read'],
      [2, 'pending'],
      [3, 'read'],
      [4, 'pending'],
    ]);
    // One page read of three image pages: the source is not read in full.
    expect(isFullyRead(manifest)).toBe(false);
  });

  it('a reading the Worker calls unreadable lands as unreadable, still one unit, never as read', async () => {
    const vault = eventedTestVault({ [DECK]: 'deck bytes' });
    const store = createVaultUnitManifestStore({
      vault,
      deviceId: 'olea-testdevice1',
      now: () => NOW,
      extractSource: async () => fourPageDeck(),
    });
    await store.load();
    const transport = visionTransport({
      outcome: 'unreadable',
      extractedText: '',
      figureDescription: null,
      coverage: null,
      unreadableReason: 'not-legible',
    });
    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      vision: {
        dataHost: configuredHost(CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
        onManifestEntry: (entry) => store.recordReading(entry),
      },
      pageRenderer: PAGE_RENDERER,
    });
    await engine.enqueue({
      contentHash: 'deck-page-2',
      label: 'deck page 2',
      payload: { kind: 'vision-page', sourcePath: DECK, format: 'pdf', page: 2 },
    });
    await engine.tick();
    await store.idle();

    const manifest = store.manifests().get(DECK) as UnitManifest;
    expect(manifest.entries[1]?.readingState).toMatchObject({
      kind: 'unreadable',
      reason: 'not-legible',
    });
  });

  it('omitted, the runner persists nothing, exactly as before this bead', async () => {
    const vault = eventedTestVault({ [DECK]: 'deck bytes' });
    const transport = visionTransport({
      outcome: 'complete',
      extractedText: 'Rendered page text',
      figureDescription: null,
      coverage: null,
      unreadableReason: null,
    });
    const { engine } = await buildIngestionRunner({
      vault,
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      vision: {
        dataHost: configuredHost(CONFIG),
        createTransport: (_config: WorkerConfig) => transport,
      },
      pageRenderer: PAGE_RENDERER,
    });
    await engine.enqueue({
      contentHash: 'deck-page-1',
      label: 'deck page 1',
      payload: { kind: 'vision-page', sourcePath: DECK, format: 'pdf', page: 1 },
    });
    await engine.tick();
    expect(vault.writes).toEqual([]);
  });
});

describe('buildIngestionRunner — extractOptions exposed for the manifest ([D-445])', () => {
  function bodyEnvelope(minTextLayerChars: number) {
    return {
      envelopeVersion: 1,
      kind: 'vision-route',
      bodyVersion: 1,
      policyVersion: 'vr1-test0123456789',
      computedAt: NOW.toISOString(),
      freshForSeconds: OPERATING_FRESH_FOR_SECONDS,
      governsForSeconds: OPERATING_GOVERNS_FOR_SECONDS,
      body: { minTextLayerChars },
    };
  }

  it('the delivered threshold is the routing the manifest enumerates with', async () => {
    const wiring = await buildIngestionRunner({
      vault: eventedTestVault(),
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
      visionRoute: {
        dataHost: configuredHost(CONFIG),
        httpGet: async () => ({ status: 200, text: JSON.stringify(bodyEnvelope(10)) }),
        now: () => NOW,
      },
    });
    expect(wiring.extractOptions).toEqual({ textLayerCharThreshold: 10 });
  });

  it("with no delivered threshold there is no override: the extractors' declared default applies on both sides", async () => {
    const wiring = await buildIngestionRunner({
      vault: eventedTestVault(),
      queueStore: new MemoryQueueStore(),
      capability: CAN_DRAIN,
    });
    expect(wiring.extractOptions).toBeUndefined();
  });
});
