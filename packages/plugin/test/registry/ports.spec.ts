import type { RegistryConceptEntry } from 'olea-core';
import { listConceptKeyRecords, resolveConceptKey, suspendedInstrumentIds } from 'olea-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createObsidianAcceptNoteOfferPort,
  createVaultPruneInstrumentPort,
} from '../../src/registry/ports.js';
import { memoryVault } from '../review/memory-vault.js';

/**
 * A minimal `RegistryConceptEntry` fixture. `createObsidianAcceptNoteOfferPort.accept` reads
 * only `key` and `displayName` — see `../../src/registry/ports.ts`'s own doc — so every other
 * field is a placeholder value never touched by the port under test, hence the cast rather than
 * hand-filling `mastery`/`vitality`/`explainBack`'s full shapes.
 */
function conceptEntry(overrides: Partial<Pick<RegistryConceptEntry, 'key' | 'displayName'>>) {
  return {
    key: 'concept-prov1:placeholder',
    displayName: 'Placeholder concept',
    originalName: 'Placeholder concept',
    aliases: [],
    courses: [],
    tier: 2,
    pruned: false,
    instruments: [],
    sourceLocations: [],
    noteOffer: { eligible: true },
    ...overrides,
  } as unknown as RegistryConceptEntry;
}

const INSTRUMENT_ID = 'qa:concept-a:1';
const DEVICE = 'olea-testdevice1';

describe('createVaultPruneInstrumentPort', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('prune writes a suspend event the existing projection reads back as withdrawn', async () => {
    const vault = memoryVault();
    const port = createVaultPruneInstrumentPort(vault, DEVICE);

    await port.prune({
      instrumentId: INSTRUMENT_ID,
      instrumentType: 'qa',
      conceptIds: ['concept-a'],
      notePath: 'Notes/one.md',
      noteTitle: 'one',
      blockId: null,
      heading: null,
      sourceLocations: [],
      explainBackHistory: [],
      pruned: false,
    });

    const [logPath] = vault.writes;
    if (logPath === undefined) throw new Error('expected a write');
    const parsed = (await vault.read(logPath))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ kind: 'suspend', instrumentId: INSTRUMENT_ID });

    expect(suspendedInstrumentIds(parsed).has(INSTRUMENT_ID)).toBe(true);
  });

  it('restore is a second, symmetric append — never a rewrite of the first event', async () => {
    // Distinct timestamps, deliberately: `suspendedInstrumentIds` breaks a
    // same-instant tie by `eventId` (a random uuid), so two real button
    // presses close enough in wall-clock time to land on the same
    // millisecond would otherwise make this assertion depend on uuid
    // ordering rather than on which happened second. Fake timers make the
    // ordinary case (seconds apart, in practice) the case this test runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T09:00:00.000-04:00'));

    const vault = memoryVault();
    const port = createVaultPruneInstrumentPort(vault, DEVICE);
    const instrument = {
      instrumentId: INSTRUMENT_ID,
      instrumentType: 'qa' as const,
      conceptIds: ['concept-a'],
      notePath: 'Notes/one.md',
      noteTitle: 'one',
      blockId: null,
      heading: null,
      sourceLocations: [],
      explainBackHistory: [],
      pruned: false,
    };

    await port.prune(instrument);
    vi.setSystemTime(new Date('2026-01-10T09:00:01.000-04:00'));
    await port.restore(instrument);

    const [logPath] = vault.writes;
    if (logPath === undefined) throw new Error('expected a write');
    const lines = (await vault.read(logPath)).trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed.map((r) => r.kind)).toEqual(['suspend', 'unsuspend']);

    expect(suspendedInstrumentIds(parsed).has(INSTRUMENT_ID)).toBe(false);
  });

  it('carries every conceptId the instrument names — the frozen schema requires the whole set, never a narrowing', async () => {
    const vault = memoryVault();
    const port = createVaultPruneInstrumentPort(vault, DEVICE);

    await port.prune({
      instrumentId: INSTRUMENT_ID,
      instrumentType: 'qa',
      conceptIds: ['concept-a', 'concept-b'],
      notePath: 'Notes/one.md',
      noteTitle: 'one',
      blockId: null,
      heading: null,
      sourceLocations: [],
      explainBackHistory: [],
      pruned: false,
    });

    const [logPath] = vault.writes;
    if (logPath === undefined) throw new Error('expected a write');
    const record = JSON.parse((await vault.read(logPath)).trim());
    expect(record.conceptIds).toEqual(['concept-a', 'concept-b']);
  });
});

// Scenarios: olea-service/features/F8-concepts-scope.md — "Accepting a note offer rebinds the
// existing concept key onto the new note ([D-088], [D-176], [D-183], ol-2zfj.55)", tagged
// `@auto:plugin/registry/ports.spec`.
describe('createObsidianAcceptNoteOfferPort — creates the note AND rebinds the existing key ([D-176], ol-2zfj.55)', () => {
  it('creates a note at the vault root named for her display name', async () => {
    const vault = memoryVault();
    const key = await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });
    const port = createObsidianAcceptNoteOfferPort(vault);

    await port.accept(conceptEntry({ key, displayName: 'Basalt weathering' }));

    expect(vault.contentOf('Basalt weathering.md')).toBe('# Basalt weathering\n');
  });

  it('rebinds the existing key onto the new note instead of minting a second one', async () => {
    const vault = memoryVault();
    const key = await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Isostasy',
      aliases: [],
    });
    const port = createObsidianAcceptNoteOfferPort(vault);

    await port.accept(conceptEntry({ key, displayName: 'Isostasy' }));

    const records = await listConceptKeyRecords(vault);
    expect(records).toHaveLength(1);
    expect(records[0]?.record.key).toBe(key);
    expect(records[0]?.record.anchor).toEqual({
      kind: 'note',
      noteUid: null,
      notePath: 'Isostasy.md',
    });
  });

  it('keeps the old topic wording as an alias, per [D-183]', async () => {
    const vault = memoryVault();
    const key = await resolveConceptKey(vault, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Cross-bedding',
      aliases: [],
    });
    const port = createObsidianAcceptNoteOfferPort(vault);

    await port.accept(conceptEntry({ key, displayName: 'Cross-bedding' }));

    const records = await listConceptKeyRecords(vault);
    expect(records[0]?.record.aliases).toEqual(['Cross-bedding']);
  });
});
