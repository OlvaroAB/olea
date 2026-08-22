// PERMANENT SUITE — INV-2's sibling on the *content* side, for P2-T04 / P2-T05.
//
// `test/instrument/golden.spec.ts` proves that every instrument write changes
// exactly the bytes it says it changes, over whatever notes happen to be in the
// fixture trees. It is deliberately structural, and it passes just as happily
// over a vault containing **no instruments at all** — which is exactly what the
// fixture vault was until this suite's fixtures were added. A round-trip proof
// over an empty set is the `ol-inv2vacuity` failure mode again, one level up.
//
// So this suite asserts the opposite thing: that the fixture vault actually
// *carries* instruments, in every format the two format modules implement, and
// that they are distributed across both fixture courses and across several
// concepts. Everything downstream of parsing — queue composition, the review
// view, the workbench, the end-to-end session proof — needs a corpus with real
// instruments in it, and needs that corpus to keep having them.
//
// Assertions are counts, styles, delimiters and pool sizes — never the fixture
// vocabulary itself. The fixture courses have been rebuilt once already
// (`ol-snpq`/`ol-vs57`) and a suite that hardcoded the words would have broken
// on that rebuild and invited someone to paste the new ones in from a private
// source. The one place a name appears below it is read out of the vault at run
// time, never written here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractConcepts } from '../../src/concept/extract.js';
import { parseCards } from '../../src/instrument/card-format.js';
import { parseMcqBlocks } from '../../src/instrument/mcq-format.js';
import type { CardInstrument, ClozeDelimiter, QaCardStyle } from '../../src/instrument/types.js';
import { MIN_DISTRACTOR_POOL } from '../../src/instrument/types.js';
import { FolderSource } from '../../src/vault/folder-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vaultRoot = join(__dirname, '..', '..', 'fixtures', 'vault');

function walkMarkdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkMarkdownFiles(full, acc);
    else if (entry.toLowerCase().endsWith('.md')) acc.push(full);
  }
  return acc;
}

interface Note {
  /** Vault-relative, POSIX-separated, so it matches `ConceptRecord.sourcePaths`. */
  readonly relPath: string;
  readonly source: string;
}

/**
 * The vault's own index file. It is documentation *about* the fixtures rather
 * than a fixture note, and it necessarily quotes the card separators it
 * documents — `::`, `:::`, `==…==` — so `parseCards` reads real cards out of
 * it. Those are an artefact of the prose, not instruments in the corpus, and
 * counting them would inflate every number below and break the "every
 * instrument-bearing note binds to a concept" claim (the README has no
 * frontmatter at all).
 *
 * Excluded by name rather than by a `startsWith('README')` rule, so a second
 * README appearing somewhere in the vault is a visible decision here instead
 * of being silently swallowed. The round-trip suites deliberately keep reading
 * it — INV-2 applies to every byte in the tree, this suite's subject does not.
 */
const NOT_A_FIXTURE_NOTE = ['README.md'];

const notes: Note[] = walkMarkdownFiles(vaultRoot)
  .sort()
  .map((file) => ({
    relPath: relative(vaultRoot, file).split(sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }))
  .filter((note) => !NOT_A_FIXTURE_NOTE.includes(note.relPath));

const cardsByNote = new Map<string, readonly CardInstrument[]>(
  notes.map((n) => [n.relPath, parseCards(n.source)]),
);
const mcqByNote = new Map(notes.map((n) => [n.relPath, parseMcqBlocks(n.source)]));

const allCards = [...cardsByNote.values()].flat();
const allMcq = [...mcqByNote.values()].flatMap((r) => r.instruments);
const allInvalidMcq = [...mcqByNote.values()].flatMap((r) => r.invalid);

/** The course a fixture note belongs to, by folder — `01 Courses/<CODE>/...`. */
function courseOf(relPath: string): string | undefined {
  const parts = relPath.split('/');
  return parts[0] === '01 Courses' ? parts[1] : undefined;
}

describe('the fixture vault carries instruments at all', () => {
  it('the walk found the vault (guards every loop below against passing vacuously)', () => {
    expect(notes.length).toBeGreaterThanOrEqual(44);
  });

  it('parseCards finds Q&A and cloze cards in the fixture vault', () => {
    // Before these fixtures existed this was zero, and every suite that
    // loops over the vault's cards passed by looping over nothing.
    expect(allCards.length).toBeGreaterThanOrEqual(11);
    expect(allCards.filter((c) => c.type === 'qa').length).toBeGreaterThanOrEqual(7);
    expect(allCards.filter((c) => c.type === 'cloze').length).toBeGreaterThanOrEqual(4);
  });

  it('covers more than one Q&A style — in fact all four the format defines', () => {
    const styles = new Set<QaCardStyle>(
      allCards.filter((c) => c.type === 'qa').map((c) => c.style),
    );
    expect([...styles].sort()).toEqual([
      'multi-line',
      'multi-line-reversed',
      'single-line',
      'single-line-reversed',
    ]);
  });

  it('covers both cloze delimiters the format recognises', () => {
    const delimiters = new Set<ClozeDelimiter>(
      allCards.filter((c) => c.type === 'cloze').map((c) => c.delimiter),
    );
    expect([...delimiters].sort()).toEqual(['==', '{{']);
  });

  it('parseMcqBlocks finds MCQ blocks and reports no invalid block anywhere in the vault', () => {
    expect(allMcq.length).toBeGreaterThanOrEqual(2);
    // The vault is the *good* corpus: the deliberately-broken MCQ blocks live
    // in `fixtures/instruments/mcq-invalid.md` and belong there. An invalid
    // block appearing here is a typo in a fixture, not a fixture.
    expect(allInvalidMcq).toEqual([]);
  });

  it('every vault MCQ clears the distractor floor, and at least one exceeds it', () => {
    const pools = allMcq.map((m) => m.distractors.length);
    expect(Math.min(...pools)).toBeGreaterThanOrEqual(MIN_DISTRACTOR_POOL);
    expect(Math.max(...pools)).toBeGreaterThan(MIN_DISTRACTOR_POOL);
  });

  it('no fixture instrument carries scheduling data or a foreign SR comment', () => {
    // C5.3: Olea owns scheduling state and never writes the other plugin's
    // comment. A fixture that carried one would make it impossible to tell a
    // read-it-and-leave-it regression from a fixture that always had it.
    for (const card of allCards) {
      expect(card.foreignScheduling).toBeNull();
    }
  });
});

describe('instruments are spread across both courses and several concepts', () => {
  it('both fixture courses carry instruments', () => {
    const courses = new Set<string>();
    for (const { relPath } of notes) {
      const course = courseOf(relPath);
      if (course === undefined) continue;
      const count =
        (cardsByNote.get(relPath)?.length ?? 0) + (mcqByNote.get(relPath)?.instruments.length ?? 0);
      if (count > 0) courses.add(course);
    }
    expect(courses.size).toBe(2);
  });

  it('both courses carry at least one MCQ', () => {
    const courses = new Set<string>();
    for (const { relPath } of notes) {
      if ((mcqByNote.get(relPath)?.instruments.length ?? 0) === 0) continue;
      const course = courseOf(relPath);
      if (course !== undefined) courses.add(course);
    }
    expect(courses.size).toBe(2);
  });

  it('instrument-bearing notes all bind to at least one concept via `topic`', async () => {
    const concepts = await extractConcepts(new FolderSource(vaultRoot));
    const boundPaths = new Set(concepts.flatMap((c) => c.sourcePaths));
    for (const { relPath } of notes) {
      const count =
        (cardsByNote.get(relPath)?.length ?? 0) + (mcqByNote.get(relPath)?.instruments.length ?? 0);
      if (count === 0) continue;
      // An instrument in a note with no `topic` is invisible to queue
      // composition, so a fixture instrument that drifts into an untagged
      // note is a silently useless fixture.
      expect(boundPaths).toContain(relPath);
    }
  });

  it('several concepts carry instruments, and at least one carries two or more', async () => {
    const concepts = await extractConcepts(new FolderSource(vaultRoot));
    const perConcept = concepts.map((concept) => ({
      name: concept.name,
      instruments: concept.sourcePaths.reduce(
        (total, path) =>
          total +
          (cardsByNote.get(path)?.length ?? 0) +
          (mcqByNote.get(path)?.instruments.length ?? 0),
        0,
      ),
    }));

    const withInstruments = perConcept.filter((c) => c.instruments > 0);
    expect(withInstruments.length).toBeGreaterThanOrEqual(4);

    // Per-concept dedupe (R3 is per instrument, selection is per concept) can
    // only be demonstrated where one concept genuinely has more than one
    // instrument to choose between. Without this the dedupe proof downstream
    // would pass on a corpus that never gave it a decision to make.
    const multi = withInstruments.filter((c) => c.instruments >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(1);
  });
});
