/**
 * `ol-egov.141.89.10.52` — concept keys must be conserved (`[D-088]`) on a host whose `list()`
 * cannot see a dot-prefixed folder.
 *
 * `ObsidianSource.list()` is built on Obsidian's `vault.getFiles()`, which never returns a
 * dot-prefixed path, so `list({ under: '.olea/concepts' })` is always empty there — on a real
 * host and in the workbench's Obsidian shim alike (`vault-shim.ts`'s `getFiles`, `ol-3ux7.64.21`).
 * The same class's `listUnder()` walks the raw adapter instead (`ol-2zfj.44`,
 * `packages/plugin/src/vault/dot-folder-walk.ts`). `HiddenDotListSource` below reproduces exactly
 * that split over a real folder: `list()` drops every dot-prefixed path, `listUnder()` walks them,
 * and read/write/exists go straight through. Every existing key-store test runs over a plain
 * `FolderSource`, whose `list({ under })` DOES see a dot folder (it starts its walk there), which
 * is why none of them caught the re-mint.
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../vault/types.js';
import { extractConcepts } from './extract.js';
import {
  bindConceptKeyToNote,
  CONCEPT_KEY_STORE_FOLDER,
  listConceptKeyRecords,
  resolveConceptKey,
} from './key-store.js';

function isDotPath(path: VaultPath): boolean {
  return path.split('/')[0]?.startsWith('.') ?? false;
}

/** `list()` hides dot-prefixed paths as `ObsidianSource.list()` does; `listUnder()` walks them. */
class HiddenDotListSource implements VaultSource {
  constructor(private readonly inner: FolderSource) {}

  async list(options?: ListOptions): Promise<readonly VaultPath[]> {
    return (await this.inner.list(options)).filter((path) => !isDotPath(path));
  }

  listUnder(
    dotPath: VaultPath,
    options?: { readonly extensions?: readonly string[] },
  ): Promise<readonly VaultPath[]> {
    return this.inner.listUnder(dotPath, options);
  }

  read(path: VaultPath): Promise<string> {
    return this.inner.read(path);
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.inner.readBinary(path);
  }

  write(path: VaultPath, content: string): Promise<void> {
    return this.inner.write(path, content);
  }

  exists(path: VaultPath): Promise<boolean> {
    return this.inner.exists(path);
  }

  delete(path: VaultPath): Promise<void> {
    return this.inner.delete(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }
}

describe('concept keys on a host whose list() hides dot folders (ol-egov.141.89.10.52)', () => {
  let root: string;
  let source: HiddenDotListSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-key-store-hidden-dot-'));
    source = new HiddenDotListSource(new FolderSource(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  /** Files actually on disk under `.olea/concepts/`, independent of any listing this test is about. */
  async function recordFilesOnDisk(): Promise<number> {
    try {
      return (await readdir(join(root, ...CONCEPT_KEY_STORE_FOLDER.split('/')))).length;
    } catch {
      return 0;
    }
  }

  it('the model is faithful: list() cannot see .olea/concepts, listUnder() can', async () => {
    await write('.olea/concepts/concept-key1%3Aa.json', '{}\n');
    await write('01 Courses/COURSEA/Note.md', '# Note\n');

    expect(await source.list({ under: CONCEPT_KEY_STORE_FOLDER })).toEqual([]);
    expect(await source.list()).toEqual(['01 Courses/COURSEA/Note.md']);
    expect(await source.listUnder(CONCEPT_KEY_STORE_FOLDER)).toEqual([
      '.olea/concepts/concept-key1%3Aa.json',
    ]);
  });

  it('resolveConceptKey reads an existing record back instead of minting a second one', async () => {
    const anchor = {
      kind: 'topic' as const,
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    };
    const first = await resolveConceptKey(source, 2, anchor);
    const second = await resolveConceptKey(source, 2, anchor);

    expect(second).toBe(first);
    expect(await listConceptKeyRecords(source)).toHaveLength(1);
    expect(await recordFilesOnDisk()).toBe(1);
  });

  it('a second extraction reuses the first run keys and writes no new record files', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage\n\nDefinition, hers.\n',
    );
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [[Quartz cleavage]]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    await write(
      '01 Courses/COURSEA/Other.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Other\n',
    );

    const first = await extractConcepts(source, { stampConceptKeys: true });
    const firstKeys = new Map(first.map((c) => [c.name, c.key]));
    const filesAfterFirst = await recordFilesOnDisk();
    expect(filesAfterFirst).toBeGreaterThan(0);

    const second = await extractConcepts(source, { stampConceptKeys: true });
    expect(new Map(second.map((c) => [c.name, c.key]))).toEqual(firstKeys);
    expect(await recordFilesOnDisk()).toBe(filesAfterFirst);
  });

  it('bindConceptKeyToNote finds the record it rebinds', async () => {
    const key = await resolveConceptKey(source, 2, {
      kind: 'topic',
      course: 'COURSEA',
      name: 'Basalt weathering',
      aliases: [],
    });
    await expect(
      bindConceptKeyToNote(source, key, {
        kind: 'note',
        noteUid: null,
        notePath: '05 Zettelkasten/Basalt weathering.md',
      }),
    ).resolves.toBeUndefined();
    expect(await recordFilesOnDisk()).toBe(1);
  });
});
