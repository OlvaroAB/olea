// The bead's single most important test (P1-T01): `parseDocument` composed
// with `isLossless` must hold over EVERY markdown file in the synthetic
// fixture vault, not a hand-picked subset. The walk is dynamic —
// `packages/core/fixtures/vault/**/*.md` — specifically so a fixture added
// later (a new nasty case, a new regression) is covered automatically
// without anyone remembering to update a list here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/block/parse.js';
import { isLossless } from '../../src/block/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/test/block -> packages/core/fixtures/vault
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

describe('parseDocument + isLossless over the entire fixture vault', () => {
  const files = walkMarkdownFiles(vaultRoot).sort();

  it('the walk actually found the vault (sanity check on the walk itself)', () => {
    // 43 .md files existed when this test was written, plus the callout
    // fixture this bead adds — guard against a silently-empty walk (wrong
    // path, vault moved) rather than a moving target.
    expect(files.length).toBeGreaterThanOrEqual(44);
  });

  for (const file of files) {
    const relPath = relative(vaultRoot, file);
    it(`round-trips byte-for-byte: ${relPath}`, () => {
      const source = readFileSync(file, 'utf8');
      const doc = parseDocument(source);

      // The invariant itself, stated directly (not just via the predicate)
      // so a failure here shows the concatenation mismatch immediately.
      expect(doc.blocks.map((b) => b.raw).join('')).toBe(source);
      expect(isLossless(doc)).toBe(true);
    });
  }
});
