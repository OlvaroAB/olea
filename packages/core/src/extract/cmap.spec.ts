import { describe, expect, it } from 'vitest';
import {
  decodeWithFont,
  type FontDecoder,
  parseToUnicodeCMap,
  type ToUnicodeCMap,
  UNMAPPED_CHAR,
} from './cmap.js';

/** Content-stream string bytes arrive at `decodeWithFont` as one char per byte — see `pdf.ts` on why Latin-1 round-trips. */
function codes(...values: number[]): string {
  return values.map((v) => String.fromCharCode(v)).join('');
}

/** Two-byte big-endian codes, the way an `/Identity-H` font is shown. */
function wideCodes(...values: number[]): string {
  return values.map((v) => String.fromCharCode(v >> 8, v & 0xff)).join('');
}

function cmapProgram(body: string, codespace = '<0000> <FFFF>'): string {
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '1 begincodespacerange',
    codespace,
    'endcodespacerange',
    body,
    'endcmap',
    'end',
    'end',
  ].join('\n');
}

describe('parseToUnicodeCMap', () => {
  it('reads bfchar pairs', () => {
    const cmap = parseToUnicodeCMap(
      cmapProgram('2 beginbfchar\n<0003> <0020>\n<0024> <0041>\nendbfchar'),
      2,
    );
    expect(cmap?.codeByteLength).toBe(2);
    expect(cmap?.map.get(0x0003)).toBe(' ');
    expect(cmap?.map.get(0x0024)).toBe('A');
  });

  it('reads a bfrange whose destination increments across the range', () => {
    const cmap = parseToUnicodeCMap(
      cmapProgram('1 beginbfrange\n<0024> <0026> <0041>\nendbfrange'),
      2,
    );
    expect(cmap?.map.get(0x0024)).toBe('A');
    expect(cmap?.map.get(0x0025)).toBe('B');
    expect(cmap?.map.get(0x0026)).toBe('C');
    expect(cmap?.map.get(0x0027)).toBeUndefined();
  });

  it('reads a bfrange whose destinations are given one per code', () => {
    const cmap = parseToUnicodeCMap(
      cmapProgram('1 beginbfrange\n<0010> <0012> [<0058> <0059> <005A>]\nendbfrange'),
      2,
    );
    expect(cmap?.map.get(0x0010)).toBe('X');
    expect(cmap?.map.get(0x0011)).toBe('Y');
    expect(cmap?.map.get(0x0012)).toBe('Z');
  });

  it('reads a multi-character destination — a ligature glyph maps to two letters', () => {
    const cmap = parseToUnicodeCMap(cmapProgram('1 beginbfchar\n<0055> <00660069>\nendbfchar'), 2);
    expect(cmap?.map.get(0x0055)).toBe('fi');
  });

  it('takes the code width from begincodespacerange, not from the font', () => {
    // A simple font with a one-byte codespace: the default the caller passes is
    // only consulted when the CMap itself declares nothing.
    const oneByte = parseToUnicodeCMap(
      cmapProgram('1 beginbfchar\n<41> <0041>\nendbfchar', '<00> <FF>'),
      2,
    );
    expect(oneByte?.codeByteLength).toBe(1);
    const noCodespace = parseToUnicodeCMap('begincmap\n1 beginbfchar\n<0041> <0041>\nendbfchar', 2);
    expect(noCodespace?.codeByteLength).toBe(2);
  });

  it('returns undefined for a CMap with no usable entries — absent beats empty', () => {
    // An empty table would claim every code is unmappable and turn material
    // that decodes fine into replacement characters. Reporting "no CMap" leaves
    // the caller on its previous, working, behaviour.
    expect(parseToUnicodeCMap(cmapProgram(''), 2)).toBeUndefined();
    expect(parseToUnicodeCMap('', 2)).toBeUndefined();
    expect(parseToUnicodeCMap('not a cmap at all', 2)).toBeUndefined();
  });

  it('ignores a commented-out operator rather than executing it', () => {
    const cmap = parseToUnicodeCMap(
      cmapProgram(
        '% 1 beginbfchar <0001> <0058> endbfchar\n1 beginbfchar\n<0002> <0059>\nendbfchar',
      ),
      2,
    );
    expect(cmap?.map.get(0x0001)).toBeUndefined();
    expect(cmap?.map.get(0x0002)).toBe('Y');
  });

  it('refuses an absurd or transposed bfrange rather than allocating for it', () => {
    expect(
      parseToUnicodeCMap(cmapProgram('1 beginbfrange\n<0030> <0020> <0041>\nendbfrange'), 2),
    ).toBeUndefined();
    expect(
      parseToUnicodeCMap(cmapProgram('1 beginbfrange\n<0000> <FFFFFF> <0041>\nendbfrange'), 2),
    ).toBeUndefined();
  });
});

/** Fails the test rather than asserting non-null: a CMap this file could not parse is a bug in the parser, not something to type-assert past. */
function requireCMap(source: string, defaultWidth: number): ToUnicodeCMap {
  const cmap = parseToUnicodeCMap(source, defaultWidth);
  if (cmap === undefined) throw new Error('fixture CMap failed to parse');
  return cmap;
}

describe('decodeWithFont', () => {
  const cmap = requireCMap(
    cmapProgram('3 beginbfchar\n<0001> <0048>\n<0002> <0069>\n<0003> <0021>\nendbfchar'),
    2,
  );

  it('passes bytes through untouched when there is no decoder at all', () => {
    // The pre-existing behaviour for every simple font, and it must not move.
    expect(decodeWithFont('Hi!', undefined)).toBe('Hi!');
  });

  it('passes bytes through for a simple font with no ToUnicode — its codes are character codes', () => {
    expect(decodeWithFont('Hi!', { composite: false })).toBe('Hi!');
  });

  it('maps two-byte codes through a composite font’s CMap', () => {
    const font: FontDecoder = { composite: true, cmap };
    expect(decodeWithFont(wideCodes(0x0001, 0x0002, 0x0003), font)).toBe('Hi!');
  });

  it('reports an unresolved composite code rather than guessing at it', () => {
    // The honesty rule. A glyph index has no character reading to fall back on;
    // `plausibility.ts` counts the marker and the page stays 'unreadable'.
    const font: FontDecoder = { composite: true, cmap };
    expect(decodeWithFont(wideCodes(0x0001, 0x00ff), font)).toBe(`H${UNMAPPED_CHAR}`);
  });

  it('reports one unresolved code per two bytes for a composite font with no CMap', () => {
    expect(decodeWithFont(wideCodes(0x0001, 0x0002), { composite: true })).toBe(
      UNMAPPED_CHAR.repeat(2),
    );
  });

  it('falls back to the byte for an unmapped code in a simple font', () => {
    // Not a guess: a simple font's codes *are* character codes, and Latin-1 is
    // the reading the format itself defaults to. This is what keeps the
    // pdfTeX-produced material that already extracted correctly unchanged.
    const simple = requireCMap(
      cmapProgram('1 beginbfchar\n<41> <0391>\nendbfchar', '<00> <FF>'),
      1,
    );
    const font: FontDecoder = { composite: false, cmap: simple };
    expect(decodeWithFont(codes(0x41, 0x42), font)).toBe('ΑB');
  });
});
