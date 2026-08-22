/**
 * `ObsidianEmbeddingCacheStore` tests (C2.3, D-004, D-006, `ol-odb0.1`).
 *
 * Runs against a fake `ObsidianDataHost` — this file never imports
 * `obsidian`, same reasoning as `test/keyword-index/store.spec.ts`, which
 * this file's shape is deliberately modelled on.
 */
import type { PersistedEmbeddingCache } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_CACHE_STORAGE_KEY,
  type ObsidianDataHost,
  ObsidianEmbeddingCacheStore,
} from '../../src/retrieval/embedding-cache-store.js';

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const sampleCache: PersistedEmbeddingCache = {
  version: 2,
  model: '@cf/baai/bge-m3',
  entries: [{ contentHash: 'deadbeef', codes: 'AAAA' }],
};

describe('ObsidianEmbeddingCacheStore.load', () => {
  it('returns null when nothing has ever been saved', async () => {
    const store = new ObsidianEmbeddingCacheStore(new FakeDataHost());
    expect(await store.load()).toBeNull();
  });

  it('returns null when data.json holds an object but no embeddingCache key yet', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: true };
    expect(await new ObsidianEmbeddingCacheStore(host).load()).toBeNull();
  });

  it('returns null (not a throw) for a version-1 cache — pre-ol-l1qz shape carried `vector`, not `codes`', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [EMBEDDING_CACHE_STORAGE_KEY]: {
        version: 1,
        model: '@cf/baai/bge-m3',
        entries: [{ contentHash: 'x', vector: [0.1, 0.2] }],
      },
    };
    expect(await new ObsidianEmbeddingCacheStore(host).load()).toBeNull();
  });

  it('returns null (not a throw) when the stored value is malformed', async () => {
    const host = new FakeDataHost();
    host.blob = { [EMBEDDING_CACHE_STORAGE_KEY]: { entries: 'not-an-array' } };
    expect(await new ObsidianEmbeddingCacheStore(host).load()).toBeNull();
  });

  it('round-trips a cache saved by this same store', async () => {
    const store = new ObsidianEmbeddingCacheStore(new FakeDataHost());
    await store.save(sampleCache);
    expect(await store.load()).toEqual(sampleCache);
  });
});

describe('ObsidianEmbeddingCacheStore.save — namespacing inside the shared data.json blob', () => {
  it('writes under its own key without touching an empty/absent blob', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianEmbeddingCacheStore(host);
    await store.save(sampleCache);
    expect(host.blob).toEqual({ [EMBEDDING_CACHE_STORAGE_KEY]: sampleCache });
  });

  it('preserves unrelated keys already present in data.json — never clobbers another writer', async () => {
    const host = new FakeDataHost();
    host.blob = { keywordIndex: { version: 1, documents: [] }, ingestionQueue: { jobs: [] } };
    const store = new ObsidianEmbeddingCacheStore(host);
    await store.save(sampleCache);
    expect(host.blob).toEqual({
      keywordIndex: { version: 1, documents: [] },
      ingestionQueue: { jobs: [] },
      [EMBEDDING_CACHE_STORAGE_KEY]: sampleCache,
    });
  });

  it('re-reads before writing, so a key written by another part of the plugin between two saves survives', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianEmbeddingCacheStore(host);
    await store.save(sampleCache);

    host.blob = { ...(host.blob as Record<string, unknown>), otherFeature: 'value' };

    const updated: PersistedEmbeddingCache = { version: 2, model: '@cf/baai/bge-m3', entries: [] };
    await store.save(updated);

    expect(host.blob).toEqual({
      otherFeature: 'value',
      [EMBEDDING_CACHE_STORAGE_KEY]: updated,
    });
  });
});
