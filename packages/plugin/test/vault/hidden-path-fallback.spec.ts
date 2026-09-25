/**
 * ol-egov.141.89.10.57: ObsidianSource's read, readBinary, exists, write and firstSeen on a
 * dot path, whether or not the host's vault index knows it. Nothing on record says which a real
 * Obsidian host does (see the bead), so every case runs against two fakes shaped like
 * Obsidian's Vault plus its raw DataAdapter:
 *
 * - a host whose index HIDES dot paths (getFileByPath and getFolderByPath answer null for them,
 *   as getFiles already does on a real host), with each unknown vault.create and createFolder
 *   behaviour for a hidden path run separately, since the typings are silent on it;
 * - a host whose index KNOWS them (what the workbench shim models), where the vault route the
 *   class always took must keep working untouched.
 *
 * Plus ordinary notes on both (exactly the host calls the class made before the fallback,
 * nothing more) and an adapter reduced to exists, list and remove (the workbench shim's
 * shape), which must keep the answers it gave before. The fake host is
 * hidden-path-fallback.fake.ts; obsidian-source-hidden-paths.spec.ts drives the real
 * ObsidianSource class over the same fake, to prove it is a thin caller of these functions.
 */

import { describe, expect, it } from 'vitest';
import {
  isHiddenVaultPath,
  readVaultBinary,
  readVaultText,
  vaultFileExists,
  vaultFileFirstSeen,
  writeVaultText,
} from '../../src/vault/hidden-path-fallback.js';
import {
  AWKWARD,
  BYTES,
  type FakeHost,
  HIDDEN,
  HIDDEN_LOG,
  type HiddenCreate,
  type HiddenCreateFolder,
  hidingHost,
  indexingHost,
  NOTE,
} from './hidden-path-fallback.fake.js';

/** The review-log shape (olea-core review-log write): exists, then read, then write it all back. */
async function appendLine(host: FakeHost, path: string, line: string): Promise<void> {
  const previous = (await vaultFileExists(host.vault, path))
    ? await readVaultText(host.vault, path)
    : '';
  await writeVaultText(host.vault, path, `${previous}${line}\n`);
}

describe('isHiddenVaultPath', () => {
  it('is true when any segment starts with a dot, false otherwise', () => {
    expect(isHiddenVaultPath('.olea/reviews/x.jsonl')).toBe(true);
    expect(isHiddenVaultPath('Course/.drafts/x.md')).toBe(true);
    expect(isHiddenVaultPath('Course/.x.md')).toBe(true);
    expect(isHiddenVaultPath(NOTE)).toBe(false);
    expect(isHiddenVaultPath('a.b/c.d.md')).toBe(false);
  });
});

describe('a host whose vault index hides dot paths', () => {
  it('read returns an unindexed .olea file byte for byte, straight from the adapter', async () => {
    const host = hidingHost();
    host.seed(HIDDEN, AWKWARD);
    expect(host.isIndexed(HIDDEN)).toBe(false);
    expect(await readVaultText(host.vault, HIDDEN)).toBe(AWKWARD);
    expect(host.calls).toEqual([`vault.getFileByPath ${HIDDEN}`, `adapter.read ${HIDDEN}`]);
  });

  it('read of a missing hidden file or a hidden folder throws the same no-such-file error as before', async () => {
    const host = hidingHost();
    host.seedFolder('.olea/concepts');
    await expect(readVaultText(host.vault, HIDDEN)).rejects.toThrow(
      `ObsidianSource: no such file: ${HIDDEN}`,
    );
    await expect(readVaultText(host.vault, '.olea/concepts')).rejects.toThrow(
      'ObsidianSource: no such file: .olea/concepts',
    );
    await expect(readVaultBinary(host.vault, HIDDEN)).rejects.toThrow(
      `ObsidianSource: no such file: ${HIDDEN}`,
    );
  });

  it('readBinary returns the exact bytes of an unindexed hidden file', async () => {
    const host = hidingHost();
    host.seed('.olea/cache/blob.bin', BYTES);
    const read = new Uint8Array(await readVaultBinary(host.vault, '.olea/cache/blob.bin'));
    expect([...read]).toEqual([...BYTES]);
    expect(host.callsTo('vault.readBinary')).toEqual([]);
  });

  it('exists is true for an unindexed hidden file, false when missing, false for a folder', async () => {
    const host = hidingHost();
    host.seed(HIDDEN, '{}');
    expect(await vaultFileExists(host.vault, HIDDEN)).toBe(true);
    expect(await vaultFileExists(host.vault, '.olea/concepts/other.json')).toBe(false);
    expect(await vaultFileExists(host.vault, '.olea/concepts')).toBe(false);
  });

  it('firstSeen reads the adapter ctime for a hidden file and null for a missing one', async () => {
    const host = hidingHost();
    host.seed(HIDDEN, '{}');
    expect(await vaultFileFirstSeen(host.vault, HIDDEN)).toBe(host.ctimeOf(HIDDEN));
    expect(await vaultFileFirstSeen(host.vault, '.olea/concepts')).toBeNull();
    expect(await vaultFileFirstSeen(host.vault, '.olea/concepts/other.json')).toBeNull();
  });

  it('write to an existing unindexed hidden file replaces it in place and never attempts create', async () => {
    const host = hidingHost({ hiddenCreate: 'throws', hiddenCreateFolder: 'throws' });
    host.seed(HIDDEN, '{"old":true}');
    await writeVaultText(host.vault, HIDDEN, AWKWARD);
    expect(host.text(HIDDEN)).toBe(AWKWARD);
    expect([...host.files.keys()]).toEqual([HIDDEN]);
    expect(host.callsTo('vault.create', 'vault.createFolder', 'adapter.mkdir')).toEqual([]);
    expect(host.callsTo('adapter.write')).toEqual([`adapter.write ${HIDDEN}`]);
  });

  it('write refuses to put a file where a hidden folder is', async () => {
    const host = hidingHost();
    host.seedFolder('.olea/concepts');
    await expect(writeVaultText(host.vault, '.olea/concepts', '{}')).rejects.toThrow(
      'ObsidianSource.write: a folder, not a file, is at .olea/concepts',
    );
    expect(host.files.size).toBe(0);
  });

  it('when the vault route and the adapter route both fail, write rejects with both errors', async () => {
    const host = hidingHost({ hiddenCreate: 'throws', hiddenCreateFolder: 'throws' });
    // A file squats where the parent folder should be, so the adapter cannot write under it.
    host.seed('.olea/reviews', 'not a folder');
    const failure = await writeVaultText(host.vault, HIDDEN_LOG, 'x').then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect([...host.files.keys()]).toEqual(['.olea/reviews']);
  });

  const creates: readonly HiddenCreate[] = ['writes', 'writes-then-throws', 'throws', 'no-op'];
  const createFolders: readonly HiddenCreateFolder[] = ['mkdir', 'throws-if-exists', 'throws'];
  for (const hiddenCreate of creates) {
    for (const hiddenCreateFolder of createFolders) {
      for (const parent of ['present', 'missing'] as const) {
        it(`write-new lands the exact content once (vault.create ${hiddenCreate}, createFolder ${hiddenCreateFolder}, parent ${parent})`, async () => {
          const host = hidingHost({ hiddenCreate, hiddenCreateFolder });
          if (parent === 'present') host.seedFolder('.olea/reviews');
          await writeVaultText(host.vault, HIDDEN_LOG, AWKWARD);
          expect(host.text(HIDDEN_LOG)).toBe(AWKWARD);
          expect([...host.files.keys()]).toEqual([HIDDEN_LOG]);
          expect(host.folders.has('.olea/reviews')).toBe(true);
        });
      }
    }
  }

  it('an exists, read, write append cycle keeps every earlier line (the review-log shape)', async () => {
    const host = hidingHost();
    await appendLine(host, HIDDEN_LOG, '{"n":1}');
    await appendLine(host, HIDDEN_LOG, '{"n":2}');
    await appendLine(host, HIDDEN_LOG, '{"n":3}');
    expect(host.text(HIDDEN_LOG)).toBe('{"n":1}\n{"n":2}\n{"n":3}\n');
    expect([...host.files.keys()]).toEqual([HIDDEN_LOG]);
  });

  it('a read-modify-write round trip changes only the bytes the edit asked for (INV-2)', async () => {
    const host = hidingHost();
    host.seed(HIDDEN, AWKWARD);
    const read = await readVaultText(host.vault, HIDDEN);
    await writeVaultText(host.vault, HIDDEN, read);
    expect(host.text(HIDDEN)).toBe(AWKWARD);
    await writeVaultText(
      host.vault,
      HIDDEN,
      `${await readVaultText(host.vault, HIDDEN)}\r\n{"d":4}`,
    );
    expect(host.text(HIDDEN)).toBe(`${AWKWARD}\r\n{"d":4}`);
  });
});

describe('a host whose vault index knows dot paths', () => {
  it('read, readBinary, exists and firstSeen go through the index and never touch the adapter', async () => {
    const host = indexingHost();
    host.seed(HIDDEN, AWKWARD);
    host.seed('.olea/cache/blob.bin', BYTES);
    expect(await readVaultText(host.vault, HIDDEN)).toBe(AWKWARD);
    expect([...new Uint8Array(await readVaultBinary(host.vault, '.olea/cache/blob.bin'))]).toEqual([
      ...BYTES,
    ]);
    expect(await vaultFileExists(host.vault, HIDDEN)).toBe(true);
    expect(await vaultFileFirstSeen(host.vault, HIDDEN)).toBe(host.ctimeOf(HIDDEN));
    expect(host.callsTo('adapter.')).toEqual([]);
    expect(host.callsTo('vault.read ', 'vault.readBinary ')).toEqual([
      `vault.read ${HIDDEN}`,
      'vault.readBinary .olea/cache/blob.bin',
    ]);
  });

  it('write to an indexed hidden file goes through vault.modify, as before', async () => {
    const host = indexingHost();
    host.seed(HIDDEN, '{}');
    await writeVaultText(host.vault, HIDDEN, AWKWARD);
    expect(host.text(HIDDEN)).toBe(AWKWARD);
    expect(host.calls).toEqual([`vault.getFileByPath ${HIDDEN}`, `vault.modify ${HIDDEN}`]);
  });

  it('write-new keeps the vault route (createFolder, then vault.create) and the adapter only looks', async () => {
    const host = indexingHost();
    await writeVaultText(host.vault, HIDDEN_LOG, AWKWARD);
    expect(host.text(HIDDEN_LOG)).toBe(AWKWARD);
    expect(host.isIndexed(HIDDEN_LOG)).toBe(true);
    expect(host.callsTo('vault.createFolder', 'vault.create ')).toEqual([
      'vault.createFolder .olea',
      'vault.createFolder .olea/reviews',
      `vault.create ${HIDDEN_LOG}`,
    ]);
    expect(host.callsTo('adapter.write', 'adapter.mkdir')).toEqual([]);
    // The next append goes through the index again.
    await appendLine(host, HIDDEN_LOG, 'x');
    expect(host.text(HIDDEN_LOG)).toBe(`${AWKWARD}x\n`);
    expect(host.callsTo('vault.modify')).toEqual([`vault.modify ${HIDDEN_LOG}`]);
  });

  it('a hidden file the index has not caught up with is read, checked and modified in place, never created', async () => {
    const host = indexingHost();
    host.seedUnindexed(HIDDEN_LOG, '{"n":1}\n');
    await appendLine(host, HIDDEN_LOG, '{"n":2}');
    expect(host.text(HIDDEN_LOG)).toBe('{"n":1}\n{"n":2}\n');
    expect(host.callsTo('vault.create', 'vault.createFolder')).toEqual([]);
  });
});

for (const [name, makeHost] of [
  ['hides', hidingHost],
  ['knows', indexingHost],
] as const) {
  describe(`ordinary notes keep the host calls they made before (index ${name} dot paths)`, () => {
    it('read, readBinary, exists and firstSeen ask the index only', async () => {
      const host = makeHost();
      host.seed(NOTE, AWKWARD);
      expect(await readVaultText(host.vault, NOTE)).toBe(AWKWARD);
      await readVaultBinary(host.vault, NOTE);
      expect(await vaultFileExists(host.vault, NOTE)).toBe(true);
      expect(await vaultFileFirstSeen(host.vault, NOTE)).toBe(host.ctimeOf(NOTE));
      expect(host.calls).toEqual([
        `vault.getFileByPath ${NOTE}`,
        `vault.read ${NOTE}`,
        `vault.getFileByPath ${NOTE}`,
        `vault.readBinary ${NOTE}`,
        `vault.getFileByPath ${NOTE}`,
        `vault.getFileByPath ${NOTE}`,
      ]);
    });

    it('a missing note: read throws no such file, exists is false, firstSeen null, the adapter is never asked', async () => {
      const host = makeHost();
      await expect(readVaultText(host.vault, NOTE)).rejects.toThrow(
        `ObsidianSource: no such file: ${NOTE}`,
      );
      await expect(readVaultBinary(host.vault, NOTE)).rejects.toThrow(
        `ObsidianSource: no such file: ${NOTE}`,
      );
      expect(await vaultFileExists(host.vault, NOTE)).toBe(false);
      expect(await vaultFileFirstSeen(host.vault, NOTE)).toBeNull();
      expect(host.callsTo('adapter.')).toEqual([]);
    });

    it('a note on disk the index has not caught up with reads as missing, as before', async () => {
      const host = makeHost();
      host.seedUnindexed(NOTE, 'text');
      await expect(readVaultText(host.vault, NOTE)).rejects.toThrow('no such file');
      expect(await vaultFileExists(host.vault, NOTE)).toBe(false);
      expect(host.callsTo('adapter.')).toEqual([]);
    });

    it('write to an existing note: getFileByPath, then vault.modify', async () => {
      const host = makeHost();
      host.seed(NOTE, 'old');
      await writeVaultText(host.vault, NOTE, AWKWARD);
      expect(host.text(NOTE)).toBe(AWKWARD);
      expect(host.calls).toEqual([`vault.getFileByPath ${NOTE}`, `vault.modify ${NOTE}`]);
    });

    it('write of a new note: createFolder per missing segment, then vault.create', async () => {
      const host = makeHost();
      host.seedFolder('Course');
      await writeVaultText(host.vault, NOTE, AWKWARD);
      expect(host.text(NOTE)).toBe(AWKWARD);
      expect(host.calls).toEqual([
        `vault.getFileByPath ${NOTE}`,
        'vault.getFolderByPath Course',
        'vault.getFolderByPath Course/Week 1',
        'vault.createFolder Course/Week 1',
        `vault.create ${NOTE}`,
      ]);
    });
  });
}

describe('a hidden path the index has never seen at all: the fallback consults the adapter and still says no such file', () => {
  it('on a host that indexes dot paths, an unseeded hidden path falls back to the adapter, which also has nothing', async () => {
    const host = indexingHost();
    await writeVaultText(host.vault, HIDDEN_LOG, 'one\n');
    await appendLine(host, HIDDEN_LOG, 'two');
    expect(host.text(HIDDEN_LOG)).toBe('one\ntwo\n');
    await expect(readVaultText(host.vault, HIDDEN)).rejects.toThrow('no such file');
    expect(await vaultFileExists(host.vault, HIDDEN)).toBe(false);
    expect(await vaultFileFirstSeen(host.vault, HIDDEN)).toBeNull();
    // Since ol-3ux7.64.25 the adapter is always the full RawFileAdapter surface (a real host and
    // the workbench shim both provide it), so an index miss on a hidden path still falls back
    // and asks it, rather than assuming the index is authoritative for every host — the adapter
    // itself also has nothing, so the answer is unchanged, but it is now consulted, not skipped.
    expect(host.callsTo('adapter.stat').length).toBeGreaterThan(0);
  });
});
