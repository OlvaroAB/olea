/**
 * `buildMisconceptionEmbedderWiring` / `ObsidianMisconceptionEmbeddingCacheStore`
 * tests (`ol-nagi`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `WorkerTaskTransport`) — no `obsidian` import
 * anywhere in this file, mirroring `test/grading/wiring.spec.ts` and
 * `test/retrieval/embedding-cache-store.spec.ts`, which this file's shape is
 * deliberately modelled on.
 */
import type { PersistedMisconceptionEmbeddingCache, WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildMisconceptionEmbedderWiring,
  MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY,
  type ObsidianDataHost,
  ObsidianMisconceptionEmbeddingCacheStore,
} from '../src/misconception-embedder.js';
import { SLOT_E_MODEL_ID } from '../src/retrieval/wiring.js';
import type { PersistedWorkerConfig } from '../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../src/worker/config-store.js';
import type { WorkerConfig } from '../src/worker/transport.js';

// ---- shared fakes -----------------------------------------------------

class FakeDataHost implements ObsidianDataHost {
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

/** A `WorkerTaskTransport` fake that answers `retrieval.embed.v1` with scripted vectors keyed by hash. */
function fakeEmbeddingTransport() {
  const calls: WorkerTaskRequest[] = [];
  return {
    calls,
    send: async (request: WorkerTaskRequest) => {
      calls.push(request);
      const payload = request.payload as { chunks: { contentHash: string; text: string }[] };
      return {
        ok: true,
        stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: SLOT_E_MODEL_ID },
        result: {
          embeddings: payload.chunks.map((chunk) => ({
            contentHash: chunk.contentHash,
            vector: [chunk.text.length, 1, 0],
          })),
        },
      };
    },
  };
}

const sampleCache: PersistedMisconceptionEmbeddingCache = {
  version: 1,
  model: SLOT_E_MODEL_ID,
  entries: [{ contentHash: 'deadbeef', vector: [0.1, 0.2, 0.3] }],
};

// ---- ObsidianMisconceptionEmbeddingCacheStore --------------------------

describe('ObsidianMisconceptionEmbeddingCacheStore — namespacing inside the shared data.json blob', () => {
  it('returns null when nothing has ever been saved', async () => {
    const store = new ObsidianMisconceptionEmbeddingCacheStore(new FakeDataHost());
    expect(await store.load()).toBeNull();
  });

  it('round-trips a cache saved by this same store', async () => {
    const store = new ObsidianMisconceptionEmbeddingCacheStore(new FakeDataHost());
    await store.save(sampleCache);
    expect(await store.load()).toEqual(sampleCache);
  });

  it('writes under its own key, distinct from retrieval’s embeddingCache key, and preserves unrelated keys', async () => {
    const host = new FakeDataHost();
    host.blob = {
      embeddingCache: { version: 2, model: 'x', entries: [] },
      keywordIndex: { version: 1 },
    };
    const store = new ObsidianMisconceptionEmbeddingCacheStore(host);
    await store.save(sampleCache);
    expect(host.blob).toEqual({
      embeddingCache: { version: 2, model: 'x', entries: [] },
      keywordIndex: { version: 1 },
      [MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY]: sampleCache,
    });
  });

  it('returns null (not a throw) for a malformed stored value', async () => {
    const host = new FakeDataHost();
    host.blob = { [MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY]: { entries: 'not-an-array' } };
    expect(await new ObsidianMisconceptionEmbeddingCacheStore(host).load()).toBeNull();
  });
});

// ---- buildMisconceptionEmbedderWiring — F7.8 grey-out -------------------

describe('buildMisconceptionEmbedderWiring — F7.8 grey-out', () => {
  it('returns a null embedder and cache when no Worker config has ever been saved', async () => {
    const wiring = await buildMisconceptionEmbedderWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeEmbeddingTransport(),
    });
    expect(wiring.embedder).toBeNull();
    expect(wiring.cache).toBeNull();
  });

  it('returns null when the config is present but blank', async () => {
    const wiring = await buildMisconceptionEmbedderWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      createTransport: () => fakeEmbeddingTransport(),
    });
    expect(wiring.embedder).toBeNull();
    expect(wiring.cache).toBeNull();
  });
});

describe('buildMisconceptionEmbedderWiring — a configured Worker builds a real, usable embedder + cache', () => {
  it('constructs the transport with the persisted config and reaches the SAME registered embedding task (retrieval.embed.v1) — no new endpoint', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let seenConfig: WorkerConfig | null = null;
    const transport = fakeEmbeddingTransport();

    const wiring = await buildMisconceptionEmbedderWiring({
      dataHost: host,
      createTransport: (config) => {
        seenConfig = config;
        return transport;
      },
    });

    expect(seenConfig).toEqual({ baseUrl: 'https://worker.example', token: 'secret-token' });
    expect(wiring.embedder).not.toBeNull();
    expect(wiring.cache).not.toBeNull();

    const vectors = await wiring.embedder?.embed(['a statement']);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('retrieval.embed.v1');
    expect(vectors).toEqual([['a statement'.length, 1, 0]]);
  });

  it('the cache actually caches across calls, backed by the same real embedder', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    const transport = fakeEmbeddingTransport();
    const wiring = await buildMisconceptionEmbedderWiring({
      dataHost: host,
      createTransport: () => transport,
    });

    const record = {
      id: 'm1',
      conceptId: 'concept-alpha',
      confusedWithConceptId: null,
      statement: 'Believes X implies Y.',
      correction: 'Only under condition Z.',
      citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
      firstSeen: '2026-08-01T00:00:00-04:00',
      lastSeen: '2026-08-01T00:00:00-04:00',
      occurrenceCount: 1,
      status: 'active' as const,
      originInstrumentId: 'explain-back:concept-alpha:1',
    };

    await wiring.cache?.candidatesFor([record]);
    expect(transport.calls).toHaveLength(1);

    await wiring.cache?.candidatesFor([record]);
    // Still one call — the second lookup was a cache hit.
    expect(transport.calls).toHaveLength(1);
  });
});
