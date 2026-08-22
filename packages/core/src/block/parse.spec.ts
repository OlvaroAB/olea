import { describe, expect, it } from 'vitest';
import { parseDocument } from './parse.js';
import { isLossless } from './types.js';

/** Convenience: assert isLossless and return the doc, for terser tests below. */
function parseAndCheck(source: string) {
  const doc = parseDocument(source);
  expect(isLossless(doc)).toBe(true);
  return doc;
}

describe('parseDocument — frontmatter (C1.3: delimited, not interpreted)', () => {
  it('captures inner verbatim, excluding the delimiter lines', () => {
    const source = '---\nfoo: bar\ntags: [[Wikilink]]\n---\n\n# Title\n';
    const doc = parseAndCheck(source);
    expect(doc.blocks[0]?.kind).toBe('frontmatter');
    if (doc.blocks[0]?.kind === 'frontmatter') {
      expect(doc.blocks[0].inner).toBe('foo: bar\ntags: [[Wikilink]]\n');
      expect(doc.blocks[0].raw).toBe('---\nfoo: bar\ntags: [[Wikilink]]\n---\n');
    }
  });

  it('is only recognised at offset 0 — a mid-file `---` is not frontmatter', () => {
    const source = 'Some paragraph text.\n\n---\n\nMore text.\n';
    const doc = parseAndCheck(source);
    expect(doc.blocks.some((b) => b.kind === 'frontmatter')).toBe(false);
    expect(doc.blocks.some((b) => b.kind === 'thematicBreak')).toBe(true);
  });

  it('does not extend to a `---` inside a fenced code block (the classic bug)', () => {
    const source = '---\nkey: value\n---\n\n```\n---\nnested\n---\n```\n';
    const doc = parseAndCheck(source);
    const frontmatter = doc.blocks.find((b) => b.kind === 'frontmatter');
    expect(frontmatter?.kind).toBe('frontmatter');
    if (frontmatter?.kind === 'frontmatter') {
      expect(frontmatter.inner).toBe('key: value\n');
    }
    const code = doc.blocks.find((b) => b.kind === 'code');
    expect(code?.raw).toBe('```\n---\nnested\n---\n```\n');
  });

  it('falls through to a thematic break when the opening `---` is never closed', () => {
    const source = '---\nno closing delimiter here\n';
    const doc = parseAndCheck(source);
    expect(doc.blocks.some((b) => b.kind === 'frontmatter')).toBe(false);
    expect(doc.blocks[0]?.kind).toBe('thematicBreak');
  });
});

describe('parseDocument — headings', () => {
  it('reads level from the `#` run and trims the text', () => {
    const doc = parseAndCheck('## Describe the stages of impulse regeneration at a node\n');
    const block = doc.blocks[0];
    expect(block?.kind).toBe('heading');
    if (block?.kind === 'heading') {
      expect(block.level).toBe(2);
      expect(block.text).toBe('Describe the stages of impulse regeneration at a node');
    }
  });

  it('does not treat `#tag`-style text (no space after hash) as a heading', () => {
    const doc = parseAndCheck('#tag not a heading\n');
    expect(doc.blocks[0]?.kind).toBe('paragraph');
  });

  it('does not treat more than 6 leading `#` as a heading', () => {
    const doc = parseAndCheck('####### too many\n');
    expect(doc.blocks[0]?.kind).toBe('paragraph');
  });
});

describe('parseDocument — lists', () => {
  it('parses an ordered list, one item per source line', () => {
    const doc = parseAndCheck('1. First\n2. Second\n3. Third\n');
    const block = doc.blocks[0];
    expect(block?.kind).toBe('list');
    if (block?.kind === 'list') {
      expect(block.ordered).toBe(true);
      expect(block.items.map((i) => i.text)).toEqual(['First', 'Second', 'Third']);
    }
  });

  it('preserves a literal tab indent verbatim and reports depth 1', () => {
    const doc = parseAndCheck('\t- Nested under a tab\n\t- Another\n');
    const block = doc.blocks[0];
    expect(block?.kind).toBe('list');
    if (block?.kind === 'list') {
      expect(block.items[0]?.indentRaw).toBe('\t');
      expect(block.items[0]?.depth).toBe(1);
      expect(block.items[0]?.raw).toBe('\t- Nested under a tab\n');
    }
  });
});

describe('parseDocument — fenced code blocks', () => {
  it('captures the fence marker and trimmed info string', () => {
    const doc = parseAndCheck('```ts\nconst x = 1;\n```\n');
    const block = doc.blocks[0];
    expect(block?.kind).toBe('code');
    if (block?.kind === 'code') {
      expect(block.fence).toBe('```');
      expect(block.info).toBe('ts');
    }
  });

  it('an unterminated fence runs to end of file rather than being dropped', () => {
    const doc = parseAndCheck('```\nline one\nline two\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.kind).toBe('code');
    expect(doc.blocks[0]?.raw).toBe('```\nline one\nline two\n');
  });
});

describe('parseDocument — thematic breaks', () => {
  it.each(['---', '***', '___', '- - -'])('recognises %s as a thematic break mid-file', (rule) => {
    const doc = parseAndCheck(`Paragraph.\n\n${rule}\n\nMore.\n`);
    expect(doc.blocks.some((b) => b.kind === 'thematicBreak' && b.raw === `${rule}\n`)).toBe(true);
  });
});

describe('parseDocument — callouts', () => {
  it('parses a plain callout with no title and no fold', () => {
    const doc = parseAndCheck('> [!note]\n> Body text.\n');
    const block = doc.blocks[0];
    expect(block?.kind).toBe('callout');
    if (block?.kind === 'callout') {
      expect(block.calloutType).toBe('note');
      expect(block.title).toBe('');
      expect(block.fold).toBe('');
      expect(block.raw).toBe('> [!note]\n> Body text.\n');
    }
  });

  it('parses a titled callout', () => {
    const doc = parseAndCheck('> [!tip] Quick reminder\n> Body.\n');
    const block = doc.blocks[0];
    if (block?.kind === 'callout') {
      expect(block.calloutType).toBe('tip');
      expect(block.title).toBe('Quick reminder');
      expect(block.fold).toBe('');
    }
  });

  it('parses a foldable callout (default closed) with a title', () => {
    const doc = parseAndCheck('> [!warning]- Common mistake\n> Body.\n');
    const block = doc.blocks[0];
    if (block?.kind === 'callout') {
      expect(block.calloutType).toBe('warning');
      expect(block.fold).toBe('-');
      expect(block.title).toBe('Common mistake');
    }
  });

  it('retains a nested list inside a callout as raw text, unparsed', () => {
    const doc = parseAndCheck('> [!question] Practice list\n> - one\n> - two\n');
    const block = doc.blocks[0];
    expect(block?.kind).toBe('callout');
    expect(block?.raw).toBe('> [!question] Practice list\n> - one\n> - two\n');
  });

  it('ends the callout at the first non-blockquote line', () => {
    const doc = parseAndCheck('> [!note]\n> Body.\n\nAfter.\n');
    expect(doc.blocks[0]?.raw).toBe('> [!note]\n> Body.\n');
    expect(doc.blocks[1]?.kind).toBe('blank');
    expect(doc.blocks[2]?.kind).toBe('paragraph');
  });
});

describe('parseDocument — blank runs', () => {
  it('merges consecutive blank lines into a single block', () => {
    const doc = parseAndCheck('A\n\n\n\nB\n');
    expect(doc.blocks.map((b) => b.kind)).toEqual(['paragraph', 'blank', 'paragraph']);
    expect(doc.blocks[1]?.raw).toBe('\n\n\n');
  });
});

describe('parseDocument — edge cases the task card calls out by name', () => {
  it('an empty file parses to zero blocks and is trivially lossless', () => {
    const doc = parseAndCheck('');
    expect(doc.blocks).toEqual([]);
  });

  it('a frontmatter-only file yields exactly one block', () => {
    const doc = parseAndCheck('---\nkey: value\n---\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]?.kind).toBe('frontmatter');
  });

  it('a file not ending in a newline still round-trips', () => {
    const doc = parseAndCheck('# Title\n\nNo trailing newline here');
    expect(doc.blocks.at(-1)?.raw).toBe('No trailing newline here');
    expect(doc.source.endsWith('\n')).toBe(false);
  });

  it('preserves CRLF line endings verbatim, not normalised to LF', () => {
    const source = '# Title\r\n\r\nBody line one\r\nBody line two\r\n';
    const doc = parseAndCheck(source);
    // Every raw slice that contains a newline at all uses \r\n, never a bare \n.
    for (const block of doc.blocks) {
      if (block.raw.includes('\n')) {
        expect(block.raw.includes('\r\n')).toBe(true);
      }
    }
    expect(doc.blocks[0]?.raw).toBe('# Title\r\n');
    expect(doc.blocks[2]?.raw).toBe('Body line one\r\nBody line two\r\n');
  });

  it('non-ASCII content round-trips with UTF-16 code unit offsets', () => {
    const source = '# Dr. Élise Béranger — “curly quotes”\n\nBody with an em dash — here.\n';
    const doc = parseAndCheck(source);
    expect(doc.blocks[0]?.raw).toBe('# Dr. Élise Béranger — “curly quotes”\n');
  });
});
