import { describe, expect, it } from 'vitest';
import { EmbeddingCacheEngine } from './embeddingCache.js';
import { decodeQuantisedVector, encodeQuantisedVector, quantiseVector } from './quantise.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  PersistedEmbeddingCache,
  RetrievalChunk,
} from './types.js';

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  saveCount = 0;

  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }

  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saveCount += 1;
    this.saved = cache;
  }

  peek(): PersistedEmbeddingCache | null {
    return this.saved;
  }

  /** Writes a value the port's type forbids — an older build's shape. `load` is a boundary onto untyped JSON on disk, so this is a state the engine really can meet. */
  forceSave(raw: unknown): void {
    this.saved = raw as PersistedEmbeddingCache;
  }
}

/**
 * Deterministic three-dimensional "vector" per text, unless a failure is
 * scripted. Three dimensions rather than one because quantisation keeps
 * *direction*: every one-dimensional vector has the same direction up to
 * sign, so a 1-D fake could not tell two cached entries apart at all.
 */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly requests: EmbedRequest[] = [];
  private failNext = false;

  scriptFailure(): void {
    this.failNext = true;
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.requests.push(request);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider unavailable');
    }
    return { vectors: request.texts.map((text) => [text.length, 1, 0]) };
  }
}

function chunk(
  path: string,
  blockIndex: number,
  contentHash: string,
  text = contentHash,
): RetrievalChunk {
  return { path, blockIndex, kind: 'paragraph', text, contentHash };
}

/** What the fake provider's vector for a text of length `n` quantises to. */
function expectedCodes(length: number): Int8Array {
  return quantiseVector([length, 1, 0]);
}

describe('EmbeddingCacheEngine.create (D-004, D-006)', () => {
  it('starts empty when nothing is persisted', async () => {
    const engine = await EmbeddingCacheEngine.create({
      store: new MemoryEmbeddingCacheStore(),
      provider: new FakeEmbeddingProvider(),
      model: 'model-a',
    });
    expect(engine.snapshot().size).toBe(0);
  });

  it('loads a persisted cache computed under the same model', async () => {
    const store = new MemoryEmbeddingCacheStore();
    await store.save({
      version: 2,
      model: 'model-a',
      entries: [{ contentHash: 'h1', codes: encodeQuantisedVector(Int8Array.from([127, 25, 0])) }],
    });

    const engine = await EmbeddingCacheEngine.create({
      store,
      provider: new FakeEmbeddingProvider(),
      model: 'model-a',
    });

    expect(engine.codesFor('h1')).toEqual(Int8Array.from([127, 25, 0]));
  });

  it('treats a cache computed under a different model as fully stale (cost model §2 makes any model change a full re-index)', async () => {
    const store = new MemoryEmbeddingCacheStore();
    await store.save({
      version: 2,
      model: 'model-old',
      entries: [{ contentHash: 'h1', codes: encodeQuantisedVector(Int8Array.from([127, 25, 0])) }],
    });

    const engine = await EmbeddingCacheEngine.create({
      store,
      provider: new FakeEmbeddingProvider(),
      model: 'model-new',
    });

    expect(engine.snapshot().size).toBe(0);
    expect(engine.codesFor('h1')).toBeUndefined();
  });

  it('treats a version-1 cache — full-precision `vector` arrays — as nothing persisted, rather than migrating it (ol-l1qz)', async () => {
    const store = new MemoryEmbeddingCacheStore();
    store.forceSave({
      version: 1,
      model: 'model-a',
      entries: [{ contentHash: 'h1', vector: [0.1, 0.2, 0.3] }],
    });

    const engine = await EmbeddingCacheEngine.create({
      store,
      provider: new FakeEmbeddingProvider(),
      model: 'model-a',
    });

    expect(engine.snapshot().size).toBe(0);
  });

  it('drops an entry whose codes do not decode and keeps the rest, rather than failing the whole load', async () => {
    const store = new MemoryEmbeddingCacheStore();
    await store.save({
      version: 2,
      model: 'model-a',
      entries: [
        { contentHash: 'bad', codes: 'not!valid!base64' },
        { contentHash: 'good', codes: encodeQuantisedVector(Int8Array.from([127, 25, 0])) },
      ],
    });

    const engine = await EmbeddingCacheEngine.create({
      store,
      provider: new FakeEmbeddingProvider(),
      model: 'model-a',
    });

    expect(engine.snapshot().size).toBe(1);
    expect(engine.codesFor('good')).toEqual(Int8Array.from([127, 25, 0]));
    expect(engine.codesFor('bad')).toBeUndefined();
  });
});

describe('EmbeddingCacheEngine.ensureEmbeddings (C2.3: only changed chunks re-embed)', () => {
  it('embeds a chunk with no cached vector and persists it as quantised codes, never as floats (ol-l1qz)', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });

    const result = await engine.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    expect(result.get('h1')).toEqual(expectedCodes(5));
    expect(provider.requests).toHaveLength(1);

    const persisted = store.peek();
    expect(persisted?.version).toBe(2);
    expect(persisted?.entries).toHaveLength(1);
    expect(persisted?.entries[0]?.contentHash).toBe('h1');
    expect(decodeQuantisedVector(persisted?.entries[0]?.codes ?? '')).toEqual(expectedCodes(5));
  });

  it('quantises the provider vector rather than storing it — the exact code grid, not "roughly right"', async () => {
    // [5, 1, 0] -> scale 5 -> [127, round(1/5*127)=25, 0].
    expect(quantiseVector([5, 1, 0])).toEqual(Int8Array.from([127, 25, 0]));
    // Direction only: the scale is discarded, so a 10x-longer vector codes identically.
    expect(quantiseVector([50, 10, 0])).toEqual(quantiseVector([5, 1, 0]));
  });

  it('the persisted JSON carries no full-precision component anywhere', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });
    await engine.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    const json = JSON.stringify(store.peek());
    // A stored float would show up as a decimal point inside a number array;
    // the persisted form has neither an array of numbers nor a `vector` key.
    expect(json).not.toContain('"vector"');
    expect(json).toContain('"codes"');
    expect(json).toMatch(/"codes":"[A-Za-z0-9+/]*={0,2}"/);
  });

  it('never re-sends a chunk whose content hash is already cached', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });
    await engine.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    provider.requests.length = 0;
    await engine.ensureEmbeddings([
      chunk('a.md', 0, 'h1', 'hello (edited elsewhere, same hash key in this test)'),
    ]);

    expect(provider.requests).toHaveLength(0);
  });

  it('embeds identical text appearing in two chunks exactly once', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });

    await engine.ensureEmbeddings([
      chunk('a.md', 0, 'shared', 'same text'),
      chunk('b.md', 0, 'shared', 'same text'),
    ]);

    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.texts).toEqual(['same text']);
  });

  it('is a no-op — no provider call, no persist — when every chunk is already cached', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });
    await engine.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);
    const savesAfterFirst = store.saveCount;

    provider.requests.length = 0;
    await engine.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    expect(provider.requests).toHaveLength(0);
    expect(store.saveCount).toBe(savesAfterFirst);
  });

  it('survives a full save/load round trip — a reopened cache re-sends nothing', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const first = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });
    await first.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    const reopened = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });
    provider.requests.length = 0;
    await reopened.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    expect(provider.requests).toHaveLength(0);
    expect(reopened.codesFor('h1')).toEqual(expectedCodes(5));
  });

  it('batches missing chunks rather than sending one request per chunk', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({
      store,
      provider,
      model: 'model-a',
      batchSize: 2,
    });

    const chunks = [
      chunk('a.md', 0, 'h1', 'a'),
      chunk('a.md', 1, 'h2', 'bb'),
      chunk('a.md', 2, 'h3', 'ccc'),
    ];
    await engine.ensureEmbeddings(chunks);

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.texts).toHaveLength(2);
    expect(provider.requests[1]?.texts).toHaveLength(1);
  });

  it('keeps partial progress and does not throw when the provider fails partway through', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({
      store,
      provider,
      model: 'model-a',
      batchSize: 1,
    });
    provider.scriptFailure();
    // First batch (h1) fails; engine must not throw and must not attempt h2.

    const result = await engine.ensureEmbeddings([
      chunk('a.md', 0, 'h1', 'a'),
      chunk('a.md', 1, 'h2', 'bb'),
    ]);

    expect(result.size).toBe(0);
    expect(engine.codesFor('h1')).toBeUndefined();
    expect(engine.codesFor('h2')).toBeUndefined();
  });

  it('persists embeddings obtained before a later batch fails', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({
      store,
      provider,
      model: 'model-a',
      batchSize: 1,
    });

    // Fail the second of two batches.
    const originalEmbed = provider.embed.bind(provider);
    let call = 0;
    provider.embed = async (request: EmbedRequest): Promise<EmbedResult> => {
      call += 1;
      if (call === 2) throw new Error('provider unavailable');
      return originalEmbed(request);
    };

    const result = await engine.ensureEmbeddings([
      chunk('a.md', 0, 'h1', 'a'),
      chunk('a.md', 1, 'h2', 'bb'),
    ]);

    expect(result.get('h1')).toEqual(expectedCodes(1));
    expect(result.has('h2')).toBe(false);
    expect(store.peek()?.entries).toHaveLength(1);
    expect(store.peek()?.entries[0]?.contentHash).toBe('h1');
  });
});

describe('EmbeddingCacheEngine.clear (D-006)', () => {
  it('empties the cache and persists the empty state', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });
    await engine.ensureEmbeddings([chunk('a.md', 0, 'h1', 'hello')]);

    await engine.clear();

    expect(engine.snapshot().size).toBe(0);
    expect(store.peek()?.entries).toEqual([]);
  });
});

describe('EmbeddingCacheEngine.toPersisted', () => {
  it('sorts entries by content hash ascending, deterministically', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const provider = new FakeEmbeddingProvider();
    const engine = await EmbeddingCacheEngine.create({ store, provider, model: 'model-a' });

    await engine.ensureEmbeddings([chunk('a.md', 0, 'zzz', 'z'), chunk('a.md', 1, 'aaa', 'a')]);

    expect(engine.toPersisted().entries.map((e) => e.contentHash)).toEqual(['aaa', 'zzz']);
  });

  it('stamps the current schema version, so an older reader rejects rather than misreads it', async () => {
    const store = new MemoryEmbeddingCacheStore();
    const engine = await EmbeddingCacheEngine.create({
      store,
      provider: new FakeEmbeddingProvider(),
      model: 'model-a',
    });
    expect(engine.toPersisted().version).toBe(2);
  });
});
