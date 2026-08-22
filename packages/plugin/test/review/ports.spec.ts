/**
 * `createVaultNoteExistsPort` (`ol-t5lj`, F2.6) and `createVaultSuspendPort`
 * (`ol-xvmx`, F2.6's durable half, D-020).
 *
 * The point of the change both cover is that the port needs a `VaultSource`
 * and nothing else — so the test that proves it is one that drives it against
 * a plain fake with no Obsidian anywhere. If either port ever reaches for an
 * `App` again, this file stops compiling.
 */

import type { VaultSource } from 'olea-core';
import { calendarDayFromLocalDate, parseReviewLog, reviewLogPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createVaultNoteExistsPort, createVaultSuspendPort } from '../../src/review/ports.js';
import { memoryVault } from './memory-vault.js';

/** Only `exists` is reachable from this port; the rest throw so a widened implementation is caught rather than silently tolerated. */
function fakeVault(present: readonly string[]): { vault: VaultSource; asked: string[] } {
  const asked: string[] = [];
  const unreachable = (name: string) => () => {
    throw new Error(`createVaultNoteExistsPort must not call VaultSource.${name}`);
  };
  const vault = {
    exists: async (path: string) => {
      asked.push(path);
      return present.includes(path);
    },
    list: unreachable('list'),
    read: unreachable('read'),
    readBinary: unreachable('readBinary'),
    write: unreachable('write'),
    watch: unreachable('watch'),
  } as unknown as VaultSource;
  return { vault, asked };
}

describe('createVaultNoteExistsPort', () => {
  it('reports true for a path the vault has', async () => {
    const { vault } = fakeVault(['01 Courses/GEOL204/Synapses.md']);
    const port = createVaultNoteExistsPort(vault);
    await expect(port.exists('01 Courses/GEOL204/Synapses.md')).resolves.toBe(true);
  });

  it("reports false for a note that has been deleted since it was scheduled (F2.6's note-missing screen)", async () => {
    const { vault } = fakeVault(['01 Courses/GEOL204/Synapses.md']);
    const port = createVaultNoteExistsPort(vault);
    await expect(port.exists('01 Courses/GEOL204/Deleted.md')).resolves.toBe(false);
  });

  it('asks the vault for exactly the path it was given, unmodified', async () => {
    const { vault, asked } = fakeVault([]);
    const port = createVaultNoteExistsPort(vault);
    await port.exists('01 Courses/MUSTH104/Chorale No. 12/Listening notes.md');
    expect(asked).toEqual(['01 Courses/MUSTH104/Chorale No. 12/Listening notes.md']);
  });

  it('uses only VaultSource.exists — never another vault method', async () => {
    const { vault } = fakeVault(['a.md']);
    const port = createVaultNoteExistsPort(vault);
    await expect(port.exists('a.md')).resolves.toBe(true);
    await expect(port.exists('b.md')).resolves.toBe(false);
  });
});

describe('createVaultSuspendPort', () => {
  const DEVICE = 'ports-spec-device';

  /** Where `appendSuspendRecord` lands a same-day event, exactly as `open-session.spec.ts`'s helper does. */
  function todaysLogPath(): string {
    return reviewLogPath(calendarDayFromLocalDate(new Date()), DEVICE);
  }

  it('writes a durable suspend record carrying the instrument id and its concept ids (ol-xvmx)', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);

    await port.suspend('inst-1', ['concept-a', 'concept-b']);

    const logPath = todaysLogPath();
    const written = vault.contentOf(logPath);
    expect(
      written,
      `expected a log at ${logPath}, wrote: ${vault.writes.join(', ')}`,
    ).toBeDefined();

    const parsed = parseReviewLog(written ?? '');
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    const record = parsed.records[0];
    expect(record?.kind).toBe('suspend');
    if (record?.kind !== 'suspend') return;
    expect(record.instrumentId).toBe('inst-1');
    expect(record.conceptIds).toEqual(['concept-a', 'concept-b']);
  });

  it('copies conceptIds rather than holding the caller’s array (matches createVaultReviewLogPort)', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);
    const conceptIds: string[] = ['concept-a'];

    await port.suspend('inst-1', conceptIds);
    // Mutating the caller's array after the write must not retroactively change
    // what was already persisted — proof that the port copied, not aliased.
    conceptIds.push('concept-b');

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    const record = parsed.records[0];
    expect(record?.kind).toBe('suspend');
    if (record?.kind !== 'suspend') return;
    expect(record.conceptIds).toEqual(['concept-a']);
  });

  it('rejects an empty concept list rather than writing an un-backfillable record', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);

    await expect(port.suspend('inst-1', [])).rejects.toThrow();
    expect(vault.writes).toEqual([]);
  });

  it('a second suspend for the same instrument appends rather than replacing the first', async () => {
    const vault = memoryVault();
    const port = createVaultSuspendPort(vault, DEVICE);

    await port.suspend('inst-1', ['concept-a']);
    await port.suspend('inst-2', ['concept-b']);

    const parsed = parseReviewLog(vault.contentOf(todaysLogPath()) ?? '');
    expect(parsed.invalidLines).toEqual([]);
    expect(parsed.records.map((r) => r.instrumentId)).toEqual(['inst-1', 'inst-2']);
    expect(new Set(parsed.records.map((r) => r.eventId)).size).toBe(2);
  });
});
