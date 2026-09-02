/**
 * `createLocalRegistryProvider` wiring tests (`ol-4v2l`, F8.4/F8.5).
 *
 * Every fixture string below is INVENTED — course codes, concept names,
 * question text — per INV-3; nothing here is drawn from a real vault. This
 * suite is not re-testing `buildRegistryModel`'s own acceptance criteria
 * (that is `packages/core/src/registry/build.spec.ts`'s job) — it tests the
 * WIRING this bead adds: the vault walk plus whole-log read, the overrides
 * round trip through `data.json`, and the prune/restore round trip through
 * the review log.
 */
import {
  appendDisputeRecord,
  appendReviewLogRecord,
  type ConceptRecord,
  contestClaim,
  type RegistryInstrumentSummary,
  type RegistrySourceLocation,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/registry/overrides-store.js';
import type { EditInstrumentPort, OpenSourceLocationPort } from '../../src/registry/provider.js';
import { createLocalRegistryProvider } from '../../src/registry/provider.js';
import type { RegistryViewState } from '../../src/registry/view.js';
import { memoryVault, unreadableVault } from '../review/memory-vault.js';

const DEVICE = 'olea-testdevice1';
const NOW = new Date('2026-02-01T12:00:00Z');

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}

class FakeEditPort implements EditInstrumentPort {
  opened: RegistryInstrumentSummary[] = [];

  async edit(instrument: RegistryInstrumentSummary): Promise<void> {
    this.opened.push(instrument);
  }
}

function fixtureVault() {
  return memoryVault({
    'Notes/one.md': [
      '---',
      'topic: [Concept A]',
      'course: TESTC101',
      '---',
      '',
      'Front text::Back text',
      '',
    ].join('\n'),
  });
}

async function modelFrom(state: RegistryViewState) {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  return state.model;
}

function makeProvider(
  vault: ReturnType<typeof fixtureVault>,
  settingsHost: FakeDataHost,
  editPort: FakeEditPort,
) {
  return createLocalRegistryProvider({
    vault,
    deviceId: DEVICE,
    settingsHost,
    now: () => NOW,
    editPort,
  });
}

describe('createLocalRegistryProvider — load', () => {
  it('composes a browsable model from the vault walk', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const model = await modelFrom(await provider.load());
    expect(model.concepts).toHaveLength(1);
    const row = model.concepts[0];
    expect(row?.displayName).toBe('Concept A');
    expect(row?.courses).toEqual(['TESTC101']);
    expect(row?.instruments).toHaveLength(1);
    expect(row?.pruned).toBe(false);
  });

  it('returns unavailable, never throws, when the vault cannot be read', async () => {
    const provider = makeProvider(
      unreadableVault() as ReturnType<typeof fixtureVault>,
      new FakeDataHost(),
      new FakeEditPort(),
    );
    const state = await provider.load();
    expect(state.kind).toBe('unavailable');
  });
});

describe('createLocalRegistryProvider — rename (F8.4)', () => {
  it('persists across a reload, and the old name becomes an alias', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    await provider.rename(entry, 'Renamed concept');

    const after = await modelFrom(await provider.load());
    const row = after.concepts[0];
    expect(row?.key).toBe(entry.key);
    expect(row?.displayName).toBe('Renamed concept');
    expect(row?.aliases).toEqual(['Concept A']);
  });
});

describe('createLocalRegistryProvider — withdraw/restore concept (F8.5)', () => {
  it('withdraws and restores, never deleting the row', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    await provider.withdrawConcept(entry);
    const withdrawn = await modelFrom(await provider.load());
    expect(withdrawn.concepts).toHaveLength(1);
    expect(withdrawn.concepts[0]?.pruned).toBe(true);
    expect(withdrawn.concepts[0]?.instruments).toHaveLength(1);

    await provider.restoreConcept(entry);
    const restored = await modelFrom(await provider.load());
    expect(restored.concepts[0]?.pruned).toBe(false);
  });
});

describe('createLocalRegistryProvider — withdraw/restore instrument (F8.5)', () => {
  it('withdraws and restores an instrument through the review log, never deleting it from the mix', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const instrument = before.concepts[0]?.instruments[0];
    if (instrument === undefined) throw new Error('missing instrument');

    await provider.withdrawInstrument(instrument);
    const withdrawn = await modelFrom(await provider.load());
    const withdrawnInstrument = withdrawn.concepts[0]?.instruments[0];
    expect(withdrawnInstrument?.pruned).toBe(true);
    expect(withdrawnInstrument?.instrumentId).toBe(instrument.instrumentId);

    await provider.restoreInstrument(instrument);
    const restored = await modelFrom(await provider.load());
    expect(restored.concepts[0]?.instruments[0]?.pruned).toBe(false);
  });
});

describe('createLocalRegistryProvider — onOverridesChanged (ol-r5j4)', () => {
  it('fires with the freshly-saved overrides on rename, withdraw and restore, and never on load', async () => {
    const host = new FakeDataHost();
    const seen: unknown[] = [];
    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: host,
      now: () => NOW,
      editPort: new FakeEditPort(),
      onOverridesChanged: (overrides) => {
        seen.push(overrides);
      },
    });

    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');
    expect(seen).toHaveLength(0); // load() never fires it — only a write does

    await provider.rename(entry, 'Renamed concept');
    expect(seen).toHaveLength(1);

    await provider.withdrawConcept(entry);
    expect(seen).toHaveLength(2);

    await provider.restoreConcept(entry);
    expect(seen).toHaveLength(3);

    // Each call reflects that specific write, not a stale earlier snapshot.
    expect(seen[0]).toMatchObject({ renames: { [entry.key]: { displayName: 'Renamed concept' } } });
    expect(seen[1]).toMatchObject({ prunedConceptKeys: [entry.key] });
    expect(seen[2]).toMatchObject({ prunedConceptKeys: [] });
  });

  it('is optional — omitting it changes nothing about rename/withdraw/restore', async () => {
    const host = new FakeDataHost();
    const provider = makeProvider(fixtureVault(), host, new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');

    await expect(provider.rename(entry, 'Renamed concept')).resolves.toBeUndefined();
  });
});

describe('createLocalRegistryProvider — edit (F8.4: delegated to Obsidian)', () => {
  it('hands the instrument to the injected edit port, and does nothing else', async () => {
    const editPort = new FakeEditPort();
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), editPort);
    const model = await modelFrom(await provider.load());
    const instrument = model.concepts[0]?.instruments[0];
    if (instrument === undefined) throw new Error('missing instrument');

    await provider.editInstrument(instrument);
    expect(editPort.opened).toEqual([instrument]);
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 / [D-171] —
// The registry carries source provenance", tagged `@auto:plugin/registry/provider.spec`.
describe('createLocalRegistryProvider — openSourceLocation ([D-171])', () => {
  it('calls the injected openSourceLocationPort with the given location', async () => {
    const opened: RegistrySourceLocation[] = [];
    const openSourceLocationPort: OpenSourceLocationPort = {
      open: async (location) => {
        opened.push(location);
      },
    };
    const provider = createLocalRegistryProvider({
      vault: fixtureVault(),
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      openSourceLocationPort,
    });

    const location: RegistrySourceLocation = { sourcePath: 'Notes/one.md' };
    await provider.openSourceLocation(location);
    expect(opened).toEqual([location]);
  });

  it('falls back to a logging no-op, never a throw, when no port is wired yet (main.ts follow-up pending)', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const location: RegistrySourceLocation = { sourcePath: 'Notes/one.md' };
    await expect(provider.openSourceLocation(location)).resolves.toBeUndefined();
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4 — the
// registry's Sources list shows passage grain once a read has completed",
// tagged `@auto:plugin/registry/provider.spec`.
describe('createLocalRegistryProvider — conceptRecords thunk (ol-2zfj.49 closing step)', () => {
  it('overlays anchor/alsoIn from the folded ConceptRecord onto the matching concept, by key', async () => {
    const vault = fixtureVault();
    const plainProvider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const plain = await modelFrom(await plainProvider.load());
    const entry = plain.concepts[0];
    if (entry === undefined) throw new Error('missing entry');
    // Before any fold: note-grain-only, exactly what F8.4 shipped with.
    expect(entry.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);

    const folded: readonly ConceptRecord[] = [
      {
        key: entry.key,
        name: entry.originalName,
        tier: 2,
        courses: entry.courses,
        sourcePaths: ['Notes/one.md'],
        anchor: {
          sourcePath: 'Notes/one.md',
          location: {
            page: 3,
            charRange: { start: 0, end: 10 },
            section: 'Invented section title',
          },
        },
      },
    ];

    const withFold = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      conceptRecords: () => folded,
    });
    const model = await modelFrom(await withFold.load());
    const row = model.concepts[0];
    expect(row?.key).toBe(entry.key);
    expect(row?.sourceLocations).toEqual([
      { sourcePath: 'Notes/one.md', page: 3, section: 'Invented section title' },
    ]);
  });

  it('is read fresh on every load() — a later thunk value reaches the next load, not just the first', async () => {
    const vault = fixtureVault();
    let folded: readonly ConceptRecord[] | null = null;
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      conceptRecords: () => folded,
    });

    const before = await modelFrom(await provider.load());
    const entry = before.concepts[0];
    if (entry === undefined) throw new Error('missing entry');
    expect(entry.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);

    folded = [
      {
        key: entry.key,
        name: entry.originalName,
        tier: 2,
        courses: entry.courses,
        sourcePaths: ['Notes/one.md'],
        anchor: {
          sourcePath: 'Notes/one.md',
          location: { page: 7, charRange: { start: 0, end: 10 } },
        },
      },
    ];

    const after = await modelFrom(await provider.load());
    expect(after.concepts[0]?.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md', page: 7 }]);
  });

  it('falls back to the plain vault walk, unchanged, when the thunk returns null (no read has completed yet)', async () => {
    const vault = fixtureVault();
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      conceptRecords: () => null,
    });
    const model = await modelFrom(await provider.load());
    expect(model.concepts[0]?.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);
  });

  it('is optional — omitting it entirely changes nothing about load()', async () => {
    const provider = makeProvider(fixtureVault(), new FakeDataHost(), new FakeEditPort());
    const model = await modelFrom(await provider.load());
    expect(model.concepts[0]?.sourceLocations).toEqual([{ sourcePath: 'Notes/one.md' }]);
  });

  it('never drops a concept the walk just found but the (stale) fold does not know about yet', async () => {
    const vault = memoryVault({
      'Notes/one.md': [
        '---',
        'topic: [Concept A]',
        'course: TESTC101',
        '---',
        '',
        'Front text::Back text',
        '',
      ].join('\n'),
      'Notes/two.md': [
        '---',
        'topic: [Concept B]',
        'course: TESTC101',
        '---',
        '',
        'Front two::Back two',
        '',
      ].join('\n'),
    });
    const provider = createLocalRegistryProvider({
      vault,
      deviceId: DEVICE,
      settingsHost: new FakeDataHost(),
      now: () => NOW,
      editPort: new FakeEditPort(),
      // Stale fold: only knows about a key that matches nothing in this walk.
      conceptRecords: () => [
        {
          key: 'stale-key-not-in-this-walk',
          name: 'Some other concept',
          tier: 2,
          courses: [],
          sourcePaths: [],
        },
      ],
    });
    const model = await modelFrom(await provider.load());
    expect(model.concepts.map((c) => c.displayName).sort()).toEqual(['Concept A', 'Concept B']);
  });
});

// Scenario: olea-service/features/F8-concepts-scope.md — "F8.4b — The
// explain-back history surface", tagged `@auto:plugin/registry/provider.spec`.
describe('createLocalRegistryProvider — explain-back history wiring (F8.4b, [D-175])', () => {
  it('surfaces a graded explain-back attempt on the originating instrument, and marks it contested once a [D-095] dispute quarantines it', async () => {
    const vault = fixtureVault();
    const provider = makeProvider(vault, new FakeDataHost(), new FakeEditPort());
    const before = await modelFrom(await provider.load());
    const instrument = before.concepts[0]?.instruments[0];
    if (instrument === undefined) throw new Error('missing instrument');
    expect(instrument.explainBackHistory).toEqual([]);

    const { record } = await appendReviewLogRecord(
      vault,
      {
        timestamp: '2026-01-20T09:00:00-04:00',
        instrumentId: instrument.instrumentId,
        instrumentType: 'explain-back',
        conceptIds: [...instrument.conceptIds],
        rating: null,
        wasUnsure: false,
        durationMs: 4000,
        selectionContext: {
          dueState: 'due',
          examProximity: null,
          yieldRank: null,
          instrumentTypesOffered: ['explain-back'],
          planVersion: null,
        },
        explainBackGrade: {
          soloLevel: 'relational',
          contentRef: 'content-ref-1',
          revisionOf: null,
          artifactProvenance: { taskId: 'task-1', promptVersion: 'v1', modelId: 'model-1' },
        },
      },
      { deviceId: DEVICE, generateEventId: () => 'event-1' },
    );

    const afterGrade = await modelFrom(await provider.load());
    const historied = afterGrade.concepts[0]?.instruments[0];
    expect(historied?.explainBackHistory).toEqual([
      {
        eventId: 'event-1',
        timestamp: record.timestamp,
        soloLevel: 'relational',
        contested: false,
      },
    ]);

    // This provider is `session/history.ts`'s dispute-blind reader plus a
    // second dispute-only read over the same files — see `disputesFromFiles`'s
    // own doc. Proving that path here, not just at `buildRegistryModel`'s own
    // unit level, is exactly the wiring this suite's own module doc says is
    // its job (build.spec.ts already proves the fold itself).
    const dispute = contestClaim({
      claim: {
        rendering: 'explain-back-grade',
        conceptIds: instrument.conceptIds,
        instrumentId: instrument.instrumentId,
        evidenceBasis: 'evidence-fingerprint-1',
      },
      timestamp: '2026-01-21T09:00:00-04:00',
    });
    await appendDisputeRecord(vault, dispute.record, {
      deviceId: DEVICE,
      generateEventId: () => 'dispute-1',
    });

    const afterDispute = await modelFrom(await provider.load());
    const contested = afterDispute.concepts[0]?.instruments[0];
    expect(contested?.explainBackHistory).toEqual([
      {
        eventId: 'event-1',
        timestamp: record.timestamp,
        soloLevel: 'relational',
        contested: true,
      },
    ]);
  });
});
