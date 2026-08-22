/**
 * `buildRetrievalWiring` / `drainIntoEmbeddingCache` tests (`ol-odb0.1`).
 *
 * Runs entirely against fakes at the plugin's own testable seam
 * (`ObsidianDataHost`, `WorkerTaskTransport`, `EmbeddingCacheStore`,
 * `KeywordIndexStore`) — no `obsidian` import anywhere in this file, and
 * none needed: neither `retrieval/wiring.ts` nor its dependencies import
 * `obsidian`. What is NOT proven here, because it cannot be without a
 * running Obsidian host: that `main.ts` actually calls these with
 * `createObsidianWorkerTransport` and a real plugin instance as the data
 * host — see `test/main-wiring.spec.ts`'s source-level assertions for that
 * half.
 */
import type {
  EmbeddingCacheStore,
  ExtractedUnit,
  KeywordIndexStore,
  PersistedEmbeddingCache,
  VaultSource,
  WorkerTaskRequest,
} from 'olea-core';
import { EmbeddingCacheEngine, KeywordIndexEngine } from 'olea-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingIndexingSink } from '../../src/ingestion/pending-indexing-sink.js';
import { buildRetrievalWiring, drainIntoEmbeddingCache } from '../../src/retrieval/wiring.js';
import type { PersistedWorkerConfig } from '../../src/worker/config-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../../src/worker/config-store.js';
import type { WorkerConfig } from '../../src/worker/transport.js';

// ---- shared fakes -----------------------------------------------------

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

/** A `WorkerTaskTransport` fake that answers `retrieval.embed.v1` with one deterministic vector per content hash — enough to prove the seam without a real Worker. */
function fakeTransport() {
  const calls: WorkerTaskRequest[] = [];
  const send = vi.fn(async (request: WorkerTaskRequest) => {
    calls.push(request);
    const payload = request.payload as { chunks: readonly { contentHash: string }[] };
    return {
      ok: true,
      stamp: { modelId: '@cf/baai/bge-m3', promptVersion: 'v1' },
      result: {
        embeddings: payload.chunks.map((chunk) => ({
          contentHash: chunk.contentHash,
          // A short, deterministic, chunk-specific vector — cosine ranking
          // isn't under test here, only that the seam carries vectors through.
          vector: [1, 0, 0],
        })),
      },
    };
  });
  return { send: (request: WorkerTaskRequest) => send(request), calls, sendSpy: send };
}

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  state: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.state;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.state = cache;
  }
}

class MemoryKeywordIndexStore implements KeywordIndexStore {
  constructor(private readonly persisted: import('olea-core').PersistedKeywordIndex | null) {}
  async load() {
    return this.persisted;
  }
  async save(): Promise<void> {
    throw new Error('not needed by these tests');
  }
}

/** Never called in these tests — `KeywordIndexEngine.create` only calls `store.load()`. */
const unusedVault: VaultSource = {
  list: () => {
    throw new Error('unused');
  },
  read: () => {
    throw new Error('unused');
  },
  readBinary: () => {
    throw new Error('unused');
  },
  write: () => {
    throw new Error('unused');
  },
  exists: () => {
    throw new Error('unused');
  },
  watch: () => () => {},
};

function unit(sourcePath: string, text: string): ExtractedUnit {
  return {
    text,
    provenance: { sourcePath, location: { page: 1, charRange: { start: 0, end: text.length } } },
  };
}

// ---- buildRetrievalWiring ----------------------------------------------

describe('buildRetrievalWiring — F7.8 grey-out', () => {
  it('returns a null embeddingCache when no Worker config has ever been saved', async () => {
    const wiring = await buildRetrievalWiring({
      dataHost: new FakeDataHost(),
      createTransport: () => fakeTransport(),
    });
    expect(wiring.embeddingCache).toBeNull();
  });

  it('returns a null embeddingCache when the config is present but blank (baseUrl or token empty)', async () => {
    const wiring = await buildRetrievalWiring({
      dataHost: configuredHost({ version: 1, baseUrl: '', token: '' }),
      createTransport: () => fakeTransport(),
    });
    expect(wiring.embeddingCache).toBeNull();
  });
});

describe('buildRetrievalWiring — a configured Worker builds a real, usable EmbeddingCacheEngine', () => {
  it('constructs the transport with the persisted config and the engine actually embeds through it', async () => {
    const host = configuredHost({
      version: 1,
      baseUrl: 'https://worker.example',
      token: 'secret-token',
    });
    let seenConfig: WorkerConfig | null = null;
    const transport = fakeTransport();

    const wiring = await buildRetrievalWiring({
      dataHost: host,
      createTransport: (config) => {
        seenConfig = config;
        return transport;
      },
    });

    expect(seenConfig).toEqual({ baseUrl: 'https://worker.example', token: 'secret-token' });
    expect(wiring.embeddingCache).not.toBeNull();

    const engine = wiring.embeddingCache as EmbeddingCacheEngine;
    await engine.ensureEmbeddings([
      { path: 'a.md', blockIndex: 0, kind: 'paragraph', text: 'hello', contentHash: 'hash-1' },
    ]);
    expect(transport.calls).toHaveLength(1);
    expect(engine.codesFor('hash-1')).toBeDefined();
  });
});

// ---- drainIntoEmbeddingCache -------------------------------------------

describe('drainIntoEmbeddingCache', () => {
  let cacheStore: MemoryEmbeddingCacheStore;
  let transport: ReturnType<typeof fakeTransport>;
  let embeddingCache: EmbeddingCacheEngine;

  beforeEach(async () => {
    cacheStore = new MemoryEmbeddingCacheStore();
    transport = fakeTransport();
    const { WorkerEmbeddingProvider } = await import('olea-core');
    embeddingCache = await EmbeddingCacheEngine.create({
      store: cacheStore,
      provider: new WorkerEmbeddingProvider({ transport }),
      model: '@cf/baai/bge-m3',
    });
  });

  it('embeds everything the sink has accumulated', async () => {
    const sink = new PendingIndexingSink();
    await sink.receive([unit('Lectures/a.pdf', 'extracted text one')]);

    await drainIntoEmbeddingCache({ embeddingCache, sink });

    expect(transport.calls).toHaveLength(1);
    const payload = transport.calls[0]?.payload as { chunks: readonly { text: string }[] };
    expect(payload.chunks.map((c) => c.text)).toEqual(['extracted text one']);
  });

  it('also embeds the keyword index chunks when one is supplied', async () => {
    const sink = new PendingIndexingSink();
    const keywordIndex = await KeywordIndexEngine.create({
      vault: unusedVault,
      store: new MemoryKeywordIndexStore({
        version: 1,
        documents: [
          {
            path: 'note.md',
            courses: [],
            contentHash: 'doc-hash',
            blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'markdown block text' }],
          },
        ],
      }),
    });

    await drainIntoEmbeddingCache({ embeddingCache, sink, keywordIndex });

    const payload = transport.calls[0]?.payload as { chunks: readonly { text: string }[] };
    expect(payload.chunks.map((c) => c.text)).toEqual(['markdown block text']);
  });

  it('sends each distinct text exactly once even when it appears in both sources (C2.3 dedup)', async () => {
    const sink = new PendingIndexingSink();
    await sink.receive([unit('Lectures/a.pdf', 'shared text')]);
    const keywordIndex = await KeywordIndexEngine.create({
      vault: unusedVault,
      store: new MemoryKeywordIndexStore({
        version: 1,
        documents: [
          {
            path: 'note.md',
            courses: [],
            contentHash: 'doc-hash',
            blocks: [{ blockIndex: 0, kind: 'paragraph', text: 'shared text' }],
          },
        ],
      }),
    });

    await drainIntoEmbeddingCache({ embeddingCache, sink, keywordIndex });

    const payload = transport.calls[0]?.payload as { chunks: readonly { text: string }[] };
    expect(payload.chunks).toHaveLength(1);
  });

  it('makes no provider call at all when there is nothing to embed', async () => {
    const sink = new PendingIndexingSink();
    await drainIntoEmbeddingCache({ embeddingCache, sink });
    expect(transport.calls).toHaveLength(0);
  });

  it('a second drain of the same content sends nothing new (already cached by content hash)', async () => {
    const sink = new PendingIndexingSink();
    await sink.receive([unit('Lectures/a.pdf', 'stable text')]);

    await drainIntoEmbeddingCache({ embeddingCache, sink });
    expect(transport.calls).toHaveLength(1);

    await drainIntoEmbeddingCache({ embeddingCache, sink });
    expect(transport.calls).toHaveLength(1); // unchanged — no second call
  });
});
