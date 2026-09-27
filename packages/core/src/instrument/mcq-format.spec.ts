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
  formatMcqPaperOrigin,
  insertMcqBlock,
  MCQ_FENCE_INFO,
  parseMcqBlocks,
  parseMcqPaperOrigin,
  serializeMcq,
  serializeMcqInstrument,
  stampMcqId,
  stampMcqPaperOrigin,
  stampMcqPredecessor,
} from './mcq-format.js';
import { MIN_DISTRACTOR_POOL } from './types.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'instruments');
const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** A minimal valid block, built rather than pasted so the floor is visible in the test. */
function block(lines: readonly string[]): string {
  return [`\`\`\`${MCQ_FENCE_INFO}`, ...lines, '```', ''].join('\n');
}

const POOL = ['distractor A', 'distractor B', 'distractor C', 'distractor D'];
/** A pool of exactly `MIN_DISTRACTOR_POOL` — `[D-195]` lowered the floor to 2, so `POOL` above (4) is comfortably above it and no longer doubles as the floor-sized pool. */
const POOL_AT_FLOOR = POOL.slice(0, MIN_DISTRACTOR_POOL);
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

  // `[D-133]` regression guard: before this landed, `predecessor` was not a
  // recognised field and a block carrying one was rejected wholesale
  // (`unknown-field`) — see `types.ts`'s doc on `McqInstrument.predecessor`.
  it('carries the optional predecessor when it is there, and is null when absent (ol-2zfj.37)', () => {
    const withPredecessor = parseMcqBlocks(
      block([...validLines, 'id: item-2', 'predecessor: item-1']),
    ).instruments[0];
    expect(withPredecessor?.predecessor).toBe('item-1');

    const without = parseMcqBlocks(block(validLines)).instruments[0];
    expect(without?.predecessor).toBeNull();
  });

  it('a predecessor-carrying block parses (not `unknown-field`) and round-trips byte-identically (INV-2, ol-2zfj.37)', () => {
    const source = block([...validLines, 'id: item-2', 'predecessor: item-1']);
    const { instruments, invalid } = parseMcqBlocks(source);
    expect(invalid).toHaveLength(0);
    expect(instruments).toHaveLength(1);
    const instrument = instruments[0];
    if (!instrument) throw new Error('no instrument');
    expect(instrument.predecessor).toBe('item-1');
    expect(serializeMcqInstrument(instrument)).toBe(instrument.raw);
  });

  it('ignores a fenced block that is not ours', () => {
    const source = '```js\nconst x = 1;\n```\n';
    expect(parseMcqBlocks(source)).toEqual({ instruments: [], invalid: [] });
  });

  it('tolerates irregular spacing, field order and label case', () => {
    const { instruments, invalid } = parseMcqBlocks(
      [
        `\`\`\`${MCQ_FENCE_INFO}`,
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
  it('fewer than the floor is rejected, with the floor named (`[D-195]`: floor is 2)', () => {
    const short = block([
      'stem: which one is it?',
      'answer: the right one',
      ...POOL.slice(0, MIN_DISTRACTOR_POOL - 1).map((d) => `distractor: ${d}`),
    ]);
    const { instruments, invalid } = parseMcqBlocks(short);
    // Never returned as schedulable. This is the whole point of F2.15's floor:
    // below it, an MCQ is a different instrument wearing the same name.
    expect(instruments).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.reason).toBe('insufficient-distractors');
    expect(invalid[0]?.detail).toContain(String(MIN_DISTRACTOR_POOL));
  });

  it('exactly the floor (two) is accepted — the floor is a floor, not a threshold to exceed', () => {
    const atFloor = block([
      'stem: which one is it?',
      'answer: the right one',
      ...POOL_AT_FLOOR.map((d) => `distractor: ${d}`),
    ]);
    expect(parseMcqBlocks(atFloor).instruments).toHaveLength(1);
    expect(POOL_AT_FLOOR).toHaveLength(MIN_DISTRACTOR_POOL);
  });

  it('a pool comfortably above the floor is also accepted', () => {
    expect(parseMcqBlocks(block(validLines)).instruments).toHaveLength(1);
    expect(POOL.length).toBeGreaterThan(MIN_DISTRACTOR_POOL);
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
    const shortLines = [
      'stem: which one is it?',
      'answer: the right one',
      ...POOL.slice(0, MIN_DISTRACTOR_POOL - 1).map((d) => `distractor: ${d}`),
    ];
    const source = `${block(validLines)}\nsome prose between them\n\n${block(shortLines)}`;
    const { instruments, invalid } = parseMcqBlocks(source);
    expect(instruments).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    // Located, so she can be told which block — not dropped, which would leave
    // her with a quiz item that quietly stopped existing.
    expect(source.slice(invalid[0]?.span.start, invalid[0]?.span.end)).toBe(invalid[0]?.raw);
    expect(invalid[0]?.span.start).toBeGreaterThan(instruments[0]?.span.end ?? 0);
  });

  describe('[D-334] M4 — corrupted text or an unterminated fence', () => {
    it('a block whose text carries a Unicode replacement character is corrupted, checked ahead of every other field check', () => {
      const source = block([
        'stem: which one is it�?',
        'answer: the right one',
        ...POOL.map((d) => `distractor: ${d}`),
      ]);
      const { instruments, invalid } = parseMcqBlocks(source);
      expect(instruments).toHaveLength(0);
      expect(invalid).toHaveLength(1);
      expect(invalid[0]?.reason).toBe('corrupted-or-unterminated');
      expect(invalid[0]?.detail).toContain('replacement character');
    });

    it('a fence that never closes before the note ends is unterminated, not read as a run of valid fields', () => {
      // No closing ``` line at all — `../block/parse.ts` runs the fence to EOF
      // (its own documented behaviour), and until this bead nothing checked
      // for that: the fields still looked well-formed.
      const source = `${[`\`\`\`${MCQ_FENCE_INFO}`, ...validLines].join('\n')}\n`;
      const { instruments, invalid } = parseMcqBlocks(source);
      expect(instruments).toHaveLength(0);
      expect(invalid).toHaveLength(1);
      expect(invalid[0]?.reason).toBe('corrupted-or-unterminated');
      expect(invalid[0]?.detail).toContain('never closed');
    });

    it('a properly closed block is unaffected — no false unterminated report', () => {
      const { instruments, invalid } = parseMcqBlocks(block(validLines));
      expect(invalid).toHaveLength(0);
      expect(instruments).toHaveLength(1);
    });
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
        `\`\`\`${MCQ_FENCE_INFO}`,
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

  it('emits predecessor last, after id — both machine fields, id first (ol-2zfj.37)', () => {
    expect(
      serializeMcq({
        stem: 'which one is it?',
        answer: 'the right one',
        distractors: POOL,
        feedback: 'because of the thing',
        id: 'item-2',
        predecessor: 'item-1',
      }),
    ).toBe(
      [
        `\`\`\`${MCQ_FENCE_INFO}`,
        'stem: which one is it?',
        'answer: the right one',
        ...POOL.map((d) => `distractor: ${d}`),
        'feedback: because of the thing',
        'id: item-2',
        'predecessor: item-1',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('refuses to emit anything its own parser would reject', () => {
    const base = { stem: 'q', answer: 'a', distractors: POOL };
    expect(() =>
      serializeMcq({ ...base, distractors: POOL.slice(0, MIN_DISTRACTOR_POOL - 1) }),
    ).toThrowError(new RegExp(`at least ${MIN_DISTRACTOR_POOL}`));
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
    const source = [`~~~~${MCQ_FENCE_INFO}`, ...validLines, '~~~~', ''].join('\r\n');
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
        fields: { stem: 'q', answer: 'a', distractors: POOL.slice(0, MIN_DISTRACTOR_POOL - 1) },
      }),
    ).toThrowError(new RegExp(`at least ${MIN_DISTRACTOR_POOL}`));
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

// `[D-133]`'s revision-chain field, MCQ-format-aware write half
// (ol-w00s / ol-2zfj.37). Mirrors `stampMcqId`'s own suite structure, field
// for field — the two functions share every mechanic except that this one
// never generates the value it stamps.
describe('stampMcqPredecessor — the MCQ-aware write half of [D-133]', () => {
  const unstamped = ['her own line above', '', block(validLines), 'and prose below'].join('\n');
  const unstampedSpan = (() => {
    const { instruments } = parseMcqBlocks(unstamped);
    const span = instruments[0]?.span;
    if (!span) throw new Error('fixture has no MCQ block');
    return span;
  })();

  it('stamps a predecessor id when the block has none', () => {
    const result = stampMcqPredecessor(unstamped, unstampedSpan, 'item-1');
    expect(result.changed).toBe(true);
    expect(result.predecessor).toBe('item-1');
    const reparsed = parseMcqBlocks(result.content);
    expect(reparsed.invalid).toHaveLength(0);
    expect(reparsed.instruments[0]?.predecessor).toBe('item-1');
  });

  it('writes exactly one new line — the predecessor field — and touches nothing else (C1.2, INV-2)', () => {
    const result = stampMcqPredecessor(unstamped, unstampedSpan, 'item-1');
    if (!result.insertedSpan) throw new Error('expected a span for a changed stamp');
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(unstamped);
    const insertedText = result.content.slice(result.insertedSpan.start, result.insertedSpan.end);
    expect(insertedText).toBe('predecessor: item-1\n');
  });

  it('stamps after an existing id, keeping "human fields first, machine fields last"', () => {
    const withId = stampMcqId(unstamped, unstampedSpan, { generateId: () => 'item-2' }).content;
    const idSpan = parseMcqBlocks(withId).instruments[0]?.span;
    if (!idSpan) throw new Error('no instrument after id stamp');
    const result = stampMcqPredecessor(withId, idSpan, 'item-1');
    const { instruments, invalid } = parseMcqBlocks(result.content);
    expect(invalid).toHaveLength(0);
    const instrument = instruments[0];
    if (!instrument) throw new Error('no instrument');
    expect(instrument).toMatchObject({ id: 'item-2', predecessor: 'item-1' });
    expect(serializeMcqInstrument(instrument)).toBe(instrument.raw);
  });

  it('is idempotent: stamping an already-stamped block is a byte-identical no-op, read-then-mint (never recompute)', () => {
    const first = stampMcqPredecessor(unstamped, unstampedSpan, 'item-1');
    const restamped = parseMcqBlocks(first.content).instruments[0]?.span;
    if (!restamped) throw new Error('no instrument after first stamp');
    const second = stampMcqPredecessor(first.content, restamped, 'a-different-predecessor');
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.predecessor).toBe('item-1');
  });

  it('throws on an empty predecessorInstrumentId', () => {
    expect(() => stampMcqPredecessor(unstamped, unstampedSpan, '')).toThrowError(
      /must not be empty/,
    );
    expect(() => stampMcqPredecessor(unstamped, unstampedSpan, '   ')).toThrowError(
      /must not be empty/,
    );
  });

  it('throws rather than stamp a block that is not there', () => {
    expect(() => stampMcqPredecessor(unstamped, { start: 0, end: 3 }, 'item-1')).toThrowError(
      /no code block/,
    );
  });

  it('throws rather than stamp a block that fails to parse as an MCQ', () => {
    const invalidBlock = block(['stem: q', 'answer: a', 'distractor: only-one']);
    const source = `${invalidBlock}\n`;
    const doc = parseDocument(source);
    const codeBlock = doc.blocks.find((b) => b.kind === 'code');
    if (!codeBlock) throw new Error('no code block in fixture');
    expect(() =>
      stampMcqPredecessor(source, { start: codeBlock.start, end: codeBlock.end }, 'item-1'),
    ).toThrowError(/does not parse as an MCQ instrument/);
  });
});

// `[D-407]` (ol-0r92.118): a handed-off practice-paper item keeps its paper and slot on one
// optional field of its own block, written once at hand-off, beside `predecessor`.
describe('paper-origin — [D-407] practice-paper provenance on the block', () => {
  const ORIGIN = { paperId: 'paper-key1:0000-synthetic', slotId: 'slot-3' };

  it('a block without the field parses exactly as before: no paperOrigin key at all', () => {
    const [instrument] = parseMcqBlocks(block(validLines)).instruments;
    expect(instrument).toBeDefined();
    expect(instrument && 'paperOrigin' in instrument).toBe(false);
    for (const golden of parseMcqBlocks(readFixture('mcq-valid.md')).instruments) {
      expect('paperOrigin' in golden).toBe(false);
    }
  });

  it('parses the field into paper id and slot id, in any field position and key case', () => {
    for (const lines of [
      [...validLines, 'id: item-1', `paper-origin: ${ORIGIN.paperId} ${ORIGIN.slotId}`],
      [`Paper-Origin:   ${ORIGIN.paperId}\t${ORIGIN.slotId}  `, ...validLines],
    ]) {
      const { instruments, invalid } = parseMcqBlocks(block(lines));
      expect(invalid).toHaveLength(0);
      expect(instruments[0]?.paperOrigin).toEqual(ORIGIN);
    }
  });

  it('round-trips byte-identically, and serializes it last, after id and predecessor', () => {
    const text = serializeMcq({
      stem: 'q',
      answer: 'a',
      distractors: POOL_AT_FLOOR,
      feedback: 'f',
      id: 'item-1',
      predecessor: 'item-0',
      paperOrigin: ORIGIN,
    });
    expect(text.split('\n').slice(-3, -1)).toEqual([
      `paper-origin: ${ORIGIN.paperId} ${ORIGIN.slotId}`,
      '```',
    ]);
    const [instrument] = parseMcqBlocks(text).instruments;
    if (!instrument) throw new Error('no instrument');
    expect(instrument.paperOrigin).toEqual(ORIGIN);
    expect(instrument.predecessor).toBe('item-0');
    expect(serializeMcqInstrument(instrument)).toBe(text);

    const crlf = serializeMcq(
      { stem: 'q', answer: 'a', distractors: POOL_AT_FLOOR, paperOrigin: ORIGIN },
      { fence: '~~~~', terminator: '\r\n' },
    );
    const [crlfInstrument] = parseMcqBlocks(crlf).instruments;
    if (!crlfInstrument) throw new Error('no CRLF instrument');
    expect(serializeMcqInstrument(crlfInstrument)).toBe(crlf);
  });

  it('a repeated or empty field makes the block invalid, like every other single field', () => {
    const repeated = parseMcqBlocks(
      block([...validLines, 'paper-origin: p1 s1', 'paper-origin: p1 s1']),
    );
    expect(repeated.invalid.map((i) => i.reason)).toEqual(['repeated-field']);
    const empty = parseMcqBlocks(block([...validLines, 'paper-origin:']));
    expect(empty.invalid.map((i) => i.reason)).toEqual(['empty-value']);
  });

  it('an unreadable value leaves the instrument reviewable with its origin unknown, never guessed', () => {
    for (const value of ['only-one-token', 'three tokens here']) {
      const { instruments, invalid } = parseMcqBlocks(
        block([...validLines, `paper-origin: ${value}`]),
      );
      expect(invalid).toHaveLength(0);
      expect(instruments).toHaveLength(1);
      expect(instruments[0] && 'paperOrigin' in instruments[0]).toBe(false);
    }
  });

  it('parse and format are inverses, and format refuses what parse could not read back', () => {
    expect(parseMcqPaperOrigin(formatMcqPaperOrigin(ORIGIN))).toEqual(ORIGIN);
    expect(() => formatMcqPaperOrigin({ paperId: '', slotId: 's' })).toThrowError(/paperId/);
    expect(() => formatMcqPaperOrigin({ paperId: 'p', slotId: 'slot 1' })).toThrowError(/slotId/);
    expect(() =>
      serializeMcq({
        stem: 'q',
        answer: 'a',
        distractors: POOL_AT_FLOOR,
        paperOrigin: { paperId: 'a b', slotId: 's' },
      }),
    ).toThrowError(/paperId/);
  });
});

describe('stampMcqPaperOrigin — the write half of [D-407]', () => {
  const ORIGIN = { paperId: 'paper-key1:0000-synthetic', slotId: 'slot-3' };
  const unstamped = ['her own line above', '', block(validLines), 'and prose below'].join('\n');
  const spanOf = (source: string) => {
    const span = parseMcqBlocks(source).instruments[0]?.span;
    if (!span) throw new Error('fixture has no MCQ block');
    return span;
  };

  it('writes exactly one new line before the closing fence and touches nothing else (C1.2, INV-2)', () => {
    const result = stampMcqPaperOrigin(unstamped, spanOf(unstamped), ORIGIN);
    expect(result.changed).toBe(true);
    expect(result.paperOrigin).toEqual(ORIGIN);
    if (!result.insertedSpan) throw new Error('expected a span for a changed stamp');
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(unstamped);
    expect(result.content.slice(result.insertedSpan.start, result.insertedSpan.end)).toBe(
      `paper-origin: ${ORIGIN.paperId} ${ORIGIN.slotId}\n`,
    );
    expect(parseMcqBlocks(result.content).instruments[0]?.paperOrigin).toEqual(ORIGIN);
  });

  it('stamps after id and predecessor, and the result serializes back to its own bytes', () => {
    const withId = stampMcqId(unstamped, spanOf(unstamped), { generateId: () => 'item-2' }).content;
    const withPred = stampMcqPredecessor(withId, spanOf(withId), 'item-1').content;
    const result = stampMcqPaperOrigin(withPred, spanOf(withPred), ORIGIN);
    const [instrument] = parseMcqBlocks(result.content).instruments;
    if (!instrument) throw new Error('no instrument');
    expect(instrument).toMatchObject({ id: 'item-2', predecessor: 'item-1', paperOrigin: ORIGIN });
    expect(serializeMcqInstrument(instrument)).toBe(instrument.raw);
  });

  it('is idempotent: a second stamp, even naming another origin, is a byte-identical no-op', () => {
    const first = stampMcqPaperOrigin(unstamped, spanOf(unstamped), ORIGIN);
    const second = stampMcqPaperOrigin(first.content, spanOf(first.content), {
      paperId: 'paper-key1:other',
      slotId: 'slot-9',
    });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.paperOrigin).toEqual(ORIGIN);
  });

  it('never overwrites or duplicates an unreadable value already on the block', () => {
    const source = block([...validLines, 'paper-origin: hand-edited']);
    const result = stampMcqPaperOrigin(source, spanOf(source), ORIGIN);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(source);
    expect(result.paperOrigin).toBeNull();
  });

  it('keeps a CRLF note CRLF and a tilde fence a tilde fence', () => {
    const source = `${['~~~olea-mcq', ...validLines, '~~~'].join('\r\n')}\r\n`;
    const result = stampMcqPaperOrigin(source, spanOf(source), ORIGIN);
    if (!result.insertedSpan) throw new Error('expected a span');
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(source);
    expect(result.content).toContain(`paper-origin: ${ORIGIN.paperId} ${ORIGIN.slotId}\r\n~~~\r\n`);
  });

  it('throws rather than stamp a missing block, an invalid one, or an unwritable origin', () => {
    expect(() => stampMcqPaperOrigin(unstamped, { start: 0, end: 3 }, ORIGIN)).toThrowError(
      /no code block/,
    );
    const invalidSource = `${block(['stem: q', 'answer: a', 'distractor: only-one'])}\n`;
    const codeBlock = parseDocument(invalidSource).blocks.find((b) => b.kind === 'code');
    if (!codeBlock) throw new Error('no code block in fixture');
    expect(() =>
      stampMcqPaperOrigin(invalidSource, { start: codeBlock.start, end: codeBlock.end }, ORIGIN),
    ).toThrowError(/does not parse as an MCQ instrument/);
    expect(() =>
      stampMcqPaperOrigin(unstamped, spanOf(unstamped), { paperId: 'p', slotId: '' }),
    ).toThrowError(/slotId/);
  });
});
