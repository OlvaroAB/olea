import { describe, expect, it } from 'vitest';
import type {
  MisconceptionEmbeddingCacheStore,
  PersistedMisconceptionEmbeddingCache,
} from './embedding-cache.js';
import { MisconceptionEmbeddingCacheEngine } from './embedding-cache.js';
import type { EmbeddingVector, MisconceptionEmbedder, MisconceptionRecord } from './types.js';

class MemoryMisconceptionEmbeddingCacheStore implements MisconceptionEmbeddingCacheStore {
  private saved: PersistedMisconceptionEmbeddingCache | null = null;
  saveCount = 0;

  async load(): Promise<PersistedMisconceptionEmbeddingCache | null> {
    return this.saved;
  }

  async save(cache: PersistedMisconceptionEmbeddingCache): Promise<void> {
    this.saveCount += 1;
    this.saved = cache;
  }

  peek(): PersistedMisconceptionEmbeddingCache | null {
    return this.saved;
  }

  /** Writes a value the port's type forbids — an older build's shape. `load` is a boundary onto untyped JSON on disk, so this is a state the engine really can meet. */
  forceSave(raw: unknown): void {
    this.saved = raw as PersistedMisconceptionEmbeddingCache;
  }
}

/** Deterministic per-text "vector", unless a failure is scripted. */
class FakeMisconceptionEmbedder implements MisconceptionEmbedder {
  readonly calls: (readonly string[])[] = [];
  private failNext = false;

  scriptFailure(): void {
    this.failNext = true;
  }

  async embed(texts: readonly string[]): Promise<readonly EmbeddingVector[]> {
    this.calls.push(texts);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('embedder unavailable');
    }
    return texts.map((text) => [text.length, 1, 0]);
  }
}

function record(id: string, statement: string): MisconceptionRecord {
  return {
    id,
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement,
    correction: 'The source says otherwise.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
    firstSeen: '2026-08-01T00:00:00-04:00',
    lastSeen: '2026-08-01T00:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:concept-alpha:1',
  };
}

describe('MisconceptionEmbeddingCacheEngine.create (ol-nagi, mirrors EmbeddingCacheEngine)', () => {
  it('starts empty when nothing is persisted', async () => {
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store: new MemoryMisconceptionEmbeddingCacheStore(),
      embedder: new FakeMisconceptionEmbedder(),
      model: 'model-a',
    });
    expect(engine.snapshot().size).toBe(0);
  });

  it('loads a persisted cache computed under the same model', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    await store.save({
      version: 1,
      model: 'model-a',
      entries: [{ contentHash: 'h1', vector: [1, 2, 3] }],
    });

    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder: new FakeMisconceptionEmbedder(),
      model: 'model-a',
    });

    expect(engine.snapshot().get('h1')).toEqual([1, 2, 3]);
  });

  it('treats a cache computed under a different model as fully stale', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    await store.save({
      version: 1,
      model: 'model-old',
      entries: [{ contentHash: 'h1', vector: [1, 2, 3] }],
    });

    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder: new FakeMisconceptionEmbedder(),
      model: 'model-new',
    });

    expect(engine.snapshot().size).toBe(0);
  });

  it('treats an unrecognised schema version as nothing persisted, rather than trusting it', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    store.forceSave({
      version: 99,
      model: 'model-a',
      entries: [{ contentHash: 'h1', vector: [1, 2, 3] }],
    });

    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder: new FakeMisconceptionEmbedder(),
      model: 'model-a',
    });

    expect(engine.snapshot().size).toBe(0);
  });
});

describe('MisconceptionEmbeddingCacheEngine.ensureEmbeddings / candidatesFor', () => {
  it('embeds a missing statement exactly once and persists it', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    const embedder = new FakeMisconceptionEmbedder();
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder,
      model: 'model-a',
    });

    const candidates = await engine.candidatesFor([record('m1', 'Believes X implies Y.')]);

    expect(candidates).toEqual([{ id: 'm1', embedding: ['Believes X implies Y.'.length, 1, 0] }]);
    expect(embedder.calls).toEqual([['Believes X implies Y.']]);
    expect(store.saveCount).toBe(1);
  });

  it('never re-embeds a statement already cached from a prior call (content-hash caching, C2.3-style)', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    const embedder = new FakeMisconceptionEmbedder();
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder,
      model: 'model-a',
    });

    await engine.candidatesFor([record('m1', 'Believes X implies Y.')]);
    embedder.calls.length = 0;
    store.saveCount = 0;

    const candidates = await engine.candidatesFor([record('m1', 'Believes X implies Y.')]);

    expect(candidates).toEqual([{ id: 'm1', embedding: ['Believes X implies Y.'.length, 1, 0] }]);
    expect(embedder.calls).toHaveLength(0);
    expect(store.saveCount).toBe(0);
  });

  it('embeds two records sharing identical statement text once, not once per record', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    const embedder = new FakeMisconceptionEmbedder();
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder,
      model: 'model-a',
    });

    const candidates = await engine.candidatesFor([
      record('m1', 'Same wording.'),
      record('m2', 'Same wording.'),
    ]);

    expect(embedder.calls).toEqual([['Same wording.']]);
    expect(candidates).toEqual([
      { id: 'm1', embedding: ['Same wording.'.length, 1, 0] },
      { id: 'm2', embedding: ['Same wording.'.length, 1, 0] },
    ]);
  });

  it('only sends the MISSING statements to the embedder when some are already cached', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    const embedder = new FakeMisconceptionEmbedder();
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder,
      model: 'model-a',
    });

    await engine.candidatesFor([record('m1', 'First statement.')]);
    embedder.calls.length = 0;

    await engine.candidatesFor([
      record('m1', 'First statement.'),
      record('m2', 'Second statement.'),
    ]);

    expect(embedder.calls).toEqual([['Second statement.']]);
  });

  it('degrades honestly on embedder failure: returns cached entries, omits the ones that could not be resolved, never throws', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    const embedder = new FakeMisconceptionEmbedder();
    embedder.scriptFailure();
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder,
      model: 'model-a',
    });

    const candidates = await engine.candidatesFor([record('m1', 'Unreachable Worker today.')]);

    expect(candidates).toEqual([]);
    expect(store.saveCount).toBe(0);
  });

  it('clear() empties the cache and persists the empty state', async () => {
    const store = new MemoryMisconceptionEmbeddingCacheStore();
    const embedder = new FakeMisconceptionEmbedder();
    const engine = await MisconceptionEmbeddingCacheEngine.create({
      store,
      embedder,
      model: 'model-a',
    });
    await engine.candidatesFor([record('m1', 'Something.')]);

    await engine.clear();

    expect(engine.snapshot().size).toBe(0);
    expect(store.peek()?.entries).toEqual([]);
  });
});
