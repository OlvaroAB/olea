/**
 * `[D-378]`'s canonical lookup in the registry provider (`ol-egov.141.89.9.56`, round 2): the
 * load reads renames and withdrawals by concept identity, and rename, withdraw, restore and an
 * accepted rename proposal act on every stored key of the identity. A concept that shares only an
 * introducing passage with it keeps its own overrides throughout.
 *
 * The fixture vault's one note introduces two concepts. Concept A is held by two same-anchor key
 * records (the earlier one canonical); Concept B shares A's introducing note but not its anchor.
 * Every fixture string is invented (INV-3).
 */
import {
  type ConceptKeyRecord,
  conceptKeyRecordPath,
  type RegistryConceptEntry,
  type RegistryOverrides,
  type TopicAnchor,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type ObsidianDataHost,
  REGISTRY_OVERRIDES_STORAGE_KEY,
} from '../../src/registry/overrides-store.js';
import {
  createLocalRegistryProvider,
  type EditInstrumentPort,
} from '../../src/registry/provider.js';
import type { RegistryViewState } from '../../src/registry/view.js';
import { memoryVault } from '../review/memory-vault.js';

const CANONICAL = 'concept-key1:aaaa';
const DUPLICATE = 'concept-key1:bbbb';
const PASSAGE_B = 'concept-key1:ffff';
const NOW = new Date('2026-02-01T12:00:00Z');

function topic(name: string, introducingPaths?: readonly string[]): TopicAnchor {
  return {
    kind: 'topic',
    course: 'TESTC101',
    name,
    aliases: [],
    ...(introducingPaths !== undefined ? { introducingPaths } : {}),
  };
}

function conceptRecord(key: string, anchor: TopicAnchor, mintedAt: string): ConceptKeyRecord {
  return { key, tier: 2, anchor, aliases: [], mintedAt, schemaVersion: 1 };
}

function fixtureVault() {
  const files: Record<string, string> = {
    'Notes/one.md': [
      '---',
      'topic: [Concept A, Concept B]',
      'course: TESTC101',
      '---',
      '',
      'Front text::Back text',
      '',
    ].join('\n'),
  };
  for (const record of [
    conceptRecord(CANONICAL, topic('Concept A'), '2026-01-01'),
    conceptRecord(DUPLICATE, topic('Concept A'), '2026-01-05'),
    conceptRecord(PASSAGE_B, topic('Concept B', ['Notes/one.md']), '2026-01-02'),
  ]) {
    files[conceptKeyRecordPath(record.key)] = `${JSON.stringify(record, null, 2)}\n`;
  }
  return memoryVault(files);
}

const STORED: RegistryOverrides = {
  version: 1,
  renames: {
    [DUPLICATE]: { displayName: 'Her name for A', aliases: ['Concept A'] },
    [PASSAGE_B]: { displayName: 'Her name for B', aliases: ['Concept B'] },
  },
  prunedConceptKeys: [DUPLICATE, PASSAGE_B].sort(),
};

class FakeDataHost implements ObsidianDataHost {
  blob: unknown = { [REGISTRY_OVERRIDES_STORAGE_KEY]: STORED };
  async loadData(): Promise<unknown> {
    return this.blob;
  }
  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
  stored(): RegistryOverrides {
    return (this.blob as Record<string, RegistryOverrides>)[
      REGISTRY_OVERRIDES_STORAGE_KEY
    ] as RegistryOverrides;
  }
}

const editPort: EditInstrumentPort = { edit: async () => undefined };

function setup() {
  const host = new FakeDataHost();
  const notified: RegistryOverrides[] = [];
  const provider = createLocalRegistryProvider({
    vault: fixtureVault(),
    deviceId: 'olea-testdevice1',
    settingsHost: host,
    now: () => NOW,
    editPort,
    onOverridesChanged: (overrides) => notified.push(overrides),
  });
  return { host, notified, provider };
}

function rowFor(state: RegistryViewState, key: string): RegistryConceptEntry {
  if (state.kind !== 'model') throw new Error(`expected a model, got ${state.kind}`);
  const row = state.model.concepts.find((entry) => entry.key === key);
  if (row === undefined) throw new Error(`no row for ${key}`);
  return row;
}

describe('createLocalRegistryProvider reads and writes overrides by concept identity ([D-378], ol-egov.141.89.9.56)', () => {
  it('a rename and a withdrawal stored under a superseded key read on the canonical row; the shared-passage partner reads its own', async () => {
    const { provider } = setup();
    const state = await provider.load();

    expect(rowFor(state, CANONICAL).displayName).toBe('Her name for A');
    expect(rowFor(state, CANONICAL).pruned).toBe(true);
    expect(rowFor(state, PASSAGE_B).displayName).toBe('Her name for B');
    expect(rowFor(state, PASSAGE_B).pruned).toBe(true);
  });

  it('restore removes the withdrawal stored under the duplicate, leaves the partner withdrawn, and hands the cache the read view', async () => {
    const { host, notified, provider } = setup();
    await provider.restoreConcept(rowFor(await provider.load(), CANONICAL));

    expect(host.stored().prunedConceptKeys).toEqual([PASSAGE_B]);
    const after = await provider.load();
    expect(rowFor(after, CANONICAL).pruned).toBe(false);
    expect(rowFor(after, PASSAGE_B).pruned).toBe(true);
    expect(notified.at(-1)?.renames[CANONICAL]?.displayName).toBe('Her name for A');
    expect(notified.at(-1)?.prunedConceptKeys).toEqual([PASSAGE_B]);
  });

  it('withdrawing an identity already withdrawn under its duplicate adds no second key', async () => {
    const { host, provider } = setup();
    await provider.withdrawConcept(rowFor(await provider.load(), CANONICAL));

    expect(host.stored().prunedConceptKeys).toEqual([DUPLICATE, PASSAGE_B].sort());
  });

  it('renaming back to the original wording clears the duplicate’s rename; the partner keeps its rename', async () => {
    const { host, provider } = setup();
    await provider.rename(rowFor(await provider.load(), CANONICAL), 'Concept A');

    expect(Object.keys(host.stored().renames)).toEqual([PASSAGE_B]);
    expect(rowFor(await provider.load(), CANONICAL).displayName).toBe('Concept A');
  });

  it('a new rename is stored once, under the canonical key, with the prior wordings as aliases', async () => {
    const { host, provider } = setup();
    await provider.rename(rowFor(await provider.load(), CANONICAL), 'Newer name for A');

    expect(host.stored().renames).toEqual({
      [CANONICAL]: { displayName: 'Newer name for A', aliases: ['Her name for A', 'Concept A'] },
      [PASSAGE_B]: STORED.renames[PASSAGE_B],
    });
  });

  it('accepting a rename proposal stores it once, under the canonical key, with its tier', async () => {
    const { host, provider } = setup();
    const row = rowFor(await provider.load(), CANONICAL);
    await provider.acceptRenameProposal(row, {
      key: CANONICAL,
      currentDisplayName: 'Her name for A',
      currentTier: 2,
      candidate: { tier: 1, wording: 'Better name for A' },
    });

    expect(host.stored().renames[CANONICAL]).toEqual({
      displayName: 'Better name for A',
      aliases: ['Her name for A', 'Concept A'],
      sourceTier: 1,
    });
    expect(host.stored().renames[DUPLICATE]).toBeUndefined();
  });
});
