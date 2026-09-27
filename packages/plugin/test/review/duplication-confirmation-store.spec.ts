/**
 * `[D-380]` (`ol-v7r5.88`): a duplicated item's losing-copy confirmation entry, persisted as its
 * own dot-folder sidecar — one schema-versioned JSON file per losing note, read and written through
 * the `VaultSource` port the way `olea-core`'s outcome near-match proposals already are
 * (`outcome/near-match.ts`), and never mixed into the automatic processing queue.
 *
 * What the ruling's follow-up binds, and where each is held below:
 *
 *  - stable identities for both copies, the reason, the confirmation status — "the record's shape";
 *  - renaming either note never loses or duplicates the proposal — "renames";
 *  - a new stored record in her vault: schema-versioned, byte-identical round trips (INV-2), and
 *    nothing written into her authored notes (INV-6) — "round trips and where it writes".
 *
 * Entries are handed in the shape `olea-core`'s `resolveInstrumentDuplications` produces (one per
 * losing note path, `proposedAt` in epoch ms); these tests build them by hand so the store is
 * proven on its own, and `open-session-duplication.spec.ts` proves the real walk reaches it.
 */

import { describe, expect, it } from 'vitest';
import {
  DUPLICATION_CONFIRMATION_FOLDER,
  DUPLICATION_CONFIRMATION_RECORD_SCHEMA_VERSION,
  type DuplicationConfirmationEntryInput,
  ITEM_VALIDATION_CONFIRMATION_REASON,
  ITEM_VALIDATION_CONFIRMATION_RECORD_SCHEMA_VERSION,
  type ItemValidationConfirmationEntryInput,
  isDuplicationConfirmationRecord,
  isItemValidationConfirmationRecord,
  isRepairChoiceConfirmationRecord,
  listDuplicationConfirmationRecords,
  listItemValidationConfirmationRecords,
  listRepairChoiceConfirmationRecords,
  proposeDuplicationConfirmations,
  proposeItemValidationConfirmations,
  proposeRepairChoiceConfirmations,
  REPAIR_CHOICE_CONFIRMATION_REASON,
  REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION,
  type RepairChoiceConfirmationEntryInput,
} from '../../src/review/duplication-confirmation-store.js';
import { memoryVault } from './memory-vault.js';

const T0 = Date.parse('2026-08-10T18:00:00.000Z');
const T1 = Date.parse('2026-08-11T18:00:00.000Z');

function entry(
  losingNotePath: string,
  collisions: readonly (readonly [instrumentId: string, keptNotePath: string])[],
  proposedAt = T0,
): DuplicationConfirmationEntryInput {
  return {
    losingNotePath,
    collisions: collisions.map(([instrumentId, keptNotePath]) => ({ instrumentId, keptNotePath })),
    proposedAt,
  };
}

/** Every file under the store's folder, with its raw bytes — what a byte-identity check reads. */
async function storeFiles(vault: ReturnType<typeof memoryVault>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const path of await vault.list({ under: DUPLICATION_CONFIRMATION_FOLDER })) {
    out.set(path, vault.contentOf(path) ?? '');
  }
  return out;
}

describe('the record’s shape', () => {
  it('writes one proposed record per losing note, naming both copies, the reason and the status', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(
      vault,
      [
        entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
        entry('Notes/Other copy.md', [['mcq-dup-2', 'Notes/Original.md']]),
      ],
      { noteUidOf: (path) => (path === 'Notes/Original.md' ? 'uid-original' : null) },
    );

    const listed = await listDuplicationConfirmationRecords(vault);
    expect(listed).toHaveLength(2);
    const byLosing = new Map(listed.map(({ record }) => [record.losing.notePath, record]));
    expect(byLosing.get('Notes/Copy.md')).toEqual({
      losing: { notePath: 'Notes/Copy.md', noteUid: null },
      collisions: [
        {
          instrumentId: 'mcq-dup-1',
          kept: { notePath: 'Notes/Original.md', noteUid: 'uid-original' },
        },
      ],
      status: 'proposed',
      reason: 'duplicate-instrument-id',
      proposedAt: '2026-08-10T18:00:00.000Z',
      schemaVersion: DUPLICATION_CONFIRMATION_RECORD_SCHEMA_VERSION,
    });
    for (const { path } of listed) {
      expect(path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)).toBe(true);
      expect(path.endsWith('.json')).toBe(true);
    }
  });

  it('a whole-file conflict copy is ONE record carrying every id it lost, sorted', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Week (conflict).md', [
        ['prov1:uid-w#^b2', 'Notes/Week.md'],
        ['prov1:uid-w#^b1', 'Notes/Week.md'],
      ]),
    ]);

    const listed = await listDuplicationConfirmationRecords(vault);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.record.collisions.map((c) => c.instrumentId)).toEqual([
      'prov1:uid-w#^b1',
      'prov1:uid-w#^b2',
    ]);
  });

  it('writes nothing, and reads nothing, when there is no entry', async () => {
    const vault = memoryVault({ 'Notes/A.md': 'her note\n' });
    const result = await proposeDuplicationConfirmations(vault, []);
    expect(result.written).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('the validator accepts exactly the shape it writes, and refuses a record missing either copy', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    const [only] = await listDuplicationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    const parsed: unknown = JSON.parse(vault.contentOf(only.path) ?? '');
    expect(isDuplicationConfirmationRecord(parsed)).toBe(true);

    const { losing: _losing, ...noLosing } = only.record;
    expect(isDuplicationConfirmationRecord(noLosing)).toBe(false);
    expect(isDuplicationConfirmationRecord({ ...only.record, collisions: [] })).toBe(false);
    expect(
      isDuplicationConfirmationRecord({ ...only.record, reason: 'token-set-containment' }),
    ).toBe(false);
    expect(isDuplicationConfirmationRecord({ ...only.record, status: 'severed' })).toBe(false);
  });

  it('a corrupt file in the folder is skipped, never thrown on and never overwritten', async () => {
    const vault = memoryVault({
      [`${DUPLICATION_CONFIRMATION_FOLDER}/garbage.json`]: '{ not json',
    });
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    expect(vault.contentOf(`${DUPLICATION_CONFIRMATION_FOLDER}/garbage.json`)).toBe('{ not json');
    expect(await listDuplicationConfirmationRecords(vault)).toHaveLength(1);
  });
});

describe('renames: never lose or duplicate the proposal', () => {
  it('renaming the LOSING note keeps one record, now naming the new path, status and proposedAt unchanged', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']], T0),
    ]);
    const [before] = await listDuplicationConfirmationRecords(vault);

    await proposeDuplicationConfirmations(vault, [
      entry('Archive/Copy renamed.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
    ]);

    const after = await listDuplicationConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.path).toBe(before?.path);
    expect(after[0]?.record.losing.notePath).toBe('Archive/Copy renamed.md');
    expect(after[0]?.record.status).toBe('proposed');
    expect(after[0]?.record.proposedAt).toBe('2026-08-10T18:00:00.000Z');
  });

  it('renaming the KEPT note keeps one record, now naming the kept copy at its new path', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);

    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original renamed.md']], T1),
    ]);

    const after = await listDuplicationConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record.collisions[0]?.kept.notePath).toBe('Notes/Original renamed.md');
    expect(after[0]?.record.losing.notePath).toBe('Notes/Copy.md');
  });

  it('a rename that flips which copy keeps the id is still one proposal, not a second one', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/a.md', [['mcq-dup-1', 'Notes/b.md']]),
    ]);

    // She renamed b.md to 0.md; the walk now keeps a.md's copy, and 0.md's is the loser.
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/0.md', [['mcq-dup-1', 'Notes/a.md']], T1),
    ]);

    const after = await listDuplicationConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record.losing.notePath).toBe('Notes/0.md');
    expect(after[0]?.record.collisions[0]?.kept.notePath).toBe('Notes/a.md');
  });

  it('two losing copies of the same id stay two records; renaming one moves only its own', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy one.md', [['mcq-dup-1', 'Notes/Original.md']]),
      entry('Notes/Copy two.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    const before = await storeFiles(vault);
    expect(before.size).toBe(2);
    const untouchedPath = (await listDuplicationConfirmationRecords(vault)).find(
      ({ record }) => record.losing.notePath === 'Notes/Copy two.md',
    )?.path;
    if (untouchedPath === undefined) throw new Error('expected a record for Copy two');

    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy one renamed.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
      entry('Notes/Copy two.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
    ]);

    const after = await listDuplicationConfirmationRecords(vault);
    expect(after).toHaveLength(2);
    expect(after.map(({ record }) => record.losing.notePath).sort()).toEqual([
      'Notes/Copy one renamed.md',
      'Notes/Copy two.md',
    ]);
    // The copy nobody renamed: its record is byte-identical, never rewritten.
    expect(vault.contentOf(untouchedPath)).toBe(before.get(untouchedPath));
  });

  it('her answer survives a rename: a declined record stays declined and gains no second proposal', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    const [only] = await listDuplicationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    // No affordance writes an answer yet; a record carrying one is written here by hand, in the
    // one status vocabulary the shape already reserves for it.
    await vault.write(
      only.path,
      `${JSON.stringify({ ...only.record, status: 'declined', declinedAt: '2026-08-10T19:00:00.000Z' }, null, 2)}\n`,
    );

    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy renamed.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
    ]);

    const after = await listDuplicationConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record.status).toBe('declined');
    expect(after[0]?.record.declinedAt).toBe('2026-08-10T19:00:00.000Z');
    expect(after[0]?.record.losing.notePath).toBe('Notes/Copy renamed.md');
  });

  it('the olea-uid breaks a tie between two moved-away records of the same id', async () => {
    const vault = memoryVault();
    const uids: Record<string, string> = {
      'Notes/Copy one.md': 'uid-one',
      'Notes/Copy two.md': 'uid-two',
      'Moved/X.md': 'uid-two',
      'Moved/Y.md': 'uid-one',
    };
    const noteUidOf = (path: string) => uids[path] ?? null;
    await proposeDuplicationConfirmations(
      vault,
      [
        entry('Notes/Copy one.md', [['mcq-dup-1', 'Notes/Original.md']]),
        entry('Notes/Copy two.md', [['mcq-dup-1', 'Notes/Original.md']]),
      ],
      { noteUidOf },
    );
    const pathOfUid = new Map(
      (await listDuplicationConfirmationRecords(vault)).map(({ path, record }) => [
        record.losing.noteUid,
        path,
      ]),
    );

    // Both renamed at once: only the uid says which is which.
    await proposeDuplicationConfirmations(
      vault,
      [
        entry('Moved/X.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
        entry('Moved/Y.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
      ],
      { noteUidOf },
    );

    const after = await listDuplicationConfirmationRecords(vault);
    expect(after).toHaveLength(2);
    const byPath = new Map(after.map(({ path, record }) => [path, record.losing.notePath]));
    expect(byPath.get(pathOfUid.get('uid-one') ?? '')).toBe('Moved/Y.md');
    expect(byPath.get(pathOfUid.get('uid-two') ?? '')).toBe('Moved/X.md');
  });
});

describe('round trips and where it writes', () => {
  it('re-proposing an unchanged observation writes nothing (INV-2: an unchanged record is never rewritten)', async () => {
    const vault = memoryVault();
    const entries = [entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']])];
    await proposeDuplicationConfirmations(vault, entries);
    const before = await storeFiles(vault);
    const writesBefore = vault.writes.length;

    const result = await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
    ]);

    expect(result.written).toEqual([]);
    expect(vault.writes.length).toBe(writesBefore);
    expect(await storeFiles(vault)).toEqual(before);
  });

  it('a record read and re-serialised is byte-identical to the file it came from', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Week (conflict).md', [
        ['prov1:uid-w#^b1', 'Notes/Week.md'],
        ['prov1:uid-w#^b2', 'Notes/Week.md'],
      ]),
    ]);
    const [only] = await listDuplicationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    expect(`${JSON.stringify(only.record, null, 2)}\n`).toBe(vault.contentOf(only.path));
  });

  it('a record formatted by someone else is left byte-for-byte alone when nothing about it changed', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    const [only] = await listDuplicationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    const compact = JSON.stringify(only.record);
    await vault.write(only.path, compact);

    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
    ]);
    expect(vault.contentOf(only.path)).toBe(compact);
  });

  it('a record of a newer schema version is matched, never rewritten, and never shadowed by a second proposal', async () => {
    const path = `${DUPLICATION_CONFIRMATION_FOLDER}/from-a-newer-plugin.json`;
    const newer = `${JSON.stringify(
      {
        losing: { notePath: 'Notes/Copy.md', noteUid: null },
        collisions: [
          { instrumentId: 'mcq-dup-1', kept: { notePath: 'Notes/Original.md', noteUid: null } },
        ],
        status: 'proposed',
        reason: 'duplicate-instrument-id',
        proposedAt: '2026-08-09T18:00:00.000Z',
        schemaVersion: DUPLICATION_CONFIRMATION_RECORD_SCHEMA_VERSION + 1,
        somethingNew: true,
      },
      null,
      2,
    )}\n`;
    const vault = memoryVault({ [path]: newer });

    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy renamed.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);

    expect(vault.contentOf(path)).toBe(newer);
    expect(await listDuplicationConfirmationRecords(vault)).toHaveLength(1);
  });

  it('every write lands under its own dot folder — never in a note she wrote (INV-6)', async () => {
    const vault = memoryVault({
      'Notes/Original.md': 'her note\n',
      'Notes/Copy.md': 'her copy\n',
    });
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy renamed.md', [['mcq-dup-1', 'Notes/Original.md']], T1),
    ]);

    expect(vault.writes.length).toBeGreaterThan(0);
    for (const written of vault.writes) {
      expect(written.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)).toBe(true);
    }
    expect(vault.contentOf('Notes/Original.md')).toBe('her note\n');
    expect(vault.contentOf('Notes/Copy.md')).toBe('her copy\n');
  });

  it('the folder is its own, never the automatic processing queue’s', () => {
    expect(DUPLICATION_CONFIRMATION_FOLDER).toBe('.olea/duplication-confirmation');
  });
});

/** `[D-392]` part 2 (`ol-v7r5.91`, `ol-v7r5.100`): repair-choice proposals share this same store. */
function repairEntry(
  instrumentId: string,
  candidates: readonly (readonly [notePath: string, meetsCertaintyTest: boolean])[],
  proposedAt = T0,
): RepairChoiceConfirmationEntryInput {
  return {
    instrumentId,
    candidates: candidates.map(([notePath, meetsCertaintyTest]) => ({
      notePath,
      meetsCertaintyTest,
    })),
    proposedAt,
  };
}

describe('[D-392]: repair-choice proposals share this store, under their own reason', () => {
  it('writes one proposed record per deleted id, naming every candidate, under the second reason', async () => {
    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [
        ['Notes/Candidate B.md', false],
        ['Notes/Candidate A.md', true],
      ]),
    ]);

    const listed = await listRepairChoiceConfirmationRecords(vault);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.record).toEqual({
      instrumentId: 'mcq-deleted-1',
      candidates: [
        { notePath: 'Notes/Candidate A.md', meetsCertaintyTest: true },
        { notePath: 'Notes/Candidate B.md', meetsCertaintyTest: false },
      ],
      status: 'proposed',
      reason: REPAIR_CHOICE_CONFIRMATION_REASON,
      proposedAt: '2026-08-10T18:00:00.000Z',
      schemaVersion: REPAIR_CHOICE_CONFIRMATION_RECORD_SCHEMA_VERSION,
    });
    expect(listed[0]?.path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)).toBe(true);
  });

  it('the reader accepts the new reason value and still reads every existing duplicate record unchanged', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [['Notes/Candidate.md', true]]),
    ]);

    const duplicates = await listDuplicationConfirmationRecords(vault);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.record.reason).toBe('duplicate-instrument-id');
    const repairs = await listRepairChoiceConfirmationRecords(vault);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]?.record.reason).toBe(REPAIR_CHOICE_CONFIRMATION_REASON);
  });

  it('walking again with the same candidates writes nothing new — one proposal per deleted id, never per candidate', async () => {
    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [
        ['Notes/A.md', false],
        ['Notes/B.md', false],
      ]),
    ]);
    const writesBefore = vault.writes.length;

    const result = await proposeRepairChoiceConfirmations(vault, [
      repairEntry(
        'mcq-deleted-1',
        [
          ['Notes/A.md', false],
          ['Notes/B.md', false],
        ],
        T1,
      ),
    ]);

    expect(result.written).toEqual([]);
    expect(vault.writes.length).toBe(writesBefore);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(1);
  });

  it('a walk with a changed candidate set refreshes the still-proposed record in place', async () => {
    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [['Notes/A.md', false]]),
    ]);
    const [before] = await listRepairChoiceConfirmationRecords(vault);

    await proposeRepairChoiceConfirmations(vault, [
      repairEntry(
        'mcq-deleted-1',
        [
          ['Notes/A.md', false],
          ['Notes/C.md', false],
        ],
        T1,
      ),
    ]);

    const after = await listRepairChoiceConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.path).toBe(before?.path);
    expect(after[0]?.record.candidates.map((c) => c.notePath)).toEqual([
      'Notes/A.md',
      'Notes/C.md',
    ]);
    expect(after[0]?.record.proposedAt).toBe('2026-08-10T18:00:00.000Z'); // never moved by a later write.
  });

  it('her answer stands: a resolved proposal is never rewritten by a later walk (binding condition 1)', async () => {
    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [
        ['Notes/A.md', false],
        ['Notes/B.md', false],
      ]),
    ]);
    const [only] = await listRepairChoiceConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    // No affordance writes an answer yet (see this bead's report); a resolution is written here
    // by hand, in the vocabulary the shape already reserves for it.
    await vault.write(
      only.path,
      `${JSON.stringify(
        {
          ...only.record,
          status: 'confirmed',
          confirmedAt: '2026-08-10T19:00:00.000Z',
          resolvedNotePath: 'Notes/A.md',
        },
        null,
        2,
      )}\n`,
    );

    await proposeRepairChoiceConfirmations(vault, [
      repairEntry(
        'mcq-deleted-1',
        [
          ['Notes/A.md', false],
          ['Notes/B.md', false],
        ],
        T1,
      ),
    ]);

    const after = await listRepairChoiceConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record.status).toBe('confirmed');
    expect(after[0]?.record.resolvedNotePath).toBe('Notes/A.md');
  });

  it('a duplication record and a repair-choice record for the same id never collide on one path', async () => {
    const vault = memoryVault();
    // Both hash the identical id set (`['mcq-shared-1']`) — the duplication half's single-collision
    // case and the repair half's own identity are the same string.
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Losing.md', [['mcq-shared-1', 'Notes/Kept.md']]),
    ]);
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-shared-1', [['Notes/Candidate.md', false]]),
    ]);

    const duplicates = await listDuplicationConfirmationRecords(vault);
    const repairs = await listRepairChoiceConfirmationRecords(vault);
    expect(duplicates).toHaveLength(1);
    expect(repairs).toHaveLength(1);
    expect(duplicates[0]?.path).not.toBe(repairs[0]?.path);
  });

  it('writes nothing, and reads nothing, when there is no entry', async () => {
    const vault = memoryVault({ 'Notes/A.md': 'her note\n' });
    const result = await proposeRepairChoiceConfirmations(vault, []);
    expect(result.written).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('the validator accepts exactly the shape it writes, and refuses a duplication record', async () => {
    const vault = memoryVault();
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [['Notes/A.md', true]]),
    ]);
    const [only] = await listRepairChoiceConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    const parsed: unknown = JSON.parse(vault.contentOf(only.path) ?? '');
    expect(isRepairChoiceConfirmationRecord(parsed)).toBe(true);
    expect(isDuplicationConfirmationRecord(parsed)).toBe(false);

    expect(isRepairChoiceConfirmationRecord({ ...only.record, candidates: [] })).toBe(false);
    expect(
      isRepairChoiceConfirmationRecord({ ...only.record, reason: 'duplicate-instrument-id' }),
    ).toBe(false);
    const { instrumentId: _instrumentId, ...noInstrumentId } = only.record;
    expect(isRepairChoiceConfirmationRecord(noInstrumentId)).toBe(false);
  });

  it('every write lands under its own dot folder — never in a note she authored (INV-6)', async () => {
    const vault = memoryVault({ 'Notes/Candidate.md': 'her note\n' });
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [['Notes/Candidate.md', true]]),
    ]);

    expect(vault.writes.length).toBeGreaterThan(0);
    for (const written of vault.writes) {
      expect(written.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)).toBe(true);
    }
    expect(vault.contentOf('Notes/Candidate.md')).toBe('her note\n');
  });
});

function itemValidationEntry(
  instrumentId: string,
  kind: ItemValidationConfirmationEntryInput['kind'],
  proposedAt = T0,
  reason?: string,
): ItemValidationConfirmationEntryInput {
  return { instrumentId, kind, proposedAt, ...(reason !== undefined ? { reason } : {}) };
}

describe('[D-265] ruling 3: item-validation proposals share this store, under their own reason', () => {
  it('writes one proposed record per suspected item, under the third reason', async () => {
    const vault = memoryVault();
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'key-conflicts-with-source', T0, 'cited key mismatch'),
    ]);

    const listed = await listItemValidationConfirmationRecords(vault);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.record).toEqual({
      instrumentId: 'qa:concept-a:2',
      kind: 'key-conflicts-with-source',
      reason: 'cited key mismatch',
      status: 'proposed',
      reasonKind: ITEM_VALIDATION_CONFIRMATION_REASON,
      proposedAt: '2026-08-10T18:00:00.000Z',
      schemaVersion: ITEM_VALIDATION_CONFIRMATION_RECORD_SCHEMA_VERSION,
    });
    expect(listed[0]?.path.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)).toBe(true);
  });

  it('an omitted reason is never fabricated — the field is simply absent', async () => {
    const vault = memoryVault();
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'missing-central-assumption'),
    ]);
    const [only] = await listItemValidationConfirmationRecords(vault);
    expect(only?.record.reason).toBeUndefined();
  });

  it('the reader accepts the third reason value and still reads the other two records unchanged', async () => {
    const vault = memoryVault();
    await proposeDuplicationConfirmations(vault, [
      entry('Notes/Copy.md', [['mcq-dup-1', 'Notes/Original.md']]),
    ]);
    await proposeRepairChoiceConfirmations(vault, [
      repairEntry('mcq-deleted-1', [['Notes/Candidate.md', true]]),
    ]);
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'superseded-material'),
    ]);

    expect(await listDuplicationConfirmationRecords(vault)).toHaveLength(1);
    expect(await listRepairChoiceConfirmationRecords(vault)).toHaveLength(1);
    const items = await listItemValidationConfirmationRecords(vault);
    expect(items).toHaveLength(1);
    expect(items[0]?.record.reasonKind).toBe(ITEM_VALIDATION_CONFIRMATION_REASON);
  });

  it('walking again with the same suspected kind writes nothing new — one proposal per instrument', async () => {
    const vault = memoryVault();
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'corrupted-prompt-or-source'),
    ]);
    const writesBefore = vault.writes.length;

    const result = await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'corrupted-prompt-or-source', T1),
    ]);

    expect(result.written).toEqual([]);
    expect(vault.writes.length).toBe(writesBefore);
    expect(await listItemValidationConfirmationRecords(vault)).toHaveLength(1);
  });

  it('a walk with a changed suspected kind refreshes the still-proposed record in place', async () => {
    const vault = memoryVault();
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'stem-satisfied-by-multiple-options'),
    ]);
    const [before] = await listItemValidationConfirmationRecords(vault);

    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'key-conflicts-with-source', T1, 'now this instead'),
    ]);

    const after = await listItemValidationConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.path).toBe(before?.path);
    expect(after[0]?.record.kind).toBe('key-conflicts-with-source');
    expect(after[0]?.record.reason).toBe('now this instead');
    expect(after[0]?.record.proposedAt).toBe('2026-08-10T18:00:00.000Z'); // never moved by a later write.
  });

  it('her answer stands: a resolved proposal is never rewritten by a later walk', async () => {
    const vault = memoryVault();
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'key-conflicts-with-source'),
    ]);
    const [only] = await listItemValidationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    // No affordance writes an answer yet (see this module's doc); a resolution is written here
    // by hand, in the vocabulary the shape already reserves for it.
    await vault.write(
      only.path,
      `${JSON.stringify({ ...only.record, status: 'declined', declinedAt: '2026-08-11T00:00:00.000Z' }, null, 2)}\n`,
    );

    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'superseded-material', T1),
    ]);

    const after = await listItemValidationConfirmationRecords(vault);
    expect(after).toHaveLength(1);
    expect(after[0]?.record.status).toBe('declined');
    expect(after[0]?.record.kind).toBe('key-conflicts-with-source'); // never re-litigated.
  });

  it('writes nothing, and reads nothing, when there is no entry', async () => {
    const vault = memoryVault({ 'Notes/A.md': 'her note\n' });
    const result = await proposeItemValidationConfirmations(vault, []);
    expect(result.written).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('the validator accepts exactly the shape it writes, and refuses records of the other two reasons', async () => {
    const vault = memoryVault();
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'key-conflicts-with-source'),
    ]);
    const [only] = await listItemValidationConfirmationRecords(vault);
    if (only === undefined) throw new Error('expected one record');
    const parsed: unknown = JSON.parse(vault.contentOf(only.path) ?? '');
    expect(isItemValidationConfirmationRecord(parsed)).toBe(true);
    expect(isDuplicationConfirmationRecord(parsed)).toBe(false);
    expect(isRepairChoiceConfirmationRecord(parsed)).toBe(false);

    expect(isItemValidationConfirmationRecord({ ...only.record, kind: 'not-a-real-kind' })).toBe(
      false,
    );
    const { instrumentId: _instrumentId, ...noInstrumentId } = only.record;
    expect(isItemValidationConfirmationRecord(noInstrumentId)).toBe(false);
  });

  it('every write lands under its own dot folder — never in a note she authored (INV-6)', async () => {
    const vault = memoryVault({ 'Notes/A.md': 'her note\n' });
    await proposeItemValidationConfirmations(vault, [
      itemValidationEntry('qa:concept-a:2', 'key-conflicts-with-source'),
    ]);

    expect(vault.writes.length).toBeGreaterThan(0);
    for (const written of vault.writes) {
      expect(written.startsWith(`${DUPLICATION_CONFIRMATION_FOLDER}/`)).toBe(true);
    }
    expect(vault.contentOf('Notes/A.md')).toBe('her note\n');
  });
});
