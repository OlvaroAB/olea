/**
 * `readPendingPassageChanges` (`ol-egov.141.89.9.98`, `[D-522]`): the pending-revalidation
 * store's persisted facts as `olea-core`'s changed, unrevalidated passages. Every string here is
 * invented (INV-3).
 */

import type { VaultPath } from 'olea-core';
import { unresolvedPassageInstrumentIds } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { readPendingPassageChanges } from '../../src/attainment/passage-changes.js';
import {
  type CitationHashStore,
  ObsidianCitationHashStore,
} from '../../src/ingestion/materiality/citation-hash-store.js';

class JsonDataHost {
  json = 'null';
  async loadData(): Promise<unknown> {
    return JSON.parse(this.json);
  }
  async saveData(data: unknown): Promise<void> {
    this.json = JSON.stringify(data);
  }
}

const NOW = new Date('2026-08-10T13:00:00.000Z');

async function tracked(
  store: CitationHashStore,
  instrumentId: string,
  since?: number,
  reason?: 'passage-missing',
): Promise<void> {
  await store.save(instrumentId, {
    sourcePath: 'Notes/one.md' as VaultPath,
    text: 'Front::Back',
    conceptIds: ['concept-key1:widget-theory'],
  });
  if (since !== undefined) await store.setPendingRevalidation(instrumentId, 'sha-b', since, reason);
}

describe('readPendingPassageChanges', () => {
  it('reads every persisted fact, whatever its reason, as a change with no revalidation, sorted by instrument; an entry with no fact gives none', async () => {
    const store = new ObsidianCitationHashStore(new JsonDataHost());
    await tracked(store, 'qa:b:1', Date.parse('2026-08-09T12:00:00.000Z'));
    await tracked(store, 'qa:a:1', Date.parse('2026-08-09T11:00:00.000Z'), 'passage-missing');
    await tracked(store, 'qa:c:1');
    const changes = await readPendingPassageChanges(store, NOW);
    expect(changes).toEqual([
      { instrumentIds: ['qa:a:1'], changedAt: '2026-08-09T11:00:00.000Z', revalidation: [] },
      { instrumentIds: ['qa:b:1'], changedAt: '2026-08-09T12:00:00.000Z', revalidation: [] },
    ]);
    expect([...unresolvedPassageInstrumentIds(changes, NOW)].sort()).toEqual(['qa:a:1', 'qa:b:1']);
  });

  it("a fact recorded later than now (another device's clock) stands at now, so it is never dropped", async () => {
    const store = new ObsidianCitationHashStore(new JsonDataHost());
    await tracked(store, 'qa:a:1', NOW.getTime() + 60_000);
    const changes = await readPendingPassageChanges(store, NOW);
    expect(changes?.[0]?.changedAt).toBe(NOW.toISOString());
    expect([...unresolvedPassageInstrumentIds(changes, NOW)]).toEqual(['qa:a:1']);
  });

  it('an empty store reads as no change; an unreadable one as undefined, never as a fact about her', async () => {
    expect(
      await readPendingPassageChanges(new ObsidianCitationHashStore(new JsonDataHost()), NOW),
    ).toEqual([]);
    const broken = {
      loadAll: async () => {
        throw new Error('unreadable');
      },
    } as unknown as CitationHashStore;
    expect(await readPendingPassageChanges(broken, NOW)).toBeUndefined();
  });
});
