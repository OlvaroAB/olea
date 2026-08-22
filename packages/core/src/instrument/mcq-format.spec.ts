// Scenarios: features/F2-review.md — "F2.15 — The MCQ block is Olea's own, and
// hand-authorable", tagged `@auto:core/mcq-format.spec`.
//
// Inline blocks in this file use structural placeholder text. Assertions against
// the golden fixture notes are structural (counts, reasons, byte identity) and
// never quote their content — INV-3's fixture vocabulary has been renamed twice
// (`ol-yj9`) and a suite that hardcodes it breaks on the next rename.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDocumentEdits, removeSpans } from '../block/edit.js';
import { parseDocument } from '../block/parse.js';
import {
  insertMcqBlock,
  MCQ_FENCE_INFO,
  parseMcqBlocks,
  serializeMcq,
  serializeMcqInstrument,
  stampMcqId,
} from './mcq-format.js';
import { MIN_DISTRACTOR_POOL } from './types.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'instruments');
const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** A minimal valid block, built rather than pasted so the floor is visible in the test. */
function block(lines: readonly string[]): string {
  return ['```' + MCQ_FENCE_INFO, ...lines, '```', ''].join('\n');
}

const POOL = ['distractor A', 'distractor B', 'distractor C', 'distractor D'];
const validLines = [
  'stem: which one is it?',
  'answer: the right one',
  ...POOL.map((d) => `distractor: ${d}`),
];

describe('parseMcqBlocks — a hand-typed block', () => {
  it('parses into stem, answer and pool', () => {
    const { instruments, invalid } = parseMcqBlocks(block(validLines));
    expect(invalid).toHaveLength(0);
    expect(instruments).toHaveLength(1);
    expect(instruments[0]).toMatchObject({
      type: 'mcq',
      stem: 'which one is it?',
      answer: 'the right one',
      distractors: POOL,
      feedback: null,
      id: null,
    });
  });

  it('carries the optional feedback and id when they are there', () => {
    const { instruments } = parseMcqBlocks(
      block([...validLines, 'feedback: because of the thing', 'id: item-1']),
    );
    expect(instruments[0]?.feedback).toBe('because of the thing');
    expect(instruments[0]?.id).toBe('item-1');
  });

  it('ignores a fenced block that is not ours', () => {
    const source = '```js\nconst x = 1;\n```\n';
    expect(parseMcqBlocks(source)).toEqual({ instruments: [], invalid: [] });
  });

  it('tolerates irregular spacing, field order and label case', () => {
    const { instruments, invalid } = parseMcqBlocks(
      [
        '```' + MCQ_FENCE_INFO,
        'DISTRACTOR:   distractor A',
        'Stem :  which one is it?',
        '',
        'distractor:distractor B',
        'answer:  the right one',
        'distractor: distractor C',
        '  distractor: distractor D',
        '```',
        '',
      ].join('\n'),
    );
    expect(invalid).toHaveLength(0);
    expect(instruments[0]).toMatchObject({
      stem: 'which one is it?',
      answer: 'the right one',
      distractors: ['distractor A', 'distractor B', 'distractor C', 'distractor D'],
    });
  });
});

describe('parseMcqBlocks — what is not a valid MCQ', () => {
  it('fewer than four distractors is rejected, with the floor named', () => {
    const short = block([
      'stem: which one is it?',
      'answer: the right one',
      ...POOL.slice(0, 3).map((d) => `distractor: ${d}`),
    ]);
    const { instruments, invalid } = parseMcqBlocks(short);
    // Never returned as schedulable. This is the whole point of F2.15's floor:
    // sampling three from three shows her the same options every time.
    expect(instruments).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.reason).toBe('insufficient-distractors');
    expect(invalid[0]?.detail).toContain(String(MIN_DISTRACTOR_POOL));
  });

  it('exactly four is accepted — the floor is a floor, not a threshold to exceed', () => {
    expect(parseMcqBlocks(block(validLines)).instruments).toHaveLength(1);
    expect(POOL).toHaveLength(MIN_DISTRACTOR_POOL);
  });

  it.each([
    ['missing-stem', ['answer: the right one', ...POOL.map((d) => `distractor: ${d}`)]],
    ['missing-answer', ['stem: which one is it?', ...POOL.map((d) => `distractor: ${d}`)]],
    ['repeated-field', [...validLines, 'answer: a second right one']],
    ['duplicate-option', [...validLines, `distractor: ${POOL[0]}`]],
    ['empty-value', ['stem:', 'answer: the right one', ...POOL.map((d) => `distractor: ${d}`)]],
    ['unknown-field', [...validLines, 'distractors: a typo']],
    ['unknown-field', [...validLines, 'prose she pasted in by accident']],
  ] as const)('rejects with reason %s', (reason, lines) => {
    const { instruments, invalid } = parseMcqBlocks(block([...lines]));
    expect(instruments).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.reason).toBe(reason);
  });

  it('a distractor repeating the answer is a duplicate, not a fifth option', () => {
    const { invalid } = parseMcqBlocks(block([...validLines, 'distractor: the right one']));
    expect(invalid[0]?.reason).toBe('duplicate-option');
  });

  it('reports an invalid block alongside the valid ones, with its location', () => {
    const source = `${block(validLines)}\nsome prose between them\n\n${block(validLines.slice(0, -1))}`;
    const { instruments, invalid } = parseMcqBlocks(source);
    expect(instruments).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    // Located, so she can be told which block — not dropped, which would leave
    // her with a quiz item that quietly stopped existing.
    expect(source.slice(invalid[0]?.span.start, invalid[0]?.span.end)).toBe(invalid[0]?.raw);
    expect(invalid[0]?.span.start).toBeGreaterThan(instruments[0]?.span.end ?? 0);
  });
});

describe('serializeMcq — the canonical form', () => {
  it('emits the fields in the canonical order, human ones first', () => {
    expect(
      serializeMcq({
        stem: 'which one is it?',
        answer: 'the right one',
        distractors: POOL,
        feedback: 'because of the thing',
        id: 'item-1',
      }),
    ).toBe(
      [
        '```' + MCQ_FENCE_INFO,
        'stem: which one is it?',
        'answer: the right one',
        ...POOL.map((d) => `distractor: ${d}`),
        'feedback: because of the thing',
        'id: item-1',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('refuses to emit anything its own parser would reject', () => {
    const base = { stem: 'q', answer: 'a', distractors: POOL };
    expect(() => serializeMcq({ ...base, distractors: POOL.slice(0, 3) })).toThrowError(
      /at least 4/,
    );
    expect(() => serializeMcq({ ...base, distractors: [...POOL, POOL[0] ?? ''] })).toThrowError(
      /duplicate option/,
    );
    expect(() => serializeMcq({ ...base, stem: 'a\nb' })).toThrowError(/line break/);
    expect(() => serializeMcq({ ...base, stem: '   ' })).toThrowError(/no value/);
    expect(() => serializeMcq({ ...base, stem: '```' })).toThrowError(/close the fence/);
  });

  it('round-trips: parse then serialize is byte-identical for a canonical block', () => {
    const source = block([...validLines, 'feedback: because of the thing', 'id: item-1']);
    const { instruments } = parseMcqBlocks(source);
    expect(instruments).toHaveLength(1);
    const instrument = instruments[0];
    if (!instrument) throw new Error('no instrument');
    expect(serializeMcqInstrument(instrument)).toBe(instrument.raw);
  });

  it('keeps a CRLF block CRLF, and a tilde fence a tilde fence', () => {
    const source = ['~~~~' + MCQ_FENCE_INFO, ...validLines, '~~~~', ''].join('\r\n');
    const { instruments } = parseMcqBlocks(source);
    const instrument = instruments[0];
    if (!instrument) throw new Error('no instrument');
    expect(instrument.fence).toBe('~~~~');
    expect(instrument.terminator).toBe('\r\n');
    expect(serializeMcqInstrument(instrument)).toBe(instrument.raw);
  });
});

describe('reading a note never rewrites it', () => {
  it('a hand-typed block keeps its own bytes, and re-emitting is a separate act', () => {
    const source = readFixture('mcq-hand-typed.md');
    const { instruments, invalid } = parseMcqBlocks(source);
    expect(invalid).toHaveLength(0);
    expect(instruments).toHaveLength(1);
    const instrument = instruments[0];
    if (!instrument) throw new Error('no instrument');

    // Its raw bytes are exactly what she typed...
    expect(source.slice(instrument.span.start, instrument.span.end)).toBe(instrument.raw);
    // ...and the canonical form is deliberately different, which is why
    // parsing must never write. A parser that tidied on read would put a
    // byte-churning diff in every commit she makes.
    expect(serializeMcqInstrument(instrument)).not.toBe(instrument.raw);

    // Writing the note back through the engine with no edits is identity.
    expect(applyDocumentEdits(parseDocument(source), []).content).toBe(source);
  });
});

describe('insertMcqBlock — the write path an accept step uses', () => {
  it('inserts a canonical block and leaves every other byte alone', () => {
    const source = 'her own line\n\nlater prose\n';
    const result = insertMcqBlock({
      source,
      afterBlockIndex: 0,
      fields: { stem: 'which one is it?', answer: 'the right one', distractors: POOL },
    });
    // The blank line she already had is reused as the separator rather than a
    // second one being invented — the bytes before and after the insertion are
    // exactly her file, split at the insertion point.
    expect(
      result.content.slice(0, result.insertedSpan.start) +
        result.content.slice(result.insertedSpan.end),
    ).toBe(source);
    expect(parseMcqBlocks(result.content).instruments).toHaveLength(1);
  });

  it('refuses to insert a block below the floor', () => {
    expect(() =>
      insertMcqBlock({
        source: 'her own line\n',
        afterBlockIndex: 0,
        fields: { stem: 'q', answer: 'a', distractors: POOL.slice(0, 3) },
      }),
    ).toThrowError(/at least 4/);
  });
});

describe('parseMcqBlocks — against the golden fixture notes', () => {
  it('every block in the valid fixture parses, and round-trips byte-identically', () => {
    const source = readFixture('mcq-valid.md');
    const { instruments, invalid } = parseMcqBlocks(source);
    expect(invalid).toHaveLength(0);
    expect(instruments.length).toBeGreaterThanOrEqual(2);
    for (const instrument of instruments) {
      expect(instrument.distractors.length).toBeGreaterThanOrEqual(MIN_DISTRACTOR_POOL);
      expect(source.slice(instrument.span.start, instrument.span.end)).toBe(instrument.raw);
      expect(serializeMcqInstrument(instrument)).toBe(instrument.raw);
    }
    // The fixture carries the documented floor case as well as a larger pool,
    // so "≥ 4" is exercised at the boundary and above it, not only above it.
    const sizes = instruments.map((i) => i.distractors.length);
    expect(Math.min(...sizes)).toBe(MIN_DISTRACTOR_POOL);
    expect(Math.max(...sizes)).toBeGreaterThan(MIN_DISTRACTOR_POOL);
  });

  it('every block in the invalid fixture is rejected, and each named reason occurs', () => {
    const source = readFixture('mcq-invalid.md');
    const { instruments, invalid } = parseMcqBlocks(source);
    expect(instruments).toHaveLength(0);
    expect(invalid).toHaveLength(8);
    expect(new Set(invalid.map((i) => i.reason))).toEqual(
      new Set([
        'insufficient-distractors',
        'missing-stem',
        'missing-answer',
        'repeated-field',
        'duplicate-option',
        'unknown-field',
        'empty-value',
      ]),
    );
    for (const entry of invalid) {
      expect(source.slice(entry.span.start, entry.span.end)).toBe(entry.raw);
      expect(entry.detail).not.toBe('');
    }
  });
});

// Scenarios: features/F2-review.md — "F2.14 — MCQ identity is stamped, once
// (D-030)", tagged `@auto:core/mcq-format.spec`.
describe('stampMcqId — the write half of D-030, option (b)', () => {
  const unstamped = ['her own line above', '', block(validLines), 'and prose below'].join('\n');
  const unstampedSpan = (() => {
    const { instruments } = parseMcqBlocks(unstamped);
    const span = instruments[0]?.span;
    if (!span) throw new Error('fixture has no MCQ block');
    return span;
  })();

  it('mints an id when the block has none', () => {
    const result = stampMcqId(unstamped, unstampedSpan, { generateId: () => 'mcq-fixed' });
    expect(result.changed).toBe(true);
    expect(result.id).toBe('mcq-fixed');
    const reparsed = parseMcqBlocks(result.content);
    expect(reparsed.invalid).toHaveLength(0);
    expect(reparsed.instruments[0]?.id).toBe('mcq-fixed');
  });

  it('writes exactly one new line — the id field — and touches nothing else (C1.2)', () => {
    const result = stampMcqId(unstamped, unstampedSpan, { generateId: () => 'mcq-fixed' });
    if (!result.insertedSpan) throw new Error('expected a span for a changed stamp');
    // Subtracting the inserted span from the result is the direct form of
    // "everything else is unchanged" (block/edit.ts's own doc): what's left
    // is exactly the source she started with, byte for byte.
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(unstamped);
    const insertedText = result.content.slice(result.insertedSpan.start, result.insertedSpan.end);
    expect(insertedText).toBe('id: mcq-fixed\n');
  });

  it('is idempotent: stamping an already-stamped block is a byte-identical no-op', () => {
    const first = stampMcqId(unstamped, unstampedSpan, { generateId: () => 'mcq-fixed' });
    const restamped = parseMcqBlocks(first.content).instruments[0]?.span;
    if (!restamped) throw new Error('no instrument after first stamp');
    const second = stampMcqId(first.content, restamped, { generateId: () => 'a-different-id' });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.id).toBe('mcq-fixed');
  });

  // Read-then-mint, never recompute: an id already present is used verbatim,
  // even when the derivation would now produce something else entirely. This
  // is the property D-030's ruling rests on; a version of this function that
  // "helpfully" re-derived on a mismatch would be silently catastrophic —
  // see the mutation evidence below.
  it('an id already present is read, never recomputed — even when nothing about it matches what would be minted now', () => {
    const alreadyStamped = block([...validLines, 'id: her-original-id']);
    const { instruments } = parseMcqBlocks(alreadyStamped);
    const span = instruments[0]?.span;
    if (!span) throw new Error('no instrument');
    const result = stampMcqId(alreadyStamped, span, { generateId: () => 'mcq-would-be-different' });
    expect(result.changed).toBe(false);
    expect(result.id).toBe('her-original-id');
    expect(result.content).toBe(alreadyStamped);
  });

  it('survives her editing the stem and distractors around it', () => {
    const stamped = stampMcqId(unstamped, unstampedSpan, {
      generateId: () => 'mcq-durable',
    }).content;
    const edited = stamped
      .replace('which one is it?', 'a completely rewritten stem')
      .replace('distractor A', 'a brand new distractor');
    const { instruments } = parseMcqBlocks(edited);
    expect(instruments[0]?.id).toBe('mcq-durable');
    expect(instruments[0]?.stem).toBe('a completely rewritten stem');
  });

  it('throws rather than stamp a block that is not there', () => {
    expect(() => stampMcqId(unstamped, { start: 0, end: 3 })).toThrowError(/no code block/);
  });

  it('throws rather than stamp a block that fails to parse as an MCQ', () => {
    const invalidBlock = block(['stem: q', 'answer: a', 'distractor: only-one']);
    const source = `${invalidBlock}\n`;
    const doc = parseDocument(source);
    const codeBlock = doc.blocks.find((b) => b.kind === 'code');
    if (!codeBlock) throw new Error('no code block in fixture');
    expect(() => stampMcqId(source, { start: codeBlock.start, end: codeBlock.end })).toThrowError(
      /does not parse as an MCQ instrument/,
    );
  });
});
