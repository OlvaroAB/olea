/**
 * What an extraction pass hands the unit manifest as starting states (`[D-445]`,
 * `ol-egov.141.89.8.43`): the text layer answers only for a page it actually served, and a source
 * the pass could not enumerate records nothing. Every string below is invented (INV-3).
 */
import { describe, expect, it } from 'vitest';
import type { ExtractionResult, PageExtraction } from '../../extract/types.js';
import { enumerationOfExtraction } from './enumerate.js';

function page(overrides: Partial<PageExtraction> & { page: number }): PageExtraction {
  return {
    charCount: 800,
    textLayer: 'readable',
    route: 'text-layer',
    units: [],
    furniture: false,
    ...overrides,
  };
}

function result(
  pages: readonly PageExtraction[],
  outcome: ExtractionResult['outcome'] = 'extracted',
): ExtractionResult {
  return { sourcePath: '03 Research/SYNTH101 Deck.pdf', format: 'pdf', outcome, pages };
}

describe('enumerationOfExtraction', () => {
  it('a page the text layer served is read by text-layer, with no model provenance', () => {
    const enumeration = enumerationOfExtraction(result([page({ page: 1 })]));
    expect(enumeration).toEqual({
      pages: [1],
      settled: [{ page: 1, readingState: { kind: 'read', method: 'text-layer' } }],
    });
  });

  it('a page routed to vision is enumerated and NOT settled: it starts pending, never read', () => {
    const enumeration = enumerationOfExtraction(
      result([
        page({ page: 1 }),
        page({ page: 2, charCount: 0, textLayer: 'absent', route: 'vision' }),
        page({ page: 3, charCount: 0, textLayer: 'unreadable', route: 'vision' }),
      ]),
    );
    expect(enumeration?.pages).toEqual([1, 2, 3]);
    expect(enumeration?.settled.map((s) => s.page)).toEqual([1]);
  });

  it("a page routed to 'both' keeps its text but is not read until the image reading lands", () => {
    const enumeration = enumerationOfExtraction(result([page({ page: 1, route: 'both' })]));
    expect(enumeration).toEqual({ pages: [1], settled: [] });
  });

  it('a furniture page is a finished read that found no text, not a claim that it was read as content', () => {
    const enumeration = enumerationOfExtraction(
      result([page({ page: 1, furniture: true })], 'furniture-only'),
    );
    expect(enumeration?.settled).toEqual([
      { page: 1, readingState: { kind: 'unreadable', reason: 'no-text-on-page' } },
    ]);
  });

  it('pages are listed ascending whatever order the extractor produced them in, and a repeated page is one unit', () => {
    const enumeration = enumerationOfExtraction(
      result([page({ page: 3 }), page({ page: 1 }), page({ page: 2 }), page({ page: 2 })]),
    );
    expect(enumeration?.pages).toEqual([1, 2, 3]);
  });

  it('an empty document is a known, empty enumeration: nothing there, and the pass finished', () => {
    expect(enumerationOfExtraction(result([], 'empty-document'))).toEqual({
      pages: [],
      settled: [],
    });
  });

  it.each(['no-pages-found', 'unreadable', 'reached-but-unreadable'] as const)(
    'a source that yielded no pages because of %s cannot be enumerated: nothing is recorded, and the census keeps its own verdict',
    (outcome) => {
      expect(enumerationOfExtraction(result([], outcome))).toBeNull();
    },
  );

  it('a page number that cannot be a unit identity makes the whole source unenumerable rather than dropping the page', () => {
    expect(enumerationOfExtraction(result([page({ page: 1 }), page({ page: 0 })]))).toBeNull();
    expect(enumerationOfExtraction(result([page({ page: 1.5 })]))).toBeNull();
  });
});
