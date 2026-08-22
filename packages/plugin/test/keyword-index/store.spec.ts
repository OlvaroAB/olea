/**
 * `ObsidianKeywordIndexStore` tests (C2.1, D-006, P2-T01a) — see
 * `features/C2-index.md`'s "ObsidianKeywordIndexStore (plugin-side
 * persistence, P2-T01a)" scenarios, which this file's `describe`/`it`
 * names are written to satisfy directly.
 *
 * Runs against a fake `ObsidianDataHost` — this file never imports
 * `obsidian` itself, same reasoning as `test/ingestion/queue-store.spec.ts`.
 */
import type { PersistedKeywordIndex } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  INGESTION_QUEUE_STORAGE_KEY,
  ObsidianQueueStore,
} from '../../src/ingestion/queue-store.js';
import {
  KEYWORD_INDEX_STORAGE_KEY,
  type ObsidianDataHost,
  ObsidianKeywordIndexStore,
} from '../../src/keyword-index/store.js';

/** Stands in for a real `Plugin`'s `loadData`/`saveData`, backed by an in-memory blob exactly as Obsidian persists one `data.json` per plugin. */
class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

const sampleIndex: PersistedKeywordIndex = {
  version: 1,
  documents: [
    {
      path: 'Courses/GEOL204/week2.md',
      courses: ['GEOL204'],
      contentHash: 'deadbeef',
      blocks: [{ blockIndex: 1, kind: 'heading', text: 'Bedform Stratification' }],
    },
  ],
};

describe('ObsidianKeywordIndexStore.load', () => {
  it('returns null when nothing has ever been saved (data.json is null/undefined, per Obsidian for a fresh install)', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianKeywordIndexStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null when data.json holds an object but no keyword-index key yet', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: true };
    const store = new ObsidianKeywordIndexStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null (not a throw) when the stored value under the key is malformed', async () => {
    const host = new FakeDataHost();
    host.blob = { [KEYWORD_INDEX_STORAGE_KEY]: { documents: 'not-an-array', version: 1 } };
    const store = new ObsidianKeywordIndexStore(host);
    expect(await store.load()).toBeNull();
  });

  it('round-trips an index saved by this same store', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianKeywordIndexStore(host);
    await store.save(sampleIndex);
    expect(await store.load()).toEqual(sampleIndex);
  });
});

describe('ObsidianKeywordIndexStore.save — namespacing inside the shared data.json blob', () => {
  it('writes under its own key without touching an empty/absent blob', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianKeywordIndexStore(host);
    await store.save(sampleIndex);
    expect(host.blob).toEqual({ [KEYWORD_INDEX_STORAGE_KEY]: sampleIndex });
  });

  it('preserves unrelated keys already present in data.json — never clobbers another writer', async () => {
    const host = new FakeDataHost();
    host.blob = { pluginSettings: { theme: 'dark' }, cacheVersion: 3 };
    const store = new ObsidianKeywordIndexStore(host);
    await store.save(sampleIndex);
    expect(host.blob).toEqual({
      pluginSettings: { theme: 'dark' },
      cacheVersion: 3,
      [KEYWORD_INDEX_STORAGE_KEY]: sampleIndex,
    });
  });

  it('re-reads before writing, so a key written by another part of the plugin between two saves survives', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianKeywordIndexStore(host);
    await store.save(sampleIndex);

    host.blob = { ...(host.blob as Record<string, unknown>), otherFeature: 'value' };

    const updatedIndex: PersistedKeywordIndex = { version: 1, documents: [] };
    await store.save(updatedIndex);

    expect(host.blob).toEqual({
      otherFeature: 'value',
      [KEYWORD_INDEX_STORAGE_KEY]: updatedIndex,
    });
  });
});

describe('ObsidianKeywordIndexStore and ObsidianQueueStore sharing one data.json blob', () => {
  it('the keyword index never clobbers the ingestion queue key, written in either order', async () => {
    const host = new FakeDataHost();
    const keywordStore = new ObsidianKeywordIndexStore(host);
    const queueStore = new ObsidianQueueStore(host);

    // Order 1: queue first, then keyword index.
    await queueStore.save({ version: 1, jobs: [], headroom: null });
    await keywordStore.save(sampleIndex);

    expect(host.blob).toEqual({
      [INGESTION_QUEUE_STORAGE_KEY]: { version: 1, jobs: [], headroom: null },
      [KEYWORD_INDEX_STORAGE_KEY]: sampleIndex,
    });
    expect(await queueStore.load()).toEqual({ version: 1, jobs: [], headroom: null });
    expect(await keywordStore.load()).toEqual(sampleIndex);

    // Order 2: keyword index first, then queue — start from a fresh blob.
    host.blob = null;
    await keywordStore.save(sampleIndex);
    await queueStore.save({ version: 1, jobs: [], headroom: 0.9 });

    expect(host.blob).toEqual({
      [KEYWORD_INDEX_STORAGE_KEY]: sampleIndex,
      [INGESTION_QUEUE_STORAGE_KEY]: { version: 1, jobs: [], headroom: 0.9 },
    });
    expect(await queueStore.load()).toEqual({ version: 1, jobs: [], headroom: 0.9 });
    expect(await keywordStore.load()).toEqual(sampleIndex);
  });
});
