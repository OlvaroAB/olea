/**
 * `readPendingPassageChanges` and `passageChangesForReadings` (`ol-egov.141.89.9.98`, `[D-522]`,
 * `[D-536]`): the pending-revalidation store's persisted facts as `olea-core`'s changed,
 * unrevalidated passages, and a store that cannot be read as uncertainty over every instrument that
 * could carry a fact (the 2026-10-06 sheet's correction to the reversible choices), never as no
 * change. Every string here is invented (INV-3).
 */

import type { ReviewLogEntry } from 'olea-contracts';
import type { VaultInstrumentRecord, VaultPath } from 'olea-core';
import { unresolvedPassageInstrumentIds } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import {
  type PendingPassageRead,
  passageChangesForReadings,
  readPendingPassageChanges,
} from '../../src/attainment/passage-changes.js';
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
    const read = await readPendingPassageChanges(store, NOW);
    if (read.kind !== 'read') throw new Error('expected a read store');
    const changes = read.changes;
    expect(changes).toEqual([
      { instrumentIds: ['qa:a:1'], changedAt: '2026-08-09T11:00:00.000Z', revalidation: [] },
      { instrumentIds: ['qa:b:1'], changedAt: '2026-08-09T12:00:00.000Z', revalidation: [] },
    ]);
    expect([...unresolvedPassageInstrumentIds(changes, NOW)].sort()).toEqual(['qa:a:1', 'qa:b:1']);
    // A read store's facts pass through unchanged, whatever the vault holds.
    expect(passageChangesForReadings(read, [], [], NOW)).toBe(changes);
  });

  it("a fact recorded later than now (another device's clock) stands at now, so it is never dropped", async () => {
    const store = new ObsidianCitationHashStore(new JsonDataHost());
    await tracked(store, 'qa:a:1', NOW.getTime() + 60_000);
    const read = await readPendingPassageChanges(store, NOW);
    if (read.kind !== 'read') throw new Error('expected a read store');
    const changes = read.changes;
    expect(changes[0]?.changedAt).toBe(NOW.toISOString());
    expect([...unresolvedPassageInstrumentIds(changes, NOW)]).toEqual(['qa:a:1']);
  });

  it('an empty store reads as no change; an unreadable one is reported as unreadable, logged without content', async () => {
    expect(
      await readPendingPassageChanges(new ObsidianCitationHashStore(new JsonDataHost()), NOW),
    ).toEqual({ kind: 'read', changes: [] });
    const broken = {
      loadAll: async () => {
        throw new Error('unreadable: Notes/one.md');
      },
    } as unknown as CitationHashStore;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await readPendingPassageChanges(broken, NOW)).toEqual({ kind: 'unreadable' });
      // The error's name only: never its message, which could name a note.
      expect(logged).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain('Notes/one.md');
    } finally {
      logged.mockRestore();
    }
  });
});

describe('passageChangesForReadings', () => {
  /** A vault record as the readers see it; only the fields this resolver reads are real. */
  function record(instrumentId: string, cited: boolean): VaultInstrumentRecord {
    return {
      instrumentId,
      ...(cited ? { sourceProvenance: { sourcePath: 'Notes/source.md' } } : {}),
    } as unknown as VaultInstrumentRecord;
  }
  function reviewOf(instrumentId: string): ReviewLogEntry {
    return { kind: 'review', instrumentId } as unknown as ReviewLogEntry;
  }
  const UNREADABLE: PendingPassageRead = { kind: 'unreadable' };

  it("no store wired reads as no passage input (a caller with no store: today's reading)", () => {
    expect(passageChangesForReadings(undefined, [record('qa:a:1', true)], [], NOW)).toBeUndefined();
  });

  it('an unreadable store leaves out every instrument that could carry a fact, standing at now, never none', () => {
    const changes = passageChangesForReadings(
      UNREADABLE,
      [record('qa:cited:1', true), record('qa:hers:1', false), record('mcq:cited:1', true)],
      // A reviewed instrument no longer in her vault may still carry a fact; her own card's
      // review never can.
      [reviewOf('qa:gone:1'), reviewOf('qa:hers:1'), reviewOf('qa:cited:1')],
      NOW,
    );
    expect(changes).toEqual([
      {
        instrumentIds: ['mcq:cited:1', 'qa:cited:1', 'qa:gone:1'],
        changedAt: NOW.toISOString(),
        revalidation: [],
      },
    ]);
    expect([...unresolvedPassageInstrumentIds(changes, NOW)].sort()).toEqual([
      'mcq:cited:1',
      'qa:cited:1',
      'qa:gone:1',
    ]);
  });

  it('an unreadable store over a vault of only her own cards leaves nothing out', () => {
    expect(
      passageChangesForReadings(
        UNREADABLE,
        [record('qa:hers:1', false)],
        [reviewOf('qa:hers:1')],
        NOW,
      ),
    ).toEqual([]);
  });
});
