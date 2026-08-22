// PERMANENT SUITE — INV-2, P2-T04 / P2-T05. The sibling of
// test/frontmatter/golden.spec.ts, for the *body* half of the round-trip
// engine. Per CLAUDE.md's INV-2 entry this suite is **never pruned, only
// extended**: a new instrument format, or a new nasty note shape a real vault
// turns up, gets a new case here and no existing case is deleted or weakened.
//
// What it proves, over every fixture note in the repo rather than over a
// hand-picked example:
//
//   1. Reading is not writing. Parsing a note and applying no edits returns the
//      file byte-for-byte, whatever is in it.
//   2. Every instrument write — create a Q&A card, create a cloze, insert an
//      MCQ block — changes exactly the bytes it says it changes. Subtract the
//      reported spans and the original file is back, byte-for-byte.
//   3. Every MCQ in the golden set survives parse → serialize unchanged.
//
// Assertions are structural, never content: the fixture vocabulary has been
// renamed twice (`ol-yj9`), and a golden suite that hardcodes the words is a
// golden suite that breaks on the next rename and invites someone to paste the
// new ones in from a private source.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyDocumentEdits, removeSpans } from '../../src/block/edit.js';
import { parseDocument } from '../../src/block/parse.js';
import { isLossless } from '../../src/block/types.js';
import { createClozeCard, createQaCard } from '../../src/instrument/card-format.js';
import {
  insertMcqBlock,
  parseMcqBlocks,
  serializeMcqInstrument,
} from '../../src/instrument/mcq-format.js';
import { MIN_DISTRACTOR_POOL } from '../../src/instrument/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, '..', '..', 'fixtures');
const vaultRoot = join(fixturesRoot, 'vault');
const instrumentsRoot = join(fixturesRoot, 'instruments');

function walkMarkdownFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkMarkdownFiles(full, acc);
    else if (entry.toLowerCase().endsWith('.md')) acc.push(full);
  }
  return acc;
}

interface Note {
  readonly relPath: string;
  readonly source: string;
}

const notes: Note[] = [...walkMarkdownFiles(vaultRoot), ...walkMarkdownFiles(instrumentsRoot)]
  .sort()
  .map((file) => ({ relPath: relative(fixturesRoot, file), source: readFileSync(file, 'utf8') }));

/**
 * The fixture notes that contain no paragraph and no list at all — one is
 * entirely Obsidian callouts, the other is a template of headings and empty
 * frontmatter fields. A cloze has nowhere to go in either, which is a fact
 * about those notes rather than a gap in the write path, so they are named
 * here instead of being skipped by a silent `continue`.
 */
const NOTES_WITHOUT_PROSE = [
  'vault/01 Courses/GEOL204/WEEK 3/whirlwind-recap-callouts.md',
  'vault/04 Templates/Lecture Note Template.md',
];

/** The first block a card can be anchored to, or `-1`. */
function firstAnchorable(source: string): number {
  return parseDocument(source).blocks.findIndex(
    (b) => b.kind === 'paragraph' || b.kind === 'list' || b.kind === 'heading',
  );
}

/** A single-line, single-word span inside a paragraph or list item, or `null`. */
function markableSpan(source: string): { start: number; end: number } | null {
  for (const block of parseDocument(source).blocks) {
    if (block.kind !== 'paragraph' && block.kind !== 'list') continue;
    const firstLineEnd = block.raw.indexOf('\n');
    const line = firstLineEnd === -1 ? block.raw : block.raw.slice(0, firstLineEnd);
    const match = /[A-Za-z]{3,}/.exec(line);
    if (!match) continue;
    const start = block.start + match.index;
    return { start, end: start + match[0].length };
  }
  return null;
}

describe('the instrument fixture set', () => {
  it('was actually found, and spans both fixture trees', () => {
    // Guards the walk itself. Every assertion below is a loop; a loop over an
    // empty list passes for the wrong reason, which is the failure mode
    // `ol-inv2vacuity` is named after.
    expect(notes.length).toBeGreaterThanOrEqual(45);
    expect(notes.filter((n) => n.relPath.startsWith('instruments')).length).toBeGreaterThanOrEqual(
      5,
    );
    expect(notes.filter((n) => n.relPath.startsWith('vault')).length).toBeGreaterThanOrEqual(44);
  });
});

describe('reading a note is not writing it', () => {
  for (const { relPath, source } of notes) {
    it(`parse ∘ apply-no-edits is byte-identical: ${relPath}`, () => {
      const doc = parseDocument(source);
      expect(isLossless(doc)).toBe(true);
      expect(applyDocumentEdits(doc, []).content).toBe(source);
    });
  }
});

describe('every instrument write changes exactly what it says it changes (INV-2)', () => {
  let qaWrites = 0;
  let clozeWrites = 0;
  let mcqWrites = 0;

  for (const { relPath, source } of notes) {
    it(`create a Q&A card: ${relPath}`, () => {
      const index = firstAnchorable(source);
      expect(index).toBeGreaterThanOrEqual(0);
      const result = createQaCard({
        source,
        anchorBlockIndex: index,
        front: 'question one',
        back: 'answer one',
        generateBlockId: () => 'goldenid',
      });
      const spans = result.blockIdSpan
        ? [result.insertedSpan, result.blockIdSpan]
        : [result.insertedSpan];
      expect(removeSpans(result.content, spans)).toBe(source);
      qaWrites += 1;
    });

    it(`create a cloze: ${relPath}`, () => {
      const span = markableSpan(source);
      if (!span) {
        // Named, not skipped. A cloze needs prose or an outline item to sit in,
        // and two fixture notes are made entirely of callouts and template
        // placeholders. Listing them here means a *third* one appearing is a
        // failure rather than a silently smaller loop.
        expect(NOTES_WITHOUT_PROSE).toContain(relPath);
        return;
      }
      const result = createClozeCard({ source, spanStart: span.start, spanEnd: span.end });
      expect(removeSpans(result.content, result.delimiterSpans)).toBe(source);
      clozeWrites += 1;
    });

    it(`insert an MCQ block: ${relPath}`, () => {
      const index = firstAnchorable(source);
      const result = insertMcqBlock({
        source,
        afterBlockIndex: index,
        fields: {
          stem: 'which one is it?',
          answer: 'the right one',
          distractors: ['pool one', 'pool two', 'pool three', 'pool four'],
        },
      });
      expect(removeSpans(result.content, [result.insertedSpan])).toBe(source);
      mcqWrites += 1;
    });
  }

  it('every write path actually ran on the whole set', () => {
    // The counts are the anti-vacuity check: a `return` inside one of the
    // loops above, or a fixture set that quietly emptied, shows up here as a
    // number rather than as a suite that passed without doing anything.
    expect(qaWrites).toBe(notes.length);
    expect(mcqWrites).toBe(notes.length);
    expect(clozeWrites).toBe(notes.length - NOTES_WITHOUT_PROSE.length);
  });
});

describe('every MCQ in the golden set survives parse → serialize', () => {
  const withMcq = notes
    .map((note) => ({ ...note, parsed: parseMcqBlocks(note.source) }))
    .filter((n) => n.parsed.instruments.length > 0 || n.parsed.invalid.length > 0);

  it('the golden set contains both valid and invalid MCQ blocks', () => {
    expect(withMcq.some((n) => n.parsed.instruments.length > 0)).toBe(true);
    expect(withMcq.some((n) => n.parsed.invalid.length > 0)).toBe(true);
  });

  for (const { relPath, source, parsed } of withMcq) {
    it(`byte-identical round-trip for every valid block, and every invalid one located: ${relPath}`, () => {
      for (const instrument of parsed.instruments) {
        expect(source.slice(instrument.span.start, instrument.span.end)).toBe(instrument.raw);
        expect(instrument.distractors.length).toBeGreaterThanOrEqual(MIN_DISTRACTOR_POOL);
        // The one exception is the deliberately non-canonical hand-typed
        // fixture, which exists to prove that reading does not reformat.
        const canonical = serializeMcqInstrument(instrument);
        if (!relPath.includes('hand-typed')) {
          expect(canonical).toBe(instrument.raw);
        } else {
          expect(canonical).not.toBe(instrument.raw);
        }
      }
      for (const entry of parsed.invalid) {
        expect(source.slice(entry.span.start, entry.span.end)).toBe(entry.raw);
      }
    });
  }
});
