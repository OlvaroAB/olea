// PERMANENT SUITE — INV-2, filed as ol-r3uy against ol-inv2remainder's
// finding: the frontmatter and block goldens (test/frontmatter/golden.spec.ts,
// test/block/vault-lossless.spec.ts) read fixtures through `node:fs` directly
// and assert round-trips at the parse/serialise layer only. Neither ever
// calls `FolderSource.write` — the component that actually performs a write
// against a real vault — so a byte-losing mutation to the write path itself
// (trailing-newline append, per-line trailing-whitespace trim, leading-BOM
// strip) could leave both suites green.
//
// This suite closes that gap by routing the entire fixture corpus through
// the real write path: for every `.md` file in `packages/core/fixtures/vault`,
// read it through `FolderSource`, write it back through `FolderSource` to a
// fresh temp root, and assert the bytes landed on disk — and read back
// through `FolderSource` again — are identical to the original. The walk is
// dynamic, so a fixture added later (a new nasty case) is covered
// automatically, same as its sibling goldens.
//
// This is deliberately NOT a replacement for the frontmatter/block goldens,
// which test a different layer (parse ∘ serialise) and stay as they are.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FolderSource } from '../../src/vault/folder-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/test/vault -> packages/core/fixtures/vault
const vaultRoot = join(__dirname, '..', '..', 'fixtures', 'vault');

function walkMarkdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walkMarkdownFiles(full, acc);
    } else if (entry.toLowerCase().endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('FolderSource.write round-trip — every markdown fixture in the vault', () => {
  const files = walkMarkdownFiles(vaultRoot).sort();

  it('the walk actually found the vault (sanity check on the walk itself)', () => {
    // Same threshold as the sibling goldens (test/frontmatter/golden.spec.ts,
    // test/block/vault-lossless.spec.ts) — this suite must see the same
    // corpus, or the walk itself is broken.
    expect(files.length).toBeGreaterThanOrEqual(44);
  });

  const readSource = new FolderSource(vaultRoot);
  let tempRoot: string;
  let writeSource: FolderSource;

  beforeAll(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'olea-vault-write-golden-'));
    writeSource = new FolderSource(tempRoot);
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  for (const file of files) {
    const relPath = relative(vaultRoot, file);
    it(`read -> FolderSource.write -> read is byte-identical: ${relPath}`, async () => {
      const original = readFileSync(file, 'utf8');

      // Read through the real read path, not node:fs, so a read-side
      // regression would show up here too.
      const content = await readSource.read(relPath);
      expect(content).toBe(original);

      // The write path under test: a fresh temp root, through
      // FolderSource.write — not a hand-copied file.
      await writeSource.write(relPath, content);

      // Assert against the raw bytes actually landed on disk, independent of
      // FolderSource's own reader, so a mutation shared between read and
      // write could not hide the loss from itself.
      const rawOnDisk = await readFile(join(tempRoot, relPath), 'utf8');
      expect(rawOnDisk).toBe(original);

      // And through the real read path once more, closing the loop the
      // parse/serialise goldens never reach.
      const readBack = await writeSource.read(relPath);
      expect(readBack).toBe(original);
    });
  }
});
