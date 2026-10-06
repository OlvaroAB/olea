/**
 * [D-473] (ol-egov.141.89.5.52): the tolerant anchor reader. An anchor record whose pending reason
 * this build does not recognise is KEPT with its hold, never dropped, and a later write that does
 * not resolve it does not erase the value. A malformed field other than the reason still drops the
 * record, as before. Synthetic text only.
 */
import { describe, expect, it } from 'vitest';
import {
  CITATION_ANCHOR_STORAGE_KEY,
  ObsidianCitationHashStore,
} from '../../../src/ingestion/materiality/citation-hash-store.js';

class FakeDataHost {
  blob: Record<string, unknown> = {};
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data as Record<string, unknown>;
  }
}

const UNKNOWN = 'some-future-reason';

function seeded(pending: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const host = new FakeDataHost();
  host.blob = {
    [CITATION_ANCHOR_STORAGE_KEY]: {
      i1: {
        sourcePath: 'Zettel/Topic.md',
        text: 'The cited passage.',
        conceptIds: ['concept-a'],
        pendingRevalidation: pending,
        ...extra,
      },
    },
  };
  return { host, store: new ObsidianCitationHashStore(host) };
}

const table = (host: FakeDataHost) =>
  host.blob[CITATION_ANCHOR_STORAGE_KEY] as { i1?: Record<string, unknown> };

describe('tolerant anchor reader (D-473)', () => {
  it('keeps a record whose pending reason is unknown, and reads the hold as current', async () => {
    const { store } = seeded({ sinceContentHash: 'k1', since: 5, reason: UNKNOWN });
    const record = (await store.loadAll()).get('i1');
    expect(record).toBeDefined();
    expect(record?.pendingRevalidation?.reason).toBe(UNKNOWN);
    expect(await store.isPendingRevalidationCurrent('i1', 'k1')).toBe(true);
  });

  it('a same-key re-record leaves the unknown reason in place', async () => {
    const { host, store } = seeded({ sinceContentHash: 'k1', since: 5, reason: UNKNOWN });
    await store.setPendingRevalidation('i1', 'k1', 99);
    expect((await store.loadAll()).get('i1')?.pendingRevalidation?.reason).toBe(UNKNOWN);
    expect(table(host).i1?.pendingRevalidation).toEqual({
      sinceContentHash: 'k1',
      since: 5,
      reason: UNKNOWN,
    });
  });

  it('dispatch bookkeeping keeps the unknown reason and the record', async () => {
    const { host, store } = seeded({ sinceContentHash: 'k1', since: 5, reason: UNKNOWN });
    await store.recordDispatch('i1', 'k1', 50, false);
    expect((await store.loadAll()).get('i1')?.pendingRevalidation?.dispatchedAt).toBe(50);
    expect(table(host).i1?.pendingRevalidation).toMatchObject({ reason: UNKNOWN });
  });

  it('a legitimate resolution still clears the hold', async () => {
    const { host, store } = seeded({ sinceContentHash: 'k1', since: 5, reason: UNKNOWN });
    await store.save('i1', {
      sourcePath: 'Zettel/Topic.md',
      text: 'The cited passage.',
      conceptIds: ['concept-a'],
    });
    expect(table(host).i1?.pendingRevalidation).toBeUndefined();
    expect(await store.isPendingRevalidationCurrent('i1', 'k1')).toBe(false);
  });

  it('a non-string reason is still malformed and the record is dropped (unchanged)', async () => {
    const { store } = seeded({ sinceContentHash: 'k1', since: 5, reason: 7 });
    expect((await store.loadAll()).has('i1')).toBe(false);
  });

  it('another malformed pending field still drops the record (unchanged)', async () => {
    const { store } = seeded({ sinceContentHash: 'k1', since: 'late', reason: UNKNOWN });
    expect((await store.loadAll()).has('i1')).toBe(false);
  });
});
