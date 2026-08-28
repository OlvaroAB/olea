/**
 * `stampPredecessorField` / `readPredecessorField` tests (`[D-133]`,
 * `ol-w00s`).
 *
 * Exercised against a generic fenced code block, deliberately not an
 * `olea-mcq` one parsed through `parseMcqBlocks` — see `predecessor.ts`'s
 * module doc for why wiring this against a real MCQ block is blocked on a
 * core change this bead does not own.
 */
import { parseDocument } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  PREDECESSOR_FIELD_NAME,
  readPredecessorField,
  stampPredecessorField,
} from '../../src/instrument-blocks/predecessor.js';

function block(lines: readonly string[]): string {
  return ['```olea-mcq', ...lines, '```', ''].join('\n');
}

function findCodeBlock(source: string): { start: number; end: number; raw: string } {
  const doc = parseDocument(source);
  const found = doc.blocks.find((b) => b.kind === 'code');
  if (!found) throw new Error('test setup: no code block found');
  return { start: found.start, end: found.end, raw: found.raw };
}

function codeBlockSpan(source: string): { start: number; end: number } {
  return findCodeBlock(source);
}

describe('readPredecessorField', () => {
  it('returns null when the block carries no predecessor field', () => {
    const source = block(['stem: s', 'answer: a']);
    expect(readPredecessorField(findCodeBlock(source))).toBeNull();
  });

  it('reads a present predecessor field regardless of field order', () => {
    const source = block(['predecessor: mcq-old1', 'stem: s', 'answer: a']);
    expect(readPredecessorField(findCodeBlock(source))).toBe('mcq-old1');
  });
});

describe('stampPredecessorField', () => {
  it('inserts the field immediately before the closing fence, changing nothing else', () => {
    const source = block(['stem: s', 'answer: a']);
    const span = codeBlockSpan(source);

    const result = stampPredecessorField(source, span, 'mcq-old1');

    expect(result.changed).toBe(true);
    expect(result.predecessorInstrumentId).toBe('mcq-old1');
    expect(result.insertedSpan).not.toBeNull();
    expect(result.content).toBe(
      [
        '```olea-mcq',
        'stem: s',
        'answer: a',
        `${PREDECESSOR_FIELD_NAME}: mcq-old1`,
        '```',
        '',
      ].join('\n'),
    );

    // Every byte outside the inserted line is untouched (INV-2's direct form).
    if (result.insertedSpan === null) throw new Error('expected an inserted span');
    const { start, end } = result.insertedSpan;
    const withoutInsert = result.content.slice(0, start) + result.content.slice(end);
    expect(withoutInsert).toBe(source);
  });

  it('is idempotent: re-running on an already-stamped block is a byte-identical no-op', () => {
    const source = block(['stem: s', 'answer: a']);
    const span = codeBlockSpan(source);
    const first = stampPredecessorField(source, span, 'mcq-old1');

    const secondSpan = codeBlockSpan(first.content);
    const second = stampPredecessorField(first.content, secondSpan, 'mcq-old1');

    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.predecessorInstrumentId).toBe('mcq-old1');
    expect(second.insertedSpan).toBeNull();
  });

  it('read-then-mint: a pre-existing predecessor value is returned, never overwritten', () => {
    const source = block(['stem: s', 'answer: a', 'predecessor: mcq-existing']);
    const span = codeBlockSpan(source);

    const result = stampPredecessorField(source, span, 'mcq-different');

    expect(result.changed).toBe(false);
    expect(result.predecessorInstrumentId).toBe('mcq-existing');
    expect(result.content).toBe(source);
  });

  it('rejects an empty predecessor id', () => {
    const source = block(['stem: s', 'answer: a']);
    const span = codeBlockSpan(source);
    expect(() => stampPredecessorField(source, span, '  ')).toThrow(/must not be empty/);
  });

  it('preserves CRLF line endings', () => {
    const source = block(['stem: s', 'answer: a']).replace(/\n/g, '\r\n');
    const span = codeBlockSpan(source);

    const result = stampPredecessorField(source, span, 'mcq-old1');

    expect(result.content).toContain(`predecessor: mcq-old1\r\n`);
    expect(result.content).not.toMatch(/[^\r]\n/);
  });
});
