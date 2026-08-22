import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './parse.js';
import { isFrontmatterLossless } from './types.js';

/** Convenience: assert isFrontmatterLossless and return the result, for terser tests below. */
function parseAndCheck(inner: string) {
  const fm = parseFrontmatter(inner);
  expect(isFrontmatterLossless(fm)).toBe(true);
  return fm;
}

describe('parseFrontmatter — basic entries', () => {
  it('splits key and value on the first colon, with a single separating space stripped', () => {
    const fm = parseAndCheck('citekey: norling2019turbidite\n');
    expect(fm.nodes).toHaveLength(1);
    const node = fm.nodes[0];
    expect(node?.kind).toBe('entry');
    if (node?.kind === 'entry') {
      expect(node.key).toBe('citekey');
      expect(node.valueRaw).toBe('norling2019turbidite\n');
      expect(node.raw).toBe('citekey: norling2019turbidite\n');
    }
  });

  it('an inline value with extra spaces after the colon keeps the extra spaces in the value', () => {
    // Only one space is separator; a second space belongs to the value.
    const fm = parseAndCheck('key:  extra-leading-space\n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.valueRaw).toBe(' extra-leading-space\n');
    }
  });

  it('a colon with nothing after it on the line is an empty inline value', () => {
    const fm = parseAndCheck('authors:\n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.key).toBe('authors');
      expect(node.valueRaw).toBe('\n');
    }
  });

  it('a colon followed by exactly one trailing separator space and nothing else is also empty', () => {
    const fm = parseAndCheck('course: \n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.valueRaw).toBe('\n');
    }
  });

  it('preserves multiple entries in the order written, non-alphabetical included', () => {
    const fm = parseAndCheck(
      'date: 2026-08-10\ncourses-today: [GEOL204, MUSTH104]\nstatus: open\n',
    );
    const keys = fm.nodes
      .filter((n) => n.kind === 'entry')
      .map((n) => (n.kind === 'entry' ? n.key : ''));
    expect(keys).toEqual(['date', 'courses-today', 'status']);
  });
});

describe('parseFrontmatter — the nasty wikilink shapes (C1.3)', () => {
  it('bare space-separated multi-wikilink value (the shape PyYAML cannot load)', () => {
    const fm = parseAndCheck('related: [[Imbrication]] [[Hummocky stratification]]\n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.valueRaw).toBe('[[Imbrication]] [[Hummocky stratification]]\n');
    }
  });

  it("flow-list wikilinks (PyYAML's silent-corruption shape)", () => {
    const fm = parseAndCheck('related: [[[Imbrication]], [[Bioturbation]]]\n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.valueRaw).toBe('[[[Imbrication]], [[Bioturbation]]]\n');
    }
  });

  it('quoted wikilink keeps its quotes as written', () => {
    const fm = parseAndCheck('related: "[[Deceptive cadence]]"\n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.valueRaw).toBe('"[[Deceptive cadence]]"\n');
    }
  });

  it('block-style list continuation lines belong to the key, not to their own passthrough nodes', () => {
    const fm = parseAndCheck('related:\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n');
    expect(fm.nodes).toHaveLength(1);
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.key).toBe('related');
      expect(node.valueRaw).toBe('\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n');
    }
  });
});

describe('parseFrontmatter — leniency for lines it does not understand', () => {
  it('an indented line with no preceding key becomes a passthrough node, not an error', () => {
    const fm = parseAndCheck('  stray indented line\nkey: value\n');
    expect(fm.nodes[0]?.kind).toBe('other');
    expect(fm.nodes[0]?.raw).toBe('  stray indented line\n');
  });

  it('a line with no colon at all becomes a passthrough node', () => {
    const fm = parseAndCheck('# a comment, not a key\nkey: value\n');
    expect(fm.nodes[0]?.kind).toBe('other');
    expect(fm.nodes[0]?.raw).toBe('# a comment, not a key\n');
  });

  it('a blank line inside frontmatter is its own passthrough node and ends any continuation', () => {
    const fm = parseAndCheck('key:\n\nother: value\n');
    expect(fm.nodes.map((n) => n.kind)).toEqual(['entry', 'other', 'entry']);
  });
});

describe('parseFrontmatter — edge cases', () => {
  it('empty inner parses to zero nodes and is trivially lossless', () => {
    const fm = parseAndCheck('');
    expect(fm.nodes).toEqual([]);
  });

  it('empty-string and empty-list values round-trip exactly', () => {
    const fm = parseAndCheck('subtitle: ""\nrelated: []\n');
    const byKey = new Map(
      fm.nodes.filter((n) => n.kind === 'entry').map((n) => [n.kind === 'entry' ? n.key : '', n]),
    );
    expect(byKey.get('subtitle')?.valueRaw).toBe('""\n');
    expect(byKey.get('related')?.valueRaw).toBe('[]\n');
  });

  it('CRLF line endings inside frontmatter survive verbatim', () => {
    const inner = 'citekey: x\r\nauthors:\r\n  - H. Halloran\r\nyear: 2018\r\n';
    const fm = parseAndCheck(inner);
    for (const node of fm.nodes) {
      if (node.raw.includes('\n')) expect(node.raw.includes('\r\n')).toBe(true);
    }
    const authors = fm.nodes.find((n) => n.kind === 'entry' && n.key === 'authors');
    if (authors?.kind === 'entry') {
      expect(authors.raw).toBe('authors:\r\n  - H. Halloran\r\n');
    }
  });

  it('a final entry with no trailing newline still round-trips', () => {
    const fm = parseAndCheck('key: value with no trailing newline');
    expect(fm.nodes).toHaveLength(1);
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.valueRaw).toBe('value with no trailing newline');
    }
  });

  it('a key containing a hyphen is captured whole (source-type)', () => {
    const fm = parseAndCheck('source-type: journal-article\n');
    const node = fm.nodes[0];
    if (node?.kind === 'entry') {
      expect(node.key).toBe('source-type');
    }
  });
});
