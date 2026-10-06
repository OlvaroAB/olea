/**
 * Two overlapping duplicate proposals for one collision set (`ol-egov.141.89.104.53`, race 2).
 *
 * Each proposer in `../../src/review/duplication-confirmation-store.ts` lists the folder, matches
 * every entry against the records there, and writes a new record for an entry nothing matches. The
 * listing reads every record file and the new record is a file of its own, so no one file's queue
 * covers the match and the write together. Two walks that overlap both list before either write
 * lands, both match nothing, and both write: the first claims `<hash>.json`, and the second, finding
 * that name taken, claims `<hash>-2.json`. That is two `'proposed'` records for one collision set
 * (one losing note's id set), or for one deleted id, or for one flagged item — two questions for
 * her where the store promises one.
 *
 * The vault below lands each write one macrotask late, so both listings run before either write.
 * Every course, note and id here is invented.
 */

import type { VaultPath } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  DUPLICATION_CONFIRMATION_FOLDER,
  type DuplicationConfirmationEntryInput,
  listDuplicationConfirmationRecords,
  listItemValidationConfirmationRecords,
  listRepairChoiceConfirmationRecords,
  proposeDuplicationConfirmations,
  proposeItemValidationConfirmations,
  proposeRepairChoiceConfirmations,
} from '../../src/review/duplication-confirmation-store.js';
import { MemoryVaultSource } from '../privacy/fakes.js';

class LateWriteVault extends MemoryVaultSource {
  override async write(path: VaultPath, content: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await super.write(path, content);
  }
}

const T0 = Date.parse('2026-10-05T09:00:00Z');

function recordFiles(vault: MemoryVaultSource): readonly VaultPath[] {
  return vault.paths().filter((path) => path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`));
}

function duplicationEntry(losingNotePath: VaultPath): DuplicationConfirmationEntryInput {
  return {
    losingNotePath,
    collisions: [
      { instrumentId: 'mcq:widget-crank:1', keptNotePath: '01 Courses/COURSEA/Widgets.md' },
      { instrumentId: 'mcq:widget-crank:2', keptNotePath: '01 Courses/COURSEA/Widgets.md' },
    ],
    proposedAt: T0,
  };
}

const LOSING = '01 Courses/COURSEA/Widgets copy.md';

describe('race 2: two overlapping duplicate proposals for one collision set', () => {
  it('a duplicated note: one record, and both walks name it', async () => {
    const vault = new LateWriteVault();
    const [first, second] = await Promise.all([
      proposeDuplicationConfirmations(vault, [duplicationEntry(LOSING)]),
      proposeDuplicationConfirmations(vault, [duplicationEntry(LOSING)]),
    ]);

    expect(recordFiles(vault)).toHaveLength(1);
    expect(second.records[0]?.path).toBe(first.records[0]?.path);
    expect(await listDuplicationConfirmationRecords(vault)).toHaveLength(1);
    // The second walk found the first's record unchanged, so it wrote nothing.
    expect(second.written).toEqual([]);
  });

  it('a deleted id awaiting her choice: one record', async () => {
    const vault = new LateWriteVault();
    const entry = {
      instrumentId: 'mcq:widget-lid:1',
      candidates: [
        { notePath: '01 Courses/COURSEA/Lids.md', meetsCertaintyTest: false, digest: 'digest-a' },
        {
          notePath: '01 Courses/COURSEA/Lids two.md',
          meetsCertaintyTest: false,
          digest: 'digest-b',
        },
      ],
      proposedAt: T0,
    };
    const [first, second] = await Promise.all([
      proposeRepairChoiceConfirmations(vault, [entry]),
      proposeRepairChoiceConfirmations(vault, [entry]),
    ]);

    expect(recordFiles(vault)).toHaveLength(1);
    expect(second.records[0]?.path).toBe(first.records[0]?.path);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(1);
  });

  it('a flagged item: one record', async () => {
    const vault = new LateWriteVault();
    const entry = {
      instrumentId: 'qa:widget-spring:1',
      kind: 'key-conflicts-with-source' as const,
      proposedAt: T0,
    };
    const [first, second] = await Promise.all([
      proposeItemValidationConfirmations(vault, [entry]),
      proposeItemValidationConfirmations(vault, [entry]),
    ]);

    expect(recordFiles(vault)).toHaveLength(1);
    expect(second.records[0]?.path).toBe(first.records[0]?.path);
    expect(await listItemValidationConfirmationRecords(vault)).toHaveLength(1);
  });

  it('two different collision sets still get a record each when their walks overlap', async () => {
    const vault = new LateWriteVault();
    const other: DuplicationConfirmationEntryInput = {
      losingNotePath: '01 Courses/COURSEA/Springs copy.md',
      collisions: [
        { instrumentId: 'mcq:widget-spring:4', keptNotePath: '01 Courses/COURSEA/Springs.md' },
      ],
      proposedAt: T0,
    };
    await Promise.all([
      proposeDuplicationConfirmations(vault, [duplicationEntry(LOSING)]),
      proposeDuplicationConfirmations(vault, [other]),
    ]);

    expect(recordFiles(vault)).toHaveLength(2);
    expect(await listDuplicationConfirmationRecords(vault)).toHaveLength(2);
  });

  it('a repair choice and a flagged item for one id overlapping keep both records, neither written over', async () => {
    const vault = new LateWriteVault();
    const [repair, flagged] = await Promise.all([
      proposeRepairChoiceConfirmations(vault, [
        {
          instrumentId: 'mcq:widget-lid:7',
          candidates: [
            { notePath: '01 Courses/COURSEA/Lids.md', meetsCertaintyTest: false, digest: 'd-1' },
          ],
          proposedAt: T0,
        },
      ]),
      proposeItemValidationConfirmations(vault, [
        { instrumentId: 'mcq:widget-lid:7', kind: 'superseded-material', proposedAt: T0 },
      ]),
    ]);

    expect(recordFiles(vault)).toHaveLength(2);
    expect(repair.records[0]?.path).not.toBe(flagged.records[0]?.path);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(1);
    expect(await listItemValidationConfirmationRecords(vault)).toHaveLength(1);
  });

  it('a walk with nothing new after the race rewrites nothing, byte for byte (INV-2)', async () => {
    const vault = new LateWriteVault();
    await Promise.all([
      proposeDuplicationConfirmations(vault, [duplicationEntry(LOSING)]),
      proposeDuplicationConfirmations(vault, [duplicationEntry(LOSING)]),
    ]);
    const [path] = recordFiles(vault);
    const before = path === undefined ? undefined : vault.raw(path);

    const again = await proposeDuplicationConfirmations(vault, [duplicationEntry(LOSING)]);

    expect(again.written).toEqual([]);
    expect(path === undefined ? undefined : vault.raw(path)).toBe(before);
  });
});
