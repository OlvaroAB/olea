/**
 * `stampPaperOriginField` / `readPaperOriginField` tests (`[D-407]`,
 * `ol-0r92.118`): a handed-off practice-paper item's paper and slot, one
 * optional field on its own block, stamped once, idempotently. Synthetic
 * content only.
 */
import { parseDocument, parseMcqBlocks, removeSpans } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  PAPER_ORIGIN_FIELD_NAME,
  readPaperOriginField,
  stampPaperOriginField,
} from '../../src/instrument-blocks/index.js';

const ORIGIN = { paperId: 'paper-key1:0000-synthetic', slotId: 'slot-2' };
const MCQ_LINES = ['stem: s', 'answer: a', 'distractor: b', 'distractor: c'];

function block(lines: readonly string[], terminator = '\n'): string {
  return ['```olea-mcq', ...lines, '```', ''].join(terminator);
}

function findCodeBlock(source: string): { start: number; end: number; raw: string } {
  const found = parseDocument(source).blocks.find((b) => b.kind === 'code');
  if (!found) throw new Error('test setup: no code block found');
  return { start: found.start, end: found.end, raw: found.raw };
}

describe('readPaperOriginField', () => {
  it('returns null when the block carries no paper-origin field', () => {
    expect(readPaperOriginField(findCodeBlock(block(MCQ_LINES)))).toBeNull();
  });

  it('reads the paper id and slot id regardless of field order', () => {
    const source = block([`paper-origin: ${ORIGIN.paperId} ${ORIGIN.slotId}`, ...MCQ_LINES]);
    expect(readPaperOriginField(findCodeBlock(source))).toEqual(ORIGIN);
  });

  it('reads an unreadable value as no origin, never a guess', () => {
    const source = block([...MCQ_LINES, 'paper-origin: one-token-only']);
    expect(readPaperOriginField(findCodeBlock(source))).toBeNull();
  });
});

describe('stampPaperOriginField', () => {
  it('inserts the field immediately before the closing fence, changing nothing else (INV-2)', () => {
    const source = ['her prose above', '', block(MCQ_LINES), 'her prose below', ''].join('\n');
    const result = stampPaperOriginField(source, findCodeBlock(source), ORIGIN);

    expect(result.changed).toBe(true);
    expect(result.paperOrigin).toEqual(ORIGIN);
    if (!result.insertedSpan) throw new Error('expected a span');
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(source);
    expect(result.content.slice(result.insertedSpan.start, result.insertedSpan.end)).toBe(
      `${PAPER_ORIGIN_FIELD_NAME}: ${ORIGIN.paperId} ${ORIGIN.slotId}\n`,
    );
  });

  it('agrees with olea-core: the stamped block parses as a valid MCQ carrying the same origin', () => {
    const source = block([...MCQ_LINES, 'id: mcq-synthetic1']);
    const result = stampPaperOriginField(source, findCodeBlock(source), ORIGIN);
    const { instruments, invalid } = parseMcqBlocks(result.content);
    expect(invalid).toHaveLength(0);
    expect(instruments[0]?.paperOrigin).toEqual(ORIGIN);
    expect(instruments[0]?.id).toBe('mcq-synthetic1');
  });

  it('is idempotent: a second stamp, even naming another origin, is a byte-identical no-op', () => {
    const source = block(MCQ_LINES);
    const first = stampPaperOriginField(source, findCodeBlock(source), ORIGIN);
    const second = stampPaperOriginField(first.content, findCodeBlock(first.content), {
      paperId: 'paper-key1:other',
      slotId: 'slot-9',
    });
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.paperOrigin).toEqual(ORIGIN);
    expect(second.insertedSpan).toBeNull();
  });

  it('never overwrites or duplicates an unreadable value already on the block', () => {
    const source = block([...MCQ_LINES, 'paper-origin: hand-edited']);
    const result = stampPaperOriginField(source, findCodeBlock(source), ORIGIN);
    expect(result.changed).toBe(false);
    expect(result.content).toBe(source);
    expect(result.paperOrigin).toBeNull();
  });

  it('keeps a CRLF block CRLF', () => {
    const source = block(MCQ_LINES, '\r\n');
    const result = stampPaperOriginField(source, findCodeBlock(source), ORIGIN);
    if (!result.insertedSpan) throw new Error('expected a span');
    expect(removeSpans(result.content, [result.insertedSpan])).toBe(source);
    expect(result.content).toContain(`${ORIGIN.slotId}\r\n\`\`\`\r\n`);
  });

  it('throws on an origin it could not read back, and on a span with no code block', () => {
    const source = block(MCQ_LINES);
    expect(() =>
      stampPaperOriginField(source, findCodeBlock(source), { paperId: 'p q', slotId: 's' }),
    ).toThrowError(/paperId/);
    expect(() =>
      stampPaperOriginField(source, findCodeBlock(source), { paperId: 'p', slotId: '' }),
    ).toThrowError(/slotId/);
    expect(() => stampPaperOriginField(source, { start: 0, end: 2 }, ORIGIN)).toThrowError(
      /no code block/,
    );
  });
});
