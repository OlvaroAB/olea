import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { pptxExtractor } from './pptx.js';
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
