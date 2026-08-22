/**
 * `ObsidianQueueStore` tests. Runs against a fake `ObsidianDataHost` — this
 * file never imports `obsidian` itself, which is exactly what
 * `queue-store.ts`'s module doc says the narrow port type is for.
 */
import type { PersistedQueue } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  INGESTION_QUEUE_STORAGE_KEY,
  type ObsidianDataHost,
  ObsidianQueueStore,
} from '../../src/ingestion/queue-store.js';

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

const sampleQueue: PersistedQueue = {
  version: 1,
  jobs: [
    {
      contentHash: 'abc123',
      label: 'Synthetic Lecture 1',
      payload: {},
      enqueuedAt: 1000,
      status: 'queued',
      attempts: 0,
    },
  ],
  headroom: null,
};

describe('ObsidianQueueStore.load', () => {
  it('returns null when nothing has ever been saved (data.json is null/undefined, per Obsidian for a fresh install)', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianQueueStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null when data.json holds an object but no ingestion queue key yet', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: true };
    const store = new ObsidianQueueStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null (not a throw) when the stored value under the key is malformed', async () => {
    const host = new FakeDataHost();
    host.blob = { [INGESTION_QUEUE_STORAGE_KEY]: { jobs: 'not-an-array', version: 1 } };
    const store = new ObsidianQueueStore(host);
    expect(await store.load()).toBeNull();
  });

  it('round-trips a queue saved by this same store', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianQueueStore(host);
    await store.save(sampleQueue);
    expect(await store.load()).toEqual(sampleQueue);
  });
});

describe('ObsidianQueueStore.save — namespacing inside the shared data.json blob', () => {
  it('writes under its own key without touching an empty/absent blob', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianQueueStore(host);
    await store.save(sampleQueue);
    expect(host.blob).toEqual({ [INGESTION_QUEUE_STORAGE_KEY]: sampleQueue });
  });

  it('preserves unrelated keys already present in data.json — never clobbers another writer', async () => {
    const host = new FakeDataHost();
    host.blob = { pluginSettings: { theme: 'dark' }, cacheVersion: 3 };
    const store = new ObsidianQueueStore(host);
    await store.save(sampleQueue);
    expect(host.blob).toEqual({
      pluginSettings: { theme: 'dark' },
      cacheVersion: 3,
      [INGESTION_QUEUE_STORAGE_KEY]: sampleQueue,
    });
  });

  it('re-reads before writing, so a key written by another part of the plugin between two saves survives', async () => {
    const host = new FakeDataHost();
    const store = new ObsidianQueueStore(host);
    await store.save(sampleQueue);

    // Something else in the plugin writes its own key directly (not through
    // this store) between two of this store's own saves.
    host.blob = { ...(host.blob as Record<string, unknown>), otherFeature: 'value' };

    const updatedQueue: PersistedQueue = { ...sampleQueue, headroom: 0.42 };
    await store.save(updatedQueue);

    expect(host.blob).toEqual({
      otherFeature: 'value',
      [INGESTION_QUEUE_STORAGE_KEY]: updatedQueue,
    });
  });
});
