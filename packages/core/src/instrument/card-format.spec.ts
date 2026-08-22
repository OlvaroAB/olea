// Scenarios: features/F2-review.md — "C5.3 — Card format readable by Obsidian
// SR plugins" and "F2.1 — Inline card creation writes through the round-trip
// engine (INV-2)", both tagged `@auto:core/card-format.spec`.
//
// Card text in this file is structural placeholder text ("question one",
// "term A"), never fixture vocabulary. INV-3's fixture vocabulary has been
// renamed twice (`ol-yj9`); a test that hardcodes it breaks on the rename and
// tempts whoever fixes it to paste the new words in from wherever they came
// from. Assertions against the real fixture files below are structural — counts,
// styles, byte identity — for the same reason.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDocumentEdits, removeSpans } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import {
  createClozeCard,
  createQaCard,
  parseCards,
  SR_DEFAULT_DECK_TAG,
  stampQaCardBlockId,
} from './card-format.js';
import type { ClozeCardInstrument, QaCardInstrument } from './types.js';

const INSTRUMENT_FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'instruments');
const VAULT_FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'vault');

function readFixture(name: string): string {
  return readFileSync(join(INSTRUMENT_FIXTURES, name), 'utf8');
}

function walkMarkdown(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkMarkdown(full, acc);
    else if (entry.toLowerCase().endsWith('.md')) acc.push(full);
  }
  return acc;
}

const qa = (cards: readonly unknown[]): QaCardInstrument[] =>
  cards.filter((c): c is QaCardInstrument => (c as { type: string }).type === 'qa');
const cloze = (cards: readonly unknown[]): ClozeCardInstrument[] =>
  cards.filter((c): c is ClozeCardInstrument => (c as { type: string }).type === 'cloze');

describe('parseCards — the four Q&A forms the SR plugin defines', () => {
  it('recognises all four, and marks the reversed ones as reversed', () => {
    const source = [
      'question one::answer one',
      '',
      'term A:::term B',
      '',
      'question two',
      '?',
      'answer two',
      '',
      'term C',
      '??',
      'term D',
      '',
    ].join('\n');

    const cards = qa(parseCards(source));
    expect(cards.map((c) => c.style)).toEqual([
      'single-line',
      'single-line-reversed',
      'multi-line',
      'multi-line-reversed',
    ]);
    expect(cards.map((c) => c.front)).toEqual(['question one', 'term A', 'question two', 'term C']);
    expect(cards.map((c) => c.back)).toEqual(['answer one', 'term B', 'answer two', 'term D']);
    // Reversed is carried, not flattened: the plugin reviews these both ways,
    // and a parser that dropped the distinction would silently halve them.
    expect(cards.map((c) => c.reversed)).toEqual([false, true, false, true]);
  });

  it('splits on the reversed separator first — `:::` contains `::`', () => {
    // The whole correctness argument for the separator ordering, as a test:
    // matched the other way round, `term A:::term B` yields front `term A`,
    // back `:term B`, and the card is silently wrong rather than absent.
    const cards = qa(parseCards('term A:::term B\n'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.style).toBe('single-line-reversed');
    expect(cards[0]?.back).toBe('term B');
  });

  it('a separator with nothing on one side is not a card', () => {
    expect(parseCards('::answer only\n')).toHaveLength(0);
    expect(parseCards('question only::\n')).toHaveLength(0);
  });

  it('a multi-line separator with no front or no back is not a card', () => {
    expect(parseCards('?\nanswer only\n')).toHaveLength(0);
    expect(parseCards('question only\n?\n')).toHaveLength(0);
  });

  it('finds single-line cards inside list items, without the list marker', () => {
    const cards = qa(parseCards('- question one::answer one\n- question two::answer two\n'));
    expect(cards.map((c) => c.front)).toEqual(['question one', 'question two']);
  });
});

describe('parseCards — cloze', () => {
  it('one instrument per deletion, with the other deletions shown as plain text', () => {
    const cards = cloze(parseCards('the ==first== and the ==second== of them\n'));
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      delimiter: '==',
      before: 'the ',
      clozeText: 'first',
      after: ' and the second of them',
    });
    expect(cards[1]).toMatchObject({
      before: 'the first and the ',
      clozeText: 'second',
      after: ' of them',
    });
  });

  it('recognises the curly-brace form too', () => {
    const cards = cloze(parseCards('a {{blanked}} span\n'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.delimiter).toBe('{{');
    expect(cards[0]?.clozeText).toBe('blanked');
  });

  it('emphasis is not a cloze', () => {
    // `convertBoldTextToClozes` ships false in the target plugin, and her notes
    // use bold for emphasis throughout. Reading bold as a cloze would mint
    // instruments she never wrote, in every note she has.
    expect(parseCards('emphasis like **this** is not a card\n')).toHaveLength(0);
  });

  it('an empty deletion is not a cloze', () => {
    expect(parseCards('a ==== span\n')).toHaveLength(0);
  });

  it('a line carrying a Q&A separator is a Q&A card, not a cloze', () => {
    const cards = parseCards('question one::an ==answer== with a highlight in it\n');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe('qa');
  });
});

describe("parseCards — another plugin's scheduling data", () => {
  it('is reported as foreign, and kept out of the answer text', () => {
    const cards = qa(parseCards('question one::answer one <!--SR:!2026-09-01,12,250-->\n'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.back).toBe('answer one');
    expect(cards[0]?.foreignScheduling).toBe('<!--SR:!2026-09-01,12,250-->');
  });

  it('is recognised on the line after a multi-line card, where the plugin puts it by default', () => {
    const cards = qa(parseCards('question one\n?\nanswer one\n<!--SR:!2026-09-01,12,250-->\n'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.back).toBe('answer one');
    expect(cards[0]?.foreignScheduling).toBe('<!--SR:!2026-09-01,12,250-->');
  });

  it('a trailing block id is read, and kept out of the answer text', () => {
    const cards = qa(parseCards('question one::answer one ^anchor1\n'));
    expect(cards[0]?.back).toBe('answer one');
    expect(cards[0]?.blockId).toBe('anchor1');
  });

  it('no write path in this module emits a scheduling comment or a deck tag', () => {
    // C5.3 gives scheduling state one owner, because a schedule two systems
    // write to has no authority left. Asserted over what the create paths
    // actually produce, not over the module's intentions.
    const source = 'her own line\n';
    const created = createQaCard({
      source,
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(created.content).not.toContain('<!--SR:');
    expect(created.content).not.toContain(SR_DEFAULT_DECK_TAG);
    expect(created.content).not.toContain('sr-due');

    const clozed = createClozeCard({ source, spanStart: 4, spanEnd: 7 });
    expect(clozed.content).not.toContain('<!--SR:');
    expect(clozed.content).not.toContain(SR_DEFAULT_DECK_TAG);
  });

  it('an existing foreign scheduling comment survives a card being created beside it', () => {
    const source = 'question one::answer one <!--SR:!2026-09-01,12,250-->\n';
    const created = createQaCard({
      source,
      anchorBlockIndex: 0,
      front: 'question two',
      back: 'answer two',
      generateBlockId: () => 'anchor2',
    });
    expect(created.content).toContain('<!--SR:!2026-09-01,12,250-->');
    expect(removeSpans(created.content, [created.insertedSpan])).toContain(
      'answer one <!--SR:!2026-09-01,12,250--> ^anchor2',
    );
  });
});

describe('createQaCard — the anchor (C1.4)', () => {
  it('writes a block id onto a paragraph that has none', () => {
    const result = createQaCard({
      source: 'her own line\n',
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(result.anchor).toEqual({ kind: 'block-id', id: 'anchor1', created: true });
    expect(result.content.startsWith('her own line ^anchor1\n')).toBe(true);
    expect(result.blockIdSpan).not.toBeNull();
  });

  it('reuses a block id the line already had, rather than replacing it', () => {
    const result = createQaCard({
      source: 'her own line ^existing1\n',
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(result.anchor).toEqual({ kind: 'block-id', id: 'existing1', created: false });
    expect(result.blockIdSpan).toBeNull();
    expect(result.content).not.toContain('anchor1');
  });

  it('writes a block id onto a list item', () => {
    const result = createQaCard({
      source: '- her own item\n',
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(result.anchor).toEqual({ kind: 'block-id', id: 'anchor1', created: true });
    expect(result.content.startsWith('- her own item ^anchor1\n')).toBe(true);
  });

  it('never writes a block id onto a heading — Obsidian does not address one that way', () => {
    const result = createQaCard({
      source: '## her own heading\n\nsome prose\n',
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(result.anchor).toEqual({ kind: 'heading', text: 'her own heading' });
    expect(result.blockIdSpan).toBeNull();
    expect(result.content).toContain('## her own heading\n');
    expect(result.content).not.toContain('^anchor1');
  });

  it('refuses to create a card from a block kind that is not her prose', () => {
    const source = '---\ntitle: x\n---\n\nprose\n';
    expect(() => createQaCard({ source, anchorBlockIndex: 0, front: 'q', back: 'a' })).toThrowError(
      /frontmatter/,
    );
  });
});

describe('createQaCard — INV-2', () => {
  it('inserts a multi-line card by default, separated by blank lines', () => {
    const result = createQaCard({
      source: 'her own line\n\nlater prose\n',
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(result.content).toBe(
      'her own line ^anchor1\n\nquestion one\n?\nanswer one\n\nlater prose\n',
    );
  });

  it('inserts a single-line card when asked for one', () => {
    const result = createQaCard({
      source: 'her own line\n\nlater prose\n',
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      style: 'single-line',
      generateBlockId: () => 'anchor1',
    });
    expect(result.content).toBe(
      'her own line ^anchor1\n\nquestion one::answer one\n\nlater prose\n',
    );
  });

  it('a CRLF note stays CRLF, and no other line gains or loses a carriage return', () => {
    const source = 'her own line\r\n\r\nlater prose\r\n';
    const result = createQaCard({
      source,
      anchorBlockIndex: 0,
      front: 'question one',
      back: 'answer one',
      generateBlockId: () => 'anchor1',
    });
    expect(result.inserted).not.toMatch(/(?<!\r)\n/);
    // Counted, not just looped: an assertion inside a loop that never runs
    // passes for the wrong reason.
    const lines = result.content.split('\n').slice(0, -1);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) expect(line.endsWith('\r')).toBe(true);
  });

  it('every byte outside the inserted card and the block id is unchanged, for every fixture note', () => {
    const files = [...walkMarkdown(VAULT_FIXTURES), ...walkMarkdown(INSTRUMENT_FIXTURES)].sort();
    expect(files.length).toBeGreaterThanOrEqual(45);

    let anchored = 0;
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const doc = parseDocument(source);
      const index = doc.blocks.findIndex(
        (b) => b.kind === 'paragraph' || b.kind === 'list' || b.kind === 'heading',
      );
      if (index === -1) continue;
      anchored += 1;

      const result = createQaCard({
        source,
        anchorBlockIndex: index,
        front: 'question one',
        back: 'answer one',
        generateBlockId: () => 'anchor1',
      });
      const spans = result.blockIdSpan
        ? [result.insertedSpan, result.blockIdSpan]
        : [result.insertedSpan];
      // Subtract the intended change and the original file must be back,
      // byte-for-byte. This is INV-2 stated as arithmetic rather than as a
      // sample of fields somebody thought to check.
      expect(removeSpans(result.content, spans)).toBe(source);
    }
    expect(anchored).toBe(files.length);
  });
});

describe('createClozeCard', () => {
  it('wraps exactly the marked span and changes nothing else', () => {
    const source = 'the pump restores the gradient\n';
    const start = source.indexOf('pump');
    const result = createClozeCard({ source, spanStart: start, spanEnd: start + 4 });
    expect(result.content).toBe('the ==pump== restores the gradient\n');
    expect(result.clozeText).toBe('pump');
    expect(removeSpans(result.content, result.delimiterSpans)).toBe(source);
  });

  it('adds no block id and no scheduling data to her line', () => {
    const source = 'the pump restores the gradient\n';
    const start = source.indexOf('pump');
    const result = createClozeCard({ source, spanStart: start, spanEnd: start + 4 });
    expect(result.content).not.toContain('^');
    expect(result.content).not.toContain('<!--SR:');
  });

  it('the created cloze parses back as one cloze instrument', () => {
    const source = '- the pump restores the gradient\n';
    const start = source.indexOf('pump');
    const result = createClozeCard({ source, spanStart: start, spanEnd: start + 4 });
    const cards = cloze(parseCards(result.content));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.clozeText).toBe('pump');
  });

  it('refuses a span that crosses a line, is empty, or already holds a delimiter', () => {
    const source = 'first line\nsecond line\n';
    expect(() => createClozeCard({ source, spanStart: 6, spanEnd: 6 })).toThrowError(/empty/);
    expect(() => createClozeCard({ source, spanStart: 6, spanEnd: 16 })).toThrowError(/one line/);
    const already = 'a ==done== span\n';
    expect(() => createClozeCard({ source: already, spanStart: 2, spanEnd: 10 })).toThrowError(
      /already contains/,
    );
  });

  it('refuses a span inside a fenced code block', () => {
    const source = '```\nsome code here\n```\n';
    const start = source.indexOf('code');
    expect(() => createClozeCard({ source, spanStart: start, spanEnd: start + 4 })).toThrowError(
      /paragraph or list/,
    );
  });
});

describe('the writer refuses what it cannot do safely', () => {
  it('rejects an edit range that straddles a block boundary', () => {
    const source = 'first paragraph\n\nsecond paragraph\n';
    const doc = parseDocument(source);
    expect(() =>
      applyDocumentEdits(doc, [{ kind: 'replace', start: 10, end: 20, text: 'x' }]),
    ).toThrowError(/straddles a block boundary/);
  });

  it('rejects two edits that overlap', () => {
    const source = 'first paragraph\n';
    const doc = parseDocument(source);
    expect(() =>
      applyDocumentEdits(doc, [
        { kind: 'replace', start: 0, end: 6, text: 'x' },
        { kind: 'replace', start: 3, end: 9, text: 'y' },
      ]),
    ).toThrowError(/overlaps/);
  });

  it('rejects an insertion that is not on a block boundary', () => {
    const source = 'first paragraph\n';
    const doc = parseDocument(source);
    expect(() => applyDocumentEdits(doc, [{ kind: 'insert', at: 5, text: 'x' }])).toThrowError(
      /block boundary/,
    );
  });
});

describe('parseCards — against the golden fixture notes', () => {
  it('finds every card form in the Q&A/cloze fixture', () => {
    const cards = parseCards(readFixture('qa-and-cloze.md'));
    const styles = qa(cards).map((c) => c.style);
    expect(new Set(styles)).toEqual(
      new Set(['single-line', 'single-line-reversed', 'multi-line', 'multi-line-reversed']),
    );
    expect(cloze(cards).length).toBeGreaterThanOrEqual(3);
    // Exactly one card in that fixture carries another plugin's scheduling
    // state, and exactly one carries a block id.
    expect(cards.filter((c) => c.foreignScheduling !== null)).toHaveLength(1);
    expect(cards.filter((c) => c.blockId !== null)).toHaveLength(1);
  });

  it('parses the CRLF fixture without its carriage returns leaking into card text', () => {
    const cards = parseCards(readFixture('qa-and-cloze-crlf.md'));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      if (card.type === 'qa') {
        expect(card.front).not.toContain('\r');
        expect(card.back).not.toContain('\r');
      } else {
        expect(card.clozeText).not.toContain('\r');
        expect(card.after).not.toContain('\r');
      }
    }
  });

  it('finds no cards in the prose-only sections it should not', () => {
    // The fixture's closing section is ordinary prose. If the parser ever
    // starts finding a card in it, this fails with a count rather than
    // silently adding an instrument she never wrote.
    const source = readFixture('qa-and-cloze.md');
    const prose = source.slice(source.lastIndexOf('## '));
    expect(parseCards(prose)).toHaveLength(0);
  });
});

// Scenarios: features/F2-review.md — "F2.14 — Q&A identity is stamped, once
// (D-030)", tagged `@auto:core/card-format.spec`.
describe('stampQaCardBlockId — the write half of D-030, option (b)', () => {
  function qaSpanOf(source: string): { start: number; end: number } {
    const card = qa(parseCards(source))[0];
    if (!card) throw new Error('fixture has no Q&A card');
    return card.span;
  }

  it('mints a block id onto a hand-typed single-line card that has none', () => {
    const source = 'question one::answer one\n';
    const span = qaSpanOf(source);
    const result = stampQaCardBlockId(source, span, { generateBlockId: () => 'stamped1' });
    expect(result.changed).toBe(true);
    expect(result.blockId).toBe('stamped1');
    expect(result.content).toBe('question one::answer one ^stamped1\n');
    expect(qa(parseCards(result.content))[0]?.blockId).toBe('stamped1');
  });

  it('mints a block id onto the back line of a hand-typed multi-line card', () => {
    const source = 'question one\n?\nanswer one\n';
    const span = qaSpanOf(source);
    const result = stampQaCardBlockId(source, span, { generateBlockId: () => 'stamped1' });
    expect(result.content).toBe('question one\n?\nanswer one ^stamped1\n');
    expect(qa(parseCards(result.content))[0]?.blockId).toBe('stamped1');
  });

  it('writes exactly the block id and touches nothing else (C1.2)', () => {
    const source = 'her prose above\n\nquestion one::answer one\n\nher prose below\n';
    const span = qaSpanOf(source);
    const result = stampQaCardBlockId(source, span, { generateBlockId: () => 'stamped1' });
    if (!result.insertedSpan) throw new Error('expected a span for a changed stamp');
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(source);
    expect(result.content.slice(result.insertedSpan.start, result.insertedSpan.end)).toBe(
      ' ^stamped1',
    );
  });

  it('is idempotent: stamping an already-stamped card is a byte-identical no-op', () => {
    const first = stampQaCardBlockId(
      'question one::answer one\n',
      qaSpanOf('question one::answer one\n'),
      {
        generateBlockId: () => 'stamped1',
      },
    );
    const secondSpan = qaSpanOf(first.content);
    const second = stampQaCardBlockId(first.content, secondSpan, {
      generateBlockId: () => 'a-different-id',
    });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.blockId).toBe('stamped1');
    expect(second.insertedSpan).toBeNull();
  });

  // Read-then-mint, never recompute — the same property `stampMcqId` proves.
  // A block id already on the line is used verbatim, regardless of what a
  // fresh derivation would produce; recomputing on a mismatch instead of
  // reading would be silently catastrophic (D-030's whole argument for
  // stamping over any position-derived scheme).
  it('a block id already present is read, never recomputed', () => {
    const source = 'question one::answer one ^her-original-id\n';
    const span = qaSpanOf(source);
    const result = stampQaCardBlockId(source, span, {
      generateBlockId: () => 'would-be-different',
    });
    expect(result.changed).toBe(false);
    expect(result.blockId).toBe('her-original-id');
    expect(result.content).toBe(source);
  });

  it('survives her editing the front and back text around it', () => {
    const stamped = stampQaCardBlockId(
      'question one::answer one\n',
      qaSpanOf('question one::answer one\n'),
      {
        generateBlockId: () => 'durable1',
      },
    ).content;
    const edited = stamped.replace('question one', 'a completely rewritten question');
    const card = qa(parseCards(edited))[0];
    expect(card?.blockId).toBe('durable1');
    expect(card?.front).toBe('a completely rewritten question');
  });

  it('inserts before an existing foreign scheduling comment, so it stays the last thing on the line and still parses as foreign', () => {
    const source = 'question one::answer one <!--SR:!2026-09-01,12,250-->\n';
    const span = qaSpanOf(source);
    const result = stampQaCardBlockId(source, span, { generateBlockId: () => 'stamped1' });
    const card = qa(parseCards(result.content))[0];
    expect(card?.blockId).toBe('stamped1');
    expect(card?.foreignScheduling).toBe('<!--SR:!2026-09-01,12,250-->');
    expect(card?.back).toBe('answer one');
  });

  it('leaves a cloze card and every other Q&A card in the note untouched', () => {
    const source = 'a ==blank== in a sentence.\n\nquestion one::answer one\n';
    const span = qaSpanOf(source);
    const result = stampQaCardBlockId(source, span, { generateBlockId: () => 'stamped1' });
    const parsed = parseCards(result.content);
    expect(cloze(parsed)).toHaveLength(1);
    expect(cloze(parsed)[0]?.clozeText).toBe('blank');
    expect(qa(parsed)[0]?.blockId).toBe('stamped1');
  });

  it('throws rather than stamp a card that is not there', () => {
    expect(() =>
      stampQaCardBlockId('question one::answer one\n', { start: 0, end: 3 }),
    ).toThrowError(/no Q&A card/);
  });
});
