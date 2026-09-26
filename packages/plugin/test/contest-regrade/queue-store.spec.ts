/**
 * `ContestRegradeQueueStore` tests — mirrors `../ingestion/queue-store.spec.ts`
 * for the ingestion queue's own store, adjusted for this store's distinct
 * storage key, plus the one test proving the two stores never collide
 * inside one shared `data.json` blob.
 */
import type { PersistedQueue } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  CONTEST_REGRADE_QUEUE_STORAGE_KEY,
  ContestRegradeQueueStore,
} from '../../src/contest-regrade/queue-store.js';
import type { ObsidianDataHost } from '../../src/ingestion/queue-store.js';
import {
  INGESTION_QUEUE_STORAGE_KEY,
  ObsidianQueueStore,
} from '../../src/ingestion/queue-store.js';

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
      label: 'Regrade dispute · instrument-1',
      payload: {},
      enqueuedAt: 1000,
      status: 'queued',
      attempts: 0,
    },
  ],
  headroom: null,
};

describe('ContestRegradeQueueStore.load', () => {
  it('returns null when nothing has ever been saved', async () => {
    const host = new FakeDataHost();
    const store = new ContestRegradeQueueStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null when data.json holds an object but no contest-regrade queue key yet', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: true };
    const store = new ContestRegradeQueueStore(host);
    expect(await store.load()).toBeNull();
  });

  it('returns null (not a throw) when the stored value under the key is malformed', async () => {
    const host = new FakeDataHost();
    host.blob = { [CONTEST_REGRADE_QUEUE_STORAGE_KEY]: { jobs: 'not-an-array', version: 1 } };
    const store = new ContestRegradeQueueStore(host);
    expect(await store.load()).toBeNull();
  });

  it('round-trips a saved queue', async () => {
    const host = new FakeDataHost();
    const store = new ContestRegradeQueueStore(host);
    await store.save(sampleQueue);
    expect(await store.load()).toEqual(sampleQueue);
  });
});

describe('ContestRegradeQueueStore.save — read-modify-write', () => {
  it('does not clobber another key already present in data.json', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginSetting: true };
    const store = new ContestRegradeQueueStore(host);
    await store.save(sampleQueue);
    expect(host.blob).toEqual({
      someOtherPluginSetting: true,
      [CONTEST_REGRADE_QUEUE_STORAGE_KEY]: sampleQueue,
    });
  });

  it('uses readModifyWrite when the host supports it', async () => {
    const calls: unknown[] = [];
    const host: ObsidianDataHost & {
      readModifyWrite(mutate: (c: unknown) => unknown): Promise<void>;
    } = {
      async loadData() {
        return { someOtherPluginSetting: true };
      },
      async saveData() {
        throw new Error('should not call saveData directly when readModifyWrite is available');
      },
      async readModifyWrite(mutate) {
        const next = mutate({ someOtherPluginSetting: true });
        calls.push(next);
      },
    };
    const store = new ContestRegradeQueueStore(host);
    await store.save(sampleQueue);
    expect(calls).toEqual([
      { someOtherPluginSetting: true, [CONTEST_REGRADE_QUEUE_STORAGE_KEY]: sampleQueue },
    ]);
  });
});

describe('ContestRegradeQueueStore and ObsidianQueueStore share one data.json without colliding', () => {
  it('each store only ever reads and writes its own top-level key', async () => {
    const host = new FakeDataHost();
    const ingestionStore = new ObsidianQueueStore(host);
    const regradeStore = new ContestRegradeQueueStore(host);

    const ingestionQueue: PersistedQueue = { ...sampleQueue, jobs: [] };
    await ingestionStore.save(ingestionQueue);
    await regradeStore.save(sampleQueue);

    expect(await ingestionStore.load()).toEqual(ingestionQueue);
    expect(await regradeStore.load()).toEqual(sampleQueue);
    expect(host.blob).toEqual({
      [INGESTION_QUEUE_STORAGE_KEY]: ingestionQueue,
      [CONTEST_REGRADE_QUEUE_STORAGE_KEY]: sampleQueue,
    });
  });
});
