import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './parse.js';
import { readList, readScalar, readWikilinks, wikilinkTarget } from './read.js';

describe('readScalar — meaning path, lossy by design', () => {
  it('trims whitespace and one layer of quoting', () => {
    const fm = parseFrontmatter('year: "2021"\n');
    expect(readScalar(fm, 'year').scalar).toBe('2021');
  });

  it('leaves a bare scalar as written', () => {
    const fm = parseFrontmatter('course: GEOL204\n');
    expect(readScalar(fm, 'course').scalar).toBe('GEOL204');
  });

  it('an empty inline value yields an empty scalar and no items', () => {
    const fm = parseFrontmatter('subtitle: ""\n');
    const result = readScalar(fm, 'subtitle');
    expect(result.scalar).toBe('');
    expect(result.items).toEqual([]);
  });

  it('a missing key yields the empty InterpretedValue, not an error', () => {
    const fm = parseFrontmatter('key: value\n');
    expect(readScalar(fm, 'nonexistent')).toEqual({ scalar: '', items: [], wikilinks: [] });
  });

  // ol-j9c8: a single-valued field authored as a one-item YAML block list
  // (the value's own line ends after the colon, and the value lives on a
  // "- " continuation line below it) used to come back with the dash still
  // attached, corrupting assessment course attribution — see
  // ../assessment/read.ts's readField, which resolves `course` through this
  // function.
  it('strips the marker from a one-item block-list value, unlike a raw dash-prefixed scalar', () => {
    const fm = parseFrontmatter('course:\n  - GEOL204\n');
    const result = readScalar(fm, 'course');
    expect(result.scalar).toBe('GEOL204');
    expect(result.items).toEqual(['GEOL204']);
  });

  it('unquotes a one-item block-list value the same way a plain quoted scalar is unquoted', () => {
    const fm = parseFrontmatter('course:\n  - "GEOL204"\n');
    expect(readScalar(fm, 'course').scalar).toBe('GEOL204');
  });

  it('does not collapse a genuinely multi-item block list into one scalar (behavior unchanged)', () => {
    // readScalar was never meant to resolve this ambiguity — readList is —
    // so it falls through to the pre-fix trim-and-unquote path, which
    // reproduces the raw multi-line text verbatim, dashes and all. This
    // test documents that shape so a future change to it is deliberate.
    const fm = parseFrontmatter('course:\n  - GEOL204\n  - GEOL205\n');
    const result = readScalar(fm, 'course');
    expect(result.scalar).toBe('- GEOL204\n  - GEOL205');
    expect(result.items).toEqual(['- GEOL204\n  - GEOL205']);
  });
});

describe('readList — meaning path, best-effort over shapes her vault uses', () => {
  it('reads a flow list of bare strings', () => {
    const fm = parseFrontmatter('topic: [Sediment provenance, Clastic deposition]\n');
    expect(readList(fm, 'topic').items).toEqual(['Sediment provenance', 'Clastic deposition']);
  });

  it('reads a single-quoted flow list', () => {
    const fm = parseFrontmatter("authors: ['A. Petrov', 'K. Adeyemi']\n");
    expect(readList(fm, 'authors').items).toEqual(['A. Petrov', 'K. Adeyemi']);
  });

  it('reads a block-style `- item` list across continuation lines', () => {
    const fm = parseFrontmatter('related:\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n');
    expect(readList(fm, 'related').items).toEqual(['[[Appoggiatura]]', '[[Consecutive fifths]]']);
  });

  it('an empty flow list yields no items', () => {
    const fm = parseFrontmatter('related: []\n');
    expect(readList(fm, 'related').items).toEqual([]);
  });

  it('reads bare space-separated wikilinks as a list of their targets', () => {
    const fm = parseFrontmatter('related: [[Imbrication]] [[Hummocky stratification]]\n');
    expect(readList(fm, 'related').items).toEqual(['Imbrication', 'Hummocky stratification']);
  });
});

describe('readWikilinks — the nasty shapes, this is the reader that must never lose a link', () => {
  it('bare space-separated multi-wikilink (the shape PyYAML cannot even load)', () => {
    const fm = parseFrontmatter('related: [[Imbrication]] [[Hummocky stratification]]\n');
    expect(readWikilinks(fm, 'related').wikilinks).toEqual([
      'Imbrication',
      'Hummocky stratification',
    ]);
  });

  it('quoted wikilink — the wikilink survives despite the surrounding quotes', () => {
    const fm = parseFrontmatter('related: "[[Deceptive cadence]]"\n');
    expect(readWikilinks(fm, 'related').wikilinks).toEqual(['Deceptive cadence']);
  });

  it('block-style list wikilinks', () => {
    const fm = parseFrontmatter('related:\n  - [[Appoggiatura]]\n  - [[Consecutive fifths]]\n');
    expect(readWikilinks(fm, 'related').wikilinks).toEqual(['Appoggiatura', 'Consecutive fifths']);
  });

  it(
    "flow-list wikilinks [[[A]], [[B]]] — PyYAML's silent-corruption shape — " +
      'both links recovered despite the extra outer bracket',
    () => {
      const fm = parseFrontmatter('related: [[[Imbrication]], [[Bioturbation]]]\n');
      const result = readWikilinks(fm, 'related');
      // The genuinely ambiguous case (see P1-T02 report): a naive
      // "capture everything up to the next `]`" regex would swallow the
      // flow list's extra leading bracket into the first link's name
      // ("[Imbrication" instead of "Imbrication"). Excluding
      // `[`/`]` from the captured name resolves it correctly.
      expect(result.wikilinks).toEqual(['Imbrication', 'Bioturbation']);
      expect(result.wikilinks).not.toContain('[Imbrication');
    },
  );

  it('a value with no wikilinks at all yields an empty array, not an error', () => {
    const fm = parseFrontmatter('citekey: norling2019turbidite\n');
    expect(readWikilinks(fm, 'citekey').wikilinks).toEqual([]);
  });

  it('a missing key yields the empty InterpretedValue', () => {
    const fm = parseFrontmatter('key: value\n');
    expect(readWikilinks(fm, 'nonexistent')).toEqual({ scalar: '', items: [], wikilinks: [] });
  });
});

// ol-aq2p. The per-item reader the tier-1 binder uses: strict on purpose, so
// dereferencing a pointer never turns into rewriting a name (R1/R2).
describe('wikilinkTarget — a list item that is entirely one wikilink', () => {
  it('returns the link target for a value that is exactly one wikilink', () => {
    expect(wikilinkTarget('[[Deceptive cadence]]')).toBe('Deceptive cadence');
  });

  it('ignores surrounding whitespace but nothing else', () => {
    expect(wikilinkTarget('  [[Appoggiatura]] ')).toBe('Appoggiatura');
  });

  it('returns undefined for a bare string, so the caller keeps it verbatim', () => {
    expect(wikilinkTarget('Sediment provenance')).toBeUndefined();
  });

  it('returns undefined for prose that merely mentions a note', () => {
    expect(wikilinkTarget('see [[Imbrication]] for more')).toBeUndefined();
  });

  it('returns undefined when the value carries two links — there is no single target', () => {
    expect(wikilinkTarget('[[Imbrication]] [[Bioturbation]]')).toBeUndefined();
  });

  it('returns undefined for a quoted wikilink — the quotes are part of the value as written', () => {
    expect(wikilinkTarget('"[[Deceptive cadence]]"')).toBeUndefined();
  });

  it('does not fold case or trim inside the target', () => {
    expect(wikilinkTarget('[[ Deceptive Cadence ]]')).toBe(' Deceptive Cadence ');
  });

  it('returns undefined for an empty link', () => {
    expect(wikilinkTarget('[[]]')).toBeUndefined();
  });
});
