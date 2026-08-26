import { describe, expect, it } from 'vitest';
import {
  MATERIALITY_HASH_STORAGE_KEY,
  ObsidianMaterialityHashStore,
} from '../../../src/ingestion/materiality/hash-store.js';
import type { MaterialityRecord } from '../../../src/ingestion/materiality/types.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const RECORD: MaterialityRecord = {
  path: 'Courses/GEO101/Lecture 3.md',
  hashes: { rawHash: 'raw', canonicalHash: 'canon' },
  canonicalLength: 42,
  lastChangedAt: 1000,
  lastVerdictAt: null,
};

describe('ObsidianMaterialityHashStore', () => {
  it('load returns null for a path never saved', async () => {
    const store = new ObsidianMaterialityHashStore(new FakeDataHost());
    expect(await store.load(RECORD.path)).toBeNull();
  });

  it('round-trips a saved record', async () => {
    const store = new ObsidianMaterialityHashStore(new FakeDataHost());
    await store.save(RECORD);
    expect(await store.load(RECORD.path)).toEqual(RECORD);
  });

  it('namespaces under its own top-level key, never clobbering the rest of data.json', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginKey: { untouched: true } };
    const store = new ObsidianMaterialityHashStore(host);
    await store.save(RECORD);
    expect(host.blob.someOtherPluginKey).toEqual({ untouched: true });
    expect(host.blob[MATERIALITY_HASH_STORAGE_KEY]).toBeDefined();
  });

  it('saving one path does not clobber another path already recorded', async () => {
    const store = new ObsidianMaterialityHashStore(new FakeDataHost());
    const other: MaterialityRecord = { ...RECORD, path: 'Courses/GEO101/Lecture 4.md' };
    await store.save(RECORD);
    await store.save(other);
    expect(await store.load(RECORD.path)).toEqual(RECORD);
    expect(await store.load(other.path)).toEqual(other);
  });

  it('treats a corrupted entry as "never seen" rather than throwing', async () => {
    const host = new FakeDataHost();
    host.blob = { [MATERIALITY_HASH_STORAGE_KEY]: { [RECORD.path]: { garbage: true } } };
    const store = new ObsidianMaterialityHashStore(host);
    expect(await store.load(RECORD.path)).toBeNull();
  });
});
