/**
 * The two additions `[D-446]` makes to the citation anchor store (`ol-egov.141.89.5.32`):
 * `CitationAnchorRecord.passageDigest` (a passage-grain anchor) and
 * `PendingRevalidation.reason` (why an instrument is withheld when it is not "awaiting the judge").
 * Both are optional, so every record written before them still reads (INV-2); a malformed value is
 * dropped like any other corrupt entry.
 */
import { describe, expect, it } from 'vitest';
import {
  CITATION_ANCHOR_STORAGE_KEY,
  type CitationAnchorRecord,
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

const RECORD: CitationAnchorRecord = {
  sourcePath: 'Zettel/Topic.md',
  text: 'The cited passage.',
  passageDigest: `p1:${'a'.repeat(64)}`,
  conceptIds: ['concept-a'],
};

describe('ObsidianCitationHashStore, passage grain', () => {
  it('round-trips a passage digest', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('i1', RECORD);
    expect((await store.loadAll()).get('i1')).toEqual(RECORD);
  });

  it('records the reason with the pending fact, and keeps a same-key re-record a no-op', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('i1', RECORD);
    await store.setPendingRevalidation('i1', 'key-1', 10, 'passage-ambiguous');
    await store.setPendingRevalidation('i1', 'key-1', 99, 'passage-ambiguous');
    const pending = (await store.loadAll()).get('i1')?.pendingRevalidation;
    expect(pending).toEqual({ sinceContentHash: 'key-1', since: 10, reason: 'passage-ambiguous' });
    expect(await store.isPendingRevalidationCurrent('i1', 'key-1')).toBe(true);
  });

  it('a pending fact recorded without a reason carries none (awaiting the judge)', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('i1', RECORD);
    await store.setPendingRevalidation('i1', 'key-2', 10);
    expect((await store.loadAll()).get('i1')?.pendingRevalidation).toEqual({
      sinceContentHash: 'key-2',
      since: 10,
    });
  });

  it('a later fact for a different state supersedes the reason', async () => {
    const store = new ObsidianCitationHashStore(new FakeDataHost());
    await store.save('i1', RECORD);
    await store.setPendingRevalidation('i1', 'key-1', 10, 'passage-missing');
    await store.setPendingRevalidation('i1', 'key-2', 20);
    expect((await store.loadAll()).get('i1')?.pendingRevalidation).toEqual({
      sinceContentHash: 'key-2',
      since: 20,
    });
  });

  it('reads a record written before either field, and drops a malformed one (a non-string reason; an unknown string is kept, D-473)', async () => {
    const host = new FakeDataHost();
    host.blob = {
      [CITATION_ANCHOR_STORAGE_KEY]: {
        old: { sourcePath: 'A.md', text: 't', conceptIds: [] },
        badDigest: { sourcePath: 'A.md', text: 't', conceptIds: [], passageDigest: 7 },
        badReason: {
          sourcePath: 'A.md',
          text: 't',
          conceptIds: [],
          pendingRevalidation: { sinceContentHash: 'h', since: 1, reason: 7 },
        },
      },
    };
    const loaded = await new ObsidianCitationHashStore(host).loadAll();
    expect([...loaded.keys()]).toEqual(['old']);
  });
});
