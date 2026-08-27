/**
 * Proof that the furniture detector fires on the measured scan failure shape
 * and does not fire on genuine content (SCAN-1, ol-738i).
 *
 * Every string here is invented (INV-3) — the *shape* (a short running head
 * plus a folio number, 30-60 characters, repeated across pages) is the
 * measured shape named in `olea-service/docs/Olea_ai_workload_and_cost_model.md`
 * §5.1; the content is not.
 */

import { describe, expect, it } from 'vitest';
import {
  applyFurnitureDetection,
  findRunningHeadLines,
  furnitureStrippedCharCount,
  isPageNumberLine,
  RUNNING_HEAD_MIN_PAGES,
} from './furniture.js';
import { DEFAULT_TEXT_LAYER_CHAR_THRESHOLD } from './threshold.js';
import type { ExtractedUnit, PageExtraction } from './types.js';

const PATH = 'sources/deck.pdf';

/** A `'text-layer'`-routed page carrying exactly `text` as its one unit — the shape `pdf.ts`/`pptx.ts` build before furniture detection runs. */
function textLayerPage(pageNum: number, text: string): PageExtraction {
  const unit: ExtractedUnit = {
    text,
    provenance: {
      sourcePath: PATH,
      location: { page: pageNum, charRange: { start: 0, end: text.length } },
    },
  };
  return {
    page: pageNum,
    charCount: text.length,
    textLayer: 'readable',
    route: 'text-layer',
    units: [unit],
    furniture: false,
  };
}

describe('isPageNumberLine', () => {
  it('matches the folio forms a scan actually stamps', () => {
    expect(isPageNumberLine('3')).toBe(true);
    expect(isPageNumberLine('Page 3')).toBe(true);
    expect(isPageNumberLine('p. 3')).toBe(true);
    expect(isPageNumberLine('3 of 24')).toBe(true);
    expect(isPageNumberLine('3/24')).toBe(true);
    expect(isPageNumberLine('  12  ')).toBe(true);
  });

  it('does not match a real line that merely contains a number', () => {
    expect(isPageNumberLine('Week 2 Lecture Notes')).toBe(false);
    expect(isPageNumberLine('Chapter 3: Deposition')).toBe(false);
    expect(isPageNumberLine('Question 3 of 24')).toBe(false);
  });
});

describe('findRunningHeadLines', () => {
  it('requires at least RUNNING_HEAD_MIN_PAGES pages before claiming repetition', () => {
    expect(findRunningHeadLines(['GEOL204 Week 2'])).toEqual(new Set());
    expect(RUNNING_HEAD_MIN_PAGES).toBe(2);
  });

  it('finds a line recurring on a strict majority of pages, case/whitespace-insensitive', () => {
    const pages = [
      'GEOL204  Week 2\nSome content',
      'geol204 week 2\nOther content',
      'Distinct heading only',
    ];
    const found = findRunningHeadLines(pages);
    expect(found.has('geol204 week 2')).toBe(true);
  });

  it('does not count a page-number line toward the running-head majority', () => {
    // Every page's only repeated line is a folio, which changes per page and
    // so never itself recurs verbatim — isPageNumberLine catches it
    // separately, in furnitureStrippedCharCount, not here.
    const pages = ['1', '2', '3'];
    expect(findRunningHeadLines(pages)).toEqual(new Set());
  });

  it('does not fire on a real phrase that appears on fewer than a majority of pages', () => {
    const pages = ['Deposition', 'Erosion', 'Deposition', 'Weathering', 'Transport'];
    expect(findRunningHeadLines(pages).has('deposition')).toBe(false);
  });
});

describe('furnitureStrippedCharCount', () => {
  it('drops page-number and running-head lines, keeps everything else', () => {
    const runningHead = new Set(['geol204 — lecture notes']);
    const text = 'GEOL204 — Lecture Notes\nActual sentence of content here.\n4';
    expect(furnitureStrippedCharCount(text, runningHead)).toBe(
      'Actual sentence of content here.'.length,
    );
  });

  it('is zero when every line is furniture', () => {
    const runningHead = new Set(['geol204 — lecture notes']);
    expect(furnitureStrippedCharCount('GEOL204 — Lecture Notes\n4', runningHead)).toBe(0);
  });
});

describe('applyFurnitureDetection — the measured scan failure shape (cost model §5.1)', () => {
  it('catches a multi-page fixture whose every page is 30-60 chars of running-head + folio noise', () => {
    // Each page: a repeated ~34-char running head plus a distinct folio
    // number — squarely the measured "30-60 characters" band, and every
    // page clears DEFAULT_TEXT_LAYER_CHAR_THRESHOLD on the raw charCount
    // alone, which is exactly why the plain threshold does not catch it.
    const pages = [1, 2, 3, 4].map((n) => {
      const text = `GEOL204 — Week 2 Lecture Deposition\n${n}`;
      expect(text.length).toBeGreaterThanOrEqual(30);
      expect(text.length).toBeLessThanOrEqual(60);
      expect(text.length).toBeGreaterThanOrEqual(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD);
      return textLayerPage(n, text);
    });

    const result = applyFurnitureDetection(pages);

    for (const page of result) {
      expect(page.furniture).toBe(true);
      expect(page.route).toBe('vision');
      expect(page.units).toEqual([]);
      // charCount is untouched — the yield measurement stays honest.
      expect(page.charCount).toBeGreaterThan(0);
    }
  });

  it('does not catch a real single sparse-but-genuine page', () => {
    // A lone terse title slide (the fixture PDF's own example: "GEOL204 Week
    // 2 - Deposition", 44 characters) — one page, so repetition cannot even
    // be evaluated, which is the correct reason to leave it alone.
    const pages = [textLayerPage(1, 'GEOL204 Week 2 - Deposition')];

    const result = applyFurnitureDetection(pages);

    expect(result[0]?.furniture).toBe(false);
    expect(result[0]?.route).toBe('text-layer');
    expect(result[0]?.units).toHaveLength(1);
  });

  it('does not catch a genuinely terse multi-page document with no repeated line at all', () => {
    const pages = [
      textLayerPage(1, 'Introduction to sediment transport'),
      textLayerPage(2, 'Bedform classification overview'),
      textLayerPage(3, 'Depositional environments summary'),
    ];

    const result = applyFurnitureDetection(pages);

    expect(result.every((page) => !page.furniture)).toBe(true);
    expect(result.every((page) => page.route === 'text-layer')).toBe(true);
  });

  it('does not sweep away real pages because one page among many is furniture-heavy (a scanned cover ahead of a real deck)', () => {
    // Every page also carries its own folio, so this isolates the residual
    // conjunct specifically: the running head and page-number conjuncts are
    // both satisfied, and it is pages 2 and 3's substantial residual content
    // alone that correctly keeps the whole document from being flagged.
    const pages = [
      textLayerPage(1, 'GEOL204 — Week 2\n1'),
      textLayerPage(
        2,
        'GEOL204 — Week 2\nA full page of genuinely substantial lecture content on deposition.\n2',
      ),
      textLayerPage(
        3,
        'GEOL204 — Week 2\nA second full page of real, distinct discussion of bedforms.\n3',
      ),
    ];

    const result = applyFurnitureDetection(pages);

    expect(result.every((page) => !page.furniture)).toBe(true);
  });

  it('does not catch a lecture deck that simply repeats its own title on every slide, with no page numbers anywhere (tier3-evidence/build.spec.ts — ol-22zr)', () => {
    // The exact shape the module doc calls out: repetition within one
    // document, with nothing that looks like a folio anywhere, is usually
    // the deck's own subject and must not be treated as a scan's furniture.
    const pages = [1, 2, 3, 4, 5].map((n) =>
      textLayerPage(n, 'Overview and aims for this session'),
    );

    const result = applyFurnitureDetection(pages);

    expect(result.every((page) => !page.furniture)).toBe(true);
    expect(result.every((page) => page.route === 'text-layer')).toBe(true);
  });

  it('leaves a page already routed to vision for an unrelated reason untouched', () => {
    const genuineScanPage: PageExtraction = {
      page: 1,
      charCount: 0,
      textLayer: 'absent',
      route: 'vision',
      units: [],
      furniture: false,
    };
    const runningHeadPage1 = textLayerPage(2, 'GEOL204 — Week 2\n2');
    const runningHeadPage2 = textLayerPage(3, 'GEOL204 — Week 2\n3');

    const result = applyFurnitureDetection([genuineScanPage, runningHeadPage1, runningHeadPage2]);

    expect(result[0]).toEqual(genuineScanPage);
    expect(result[1]?.furniture).toBe(true);
    expect(result[2]?.furniture).toBe(true);
  });
});
