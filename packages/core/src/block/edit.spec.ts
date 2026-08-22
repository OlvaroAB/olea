// The body half of the round-trip engine (INV-2, P2-T04). The scenarios this
// backs are in features/F2-review.md under "F2.1 — Inline card creation writes
// through the round-trip engine"; this file tests the primitive itself, which
// the instrument write paths are the only production callers of.
import { describe, expect, it } from 'vitest';
import { applyDocumentEdits, removeSpans } from './edit.js';
import { parseDocument } from './parse.js';
import type { ParsedDocument } from './types.js';

const SOURCE = '---\nkey: value\n---\n\nfirst paragraph\n\n- item one\n- item two\n\nlast line\n';

describe('applyDocumentEdits', () => {
  it('no edits is identity, for a document with every block kind in it', () => {
    const source = `${SOURCE}\n> [!note] a callout\n\n\`\`\`js\ncode();\n\`\`\`\n\n***\n`;
    const doc = parseDocument(source);
    expect(new Set(doc.blocks.map((b) => b.kind)).size).toBeGreaterThanOrEqual(6);
    expect(applyDocumentEdits(doc, []).content).toBe(source);
  });

  it('applies edits in source order however they are given, and reports spans in input order', () => {
    const doc = parseDocument(SOURCE);
    const last = doc.blocks[doc.blocks.length - 1];
    if (!last) throw new Error('no blocks');
    const result = applyDocumentEdits(doc, [
      { kind: 'insert', at: last.start, text: 'Z' },
      { kind: 'insert', at: 0, text: 'A' },
    ]);
    expect(result.content.startsWith('A---')).toBe(true);
    const [zSpan, aSpan] = result.spans;
    if (!zSpan || !aSpan) throw new Error('missing spans');
    expect(result.content.slice(zSpan.start, zSpan.end)).toBe('Z');
    expect(result.content.slice(aSpan.start, aSpan.end)).toBe('A');
    expect(removeSpans(result.content, result.spans)).toBe(SOURCE);
  });

  it('a replacement inside one block leaves every other byte alone', () => {
    const doc = parseDocument(SOURCE);
    const paragraph = doc.blocks.find((b) => b.kind === 'paragraph');
    if (!paragraph) throw new Error('no paragraph');
    const result = applyDocumentEdits(doc, [
      { kind: 'replace', start: paragraph.start, end: paragraph.start + 5, text: 'FIRST' },
    ]);
    expect(result.content).toBe(SOURCE.replace('first', 'FIRST'));
  });

  it('a zero-width replacement is how a suffix is appended inside a block', () => {
    const doc = parseDocument(SOURCE);
    const paragraph = doc.blocks.find((b) => b.kind === 'paragraph');
    if (!paragraph) throw new Error('no paragraph');
    const at = paragraph.end - 1; // just before the paragraph's newline
    const result = applyDocumentEdits(doc, [
      { kind: 'replace', start: at, end: at, text: ' ^id1' },
    ]);
    expect(result.content).toContain('first paragraph ^id1\n');
    expect(removeSpans(result.content, result.spans)).toBe(SOURCE);
  });

  it('refuses a document whose blocks do not tile its source', () => {
    // A hand-built `ParsedDocument` whose offsets lie. Nothing in the parser
    // produces this — the point is that the writer checks rather than trusts,
    // because a caller can construct one and the bytes at stake are her vault.
    const doc = {
      source: SOURCE,
      blocks: [{ kind: 'paragraph', raw: 'nope', start: 0, end: 4 }],
    } as unknown as ParsedDocument;
    expect(() => applyDocumentEdits(doc, [])).toThrowError(/does not tile its source/);
  });

  it('refuses ranges outside the source, backwards ranges, and non-integer offsets', () => {
    const doc = parseDocument(SOURCE);
    expect(() =>
      applyDocumentEdits(doc, [{ kind: 'insert', at: SOURCE.length + 1, text: 'x' }]),
    ).toThrowError(/outside the source/);
    expect(() =>
      applyDocumentEdits(doc, [{ kind: 'replace', start: 10, end: 4, text: 'x' }]),
    ).toThrowError(/outside the source/);
    expect(() => applyDocumentEdits(doc, [{ kind: 'insert', at: 1.5, text: 'x' }])).toThrowError(
      /must be integers/,
    );
  });

  it('allows an insertion at the very end of the file', () => {
    const doc = parseDocument(SOURCE);
    const result = applyDocumentEdits(doc, [{ kind: 'insert', at: SOURCE.length, text: 'tail\n' }]);
    expect(result.content).toBe(`${SOURCE}tail\n`);
  });

  it('never re-renders frontmatter, whatever a YAML library would do to it', () => {
    // The shape `fixtures/vault/README.md` records PyYAML as silently
    // corrupting. It is not the target of the edit; it must come out unread.
    const source = '---\nrelated: [[[A]], [[B]]]\nz: 1\na: 2\n---\n\nbody\n';
    const doc = parseDocument(source);
    const body = doc.blocks[doc.blocks.length - 1];
    if (!body) throw new Error('no body');
    const result = applyDocumentEdits(doc, [{ kind: 'insert', at: body.end, text: 'more\n' }]);
    expect(result.content.startsWith('---\nrelated: [[[A]], [[B]]]\nz: 1\na: 2\n---\n')).toBe(true);
  });
});

describe('removeSpans', () => {
  it('is the exact inverse of a set of insertions', () => {
    const doc = parseDocument(SOURCE);
    const result = applyDocumentEdits(doc, [
      { kind: 'insert', at: 0, text: 'A' },
      { kind: 'insert', at: SOURCE.length, text: 'B' },
    ]);
    expect(removeSpans(result.content, result.spans)).toBe(SOURCE);
  });

  it('removing nothing is identity', () => {
    expect(removeSpans(SOURCE, [])).toBe(SOURCE);
  });
});
