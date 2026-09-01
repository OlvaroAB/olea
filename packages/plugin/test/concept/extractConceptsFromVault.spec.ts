/**
 * `extractConceptsFromVault` tests (`ol-2zfj.44`) — the seam that flips
 * `stampConceptKeys` on by default for every plugin-side extraction over her
 * real vault (`ol-2zfj.42`, `[D-174]`). Minting/re-mint correctness itself is
 * `olea-core`'s own coverage (`packages/core/src/concept/key-store.spec.ts`,
 * "extractConcepts — wired through the [D-174] sidecar when stampConceptKeys
 * is on") — this file only proves the wrapper's default-on/opt-out contract.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderSource } from 'olea-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractConceptsFromVault } from '../../src/concept/wiring.js';

describe('extractConceptsFromVault', () => {
  let root: string;
  let source: FolderSource;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'olea-extract-concepts-from-vault-'));
    source = new FolderSource(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(relPath: string, content: string): Promise<void> {
    const full = join(root, ...relPath.split('/'));
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  it('stamps concept keys by default — one sidecar minted under .olea/concepts/ on first extraction', async () => {
    await write(
      '05 Zettelkasten/Quartz cleavage.md',
      '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage\n\nDefinition, hers.\n',
    );
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Note\n',
    );

    const first = await extractConceptsFromVault(source);
    const key = first.find((c) => c.name === 'Quartz cleavage')?.key;
    expect(key).toBeDefined();

    const sidecars = await source.listUnder('.olea/concepts');
    expect(sidecars).toHaveLength(1);

    // A second extraction resolves to the SAME key rather than minting again.
    const second = await extractConceptsFromVault(source);
    expect(second.find((c) => c.name === 'Quartz cleavage')?.key).toBe(key);
    expect(await source.listUnder('.olea/concepts')).toHaveLength(1);
  });

  it('an explicit stampConceptKeys: false opts back out — no sidecar written', async () => {
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Basalt weathering]\ncourse: COURSEA\n---\n\n# Note\n',
    );

    await extractConceptsFromVault(source, { stampConceptKeys: false });

    expect(await source.listUnder('.olea/concepts')).toHaveLength(0);
  });

  it('leaves her authored notes byte-identical — only the sidecar is written', async () => {
    const noteContent =
      '---\ntype: concept\nolea-uid: uid-quartz\n---\n\n# Quartz cleavage\n\nDefinition, hers.\n';
    await write('05 Zettelkasten/Quartz cleavage.md', noteContent);
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [Quartz cleavage]\ncourse: COURSEA\n---\n\n# Note\n',
    );

    await extractConceptsFromVault(source);

    expect(await source.read('05 Zettelkasten/Quartz cleavage.md')).toBe(noteContent);
  });

  it('forwards other ExtractConceptsOptions through unchanged (e.g. under)', async () => {
    await write(
      '01 Courses/COURSEA/Note.md',
      '---\ntopic: [In scope]\ncourse: COURSEA\n---\n\n# Note\n',
    );
    await write(
      '01 Courses/COURSEB/Note.md',
      '---\ntopic: [Out of scope]\ncourse: COURSEB\n---\n\n# Note\n',
    );

    const concepts = await extractConceptsFromVault(source, { under: '01 Courses/COURSEA' });

    expect(concepts.map((c) => c.name)).toEqual(['In scope']);
  });
});
