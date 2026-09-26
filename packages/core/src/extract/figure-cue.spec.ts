import { describe, expect, it } from 'vitest';
import { applyFigureCue, FIGURE_CUE_MIN_SHARE, type PageImagePaint } from './figure-cue.js';
import type { PageExtraction } from './types.js';

function textLayerPage(page: number, overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    page,
    charCount: 500,
    textLayer: 'readable',
    route: 'text-layer',
    units: [
      {
        text: 'genuine page content',
        provenance: { sourcePath: 'x.pdf', location: { page } },
      },
    ],
    furniture: false,
    ...overrides,
  };
}

describe('applyFigureCue — D-324', () => {
  it('upgrades a text-layer page to both when a non-recurring image clears the declared share', () => {
    const pages = [textLayerPage(1)];
    const paints: (readonly PageImagePaint[] | undefined)[] = [[{ objectNum: 10, areaShare: 0.2 }]];
    const result = applyFigureCue(pages, paints);
    expect(result[0]?.route).toBe('both');
    // units are untouched — the text-layer content is kept, not cleared.
    expect(result[0]?.units).toEqual(pages[0]?.units);
  });

  it('leaves the page on text-layer when the image is below the declared share', () => {
    const pages = [textLayerPage(1)];
    const paints: (readonly PageImagePaint[] | undefined)[] = [
      [{ objectNum: 10, areaShare: FIGURE_CUE_MIN_SHARE - 0.001 }],
    ];
    expect(applyFigureCue(pages, paints)[0]?.route).toBe('text-layer');
  });

  it('the threshold names the lowest ACCEPTED share, not the highest rejected one (boundary, mirrors routePage)', () => {
    const pages = [textLayerPage(1)];
    const paints: (readonly PageImagePaint[] | undefined)[] = [
      [{ objectNum: 10, areaShare: FIGURE_CUE_MIN_SHARE }],
    ];
    expect(applyFigureCue(pages, paints)[0]?.route).toBe('both');
  });

  it('never touches a page already routed to vision — nothing left to add', () => {
    const pages = [textLayerPage(1, { route: 'vision', units: [], charCount: 0 })];
    const paints: (readonly PageImagePaint[] | undefined)[] = [[{ objectNum: 10, areaShare: 0.9 }]];
    const result = applyFigureCue(pages, paints);
    expect(result[0]).toEqual(pages[0]);
  });

  it('a page with no imagePaints (layout could not be inspected) is left exactly as it was', () => {
    const pages = [textLayerPage(1)];
    const result = applyFigureCue(pages, [undefined]);
    expect(result[0]).toEqual(pages[0]);
  });

  it('a page with an empty imagePaints array (layout inspected, nothing painted) stays on text-layer', () => {
    const pages = [textLayerPage(1)];
    expect(applyFigureCue(pages, [[]])[0]?.route).toBe('text-layer');
  });

  it('a recurring image (majority of inspectable pages) never triggers the cue, however large its share', () => {
    const pages = [textLayerPage(1), textLayerPage(2), textLayerPage(3)];
    const recurringEverywhere: (readonly PageImagePaint[] | undefined)[] = [
      [{ objectNum: 99, areaShare: 0.5 }],
      [{ objectNum: 99, areaShare: 0.5 }],
      [{ objectNum: 99, areaShare: 0.5 }],
    ];
    const result = applyFigureCue(pages, recurringEverywhere);
    expect(result.every((p) => p.route === 'text-layer')).toBe(true);
  });

  it('a non-recurring image on a MINORITY of pages still triggers the cue on the pages it appears on', () => {
    const pages = [textLayerPage(1), textLayerPage(2), textLayerPage(3)];
    const onOnePage: (readonly PageImagePaint[] | undefined)[] = [
      [{ objectNum: 7, areaShare: 0.5 }],
      [],
      [],
    ];
    const result = applyFigureCue(pages, onOnePage);
    expect(result[0]?.route).toBe('both');
    expect(result[1]?.route).toBe('text-layer');
    expect(result[2]?.route).toBe('text-layer');
  });

  it('a single-page document can never have a recurring image — one page is not a majority of anything', () => {
    const pages = [textLayerPage(1)];
    const result = applyFigureCue(pages, [[{ objectNum: 1, areaShare: 0.5 }]]);
    expect(result[0]?.route).toBe('both');
  });

  it('an uninspectable page is silent on recurrence — it neither confirms nor denies the image is recurring elsewhere', () => {
    // Page 1: image 5 painted, large share. Page 2: layout could not be
    // inspected at all. Page 3: image 5 NOT painted. With only two
    // inspectable pages (1 and 3), image 5 appears on 1 of 2 — not a
    // majority — so it is non-recurring and the cue fires on page 1.
    const pages = [textLayerPage(1), textLayerPage(2), textLayerPage(3)];
    const mixed: (readonly PageImagePaint[] | undefined)[] = [
      [{ objectNum: 5, areaShare: 0.5 }],
      undefined,
      [],
    ];
    const result = applyFigureCue(pages, mixed);
    expect(result[0]?.route).toBe('both');
  });

  it('a caller-supplied minShare overrides the declared default', () => {
    const pages = [textLayerPage(1)];
    const paints: (readonly PageImagePaint[] | undefined)[] = [[{ objectNum: 1, areaShare: 0.5 }]];
    expect(applyFigureCue(pages, paints, 0.6)[0]?.route).toBe('text-layer');
    expect(applyFigureCue(pages, paints, 0.4)[0]?.route).toBe('both');
  });
});
