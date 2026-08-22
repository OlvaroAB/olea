import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './parse.js';
import { serializeFrontmatter, setEntryValue } from './serialize.js';
import { isFrontmatterLossless } from './types.js';

describe('serializeFrontmatter', () => {
  it('is exact identity for anything parseFrontmatter produced', () => {
    const inner = 'citekey: x\nauthors: [T. Norling]\nrelated: [[A]] [[B]]\n';
    const fm = parseFrontmatter(inner);
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('is just a join of node.raw, independent of the inner field', () => {
    // Deliberately construct a Frontmatter whose `inner` disagrees with its
    // nodes, to prove serialize derives from nodes, not from the stored
    // (and here, stale) `inner`.
    const fm = {
      inner: 'stale',
      nodes: [
        { kind: 'entry' as const, key: 'a', raw: 'a: 1\n', valueRaw: '1\n' },
        { kind: 'entry' as const, key: 'b', raw: 'b: 2\n', valueRaw: '2\n' },
      ],
    };
    expect(serializeFrontmatter(fm)).toBe('a: 1\nb: 2\n');
  });
});

describe('setEntryValue', () => {
  it("replaces only the named entry's value, preserving the original separator style", () => {
    const inner = 'citekey: old\nyear: 2019\n';
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'citekey', 'new\n');
    expect(serializeFrontmatter(edited)).toBe('citekey: new\nyear: 2019\n');
    expect(isFrontmatterLossless(edited)).toBe(true);
  });

  it('preserves an entry with no separator space (colon immediately followed by newline)', () => {
    const inner = 'authors:\n  - H. Halloran\nyear: 2018\n';
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'authors', '\n  - New Author\n');
    expect(serializeFrontmatter(edited)).toBe('authors:\n  - New Author\nyear: 2018\n');
  });

  it('does not mutate the input Frontmatter (returns a new one)', () => {
    const inner = 'citekey: old\n';
    const fm = parseFrontmatter(inner);
    setEntryValue(fm, 'citekey', 'new\n');
    expect(serializeFrontmatter(fm)).toBe(inner);
  });

  it('editing the only entry in a single-entry frontmatter round-trips', () => {
    const fm = parseFrontmatter('key: old\n');
    const edited = setEntryValue(fm, 'key', 'new\n');
    expect(serializeFrontmatter(edited)).toBe('key: new\n');
  });

  it('editing one entry leaves passthrough nodes (comments, blanks) byte-identical', () => {
    const inner = '# a comment\nkey: old\n\nother: value\n';
    const fm = parseFrontmatter(inner);
    const edited = setEntryValue(fm, 'key', 'new\n');
    expect(serializeFrontmatter(edited)).toBe('# a comment\nkey: new\n\nother: value\n');
  });

  it('throws when the key does not exist, rather than silently no-op-ing', () => {
    const fm = parseFrontmatter('key: value\n');
    expect(() => setEntryValue(fm, 'missing', 'x\n')).toThrow(/missing/);
  });

  it('when a key appears more than once (malformed but tolerated on read), edits the first occurrence', () => {
    const fm = parseFrontmatter('key: first\nkey: second\n');
    const edited = setEntryValue(fm, 'key', 'edited\n');
    expect(serializeFrontmatter(edited)).toBe('key: edited\nkey: second\n');
  });
});
