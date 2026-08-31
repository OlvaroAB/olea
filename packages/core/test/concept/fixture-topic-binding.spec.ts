// PERMANENT SUITE — F1.4 / C7.2 / R1 / R2, against the synthetic fixture vault.
//
// `src/concept/extract.spec.ts` proves the wikilink-topic dereference
// (`ol-aq2p`) on *synthetic temp vaults* built inside the test. That is the
// right place for the R1/R2 edge cases, but it left a standing gap: the fixture
// vault — the corpus every other suite and every downstream lane runs against —
// carried `topic:` values as bare strings only, so the dereference path was
// never exercised by the committed corpus at all. Her live convention writes
// `topic: [[Concept]]`, so the corpus was missing the shape the real vault
// actually uses.
//
// This suite closes that gap and pins it open. It asserts two things:
//
//   1. The fixture vault really does carry wikilink-shaped `topic:` values —
//      one flow list mixing a wikilink with a plain string, one block list
//      whose items are wikilinks (bare and quoted). Read out of the vault, so
//      deleting the fixture fails here rather than silently shrinking a loop.
//   2. Those values bind to **the same concept a plain string binds to** — not
//      merely "to some concept". The proof is that each such concept's
//      `sourcePaths` contains both the note that wrote it as a wikilink and a
//      different note that wrote the same name as a bare string. Two notes
//      landing in one record is what "the same concept" means here, and it is
//      not something a test can fake by restating the name.
//
// Deliberately not asserted: any tier-1 binding. The fixture vault's `topic`
// vocabulary and its Zettelkasten titles are different grains on purpose
// (see fixtures/vault/README.md, and `extract.spec.ts`'s "none of the fixture
// vault topics bind to a tier-1 Zettelkasten note"), so a wikilink `topic`
// value here dereferences and then resolves at tier 2. Making one of these
// point at a Zettelkasten title to force tier 1 would silently rewrite the
// tier-3 mint's negative case as a side effect.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/block/parse.js';
import { extractConcepts } from '../../src/concept/extract.js';
import type { ConceptRecord } from '../../src/concept/types.js';
import { parseFrontmatter } from '../../src/frontmatter/parse.js';
import { readList, wikilinkTarget } from '../../src/frontmatter/read.js';
import { FolderSource } from '../../src/vault/folder-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vaultRoot = join(__dirname, '..', '..', 'fixtures', 'vault');

/** The note whose `topic:` is a flow list mixing a wikilink and a plain string. */
const FLOW_LIST_NOTE = '01 Courses/GEOL204/WEEK 1/Lecture - Clast Provenance and Imbrication.md';
/** The note whose `topic:` is a block list of wikilink items, one quoted and one bare. */
const BLOCK_LIST_NOTE = '01 Courses/MUSTH104/Sonatina in D/Exposition Summary.md';

function readTopicRaw(relPath: string): string {
  const source = readFileSync(join(vaultRoot, relPath), 'utf8');
  const block = parseDocument(source).blocks[0];
  if (block?.kind !== 'frontmatter') throw new Error(`fixture has no frontmatter: ${relPath}`);
  const entry = parseFrontmatter(block.inner).nodes.find(
    (node) => node.kind === 'entry' && node.key === 'topic',
  );
  if (entry?.kind !== 'entry') throw new Error(`fixture has no \`topic\` property: ${relPath}`);
  return entry.valueRaw;
}

/** The `topic` items of a fixture note, exactly as `extract.ts` reads them. */
function readTopicItems(relPath: string): readonly string[] {
  const source = readFileSync(join(vaultRoot, relPath), 'utf8');
  const block = parseDocument(source).blocks[0];
  if (block?.kind !== 'frontmatter') throw new Error(`fixture has no frontmatter: ${relPath}`);
  return readList(parseFrontmatter(block.inner), 'topic').items;
}

describe('the fixture vault carries wikilink-shaped `topic` values', () => {
  it('one note writes `topic` as a flow list mixing a wikilink with a plain string', () => {
    const raw = readTopicRaw(FLOW_LIST_NOTE);
    const items = readTopicItems(FLOW_LIST_NOTE);
    expect(raw).toContain('[[');
    // The mix is the point: one item dereferences, the other is already a name.
    expect(items.filter((item) => wikilinkTarget(item) !== undefined)).toHaveLength(1);
    expect(items.filter((item) => wikilinkTarget(item) === undefined)).toHaveLength(1);
  });

  it('one note writes `topic` as a block list of wikilink items, bare and quoted', () => {
    const raw = readTopicRaw(BLOCK_LIST_NOTE);
    const items = readTopicItems(BLOCK_LIST_NOTE);
    expect(raw).toContain('\n  - ');
    expect(raw).toContain('"[[');
    expect(items).toHaveLength(2);
    expect(items.every((item) => wikilinkTarget(item) !== undefined)).toBe(true);
  });
});

describe('a wikilink `topic` value binds to the same concept a plain string does', () => {
  let concepts: readonly ConceptRecord[];

  beforeAll(async () => {
    concepts = await extractConcepts(new FolderSource(vaultRoot));
  });

  it('no concept name survives with wikilink syntax still in it', () => {
    // The failure this catches is the one that leaves `[[Sediment provenance]]`
    // and `Sediment provenance` as two different concepts — a silent split
    // rather than an error, invisible to anything downstream that just counts.
    for (const concept of concepts) {
      expect(concept.name).not.toContain('[[');
      expect(concept.name).not.toContain(']]');
    }
  });

  for (const [label, relPath] of [
    ['flow list', FLOW_LIST_NOTE],
    ['block list', BLOCK_LIST_NOTE],
  ] as const) {
    it(`every dereferenced ${label} topic resolves to a real concept naming that note`, () => {
      const targets = readTopicItems(relPath).map((item) => wikilinkTarget(item) ?? item);
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        const concept = concepts.find((c) => c.name === target);
        expect(concept, `no concept named ${JSON.stringify(target)}`).toBeDefined();
        expect(concept?.sourcePaths).toContain(relPath);
      }
    });
  }

  it('a wikilink-written topic and a plain-string-written topic land in ONE record', () => {
    // The actual claim of this suite. For each note that writes a topic as a
    // wikilink, at least one of its topics must also be written as a bare
    // string by some *other* note — and both notes must appear in the same
    // concept's `sourcePaths`. If the dereference regressed, the wikilink note
    // would form its own `[[...]]`-named record and this would fail with the
    // plain-string note alone in the list.
    let merged = 0;
    for (const relPath of [FLOW_LIST_NOTE, BLOCK_LIST_NOTE]) {
      const wikilinkTargets = readTopicItems(relPath)
        .map((item) => wikilinkTarget(item))
        .filter((target): target is string => target !== undefined);

      for (const target of wikilinkTargets) {
        const concept = concepts.find((c) => c.name === target);
        const others = (concept?.sourcePaths ?? []).filter((p) => p !== relPath);
        if (others.length === 0) continue;

        // Confirm the other note really did write it as a bare string, rather
        // than as a second wikilink — otherwise this proves links merge with
        // links, which is not the claim.
        const plainElsewhere = others.some((other) =>
          readTopicItems(other).some((item) => item === target),
        );
        if (!plainElsewhere) continue;

        expect(concept?.sourcePaths).toContain(relPath);
        merged += 1;
      }
    }
    // Counted, not just looped: a loop that never ran would otherwise report
    // success. Both fixture notes above contribute one such concept.
    expect(merged).toBeGreaterThanOrEqual(2);
  });
});
