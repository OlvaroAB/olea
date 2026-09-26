/**
 * `FolderSource.removeEmptyFolder` (`ol-egov.141.8.9`, promoted onto
 * `VaultSource` to close the gap `ol-egov.141.8.7` found: a full delete
 * could remove every file under `.olea/` but left the emptied folders
 * standing, because the interface had no folder-removal primitive.
 *
 * Deliberately its own file, colocated beside `folder-source.spec.ts`
 * (that file is not this bead's to edit) — see `LANE-RULES-r2.md`.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FolderSource } from './folder-source.js';

const tempRoots: string[] = [];
afterEach(async () => {
  for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'olea-folder-source-remove-empty-'));
  tempRoots.push(root);
  return root;
}

describe('FolderSource.removeEmptyFolder', () => {
  it('removes an empty folder', async () => {
    const root = await freshRoot();
    await mkdir(join(root, '.olea', 'concepts'), { recursive: true });
    const vault = new FolderSource(root);

    // Failing-first: at the time this test was added, VaultSource/FolderSource had no
    // removeEmptyFolder method at all, so this call was a TypeError, not a resolved promise.
    await vault.removeEmptyFolder?.('.olea/concepts');

    await expect(readdir(join(root, '.olea'))).resolves.toEqual([]);
  });

  it('refuses a non-empty folder, never recursively, and leaves its contents in place', async () => {
    const root = await freshRoot();
    await mkdir(join(root, '.olea', 'concepts'), { recursive: true });
    await writeFile(join(root, '.olea', 'concepts', 'key-1.json'), '{"key":1}\n', 'utf8');
    const vault = new FolderSource(root);

    await expect(vault.removeEmptyFolder?.('.olea/concepts')).rejects.toThrow();

    await expect(readdir(join(root, '.olea', 'concepts'))).resolves.toEqual(['key-1.json']);
  });

  it('is a no-op, never a throw, on a folder that does not exist', async () => {
    const root = await freshRoot();
    const vault = new FolderSource(root);

    await expect(vault.removeEmptyFolder?.('.olea/never-existed')).resolves.toBeUndefined();
  });
});
