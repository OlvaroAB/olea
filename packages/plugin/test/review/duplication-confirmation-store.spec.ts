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
  isDuplicationConfirmationRecord,
  listDuplicationConfirmationRecords,
  proposeDuplicationConfirmations,
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
