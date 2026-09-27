import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractPptxEmbeddedImages, pptxExtractor, pptxFigureCue } from './pptx.js';
import { DEFAULT_TEXT_LAYER_CHAR_THRESHOLD } from './threshold.js';

function slideXml(paragraphs: readonly string[]): string {
  const body = paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
}

/** A slide with a distinct title-placeholder shape plus a separate body shape — the section-label tests need the two told apart, which the uniform single-shape `slideXml` above cannot express. `phType` defaults to `'title'`; pass `'ctrTitle'` for the title-slide-layout variant. */
function slideXmlWithTitle(
  title: string,
  bodyParagraphs: readonly string[],
  phType: 'title' | 'ctrTitle' = 'title',
): string {
  const bodyText = bodyParagraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree>' +
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="${phType}"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
    `<p:txBody>${bodyText}</p:txBody></p:sp>` +
    '</p:spTree></p:cSld></p:sld>'
  );
}

function presentationXml(rIds: readonly string[]): string {
  const sldIds = rIds.map((rId, i) => `<p:sldId id="${256 + i}" r:id="${rId}"/>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<p:sldIdLst>${sldIds}</p:sldIdLst></p:presentation>`
  );
}

function presentationRels(mapping: ReadonlyArray<readonly [id: string, target: string]>): string {
  const rels = mapping
    .map(
      ([id, target]) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${target}"/>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );
}

function buildPptxBytes(files: Record<string, string>): Uint8Array {
  const zipped: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) zipped[path] = strToU8(content);
  return zipSync(zipped);
}

/** Like `buildPptxBytes`, but accepts already-binary parts too — the embedded-image tests need real (fake) image bytes alongside text XML. */
function buildPptxBytesMixed(files: Record<string, string | Uint8Array>): Uint8Array {
  const zipped: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipped[path] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(zipped);
}

function slideRels(
  mapping: ReadonlyArray<readonly [id: string, type: string, target: string]>,
): string {
  const rels = mapping
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
  );
}

const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

describe('pptxExtractor — presentation-order resolution', () => {
  it('orders slides by presentation.xml/rels, not by slideN.xml filename number', async () => {
    // rId2 -> slide2.xml comes FIRST in the deck; rId3 -> slide1.xml comes
    // SECOND — the reverse of filename order — so this can only pass if the
    // extractor really resolves true order rather than sorting filenames.
    const bytes = buildPptxBytes({
      'ppt/presentation.xml': presentationXml(['rId2', 'rId3']),
      'ppt/_rels/presentation.xml.rels': presentationRels([
        ['rId2', 'slides/slide2.xml'],
        ['rId3', 'slides/slide1.xml'],
      ]),
      'ppt/slides/slide1.xml': slideXml(['File named slide one']),
      'ppt/slides/slide2.xml': slideXml(['File named slide two']),
    });

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.page).toBe(1);
    expect(result.pages[0]?.units[0]?.text).toBe('File named slide two');
    expect(result.pages[1]?.page).toBe(2);
    expect(result.pages[1]?.units[0]?.text).toBe('File named slide one');
  });

  it('falls back to numeric filename order when presentation.xml/rels are absent', async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXml(['first by filename']),
      'ppt/slides/slide2.xml': slideXml(['second by filename']),
    });

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('first by filename');
    expect(result.pages[1]?.units[0]?.text).toBe('second by filename');
  });
});

describe('pptxExtractor — section labels (C3.2, DF-22)', () => {
  it("tags a slide's unit with its title-placeholder text", async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXmlWithTitle('Mitosis Overview', [
        'Phase 1: prophase',
        'Phase 2: metaphase',
      ]),
    });
    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.units[0]?.provenance.location.section).toBe('Mitosis Overview');
  });

  it("recognises the title-slide layout's ctrTitle placeholder the same way", async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXmlWithTitle(
        'Course Introduction',
        ['A subtitle line'],
        'ctrTitle',
      ),
    });
    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.units[0]?.provenance.location.section).toBe('Course Introduction');
  });

  it('never sets section on a slide with no title placeholder — undefined, not a fabricated label', async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXml(['Just a plain text box, no title shape']),
    });
    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.units[0]?.provenance.location.section).toBeUndefined();
  });
});

describe('pptxExtractor — per-slide routing and provenance', () => {
  it('routes a text-bearing slide to the text layer and an image-only slide to vision', async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXml(['A real bullet point with real words on it.']),
      'ppt/slides/slide2.xml': slideXml([]), // no <a:t> at all — a full-bleed image slide
    });

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.route).toBe('text-layer');
    expect(result.pages[1]?.route).toBe('vision');
    expect(result.pages[1]?.charCount).toBe(0);
    expect(result.pages[1]?.units).toEqual([]);
  });

  it('stamps sourcePath, slide-as-page, and embeddedIn provenance', async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXml(['Provenance check']),
    });
    const embeddedIn = { notePath: 'note.md', blockStart: 5, blockEnd: 30 };

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes, embeddedIn });
    const unit = result.pages[0]?.units[0];
    expect(unit?.provenance.sourcePath).toBe('deck.pptx');
    expect(unit?.provenance.location.page).toBe(1);
    expect(unit?.provenance.location.charRange).toEqual({
      start: 0,
      end: 'Provenance check'.length,
    });
    expect(unit?.provenance.embeddedIn).toEqual(embeddedIn);
  });

  it('decodes XML entities in slide text', async () => {
    const bytes = buildPptxBytes({
      'ppt/slides/slide1.xml': slideXml(['Ions &amp; channels: V &lt; threshold']),
    });
    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Ions & channels: V < threshold');
  });

  it('respects a per-call threshold override', async () => {
    const text = 'A'.repeat(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD + 2);
    const bytes = buildPptxBytes({ 'ppt/slides/slide1.xml': slideXml([text]) });
    const strict = await pptxExtractor.extract(
      { path: 'deck.pptx', bytes },
      { textLayerCharThreshold: text.length + 10 },
    );
    expect(strict.pages[0]?.route).toBe('vision');
  });
});

describe('pptxExtractor — robustness', () => {
  it('does not throw on bytes that are not a zip at all', async () => {
    const bytes = new TextEncoder().encode('not a zip');
    const result = await pptxExtractor.extract({ path: 'garbage.pptx', bytes });
    expect(result.pages).toEqual([]);
  });
});

describe('extractPptxEmbeddedImages — embedded raster images per slide (ol-egov.141.89.8.20)', () => {
  it("reads a slide picture relationship's bytes and real media type from ppt/media", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const bytes = buildPptxBytesMixed({
      'ppt/slides/slide1.xml': slideXml(['A figure-bearing slide']),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': pngBytes,
    });

    const result = extractPptxEmbeddedImages({ path: 'deck.pptx', bytes });

    expect(result).toHaveLength(1);
    expect(result[0]?.page).toBe(1);
    expect(result[0]?.images).toHaveLength(1);
    expect(result[0]?.images[0]?.mimeType).toBe('image/png');
    expect(result[0]?.images[0]?.bytes).toEqual(pngBytes);
  });

  it('marks a vector-only slide as having no image — never faked, never omitted', () => {
    const bytes = buildPptxBytesMixed({
      'ppt/slides/slide1.xml': slideXml(['A slide with only freeform shapes, no picture']),
    });

    const result = extractPptxEmbeddedImages({ path: 'deck.pptx', bytes });

    expect(result).toHaveLength(1);
    expect(result[0]?.page).toBe(1);
    expect(result[0]?.images).toEqual([]);
  });

  it('excludes a vector metafile (EMF) picture relationship — vector, not raster', () => {
    const bytes = buildPptxBytesMixed({
      'ppt/slides/slide1.xml': slideXml(['A slide whose only picture is a pasted vector graphic']),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.emf'],
      ]),
      'ppt/media/image1.emf': new Uint8Array([1, 2, 3]),
    });

    const result = extractPptxEmbeddedImages({ path: 'deck.pptx', bytes });
    expect(result[0]?.images).toEqual([]);
  });

  it('follows the same presentation-order page numbering as pptxExtractor.extract, not filename order', () => {
    const png = (n: number) => new Uint8Array([n]);
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXml(['rId2', 'rId3']),
      'ppt/_rels/presentation.xml.rels': presentationRels([
        ['rId2', 'slides/slide2.xml'],
        ['rId3', 'slides/slide1.xml'],
      ]),
      'ppt/slides/slide1.xml': slideXml(['File named slide one']),
      'ppt/slides/slide2.xml': slideXml(['File named slide two']),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/imageFromSlideFile1.png'],
      ]),
      'ppt/slides/_rels/slide2.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/imageFromSlideFile2.png'],
      ]),
      'ppt/media/imageFromSlideFile1.png': png(1),
      'ppt/media/imageFromSlideFile2.png': png(2),
    });

    const result = extractPptxEmbeddedImages({ path: 'deck.pptx', bytes });
    // page 1 is presentation-order-first, slide2.xml (rId2 comes first) —
    // same reordering `pptxExtractor.extract`'s own test above asserts.
    expect(result[0]?.images[0]?.bytes).toEqual(png(2));
    expect(result[1]?.images[0]?.bytes).toEqual(png(1));
  });

  it('does not throw on bytes that are not a zip at all', () => {
    const bytes = new TextEncoder().encode('not a zip');
    expect(extractPptxEmbeddedImages({ path: 'garbage.pptx', bytes })).toEqual([]);
  });

  it("does not alter pptxExtractor.extract's own text output", async () => {
    const bytes = buildPptxBytesMixed({
      'ppt/slides/slide1.xml': slideXml(['Text stays exactly as before']),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });
    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Text stays exactly as before');
    expect(Object.keys(result.pages[0] ?? {}).sort()).toEqual(
      ['charCount', 'furniture', 'page', 'route', 'textLayer', 'units'].sort(),
    );
  });
});

/** A `<p:pic>` block naming `rId` and placed at `cx` x `cy` EMU — the minimal shape `pptxFigureCue` reads (`r:embed`, `<a:xfrm><a:ext>`). */
function pictureXml(rId: string, cx: number, cy: number): string {
  return (
    '<p:pic><p:blipFill><a:blip r:embed="' +
    rId +
    '"/></p:blipFill><p:spPr><a:xfrm><a:ext cx="' +
    cx +
    '" cy="' +
    cy +
    '"/></a:xfrm></p:spPr></p:pic>'
  );
}

/** A slide carrying zero or more `<p:pic>` placements, no text — `pptxFigureCue` only reads pictures, so this omits the text-paragraph shape `slideXml` builds. */
function slideXmlWithPictures(pictures: readonly string[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:cSld><p:spTree>${pictures.join('')}</p:spTree></p:cSld></p:sld>`
  );
}

/** `ppt/presentation.xml` carrying a `<p:sldSz>` — `pptxFigureCue`'s slide-area denominator. No `.rels` is built alongside this in the tests below, so slide order falls back to filename order (`fallbackSlideOrder`); none of these tests depend on presentation order. */
function presentationXmlWithSize(cx: number, cy: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:sldSz cx="${cx}" cy="${cy}"/></p:presentation>`
  );
}

describe('pptxFigureCue — D-324 combine policy (ol-egov.141.89.8.26, findings/office-image-selection.md)', () => {
  it('a single image alone clearing the share qualifies the slide', () => {
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXmlWithSize(1000, 1000), // area 1,000,000 EMU^2
      'ppt/slides/slide1.xml': slideXmlWithPictures([pictureXml('rId1', 500, 500)]), // 25%
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });

    const result = pptxFigureCue({ path: 'deck.pptx', bytes });

    expect(result).toHaveLength(1);
    expect(result[0]?.page).toBe(1);
    expect(result[0]?.qualifies).toBe(true);
    expect(result[0]?.images).toHaveLength(1);
  });

  it('two images each under the floor, summed, qualify the slide — the combine policy over largest/all', () => {
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXmlWithSize(1000, 1000), // area 1,000,000
      'ppt/slides/slide1.xml': slideXmlWithPictures([
        pictureXml('rId1', 100, 200), // 20,000 / 1,000,000 = 2%
        pictureXml('rId2', 200, 200), // 40,000 / 1,000,000 = 4%
      ]),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
        ['rId2', IMAGE_REL_TYPE, '../media/image2.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1]),
      'ppt/media/image2.png': new Uint8Array([2]),
    });

    const result = pptxFigureCue({ path: 'deck.pptx', bytes });

    // Neither image alone clears 5% (2% and 4%); their sum, 6%, does.
    expect(result[0]?.qualifies).toBe(true);
    expect(result[0]?.images).toHaveLength(2);
  });

  it('excludes a recurring image (majority of slides) from every slide it is on, even when it alone would clear the share', () => {
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXmlWithSize(1000, 1000), // area 1,000,000
      'ppt/slides/slide1.xml': slideXmlWithPictures([pictureXml('rId1', 500, 500)]), // 25%
      'ppt/slides/slide2.xml': slideXmlWithPictures([pictureXml('rId1', 500, 500)]),
      'ppt/slides/slide3.xml': slideXmlWithPictures([pictureXml('rId1', 500, 500)]),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/logo.png'],
      ]),
      'ppt/slides/_rels/slide2.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/logo.png'],
      ]),
      'ppt/slides/_rels/slide3.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/logo.png'],
      ]),
      'ppt/media/logo.png': new Uint8Array([9]),
    });

    const result = pptxFigureCue({ path: 'deck.pptx', bytes });

    expect(result).toHaveLength(3);
    for (const slide of result) {
      expect(slide.qualifies).toBe(false);
      expect(slide.images).toEqual([]);
    }
  });

  it('a slide with no resolvable slide size never qualifies — no guessing', () => {
    const bytes = buildPptxBytesMixed({
      // No `ppt/presentation.xml` at all: `pptxSlideAreaEmu` returns `null`.
      'ppt/slides/slide1.xml': slideXmlWithPictures([pictureXml('rId1', 900, 900)]),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1]),
    });

    const result = pptxFigureCue({ path: 'deck.pptx', bytes });
    expect(result[0]?.qualifies).toBe(false);
    expect(result[0]?.images).toEqual([]);
  });

  it('does not throw on bytes that are not a zip at all', () => {
    const bytes = new TextEncoder().encode('not a zip');
    expect(pptxFigureCue({ path: 'garbage.pptx', bytes })).toEqual([]);
  });
});

/** A slide carrying both a text shape (`slideXml`'s own paragraph/run shape) and zero or more `<p:pic>` placements (`pictureXml`) — the route-upgrade tests below need a slide that is genuinely `'text-layer'` on its own AND carries pictures, which neither `slideXml` nor `slideXmlWithPictures` alone can express. */
function slideXmlWithTextAndPictures(
  paragraphs: readonly string[],
  pictures: readonly string[],
): string {
  const body = paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    `<p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp>${pictures.join('')}</p:spTree></p:cSld></p:sld>`
  );
}

describe('pptxExtractor — D-324 combine-cue route upgrade (ol-egov.141.89.8.26, the send-wiring half)', () => {
  it("upgrades a text-bearing slide to 'both' when its images clear the combine floor, keeping its text-layer units unchanged", async () => {
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXmlWithSize(1000, 1000), // area 1,000,000
      'ppt/slides/slide1.xml': slideXmlWithTextAndPictures(
        ['A real bullet point with real words on it.'],
        [pictureXml('rId1', 500, 500)], // 25% — clears FIGURE_CUE_MIN_SHARE (5%)
      ),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });

    expect(result.pages[0]?.route).toBe('both');
    // '"both"' keeps exactly the units '"text-layer"' would have carried —
    // the image reading this route also owes the page is a SEPARATE job
    // (`vision-page-runner.ts`'s `sendOfficeFigureCueImages`), never traded
    // away here.
    expect(result.pages[0]?.units[0]?.text).toBe('A real bullet point with real words on it.');
  });

  it("a text-bearing slide whose images do NOT clear the combine floor stays 'text-layer' — no guessed upgrade", async () => {
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXmlWithSize(1000, 1000), // area 1,000,000
      'ppt/slides/slide1.xml': slideXmlWithTextAndPictures(
        ['A real bullet point with real words on it.'],
        [pictureXml('rId1', 50, 50)], // 2,500 / 1,000,000 = 0.25% — under the floor
      ),
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });

    expect(result.pages[0]?.route).toBe('text-layer');
  });

  it("never upgrades an already-'vision' slide (no usable text layer) even when its images would otherwise clear the floor — the upgrade only ever widens 'text-layer'", async () => {
    const bytes = buildPptxBytesMixed({
      'ppt/presentation.xml': presentationXmlWithSize(1000, 1000), // area 1,000,000
      // No text paragraphs at all — `slideXmlWithPictures` omits the
      // text-shape entirely, so this slide's own charCount is 0 and its
      // route is `'vision'` before the figure cue ever runs.
      'ppt/slides/slide1.xml': slideXmlWithPictures([pictureXml('rId1', 900, 900)]), // 81%
      'ppt/slides/_rels/slide1.xml.rels': slideRels([
        ['rId1', IMAGE_REL_TYPE, '../media/image1.png'],
      ]),
      'ppt/media/image1.png': new Uint8Array([1, 2, 3]),
    });

    const result = await pptxExtractor.extract({ path: 'deck.pptx', bytes });

    expect(result.pages[0]?.route).toBe('vision');
  });
});
