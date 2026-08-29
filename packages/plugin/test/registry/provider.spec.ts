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
import type { RegistryInstrumentSummary } from 'olea-core';
import { describe, expect, it } from 'vitest';
import type { ObsidianDataHost } from '../../src/registry/overrides-store.js';
import type { EditInstrumentPort } from '../../src/registry/provider.js';
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
