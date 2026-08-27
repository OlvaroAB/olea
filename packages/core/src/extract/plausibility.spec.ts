/**
 * Proof that the text-plausibility signal fires, and that it discriminates
 * (ol-s3xa, ol-x1ch).
 *
 * The acceptance on both beads asks for the same pair, and it is the point of
 * this file: a case that must go red, and a control that must stay green. A
 * check that reds on everything discriminates nothing, and a check that cannot
 * fail is the defect class (N-013) these beads belong to.
 *
 * Every string here is invented. The *shapes* — a run of unresolved glyph
 * indices, WinAnsi curly punctuation, a page of NUL padding — are the real
 * producers' shapes; the content is not (INV-3).
 */

import { describe, expect, it } from 'vitest';
import {
  classifyPageText,
  controlCharShare,
  isPlausiblePageText,
  isReachedButUnreadable,
  MAX_CONTROL_CHAR_SHARE,
} from './plausibility.js';
import type { PageExtraction, PageTextLayer } from './types.js';

/** Codes 0–7: NUL and the low control range a subset font's unresolved glyph indices land in. None of them is tab, newline or carriage return. */
function glyphCodes(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += String.fromCharCode(i % 8);
  return out;
}

function page(textLayer: PageTextLayer, overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    page: 1,
    charCount: 0,
    textLayer,
    route: 'vision',
    units: [],
    furniture: false,
    ...overrides,
  };
}

describe('controlCharShare', () => {
  it('counts the codes no encoding maps a character to', () => {
    expect(controlCharShare(glyphCodes(10))).toBe(1);
    expect(controlCharShare(`${glyphCodes(1)}abcdefghi`)).toBeCloseTo(0.1);
  });

  it('does not count tab, newline or carriage return — this extractor emits newlines itself', () => {
    expect(controlCharShare('one\ttwo\nthree\r\n')).toBe(0);
  });

  it('does not count the C1 range, which WinAnsi uses for ordinary punctuation', () => {
    // 0x92 is a right single quote and 0x97 an em dash in WinAnsi, which is
    // what real producers mean by those bytes; Latin-1 merely calls them
    // control codes. Counting them would red on correct English prose.
    expect(controlCharShare('the bed\u0092s top contact \u0097 sharp \u0097 is planar')).toBe(0);
  });

  it('reports 0 for empty text — "nothing came out" is a different report', () => {
    expect(controlCharShare('')).toBe(0);
  });
});

describe('isPlausiblePageText', () => {
  it('cuts at the calibrated share, which names the highest acceptable value', () => {
    const total = 200;
    const atLimit = Math.round(total * MAX_CONTROL_CHAR_SHARE);
    const at = glyphCodes(atLimit) + 'a'.repeat(total - atLimit);
    const above = glyphCodes(atLimit + 1) + 'a'.repeat(total - atLimit - 1);
    expect(isPlausiblePageText(at)).toBe(true);
    expect(isPlausiblePageText(above)).toBe(false);
  });

  it('rejects the sampled shape: a long run of unresolved glyph codes ahead of real words', () => {
    expect(isPlausiblePageText(`${glyphCodes(270)}Aggradation surface`)).toBe(false);
  });

  it('accepts an ordinary page — the control', () => {
    expect(isPlausiblePageText('Grain size fines upward through the bed.')).toBe(true);
  });
});

describe('classifyPageText', () => {
  it('separates "nothing to read" from "could not read it"', () => {
    expect(classifyPageText('', false)).toBe('absent');
    expect(classifyPageText('', true)).toBe('unreadable');
  });

  it('calls text that is text readable, whatever reached it', () => {
    expect(classifyPageText('Ripple lamination', true)).toBe('readable');
  });
});

describe('isReachedButUnreadable', () => {
  it('is true only when nothing was readable and something was unreadable', () => {
    expect(isReachedButUnreadable([page('unreadable'), page('unreadable')])).toBe(true);
    expect(isReachedButUnreadable([page('unreadable'), page('absent')])).toBe(true);
  });

  it('is false for a genuine scan, every page of which is honestly absent', () => {
    expect(isReachedButUnreadable([page('absent'), page('absent')])).toBe(false);
  });

  it('is false when any page read fine — one bad page is not a failed document', () => {
    expect(isReachedButUnreadable([page('unreadable'), page('readable')])).toBe(false);
  });

  it('is false for no pages at all — that is what no-pages-found is for', () => {
    expect(isReachedButUnreadable([])).toBe(false);
  });
});
