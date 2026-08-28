import { suspendedInstrumentIds } from 'olea-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultPruneInstrumentPort } from '../../src/registry/ports.js';
import { memoryVault } from '../review/memory-vault.js';

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
      pruned: false,
    });

    const [logPath] = vault.writes;
    if (logPath === undefined) throw new Error('expected a write');
    const record = JSON.parse((await vault.read(logPath)).trim());
    expect(record.conceptIds).toEqual(['concept-a', 'concept-b']);
  });
});
