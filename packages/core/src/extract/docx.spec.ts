import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docxExtractor } from './docx.js';
import { DEFAULT_TEXT_LAYER_CHAR_THRESHOLD } from './threshold.js';

function documentXml(paragraphs: readonly string[]): string {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

function buildDocxBytes(files: Record<string, string>): Uint8Array {
  const zipped: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) zipped[path] = strToU8(content);
  return zipSync(zipped);
}

describe('docxExtractor — paragraph extraction and offsets', () => {
  it('extracts each non-empty paragraph as its own unit with correct running offsets', async () => {
    const paragraphs = ['First paragraph text here', 'Second paragraph, a bit shorter'];
    const bytes = buildDocxBytes({ 'word/document.xml': documentXml(paragraphs) });

    const result = await docxExtractor.extract({ path: 'reading.docx', bytes });

    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page?.page).toBe(1);
    expect(page?.units).toHaveLength(2);

    const first = page?.units[0];
    expect(first?.text).toBe(paragraphs[0]);
    expect(first?.provenance.location.charRange).toEqual({ start: 0, end: paragraphs[0]?.length });

    const second = page?.units[1];
    expect(second?.text).toBe(paragraphs[1]);
    const expectedStart = (paragraphs[0]?.length ?? 0) + 1; // +1 for the '\n' paragraph joiner
    expect(second?.provenance.location.charRange).toEqual({
      start: expectedStart,
      end: expectedStart + (paragraphs[1]?.length ?? 0),
    });

    // DOCX has no native pagination — every unit is deliberately page 1 (see docx.ts's module doc).
    expect(first?.provenance.location.page).toBe(1);
    expect(second?.provenance.location.page).toBe(1);
  });

  it('drops empty (spacing-only) paragraphs from the extracted units', async () => {
    const bytes = buildDocxBytes({
      'word/document.xml': documentXml(['Real content', '', 'More real content']),
    });
    const result = await docxExtractor.extract({ path: 'reading.docx', bytes });
    expect(result.pages[0]?.units).toHaveLength(2);
    expect(result.pages[0]?.units.map((u) => u.text)).toEqual([
      'Real content',
      'More real content',
    ]);
  });

  it('decodes XML entities in run text', async () => {
    const bytes = buildDocxBytes({
      'word/document.xml': documentXml(['Salt &amp; water; A &lt; B']),
    });
    const result = await docxExtractor.extract({ path: 'reading.docx', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Salt & water; A < B');
  });

  it('threads embeddedIn provenance through', async () => {
    const bytes = buildDocxBytes({
      'word/document.xml': documentXml(['substantial paragraph content for testing']),
    });
    const embeddedIn = { notePath: 'note.md', blockStart: 1, blockEnd: 9 };
    const result = await docxExtractor.extract({ path: 'reading.docx', bytes, embeddedIn });
    expect(result.pages[0]?.units[0]?.provenance.embeddedIn).toEqual(embeddedIn);
  });
});

describe('docxExtractor — routing', () => {
  it('routes a substantial document to the text layer', async () => {
    const text = 'A'.repeat(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD + 5);
    const bytes = buildDocxBytes({ 'word/document.xml': documentXml([text]) });
    const result = await docxExtractor.extract({ path: 'reading.docx', bytes });
    expect(result.pages[0]?.route).toBe('text-layer');
  });

  it('routes a document with no extractable text (e.g. a scanned image pasted into an otherwise-empty doc) to vision', async () => {
    const bytes = buildDocxBytes({ 'word/document.xml': documentXml([]) });
    const result = await docxExtractor.extract({ path: 'reading.docx', bytes });
    expect(result.pages[0]?.charCount).toBe(0);
    expect(result.pages[0]?.route).toBe('vision');
    expect(result.pages[0]?.units).toEqual([]);
  });

  it('respects a per-call threshold override', async () => {
    const text = 'A'.repeat(20);
    const bytes = buildDocxBytes({ 'word/document.xml': documentXml([text]) });
    const strict = await docxExtractor.extract(
      { path: 'reading.docx', bytes },
      { textLayerCharThreshold: 50 },
    );
    expect(strict.pages[0]?.route).toBe('vision');
  });
});

describe('docxExtractor — robustness', () => {
  it('does not throw on bytes that are not a zip at all', async () => {
    const bytes = new TextEncoder().encode('not a zip');
    const result = await docxExtractor.extract({ path: 'garbage.docx', bytes });
    expect(result.pages).toEqual([]);
  });

  it('handles a zip missing word/document.xml without throwing', async () => {
    const bytes = buildDocxBytes({ 'word/other.xml': '<x/>' });
    const result = await docxExtractor.extract({ path: 'weird.docx', bytes });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.charCount).toBe(0);
    expect(result.pages[0]?.route).toBe('vision');
  });
});
