/**
 * `ObsidianCitationHashStore` tests (`ol-2zfj.35` [CORP-3b]) — this store
 * had no unit coverage before `ol-ppxj.46` moved its `save`/`remove` onto
 * the atomic `readModifyWrite` path; added here alongside that migration,
 * same fake-host pattern every sibling store's test uses.
 */
import { describe, expect, it } from 'vitest';
import {
  CITATION_ANCHOR_STORAGE_KEY,
  type CitationAnchorRecord,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';
import { SerializingDataHost } from '../../../src/retrieval/serializing-data-host.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const RECORD_A: CitationAnchorRecord = {
  sourcePath: 'Courses/GEO101/Lecture 3.md',
  text: 'stripped material text A',
  conceptIds: ['concept-a'],
};

const RECORD_B: CitationAnchorRecord = {
  sourcePath: 'Courses/GEO101/Lecture 4.md',
  text: 'stripped material text B',
  conceptIds: ['concept-b'],
};

describe('ObsidianCitationHashStore', () => {
  it('loadAll returns an empty map when nothing is stored', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    expect(await store.loadAll()).toEqual(new Map());
  });

  it('round-trips a saved record, keyed by instrumentId', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('instrument-1', RECORD_A);
    const loaded = await store.loadAll();
    expect(loaded.get('instrument-1')).toEqual(RECORD_A);
  });

  it('namespaces under its own top-level key, never clobbering the rest of data.json', async () => {
    const host = new FakeDataHost();
    host.blob = { someOtherPluginKey: { untouched: true } };
    const store = new ObsidianCitationHashStore(host);
    await store.save('instrument-1', RECORD_A);
    expect(host.blob.someOtherPluginKey).toEqual({ untouched: true });
    expect(host.blob[CITATION_ANCHOR_STORAGE_KEY]).toBeDefined();
  });

  it('saving one instrument does not clobber another already recorded', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('instrument-1', RECORD_A);
    await store.save('instrument-2', RECORD_B);
    const loaded = await store.loadAll();
    expect(loaded.get('instrument-1')).toEqual(RECORD_A);
    expect(loaded.get('instrument-2')).toEqual(RECORD_B);
  });

  it('remove drops only the named instrument', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('instrument-1', RECORD_A);
    await store.save('instrument-2', RECORD_B);
    await store.remove('instrument-1');
    const loaded = await store.loadAll();
    expect(loaded.has('instrument-1')).toBe(false);
    expect(loaded.get('instrument-2')).toEqual(RECORD_B);
  });

  it('remove on an empty store is a no-op, not an error', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await expect(store.remove('never-saved')).resolves.toBeUndefined();
  });

  it('drops a corrupted entry rather than throwing', async () => {
    const host = new FakeDataHost();
    host.blob = { [CITATION_ANCHOR_STORAGE_KEY]: { 'instrument-1': { garbage: true } } };
    const store = new ObsidianCitationHashStore(host);
    expect(await store.loadAll()).toEqual(new Map());
  });

  it('the atomic path round-trips identically to the fallback path, given a host that supports readModifyWrite', async () => {
    const raw = new FakeDataHost();
    const host = new SerializingDataHost(raw);
    const store = new ObsidianCitationHashStore(host);
    await store.save('instrument-1', RECORD_A);
    await store.remove('instrument-1');
    await store.save('instrument-2', RECORD_B);
    const loaded = await store.loadAll();
    expect(loaded.has('instrument-1')).toBe(false);
    expect(loaded.get('instrument-2')).toEqual(RECORD_B);
  });
});
