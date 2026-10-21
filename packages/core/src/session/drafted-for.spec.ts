// Scenarios: features/F3-learn-from-anything.md, the `[D-558]` block of "F3.1 / F3.3 / F3.5 — A bare
// drop with no embedding note gets its own home note": "the record round-trips byte-identically and
// survives the topic list growing" — @auto:core/session/drafted-for.spec
import { describe, expect, it } from 'vitest';
import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readList } from '../frontmatter/read.js';
import { serializeFrontmatter, setEntryValue } from '../frontmatter/serialize.js';
import {
  DRAFTED_FOR_FRONTMATTER_KEY,
  draftedForItemKey,
  readDraftedFor,
  recordDraftedFor,
} from './drafted-for.js';

/** The shape the plugin's `initialHomeNoteContent` writes, after one concept was drafted into it. */
const HOME_NOTE = [
  '---',
  'topic:',
  '  - Coined idea one',
  'olea-home-note: true',
  '---',
  '',
  '*Olea created this note beside `source.pdf`.*',
  '',
].join('\n');

const HER_NOTE = ['---', 'topic: Coined idea one', '---', '', 'Her own prose.', ''].join('\n');

/** The one contiguous run `after` adds to `before`, or `null` when `after` is not `before` plus one insert. */
function insertedRun(before: string, after: string): string | null {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start += 1;
  const tail = before.length - start;
  if (after.slice(after.length - tail) !== before.slice(start)) return null;
  return after.slice(start, after.length - tail);
}

describe('[D-558] draftedForItemKey: the identity an item already carries in the note', () => {
  it("is a multiple-choice block's id and a question-and-answer card's block id", () => {
    expect(
      draftedForItemKey({ instrumentType: 'mcq', explicitId: 'mcq-0a1b', blockId: null }),
    ).toBe('mcq-0a1b');
    expect(draftedForItemKey({ instrumentType: 'qa', explicitId: null, blockId: 'k3x9qa' })).toBe(
      'k3x9qa',
    );
  });

  it('is null for an item with no identity yet, and always for a cloze', () => {
    expect(
      draftedForItemKey({ instrumentType: 'mcq', explicitId: null, blockId: null }),
    ).toBeNull();
    expect(draftedForItemKey({ instrumentType: 'qa', explicitId: null, blockId: '' })).toBeNull();
    expect(
      draftedForItemKey({ instrumentType: 'cloze', explicitId: null, blockId: 'k3x9qa' }),
    ).toBeNull();
  });
});

describe('[D-558] recordDraftedFor / readDraftedFor', () => {
  it('appends one map line to a home note, every other byte untouched, and reads it back', () => {
    const once = recordDraftedFor(HOME_NOTE, 'mcq-0123456789abcdef', 'concept-key1:k-one');
    expect(insertedRun(HOME_NOTE, once)).toBe(
      `${DRAFTED_FOR_FRONTMATTER_KEY}:\n  mcq-0123456789abcdef: concept-key1:k-one\n`,
    );
    const twice = recordDraftedFor(once, 'k3x9qa', 'concept-key1:k-two');
    expect(insertedRun(once, twice)).toBe('  k3x9qa: concept-key1:k-two\n');

    expect([...readDraftedFor(parseDocument(twice))]).toEqual([
      ['mcq-0123456789abcdef', 'concept-key1:k-one'],
      ['k3x9qa', 'concept-key1:k-two'],
    ]);
    // The note's own topic list is untouched by the record.
    const first = parseDocument(twice).blocks[0];
    if (first?.kind !== 'frontmatter') throw new Error('expected frontmatter');
    expect(readList(parseFrontmatter(first.inner), 'topic').items).toEqual(['Coined idea one']);
  });

  it('an item already recorded is a byte-identical no-op, and its first record stands', () => {
    const once = recordDraftedFor(HOME_NOTE, 'mcq-0123456789abcdef', 'concept-key1:k-one');
    expect(recordDraftedFor(once, 'mcq-0123456789abcdef', 'concept-key1:k-one')).toBe(once);
    expect(recordDraftedFor(once, 'mcq-0123456789abcdef', 'concept-key1:other')).toBe(once);
  });

  it('never writes into a note she wrote, and never reads a look-alike entry from one (INV-6)', () => {
    expect(recordDraftedFor(HER_NOTE, 'mcq-0123456789abcdef', 'concept-key1:k-one')).toBe(HER_NOTE);
    const lookAlike = [
      '---',
      'topic: Coined idea one',
      `${DRAFTED_FOR_FRONTMATTER_KEY}:`,
      '  mcq-0123456789abcdef: concept-key1:k-one',
      '---',
      '',
    ].join('\n');
    expect(readDraftedFor(parseDocument(lookAlike)).size).toBe(0);
  });

  it('a home note written before the ruling reads no records', () => {
    expect(readDraftedFor(parseDocument(HOME_NOTE)).size).toBe(0);
  });

  it('leaves a home note unchanged rather than throw when the entry was hand-edited into a scalar', () => {
    const edited = HOME_NOTE.replace(
      'olea-home-note: true\n',
      `olea-home-note: true\n${DRAFTED_FOR_FRONTMATTER_KEY}: something\n`,
    );
    expect(recordDraftedFor(edited, 'mcq-0123456789abcdef', 'concept-key1:k-one')).toBe(edited);
    expect(readDraftedFor(parseDocument(edited)).size).toBe(0);
  });

  it('survives the topic list growing the way the home note grows it, byte for byte', () => {
    const recorded = recordDraftedFor(HOME_NOTE, 'mcq-0123456789abcdef', 'concept-key1:k-one');
    // The plugin's `ensureTopicIncludes`: replace the topic entry, re-serialize every other node.
    const block = parseDocument(recorded).blocks[0];
    if (block?.kind !== 'frontmatter') throw new Error('expected frontmatter');
    const fm = setEntryValue(
      parseFrontmatter(block.inner),
      'topic',
      '\n  - Coined idea one\n  - Coined idea two\n',
    );
    const grown =
      recorded.slice(0, block.start) +
      `---\n${serializeFrontmatter(fm)}---\n` +
      recorded.slice(block.end);

    expect(insertedRun(recorded, grown)).toBe('  - Coined idea two\n');
    expect([...readDraftedFor(parseDocument(grown))]).toEqual([
      ['mcq-0123456789abcdef', 'concept-key1:k-one'],
    ]);
  });
});
