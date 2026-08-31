// PERMANENT SUITE — INV-2, P1-T02. This suite is the reason G1 is a hard
// gate: it is the byte-identity proof that editing a real student's vault
// does not silently corrupt it. Per the P1-T02 task card and CLAUDE.md's
// INV-2 entry, this suite is **never pruned, only extended** — a fixture
// added later (a new nasty case a real vault turns up, per P1-T08) gets a
// new case here, and no existing case here is ever deleted or weakened.
//
// Two layers:
//   1. A dynamic walk of every `packages/core/fixtures/vault/**/*.md` file
//      (no hardcoded list, so new fixtures are covered automatically),
//      asserting `serializeFrontmatter(parseFrontmatter(inner)) === inner`
//      byte-for-byte, plus `isFrontmatterLossless`.
//   2. The nasty cases named in fixtures/vault/README.md's "Nasty cases"
//      section, individually named and asserted against their exact
//      documented shape — so a regression here fails with a name that
//      points straight back to the README entry describing why it matters.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/block/parse.js';
import type { FrontmatterBlock } from '../../src/block/types.js';
import { parseFrontmatter } from '../../src/frontmatter/parse.js';
import { serializeFrontmatter } from '../../src/frontmatter/serialize.js';
import { isFrontmatterLossless } from '../../src/frontmatter/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/test/frontmatter -> packages/core/fixtures/vault
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

function findFrontmatterBlock(source: string): FrontmatterBlock | undefined {
  const doc = parseDocument(source);
  const block = doc.blocks[0];
  return block?.kind === 'frontmatter' ? block : undefined;
}

interface FixtureResult {
  readonly file: string;
  readonly relPath: string;
  readonly fmBlock: FrontmatterBlock | undefined;
}

describe('frontmatter round-trip — every fixture file in the vault', () => {
  const files = walkMarkdownFiles(vaultRoot).sort();

  it('the walk actually found the vault (sanity check on the walk itself)', () => {
    // 44 .md files existed when P1-T01's vault-lossless suite was written;
    // this suite must see at least as many, or the walk itself is broken.
    expect(files.length).toBeGreaterThanOrEqual(44);
  });

  const results: FixtureResult[] = files.map((file) => ({
    file,
    relPath: relative(vaultRoot, file),
    fmBlock: findFrontmatterBlock(readFileSync(file, 'utf8')),
  }));

  const withFrontmatter = results.filter(
    (r): r is FixtureResult & { fmBlock: FrontmatterBlock } => r.fmBlock !== undefined,
  );
  const withoutFrontmatter = results.filter((r) => r.fmBlock === undefined);

  it('covers files both with and without frontmatter (sanity on the split)', () => {
    // Guards against the split itself going silently empty on one side —
    // e.g. a frontmatter-detection regression that makes every file look
    // frontmatter-less would otherwise pass every test below vacuously.
    expect(withFrontmatter.length).toBeGreaterThan(0);
    expect(withoutFrontmatter.length).toBeGreaterThan(0);
    expect(withFrontmatter.length + withoutFrontmatter.length).toBe(files.length);
  });

  for (const { relPath, fmBlock } of withoutFrontmatter) {
    // Files without frontmatter are handled explicitly, not skipped
    // silently: this assertion is the record that they were looked at.
    it(`has no frontmatter block (handled, not skipped): ${relPath}`, () => {
      expect(fmBlock).toBeUndefined();
    });
  }

  for (const { relPath, fmBlock } of withFrontmatter) {
    it(`parseFrontmatter ∘ serializeFrontmatter is byte-identical: ${relPath}`, () => {
      const fm = parseFrontmatter(fmBlock.inner);
      expect(serializeFrontmatter(fm)).toBe(fmBlock.inner);
      expect(isFrontmatterLossless(fm)).toBe(true);
    });
  }
});

describe('frontmatter round-trip — named nasty cases (fixtures/vault/README.md)', () => {
  function readInner(relPath: string): string {
    const source = readFileSync(join(vaultRoot, relPath), 'utf8');
    const block = findFrontmatterBlock(source);
    if (!block) throw new Error(`fixture has no frontmatter block: ${relPath}`);
    return block.inner;
  }

  it('bare space-separated multi-wikilink — the shape PyYAML cannot even load (Norling)', () => {
    const inner = readInner('03 Research/Norling 2019 - Turbidite Bedform Successions.md');
    const fm = parseFrontmatter(inner);
    const related = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'related');
    expect(related?.kind).toBe('entry');
    if (related?.kind === 'entry') {
      expect(related.valueRaw).toBe('[[Imbrication]] [[Hummocky stratification]]\n');
    }
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it("flow-list wikilinks — PyYAML's silent-corruption shape [[[A]], [[B]]] (Vance)", () => {
    const inner = readInner('03 Research/Vance 2020 - Grainsize Fining Models.md');
    const fm = parseFrontmatter(inner);
    const related = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'related');
    expect(related?.kind).toBe('entry');
    if (related?.kind === 'entry') {
      expect(related.valueRaw).toBe('[[[Imbrication]], [[Bioturbation]]]\n');
    }
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('quoted wikilink — quoting style preserved exactly (Petrov)', () => {
    const inner = readInner(
      '03 Research/Petrov & Adeyemi 2021 - Chromatic Harmony in Keyboard Chorales.md',
    );
    const fm = parseFrontmatter(inner);
    const related = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'related');
    expect(related?.kind).toBe('entry');
    if (related?.kind === 'entry') {
      expect(related.valueRaw).toBe('"[[Deceptive cadence]]"\n');
    }
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('block-style `- [[A]]` list across continuation lines (Halloran)', () => {
    const inner = readInner(
      '03 Research/Halloran 2018 - Chorale Doubling in Keyboard Realisation.md',
    );
    const fm = parseFrontmatter(inner);
    const related = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'related');
    expect(related?.kind).toBe('entry');
    if (related?.kind === 'entry') {
      expect(related.raw).toBe('related:\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n');
      expect(related.valueRaw).toBe('\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n');
    }
    // The block-list continuation lines must not have become their own
    // passthrough nodes — they belong to `related`'s entry.
    expect(fm.nodes.filter((n) => n.kind === 'other')).toHaveLength(0);
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('non-alphabetical key order preserved (a YAML round-trip would re-sort)', () => {
    const inner = readInner('00 Daily notes/2026-08-10.md');
    const fm = parseFrontmatter(inner);
    const keys = fm.nodes
      .filter((n) => n.kind === 'entry')
      .map((n) => (n.kind === 'entry' ? n.key : ''));
    expect(keys).toEqual(['date', 'courses-today', 'status']);
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('mixed quoting within one file — bare, single-quoted, double-quoted, all preserved (Petrov)', () => {
    const inner = readInner(
      '03 Research/Petrov & Adeyemi 2021 - Chromatic Harmony in Keyboard Chorales.md',
    );
    const fm = parseFrontmatter(inner);
    const byKey = new Map(
      fm.nodes.filter((n) => n.kind === 'entry').map((n) => [n.kind === 'entry' ? n.key : '', n]),
    );
    expect(byKey.get('citekey')?.valueRaw).toBe('petrov2021chromatic\n');
    expect(byKey.get('authors')?.valueRaw).toBe("['A. Petrov', 'K. Adeyemi']\n");
    expect(byKey.get('year')?.valueRaw).toBe('"2021"\n');
    expect(byKey.get('related')?.valueRaw).toBe('"[[Deceptive cadence]]"\n');
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('empty-string value and empty list, both preserved exactly (Phrase One - Aural Study)', () => {
    const inner = readInner('01 Courses/MUSTH104/Chorale No. 12/Phrase One - Aural Study.md');
    const fm = parseFrontmatter(inner);
    const byKey = new Map(
      fm.nodes.filter((n) => n.kind === 'entry').map((n) => [n.kind === 'entry' ? n.key : '', n]),
    );
    expect(byKey.get('subtitle')?.valueRaw).toBe('""\n');
    expect(byKey.get('related')?.valueRaw).toBe('[]\n');
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('the CRLF case — line endings inside frontmatter survive (Reyes, real fixture)', () => {
    // The vault's designated CRLF-only fixture (Aural notes.md, above) has
    // no frontmatter block at all, so this reads the dedicated CRLF ×
    // frontmatter fixture instead — the file this suite's dynamic walk
    // (top of this describe block) also exercises, asserted here by name so
    // a regression points straight back to this comment.
    const inner = readInner('03 Research/Reyes 2023 - Paraconformity and Erosive Amalgamation.md');
    const fm = parseFrontmatter(inner);
    expect(serializeFrontmatter(fm)).toBe(inner);
    expect(isFrontmatterLossless(fm)).toBe(true);
    // Counted, not just looped. An assertion inside a conditional inside a
    // loop passes when the loop body never runs, which is DF-18's failure in
    // a different costume: a check that reports success because it never
    // executed. A mutation that collapsed nodes so none spanned a line would
    // have left this green while destroying the CRLF invariant it names.
    // Asserting the count is what makes the check unfalsifiable-by-vacancy.
    let multiLineNodes = 0;
    for (const node of fm.nodes) {
      if (node.raw.includes('\n')) {
        multiLineNodes += 1;
        expect(node.raw.includes('\r\n')).toBe(true);
      }
    }
    expect(multiLineNodes).toBeGreaterThan(0);
    // The mixed bare/quoted wikilink block-list items, byte-exact.
    const related = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'related');
    expect(related?.kind).toBe('entry');
    if (related?.kind === 'entry') {
      expect(related.valueRaw).toBe(
        '\r\n  - [[Paraconformity]]\r\n  - "[[Hummocky stratification]]"\r\n',
      );
    }
  });

  it('a note with no frontmatter at all is handled, not force-fit (scratch-thoughts)', () => {
    const source = readFileSync(
      join(vaultRoot, '01 Courses/GEOL204/WEEK 3/scratch-thoughts.md'),
      'utf8',
    );
    expect(findFrontmatterBlock(source)).toBeUndefined();
  });

  it('a `---` inside a fenced code block is not mistaken for the frontmatter close (lab-protocol-notes)', () => {
    const inner = readInner('01 Courses/GEOL204/WEEK 3/lab-protocol-notes.md');
    // The real frontmatter here is small; the fenced example data's two
    // `---` lines must not have been swallowed into it.
    expect(inner).toBe('topic: [Diagenetic burial]\ncourse: GEOL204\nweek: 3\ntype: lab-notes\n');
    const fm = parseFrontmatter(inner);
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('an empty inline value with a trailing separator space round-trips (Lecture Note Template)', () => {
    const inner = readInner('04 Templates/Lecture Note Template.md');
    const fm = parseFrontmatter(inner);
    const byKey = new Map(
      fm.nodes.filter((n) => n.kind === 'entry').map((n) => [n.kind === 'entry' ? n.key : '', n]),
    );
    // `course: ` and `week: ` each have exactly one trailing space (the
    // separator) and nothing else — the value is empty, not the space.
    expect(byKey.get('course')?.valueRaw).toBe('\n');
    expect(byKey.get('week')?.valueRaw).toBe('\n');
    expect(serializeFrontmatter(fm)).toBe(inner);
  });
});
