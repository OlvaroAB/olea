/**
 * `listUnderViaAdapter` tests (`ol-2zfj.44`) — the `ol-yk1c` (C5.2a) /
 * `ol-df19` (DF-19) dot-folder listing gap, closed at the Obsidian-host
 * level. This is the pure walk `ObsidianSource.listUnder` delegates to; it
 * has no `obsidian` import, so it runs against a plain fake shaped like
 * `DataAdapter.list`/`.exists` with no real Obsidian host needed.
 */

import { describe, expect, it } from 'vitest';
import { type DotFolderAdapter, listUnderViaAdapter } from '../../src/vault/dot-folder-walk.js';

interface FakeFsNode {
  readonly files: readonly string[];
  readonly folders: readonly string[];
}

function fakeAdapter(fsByDir: Record<string, FakeFsNode>): DotFolderAdapter {
  return {
    async exists(path: string): Promise<boolean> {
      return path in fsByDir;
    },
    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
      const node = fsByDir[path];
      if (node === undefined) throw new Error(`ENOENT: ${path}`);
      return { files: [...node.files], folders: [...node.folders] };
    },
  };
}

describe('listUnderViaAdapter (`ol-2zfj.44`, `ol-yk1c` / C5.2a)', () => {
  it('lists files under a dot-prefixed folder, which vault.getFiles()-based list() cannot see', async () => {
    const adapter = fakeAdapter({
      '.olea/concepts': {
        files: ['.olea/concepts/a.json', '.olea/concepts/b.json'],
        folders: [],
      },
    });

    const paths = await listUnderViaAdapter(adapter, '.olea/concepts');

    expect(paths).toEqual(['.olea/concepts/a.json', '.olea/concepts/b.json']);
  });

  it('recurses into nested (non-dot) folders', async () => {
    const adapter = fakeAdapter({
      '.olea/reviews': { files: [], folders: ['.olea/reviews/device-a'] },
      '.olea/reviews/device-a': {
        files: ['.olea/reviews/device-a/2026-09-01.jsonl'],
        folders: [],
      },
    });

    expect(await listUnderViaAdapter(adapter, '.olea/reviews')).toEqual([
      '.olea/reviews/device-a/2026-09-01.jsonl',
    ]);
  });

  it('still skips a dot-directory nested inside the walked subtree — cannot smuggle out .obsidian/.trash content', async () => {
    const adapter = fakeAdapter({
      '.olea/reviews': { files: ['.olea/reviews/kept.jsonl'], folders: ['.olea/reviews/.trash'] },
      '.olea/reviews/.trash': { files: ['.olea/reviews/.trash/deleted.jsonl'], folders: [] },
    });

    expect(await listUnderViaAdapter(adapter, '.olea/reviews')).toEqual([
      '.olea/reviews/kept.jsonl',
    ]);
  });

  it('filters by extension', async () => {
    const adapter = fakeAdapter({
      '.olea/concepts': {
        files: ['.olea/concepts/a.json', '.olea/concepts/readme.md'],
        folders: [],
      },
    });

    expect(await listUnderViaAdapter(adapter, '.olea/concepts', { extensions: ['json'] })).toEqual([
      '.olea/concepts/a.json',
    ]);
  });

  it('returns [] for a subtree that does not exist, rather than throwing', async () => {
    expect(await listUnderViaAdapter(fakeAdapter({}), '.olea/does-not-exist')).toEqual([]);
  });

  it('rejects a non-dot-prefixed path', async () => {
    await expect(listUnderViaAdapter(fakeAdapter({}), '01 Courses')).rejects.toThrow(
      /dot-prefixed/,
    );
  });

  it('returns results in stable sorted order regardless of adapter enumeration order', async () => {
    const adapter = fakeAdapter({
      '.olea/concepts': {
        files: ['.olea/concepts/z.json', '.olea/concepts/a.json'],
        folders: [],
      },
    });

    expect(await listUnderViaAdapter(adapter, '.olea/concepts')).toEqual([
      '.olea/concepts/a.json',
      '.olea/concepts/z.json',
    ]);
  });
});
