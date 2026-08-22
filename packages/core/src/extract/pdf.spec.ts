import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FolderSource } from '../vault/folder-source.js';
import { pdfExtractor, WORD_GAP_KERN_THOUSANDTHS } from './pdf.js';
import { MAX_CONTROL_CHAR_SHARE } from './plausibility.js';
import { DEFAULT_TEXT_LAYER_CHAR_THRESHOLD } from './threshold.js';

// ---- a tiny hand-built-PDF constructor, mirroring the fixture vault's own
// "hand-built objects/xref" real-PDF style (see fixtures/vault/README.md) so
// these tests exercise the actual parser/tokenizer, not a mock of them. Every
// byte value round-trips through this string space (see pdf.ts's own module
// doc on why Latin-1 is safe for this), which is what lets a FlateDecode
// stream's arbitrary compressed bytes be spliced into the same text template
// as the surrounding ASCII object syntax.

function bytesToLatin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function asciiBytes(text: string): Uint8Array {
  return latin1ToBytes(text); // every char used in content-stream templates below is ASCII, so Latin-1 encoding is byte-identical to UTF-8 here.
}

function escapePdfLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Builds a minimal, valid, multi-page PDF with one `Tj` text-show operator per page, optionally FlateDecode-compressing every content stream. */
function buildPdfBytes(
  pageTexts: readonly string[],
  options: { compress?: boolean } = {},
): Uint8Array {
  const pageCount = pageTexts.length;
  const fontNum = 3;
  const firstPageNum = 4;
  const firstContentNum = firstPageNum + pageCount;

  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageNum + i} 0 R`).join(' ');
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  objects.push(
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );

  for (let i = 0; i < pageCount; i++) {
    const pageNum = firstPageNum + i;
    const contentNum = firstContentNum + i;
    objects.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`,
    );
  }

  for (let i = 0; i < pageCount; i++) {
    const contentNum = firstContentNum + i;
    const text = pageTexts[i] ?? '';
    const raw =
      text.length > 0
        ? `BT /F1 12 Tf 20 150 Td (${escapePdfLiteral(text)}) Tj ET`
        : 'BT /F1 12 Tf ET';
    const rawBytes = asciiBytes(raw);
    const streamBytes = options.compress ? zlibSync(rawBytes) : rawBytes;
    const streamText = bytesToLatin1(streamBytes);
    const filter = options.compress ? ' /Filter /FlateDecode' : '';
    objects.push(
      `${contentNum} 0 obj\n<< /Length ${streamText.length}${filter} >>\nstream\n${streamText}\nendstream\nendobj\n`,
    );
  }

  const size = firstContentNum + pageCount;
  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n0\n%%EOF`;
  return latin1ToBytes(`%PDF-1.4\n${objects.join('')}${trailer}`);
}

/**
 * Builds the same minimal multi-page PDF as `buildPdfBytes`, but with each
 * page's content-stream *body* supplied verbatim instead of wrapped around a
 * single `Tj`. That is what lets the ol-frk9 tests below write `TJ` arrays in
 * the exact shape pdfTeX emits them — `[(word)-333(word)]TJ` — rather than
 * asserting against a mock of the tokenizer.
 */
function buildPdfWithBodies(bodies: readonly string[]): Uint8Array {
  const pageCount = bodies.length;
  const fontNum = 3;
  const firstPageNum = 4;
  const firstContentNum = firstPageNum + pageCount;

  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageNum + i} 0 R`).join(' ');
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  objects.push(
    `${fontNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `${firstPageNum + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${firstContentNum + i} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>\nendobj\n`,
    );
  }
  for (let i = 0; i < pageCount; i++) {
    const body = bodies[i] ?? '';
    objects.push(
      `${firstContentNum + i} 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`,
    );
  }
  const size = firstContentNum + pageCount;
  return latin1ToBytes(
    `%PDF-1.4\n${objects.join('')}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** Extracts one synthetic page built from a raw content-stream body. */
async function textOfBody(body: string): Promise<string> {
  // The routing cut would send a short synthetic page to vision and drop its
  // unit, which says nothing about the text the tokenizer produced.
  const result = await pdfExtractor.extract(
    { path: 'deck.pdf', bytes: buildPdfWithBodies([body]) },
    { textLayerCharThreshold: 1 },
  );
  return result.pages[0]?.units[0]?.text ?? '';
}

/** Deliberately dull filler: the point of the stream-boundary fixture below is the *compressed* bytes' last value, so the words themselves carry nothing. */
const WORDS = ['alpha', 'bravo', 'delta', 'gamma', 'omega', 'sigma', 'theta', 'kappa'];

/** A one-page PDF written the way a real producer writes it when it writes no EOL between the stream data and `endstream` — the shape that turns an unconditional trim into a lost data byte. */
function buildNoEolBeforeEndstreamPdf(compressed: Uint8Array): Uint8Array {
  const streamText = bytesToLatin1(compressed);
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${streamText.length} /Filter /FlateDecode >>\nstream\n${streamText}endstream\nendobj\n`;
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** A PDF whose page tree resolves and honestly declares zero pages — the `'empty-document'` shape, which must never be confused with the `'no-pages-found'` one below. */
function buildZeroPagePdfBytes(): Uint8Array {
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n';
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** A PDF whose Catalog points at a `/Pages` object that isn't in the file and which has no `/Type /Page` objects to fall back to — the `'no-pages-found'` shape the affected real decks were in. */
function buildUnreachablePagesPdfBytes(): Uint8Array {
  const objects = '1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\n';
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

describe('pdfExtractor — against the real fixture PDF', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);
  const pdfPath = '01 Courses/GEOL204/WEEK 2/Geol204-Week2-Slides.pdf';

  it('extracts the exact title text from the hand-built one-page fixture PDF', async () => {
    const bytes = await vault.readBinary(pdfPath);
    const result = await pdfExtractor.extract({ path: pdfPath, bytes });

    expect(result.format).toBe('pdf');
    expect(result.pages).toHaveLength(1);
    const page = result.pages[0];
    expect(page?.charCount).toBe('GEOL204 Week 2 - Stratigraphic succession'.length);
    expect(page?.route).toBe('text-layer');
    expect(page?.units).toHaveLength(1);
    expect(page?.units[0]?.text).toBe('GEOL204 Week 2 - Stratigraphic succession');
  });

  it('stamps complete, precise provenance on the extracted unit', async () => {
    const bytes = await vault.readBinary(pdfPath);
    const result = await pdfExtractor.extract({ path: pdfPath, bytes });
    const unit = result.pages[0]?.units[0];
    const expectedText = 'GEOL204 Week 2 - Stratigraphic succession';
    expect(unit?.provenance.sourcePath).toBe(pdfPath);
    expect(unit?.provenance.location.page).toBe(1);
    expect(unit?.provenance.location.charRange).toEqual({ start: 0, end: expectedText.length });
    expect(unit?.provenance.embeddedIn).toBeUndefined();
  });

  it('threads embeddedIn provenance through when the input carries it', async () => {
    const bytes = await vault.readBinary(pdfPath);
    const embeddedIn = {
      notePath: '01 Courses/GEOL204/WEEK 2/Lecture - Deposition & Bedform Stratification.md',
      blockStart: 100,
      blockEnd: 140,
    };
    const result = await pdfExtractor.extract({ path: pdfPath, bytes, embeddedIn });
    expect(result.pages[0]?.units[0]?.provenance.embeddedIn).toEqual(embeddedIn);
  });
});

describe('pdfExtractor — synthetic multi-page routing', () => {
  it('routes each page independently by its own char yield', async () => {
    const aboveThreshold = 'A'.repeat(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD + 5);
    const bytes = buildPdfBytes([aboveThreshold, '']);
    const result = await pdfExtractor.extract({ path: 'deck.pdf', bytes });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.route).toBe('text-layer');
    expect(result.pages[0]?.charCount).toBe(aboveThreshold.length);
    expect(result.pages[0]?.units).toHaveLength(1);

    // Page 2's content stream has no Tj operator at all — the true
    // image-only/scanned-page shape (cost model §5.1) — so char yield is
    // genuinely zero, not just "low".
    expect(result.pages[1]?.route).toBe('vision');
    expect(result.pages[1]?.charCount).toBe(0);
    expect(result.pages[1]?.units).toEqual([]);
  });

  it('numbers pages in document order starting at 1', async () => {
    const bytes = buildPdfBytes(['first page text here', 'second page text here', 'third page']);
    const result = await pdfExtractor.extract({ path: 'deck.pdf', bytes });
    expect(result.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(result.pages[0]?.units[0]?.text).toBe('first page text here');
    expect(result.pages[2]?.units[0]?.text).toBe('third page');
  });

  it('respects a per-call threshold override, not just the default', async () => {
    const text = 'A'.repeat(20);
    const bytes = buildPdfBytes([text]);
    const strict = await pdfExtractor.extract(
      { path: 'deck.pdf', bytes },
      { textLayerCharThreshold: 50 },
    );
    expect(strict.pages[0]?.route).toBe('vision');
    const lenient = await pdfExtractor.extract(
      { path: 'deck.pdf', bytes },
      { textLayerCharThreshold: 5 },
    );
    expect(lenient.pages[0]?.route).toBe('text-layer');
  });
});

describe('pdfExtractor — FlateDecode-compressed content streams', () => {
  it('inflates a compressed content stream and extracts the same text a raw one would', async () => {
    const text = 'Compressed slide content should still extract correctly.';
    const rawBytes = buildPdfBytes([text], { compress: false });
    const compressedBytes = buildPdfBytes([text], { compress: true });

    const rawResult = await pdfExtractor.extract({ path: 'deck.pdf', bytes: rawBytes });
    const compressedResult = await pdfExtractor.extract({
      path: 'deck.pdf',
      bytes: compressedBytes,
    });

    expect(compressedResult.pages[0]?.charCount).toBe(text.length);
    expect(compressedResult.pages[0]?.units[0]?.text).toBe(text);
    expect(compressedResult.pages[0]?.units[0]?.text).toBe(rawResult.pages[0]?.units[0]?.text);
  });
});

describe('pdfExtractor — stream boundaries', () => {
  it('trusts /Length over the endstream scan when a compressed stream ends in a newline', async () => {
    // The EOL before `endstream` is part of the *delimiter* — but only when
    // the producer wrote one. Trimming it unconditionally eats a real data
    // byte whenever the stream's own last byte is 0x0A and no delimiter EOL
    // follows, which for compressed data is roughly 1-in-128 streams. The
    // inflate then fails outright and the whole stream is dropped: for a
    // content stream that is one silently blank page, and for an `/ObjStm`
    // it is every object inside it. Measured against a real-world vault, that
    // cost a run of page dictionaries out of one long document, which then
    // reported short with no error anywhere; the figures stay private, in
    // `olea-service/findings/E4-corpus-and-zero-yield.md`.
    const words = Array.from({ length: 98 }, (_, i) => WORDS[i % WORDS.length]).join(' ');
    const raw = asciiBytes(`BT /F1 12 Tf 20 150 Td (${words}) Tj ET`);
    const compressed = zlibSync(raw);
    // Guards the guard: if fflate's output ever stops ending in 0x0A here,
    // this test would silently stop exercising the case it exists for.
    expect(compressed[compressed.length - 1]).toBe(0x0a);

    const result = await pdfExtractor.extract({
      path: 'deck.pdf',
      bytes: buildNoEolBeforeEndstreamPdf(compressed),
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.units[0]?.text).toBe(words);
    expect(result.pages[0]?.charCount).toBe(words.length);
  });
});

describe('pdfExtractor — robustness', () => {
  it('does not throw on bytes that are not a PDF at all, and reports no pages', async () => {
    const bytes = new TextEncoder().encode('this is not a pdf');
    const result = await pdfExtractor.extract({ path: 'garbage.pdf', bytes });
    expect(result.pages).toEqual([]);
    expect(result.outcome).toBe('unreadable');
  });

  it('does not throw on empty input', async () => {
    const result = await pdfExtractor.extract({ path: 'empty.pdf', bytes: new Uint8Array(0) });
    expect(result.pages).toEqual([]);
    expect(result.outcome).toBe('unreadable');
  });
});

// ---- ol-voen / [P3-T04b] ---------------------------------------------------
// Real lecture PDFs resolved as embeds and produced zero pages while the
// pipeline reported success. Two independent extractors (poppler `pdftotext`
// and `pdfjs-dist`) read a full text layer out of every one, so the material
// was never the problem — the parser was, in two distinct ways. That was
// established by measuring against a real-world vault, with the figures kept
// private in `olea-service/findings/E4-corpus-and-zero-yield.md`. The two
// fixtures below are invented reproductions of both shapes; their README
// entries name the invariant each one guards.

describe('pdfExtractor — PDF 1.5+ object streams (ol-voen bug A)', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);
  const pdfPath = '01 Courses/GEOL204/WEEK 3/xref-stream-only.pdf';
  const expected = [
    'Compressed page tree fixture, page one. Every page dictionary is held inside the object stream.',
    'Compressed page tree fixture, page two. The catalog and the pages node are compressed as well.',
    'Compressed page tree fixture, page three. Content streams are kept beyond the object stream.',
  ];

  it('still has the structure it was built to have — no literal trailer, a real /ObjStm', async () => {
    // Guards the fixture itself: regenerated bytes that lost either property
    // would leave the tests below passing for the wrong reason.
    const text = new TextDecoder('latin1').decode(await vault.readBinary(pdfPath));
    expect(text).not.toContain('trailer');
    expect(text).toContain('/Type /XRef');
    expect(text).toContain('/Type /ObjStm');
    expect(text).not.toContain('/Type /Catalog'); // it is inside the object stream, not in plain sight
    expect(text).not.toContain('/Type /Page'); // ditto every leaf page dict
  });

  it('reaches all three pages when the Catalog, /Pages node and every leaf page dict are inside an /ObjStm', async () => {
    const bytes = await vault.readBinary(pdfPath);
    const result = await pdfExtractor.extract({ path: pdfPath, bytes });

    expect(result.pages).toHaveLength(3);
    expect(result.outcome).toBe('extracted');
    expect(result.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(result.pages.map((p) => p.units[0]?.text)).toEqual(expected);
    expect(result.pages.map((p) => p.charCount)).toEqual(expected.map((t) => t.length));
    expect(result.pages.every((p) => p.route === 'text-layer')).toBe(true);
  });
});

describe('pdfExtractor — hybrid page tree (ol-voen bug B)', () => {
  const vaultRoot = new URL('../../fixtures/vault', import.meta.url).pathname;
  const vault = new FolderSource(vaultRoot);
  const pdfPath = '01 Courses/GEOL204/WEEK 3/hybrid-pages-node.pdf';
  const expected = [
    'Hybrid page tree fixture, page one. Only the branch pages node is compressed.',
    'Hybrid page tree fixture, page two. A page tree traversal that yields none should still find pages.',
    'Hybrid page tree fixture, page three. Every leaf page object is a plain uncompressed object.',
  ];

  it('still has the structure it was built to have — plain Catalog and leaf pages, compressed /Pages node', async () => {
    const text = new TextDecoder('latin1').decode(await vault.readBinary(pdfPath));
    expect(text).not.toContain('trailer');
    expect(text).toContain('/Type /Catalog'); // in plain sight, so the root resolves...
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(3); // ...as do all three leaf pages...
    expect(text).not.toContain('/Type /Pages'); // ...but the node between them is in the /ObjStm.
  });

  it('reaches all three pages when only the intermediate /Pages node is compressed', async () => {
    const bytes = await vault.readBinary(pdfPath);
    const result = await pdfExtractor.extract({ path: pdfPath, bytes });

    expect(result.pages).toHaveLength(3);
    expect(result.outcome).toBe('extracted');
    expect(result.pages.map((p) => p.units[0]?.text)).toEqual(expected);
    expect(result.pages.map((p) => p.charCount)).toEqual(expected.map((t) => t.length));
  });

  it('falls back on a page-tree walk that yields nothing, not only on an unresolvable root', async () => {
    // The precise mechanism, stated without the fixture: a resolvable root
    // whose node is unreachable used to skip the fallback entirely, because
    // the guard asked whether the *root* was found rather than whether the
    // *walk* found anything — with every page object sitting in the map.
    const text = 'first page here';
    const bytes = buildPdfBytes([text]);
    const withUnreachableRoot = latin1ToBytes(
      new TextDecoder('latin1').decode(bytes).replace('/Pages 2 0 R', '/Pages 99 0 R'),
    );
    const result = await pdfExtractor.extract({ path: 'deck.pdf', bytes: withUnreachableRoot });

    expect(result.pages).toHaveLength(1);
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.units[0]?.text).toBe(text);
  });
});

describe('pdfExtractor — the outcome discriminant (ol-voen, the reporting half)', () => {
  it('reports no-pages-found, not success, for a document whose pages it cannot reach', async () => {
    const result = await pdfExtractor.extract({
      path: 'unreachable.pdf',
      bytes: buildUnreachablePagesPdfBytes(),
    });
    expect(result.pages).toEqual([]);
    expect(result.outcome).toBe('no-pages-found');
  });

  it('reports empty-document for a page tree that honestly declares zero pages', async () => {
    const result = await pdfExtractor.extract({
      path: 'nothing.pdf',
      bytes: buildZeroPagePdfBytes(),
    });
    expect(result.pages).toEqual([]);
    expect(result.outcome).toBe('empty-document');
  });

  it('distinguishes the two empties that pages: [] used to collapse into one', async () => {
    // The whole point of the field: before it, these two results were
    // byte-for-byte identical to every caller, and real sources took the
    // second path while the run over them reported no extraction failures.
    // That was established by measuring against a real-world vault, with the
    // figures kept private in
    // `olea-service/findings/E4-corpus-and-zero-yield.md`.
    const empty = await pdfExtractor.extract({ path: 'a.pdf', bytes: buildZeroPagePdfBytes() });
    const unreachable = await pdfExtractor.extract({
      path: 'b.pdf',
      bytes: buildUnreachablePagesPdfBytes(),
    });
    expect(empty.pages).toEqual(unreachable.pages);
    expect(empty.outcome).not.toBe(unreachable.outcome);
  });

  it('reports extracted whenever at least one page record was produced, whatever its yield', async () => {
    // A zero-char page is a *routed* page, not a missing one — `route` already
    // says so, and `outcome` must not second-guess it.
    const result = await pdfExtractor.extract({ path: 'deck.pdf', bytes: buildPdfBytes(['']) });
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.route).toBe('vision');
    expect(result.pages[0]?.charCount).toBe(0);
  });
});

// ---- ol-frk9 ---------------------------------------------------------------
// The `TJ` numeric adjustments used to be dropped outright. On PowerPoint,
// Keynote and pdf-lib material that costs nothing, because those producers set
// a real space glyph between words. pdfTeX sets each word as its own string
// and encodes the inter-word gap *as* the adjustment, so dropping the numbers
// glued every LaTeX-produced line into one token: the characters missing on
// that material were overwhelmingly inter-word spaces, and word recall there
// sat far below its level on the rest of the corpus. Both claims were
// established by measuring against a real-world vault; the figures stay
// private, in `olea-service/findings/E4-corpus-and-zero-yield.md`. The
// fixtures below are invented content in the real producers' *shapes* — no
// vault text (INV-3).

describe('pdfExtractor — TJ word-gap synthesis (ol-frk9)', () => {
  it('recovers word boundaries from a pdfTeX-shaped TJ array', async () => {
    // The pdfTeX shape: one string per word, the gap carried by the number.
    const body = 'BT /F1 12 Tf 20 150 Td [(Sediment)-333(transport)-333(regimes)]TJ ET';
    expect(await textOfBody(body)).toBe('Sediment transport regimes');
  });

  it('leaves intra-word pair kerning alone — a small adjustment is not a gap', async () => {
    // `-60` is the kerning a producer applies inside a word (here across the
    // classic AV/Wa pairs). Reading it as a gap would shatter words instead of
    // joining them, which is the failure mode opposite to the one being fixed.
    const body = 'BT /F1 12 Tf 20 150 Td [(W)-60(a)-30(v)80(elength)]TJ ET';
    expect(await textOfBody(body)).toBe('Wavelength');
  });

  it('ignores a positive adjustment however large — tightening is never a word break', async () => {
    // A positive number pulls the next glyph *back* over the previous one. It
    // closes distance, so magnitude alone must not decide: testing |value|
    // would split accent and ligature composition apart.
    const body = 'BT /F1 12 Tf 20 150 Td [(over)1200(lap)]TJ ET';
    expect(await textOfBody(body)).toBe('overlap');
  });

  it('cuts exactly at the calibrated threshold, in thousandths of a text-space unit', async () => {
    const below = `BT /F1 12 Tf 20 150 Td [(one)${-(WORD_GAP_KERN_THOUSANDTHS - 1)}(two)]TJ ET`;
    const at = `BT /F1 12 Tf 20 150 Td [(one)${-WORD_GAP_KERN_THOUSANDTHS}(two)]TJ ET`;
    expect(await textOfBody(below)).toBe('onetwo');
    expect(await textOfBody(at)).toBe('one two');
  });

  it('never doubles a space the producer already wrote, on either side of the gap', async () => {
    // A producer that emits both a space glyph and a positioning number must
    // not yield two spaces: that would inflate charCount on exactly the
    // non-LaTeX material this fix has to leave untouched.
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td [(one )-500(two)]TJ ET')).toBe('one two');
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td [(one)-500( two)]TJ ET')).toBe('one two');
    // A gap on each side of a string that *is* a space: suppressed both times.
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td [(one)-500( )-500(two)]TJ ET')).toBe('one two');
  });

  it('collapses a run of adjustments to one space and emits nothing at the array edges', async () => {
    // A leading gap has nothing before it and a trailing gap nothing after it,
    // so neither is a boundary *between* two words. Emitting there would add
    // characters that are not word boundaries — measurable as yield, useless
    // for matching, and trailing whitespace no round-trip wants.
    const body = 'BT /F1 12 Tf 20 150 Td [-800(alpha)-400-600(beta)-800]TJ ET';
    expect(await textOfBody(body)).toBe('alpha beta');
  });

  it('leaves PowerPoint-shaped text byte-identical — the producers that were already correct', async () => {
    // The non-LaTeX producers in the corpus write this shape: literal spaces
    // inside the strings, numbers only ever small pair kerning. Their char
    // yield was already right before the fix — that was checked by measuring
    // against a real-world vault, with the figures kept private in
    // `olea-service/findings/E4-word-gap-calibration.md` — so this material
    // must not move by one character.
    const body =
      'BT /F1 12 Tf 20 150 Td [(Cementation )-11(diagene)-6(sis )18(in )-4(a )-11(sandstone)]TJ ET';
    const text = await textOfBody(body);
    expect(text).toBe('Cementation diagenesis in a sandstone');
    expect(text).not.toMatch(/ {2}/);
  });

  it('carries the recovered boundaries through to charCount and provenance', async () => {
    // charCount is what routing reads and what provenance spans index into, so
    // the synthesised spaces have to be in the same string both of those see —
    // not added by some later cosmetic pass.
    const body =
      'BT /F1 12 Tf 20 150 Td [(Clast)-333(imbrication)-333(fabric)]TJ 0 -14 Td [(Feldspar)-333(dissolution)]TJ ET';
    const result = await pdfExtractor.extract({
      path: 'beamer.pdf',
      bytes: buildPdfWithBodies([body]),
    });
    const page = result.pages[0];
    const expected = 'Clast imbrication fabric\nFeldspar dissolution';
    expect(page?.units[0]?.text).toBe(expected);
    expect(page?.charCount).toBe(expected.length);
    expect(page?.units[0]?.provenance.location.charRange).toEqual({
      start: 0,
      end: expected.length,
    });
  });

  it('is what the word-boundary defect looked like: without gaps the line is one token', async () => {
    // Guards the *claim*, not just the code. Word recall was the metric that
    // exposed this (characters were being read fine); a page whose words are
    // all glued together scores zero on any \b-delimited match, which is the
    // whole of the tier-3 matching rule.
    const glued = 'BT /F1 12 Tf 20 150 Td [(Sediment)(transport)(regimes)]TJ ET';
    expect((await textOfBody(glued)).match(/\b[A-Za-z]{4,}\b/g)).toEqual([
      'Sedimenttransportregimes',
    ]);
    const spaced = 'BT /F1 12 Tf 20 150 Td [(Sediment)-333(transport)-333(regimes)]TJ ET';
    expect((await textOfBody(spaced)).match(/\b[A-Za-z]{4,}\b/g)).toEqual([
      'Sediment',
      'transport',
      'regimes',
    ]);
  });
});

// ---- ol-pvmy ---------------------------------------------------------------
// ol-frk9 fixed the numbers *inside* a `TJ` array. Nothing carried state
// *between* two text-showing operators, so a gap the producer encoded either
// side of a font switch, a colour change or a `Tm` reposition was thrown away
// and the two runs were concatenated with no delimiter at all. The words are
// in our extracted text; only the boundary is missing, which is exactly the
// failure a `\b`-delimited tier-3 match cannot survive. That was established
// by measuring against a real-world vault; the figures stay private, in
// `olea-service/findings/G1-census-2026-08-14-run6.md` §4.4 and
// `olea-service/findings/E4-word-gap-calibration.md` §6. The fixtures below
// are invented content in the real producers' *shapes* — no vault text (INV-3).

describe('pdfExtractor — word gaps across operator boundaries (ol-pvmy)', () => {
  it('carries a leading gap in the array after a font switch (the shape that cost the citations)', async () => {
    // The measured shape, schematically: one run, a `Tf`, then a second array
    // whose *first* element is the gap. `joinTjArray` is called fresh per
    // array, so the gap was leading, and the array-edge suppression that is
    // correct for a trailing gap discarded it.
    const body =
      'BT /F1 9.9626 Tf 20 150 Td [(Turbidite)]TJ /F2 5.9776 Tf [-354(x)]TJ /F1 5.9776 Tf [-71(-facies)]TJ ET';
    expect(await textOfBody(body)).toBe('Turbidite x-facies');
  });

  it('carries a trailing gap at an array edge forward to the next text-showing operator', async () => {
    // The mirror image: the gap is the *last* element of the first array, so
    // there was no following glyph inside that array to attach it to — and the
    // next array is a separate call that starts with no memory of it.
    const body = 'BT /F1 12 Tf 20 150 Td [(Graded)-500]TJ /F2 12 Tf [(bedding)]TJ ET';
    expect(await textOfBody(body)).toBe('Graded bedding');
  });

  it('carries a gap from a Tj run into the TJ array that follows it', async () => {
    const body = 'BT /F1 12 Tf 20 150 Td (Cross)Tj /F2 12 Tf [-400(stratification)]TJ ET';
    expect(await textOfBody(body)).toBe('Cross stratification');
  });

  it('carries a gap across a Tm reposition, not just a font switch', async () => {
    const body = 'BT /F1 12 Tf 20 150 Td [(Aeolian)]TJ 1 0 0 1 120 150 Tm [-420(dune)]TJ ET';
    expect(await textOfBody(body)).toBe('Aeolian dune');
  });

  it('does NOT invent a boundary where the producer encoded none', async () => {
    // The control, and the reason this fix is a *carry* rather than a rule
    // about operator boundaries. A font switch mid-word — small caps, a maths
    // italic, a coloured fragment — is set with no adjustment at all, and a
    // check that reds on every `Tf` discriminates nothing. Splitting here
    // would shatter words, which is the failure mode opposite to the one
    // being fixed.
    const body = 'BT /F1 12 Tf 20 150 Td [(Micro)]TJ /F2 12 Tf [(fossil)]TJ ET';
    expect(await textOfBody(body)).toBe('Microfossil');
    const kerned = 'BT /F1 12 Tf 20 150 Td [(Micro)]TJ /F2 12 Tf [-90(fossil)]TJ ET';
    expect(await textOfBody(kerned)).toBe('Microfossil');
  });

  it('still emits nothing for a gap with nothing on the far side of it', async () => {
    // Carrying the flag across operators must not resurrect the two edges
    // ol-frk9 deliberately suppresses: a gap before any text has been emitted
    // is not a boundary *between* two words, and a gap at the very end has
    // nothing to separate.
    expect(await textOfBody('BT /F1 12 Tf [-900(alpha)]TJ /F2 12 Tf [(beta)]TJ ET')).toBe(
      'alphabeta',
    );
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td [(alpha)]TJ /F2 12 Tf [-900]TJ ET')).toBe(
      'alpha',
    );
  });

  it('never doubles a space across the boundary either', async () => {
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td [(one )]TJ /F2 12 Tf [-500(two)]TJ ET')).toBe(
      'one two',
    );
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td [(one)-500]TJ /F2 12 Tf [( two)]TJ ET')).toBe(
      'one two',
    );
  });

  it('is what the defect looked like: the footline phrase matched as one token', async () => {
    // Guards the *claim*. A deck's per-page footline is set with a font switch
    // mid-phrase, so every page of that deck carried the concept glued to its
    // neighbour and scored zero on the `\b`-delimited tier-3 matching rule.
    const footline =
      'BT /F1 5.9776 Tf 20 20 Td [(Sequence)]TJ /F2 5.9776 Tf [-354(x)]TJ /F1 5.9776 Tf [-71(-stratigraphy)]TJ ET';
    expect((await textOfBody(footline)).match(/\b[A-Za-z]{4,}\b/g)).toEqual([
      'Sequence',
      'stratigraphy',
    ]);
  });
});

// ---- ol-x1ch / ol-s3xa -----------------------------------------------------
// Two halves of one shape: the extractor reaching a page and reporting success
// over output that is not usable text. ol-x1ch is the zero-yield half — whole
// producer classes whose pages decode to nothing while `outcome` reads
// `'extracted'` and every page is escalated to the vision slot at full price,
// silently. ol-s3xa is the garbage-yield half — pages of NULs and unresolved
// glyph indices that clear the routing threshold, keep their units, and become
// eligible to be quoted back to the user. Both were established by measuring
// real material against poppler `pdftotext`; the figures stay private, in
// `olea-service/findings/H-past-papers-inventory-and-text-layer.md` §5.1/§5.2
// and `olea-service/findings/G1-concept-review.md` §(b). Every fixture below is
// invented content in the real producers' *shapes* — no vault text (INV-3).

/**
 * A PDF literal string of `count` un-mapped glyph codes: what a subset font's
 * glyph indices decode to when no CMap resolves them (they are numbered from
 * zero, so they land in the control range), and what a producer's NUL padding
 * looks like by the time it reaches extracted text.
 */
function unmappedGlyphRun(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += `\\${(i % 8).toString(8).padStart(3, '0')}`;
  return out;
}

/** One page built from a raw content-stream body, at a threshold low enough that routing never hides what the tokenizer produced. */
async function pageOfBody(body: string) {
  const result = await pdfExtractor.extract(
    { path: 'deck.pdf', bytes: buildPdfWithBodies([body]) },
    { textLayerCharThreshold: 1 },
  );
  return result.pages[0];
}

/**
 * A one-page PDF whose text lives inside a **Form XObject** rather than in the
 * page's own content stream. The page is reached, its content stream decodes
 * cleanly, and it contains no text-showing operator at all — it paints a form
 * and stops. The form declares no `/Resources` of its own, so it reads the
 * page's `/Font /F1` by inheritance (ol-v460 — see `resolveFormXObject`).
 */
function buildFormXObjectPdf(formBody: string): Uint8Array {
  const pageBody = 'q 1 0 0 1 0 0 cm /Fm1 Do Q';
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R ' +
    '/Resources << /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${pageBody.length} >>\nstream\n${pageBody}\nendstream\nendobj\n` +
    `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] /Length ${formBody.length} >>\nstream\n${formBody}\nendstream\nendobj\n`;
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** A one-page PDF whose content stream declares `/FlateDecode` and is not inflatable — content that was reached and cannot be read, as distinct from content that is not there. */
function buildUndecodableContentPdf(): Uint8Array {
  const garbage = 'this is not deflate data and will never inflate';
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${garbage.length} /Filter /FlateDecode >>\nstream\n${garbage}\nendstream\nendobj\n`;
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** A one-page PDF that really is a scan: an Image XObject painted onto the page, no text layer anywhere. The control that keeps the new check from reddening on everything. */
function buildImageOnlyPdf(): Uint8Array {
  const pageBody = 'q 300 0 0 200 0 0 cm /Im1 Do Q';
  const pixels = '\x00\x11\x22\x33';
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R ' +
    '/Resources << /XObject << /Im1 6 0 R >> >> >>\nendobj\n' +
    `5 0 obj\n<< /Length ${pageBody.length} >>\nstream\n${pageBody}\nendstream\nendobj\n` +
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n${pixels}\nendstream\nendobj\n`;
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

describe('pdfExtractor — a text layer reached and not read (ol-x1ch)', () => {
  it('recovers the text of a page whose only content lives in a Form XObject (ol-v460)', async () => {
    // This fixture and this test used to be the other way round: before
    // ol-v460, `getPageContent` never opened a Form XObject at all, so this
    // exact shape — a page that paints a form and shows no text of its own —
    // reported `charCount: 0`, `textLayer: 'unreadable'`, and
    // `outcome: 'reached-but-unreadable'` over material that had a perfectly
    // good text layer sitting one `Do` away. `pages.length > 0` satisfied the
    // old success discriminant regardless, so the honesty guard ol-x1ch built
    // was what kept that state from reading as a silent success — but the
    // text itself did not come out until this bead walked the form. It now
    // does: the form has no `/Resources` of its own, so its `/F1` resolves by
    // inheriting the page's (see `buildFormXObjectPdf`'s doc comment).
    const result = await pdfExtractor.extract({
      path: 'converted.pdf',
      bytes: buildFormXObjectPdf('BT /F1 12 Tf 20 150 Td (Provenance of the fluvial member) Tj ET'),
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.textLayer).toBe('readable');
    expect(result.pages[0]?.charCount).toBe('Provenance of the fluvial member'.length);
    expect(result.pages[0]?.route).toBe('text-layer');
    expect(result.pages[0]?.units[0]?.text).toBe('Provenance of the fluvial member');
    expect(result.outcome).toBe('extracted');
  });

  it('reports reached-but-unreadable for a content stream it cannot decode', async () => {
    const result = await pdfExtractor.extract({
      path: 'broken.pdf',
      bytes: buildUndecodableContentPdf(),
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.textLayer).toBe('unreadable');
    expect(result.outcome).toBe('reached-but-unreadable');
  });

  it('still reports extracted for a genuine scan — a check that reds on everything discriminates nothing', async () => {
    // The control this bead's acceptance asks for by name. An image-only page
    // honestly has no text layer; routing it to vision is the right answer,
    // and calling it a decode failure would turn every scanned deck into a
    // reported defect.
    const result = await pdfExtractor.extract({
      path: 'scan.pdf',
      bytes: buildImageOnlyPdf(),
    });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.textLayer).toBe('absent');
    expect(result.pages[0]?.charCount).toBe(0);
    expect(result.pages[0]?.route).toBe('vision');
    expect(result.outcome).toBe('extracted');
  });

  it('still reports extracted, and readable pages, for ordinary text material', async () => {
    const result = await pdfExtractor.extract({
      path: 'deck.pdf',
      bytes: buildPdfBytes(['Cross-bedding in the lower unit', 'Ripple lamination above it']),
    });
    expect(result.outcome).toBe('extracted');
    expect(result.pages.map((p) => p.textLayer)).toEqual(['readable', 'readable']);
    expect(result.pages.every((p) => p.route === 'text-layer')).toBe(true);
  });

  it('does not call a whole document unreadable because one page of it was', async () => {
    // The page already says so itself. Reporting the *document* as a failure
    // when 39 of its 40 pages read fine would be a different kind of dishonesty.
    const result = await pdfExtractor.extract({
      path: 'mixed.pdf',
      bytes: buildPdfWithBodies([
        `BT /F1 12 Tf (${unmappedGlyphRun(200)}) Tj ET`,
        'BT /F1 12 Tf 20 150 Td (Bioturbation destroys primary lamination) Tj ET',
      ]),
    });
    expect(result.outcome).toBe('extracted');
    expect(result.pages.map((p) => p.textLayer)).toEqual(['unreadable', 'readable']);
  });
});

// ---- ol-v460 ----------------------------------------------------------------
// Form XObject traversal. ol-x1ch bought the honesty of the unwalked-forms
// limitation; this bead lifts it. The trap named in the bead's own tracing is
// resource scope — a form must be decoded through its OWN `/Resources`, never
// unconditionally the page's, because the two can reuse a resource name
// (`/F1`) for two different fonts. The fixtures below exercise that trap
// directly, plus the hazards the task named: cycles, depth, and malformed or
// dangling resource dictionaries. Invented content in the real producers'
// shapes — no vault text (INV-3).

/**
 * A one-page PDF whose `/Resources`, page content-stream body and further
 * objects (fonts, forms, CMaps) are all caller-supplied raw `N G obj`
 * bodies — full control over the object graph, which is what the tests below
 * need for nesting, self-reference and dangling references. Object numbers
 * need not be contiguous or ordered in the file: `parsePdfObjects` finds every
 * `N G obj` by scanning the whole text, not by following an xref table.
 */
function buildFormGraphPdf(
  pageResources: string,
  pageContentBody: string,
  extraObjects: readonly string[],
): Uint8Array {
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n' +
    `4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R /Resources ${pageResources} >>\nendobj\n` +
    `5 0 obj\n<< /Length ${pageContentBody.length} >>\nstream\n${pageContentBody}\nendstream\nendobj\n` +
    extraObjects.join('');
  // /Size is never read by this parser (see parsePdfObjects's own doc) — any
  // value covers every object number these fixtures use.
  return latin1ToBytes(
    `%PDF-1.4\n${objects}trailer\n<< /Size 999 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

/** A simple `/Type1` font object at the given object number — the plain Helvetica every fixture below reuses when it needs a resolvable, uncomplicated font. */
function simpleFontObj(num: number): string {
  return `${num} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
}

/**
 * A straight-line chain of `count` Form XObjects, object numbers 20, 21, 22…,
 * each painting the next via `Do` — the last one alone shows `textAtEnd`, and
 * alone carries a `/Font` resource. Object 3 is assumed to already exist as a
 * `simpleFontObj`. Used to pin `MAX_FORM_XOBJECT_DEPTH` from both sides: a
 * chain within it recovers the text at the bottom, one past it does not.
 */
function chainedFormObjects(count: number, textAtEnd: string): string[] {
  const base = 20;
  const objs: string[] = [];
  for (let i = 0; i < count; i++) {
    const num = base + i;
    const isLast = i === count - 1;
    if (isLast) {
      const body = `BT /F1 12 Tf 20 150 Td (${textAtEnd}) Tj ET`;
      objs.push(
        `${num} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ` +
          `/Resources << /Font << /F1 3 0 R >> >> /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`,
      );
    } else {
      const nextNum = base + i + 1;
      const body = 'q 1 0 0 1 0 0 cm /FmNext Do Q';
      objs.push(
        `${num} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ` +
          `/Resources << /XObject << /FmNext ${nextNum} 0 R >> >> /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`,
      );
    }
  }
  return objs;
}

describe('pdfExtractor — Form XObject traversal (ol-v460)', () => {
  it('recovers text painted entirely inside a form the page itself shows none of', async () => {
    // The measured shape, restated structurally: the page's own content
    // stream has zero shown-text bytes, and 100% of the body text is inside
    // one form — with the form declaring its OWN font resources, which is
    // the common case (`/F1` inside the form, nothing named `/F1` on the
    // page at all).
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 7 0 R >> >> ' +
          '/Length 58 >>\nstream\nBT /F1 12 Tf 20 150 Td (Provenance of the fluvial member) Tj ET\nendstream\nendobj\n',
        simpleFontObj(7),
      ],
    );
    const result = await pdfExtractor.extract({ path: 'form-owned-fonts.pdf', bytes });
    expect(result.pages[0]?.textLayer).toBe('readable');
    expect(result.pages[0]?.units[0]?.text).toBe('Provenance of the fluvial member');
  });

  it("THE TRAP: resolves a form Tf against the FORM's own /F1, not the page's same-named one", async () => {
    // The bead's own words: "a form must be decoded using the FORM'S OWN
    // /Resources for font resolution. Using the page's resources would
    // decode with the wrong CMap and produce exactly the plausible-looking
    // garbage that ol-avvt was fixed to stop producing." Both the page and
    // the form here name a font resource `/F1`; they are NOT the same font.
    // The page's `/F1` is a plain Type1 font whose bytes are character codes.
    // The form's `/F1` is a composite Identity-H font whose bytes are
    // two-byte glyph indices, readable only through its own /ToUnicode CMap.
    // If this extractor ever decoded the form through the page's resources,
    // the glyph-index bytes would be read as Latin-1 and this test would see
    // control characters, not the word below.
    const WORD = 'Sandstone';
    const ids = subsetGlyphIds(WORD);
    const cmapSrc = toUnicodeCMapSource(ids);
    const hex = glyphHex(WORD, ids);
    const formBody = `BT /F1 12 Tf 20 150 Td <${hex}> Tj ET`;

    const bytes = buildFormGraphPdf(
      '<< /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >>', // page's /F1: plain Helvetica
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        simpleFontObj(3),
        `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ` +
          `/Resources << /Font << /F1 7 0 R >> >> /Length ${formBody.length} >>\nstream\n${formBody}\nendstream\nendobj\n`,
        `7 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /BAAAAA+Test /Encoding /Identity-H /ToUnicode 8 0 R >>\nendobj\n`,
        `8 0 obj\n<< /Length ${cmapSrc.length} >>\nstream\n${cmapSrc}\nendstream\nendobj\n`,
      ],
    );
    // The word alone is 9 characters, under the default routing threshold —
    // irrelevant to what this test pins (decode correctness, not routing), so
    // it is overridden the same way `textOfBody` does above.
    const result = await pdfExtractor.extract(
      { path: 'form-resource-scope-trap.pdf', bytes },
      { textLayerCharThreshold: 1 },
    );
    expect(result.pages[0]?.units[0]?.text).toBe(WORD);
  });

  it('falls back to the invoking resources when a form declares none of its own', async () => {
    // The other half of "the form's own /Resources": that entry is optional
    // per spec, and its absence means "inherit from whatever painted me" —
    // not "no resources at all". `buildFormXObjectPdf`'s fixture, used above
    // in the ol-x1ch block, already covers the single-level case; this one
    // pins it explicitly by name, alongside the trap test it is the control
    // for.
    const bytes = buildFormGraphPdf(
      '<< /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        simpleFontObj(3),
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Length 44 >>\nstream\nBT /F1 12 Tf 20 150 Td (Inherited font) Tj ET\nendstream\nendobj\n',
      ],
    );
    const result = await pdfExtractor.extract({ path: 'form-inherits-resources.pdf', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Inherited font');
  });

  it('recovers text through nested forms, each level resolving its own resources', async () => {
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        simpleFontObj(3),
        // Form A: shows its own text, then paints nested Form B.
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> /XObject << /Fm2 10 0 R >> >> ' +
          '/Length 76 >>\nstream\nBT /F1 12 Tf (Outer form text ) Tj ET q 1 0 0 1 0 0 cm /Fm2 Do Q\nendstream\nendobj\n',
        // Form B: nested two deep, resolves its own font independently.
        '10 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> >> ' +
          '/Length 41 >>\nstream\nBT /F1 12 Tf (Inner form text) Tj ET\nendstream\nendobj\n',
      ],
    );
    const result = await pdfExtractor.extract({ path: 'nested-forms.pdf', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Outer form text Inner form text');
  });

  it('does not hang or duplicate text on a form that paints itself', async () => {
    // The ancestor-PATH cycle guard, exercised directly: Fm1's own /XObject
    // resources name itself. Without the guard this recurses forever; with
    // it, the self-referential `Do` is skipped and the text before it is
    // still recovered exactly once.
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        simpleFontObj(3),
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >> ' +
          '/Length 71 >>\nstream\nBT /F1 12 Tf (Cyclic form text) Tj ET q 1 0 0 1 0 0 cm /Fm1 Do Q\nendstream\nendobj\n',
      ],
    );
    const result = await pdfExtractor.extract({ path: 'self-referencing-form.pdf', bytes });
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.units[0]?.text).toBe('Cyclic form text');
  });

  it('does not hang on a mutual cycle between two forms either', async () => {
    // Fm1 (object 6) paints Fm2 (object 10), which paints Fm1 right back.
    // The guard is per ancestor PATH, so Fm1 is still on the path when Fm2
    // tries to re-enter it — the second `Do /Fm1` is skipped, not the first.
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        simpleFontObj(3),
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> /XObject << /Fm2 10 0 R >> >> ' +
          '/Length 68 >>\nstream\nBT /F1 12 Tf (Form A text ) Tj ET q 1 0 0 1 0 0 cm /Fm2 Do Q\nendstream\nendobj\n',
        '10 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >> ' +
          '/Length 68 >>\nstream\nBT /F1 12 Tf (Form B text) Tj ET q 1 0 0 1 0 0 cm /Fm1 Do Q\nendstream\nendobj\n',
      ],
    );
    const result = await pdfExtractor.extract({ path: 'mutual-cycle-forms.pdf', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Form A text Form B text');
  });

  it('gives up past the depth cap on an acyclic chain, without hanging, and does not invent text', async () => {
    // Not a cycle — `formPath` never sees a repeated object number — but 15
    // forms deep is past MAX_FORM_XOBJECT_DEPTH, so the text at the bottom
    // of the chain must not be recovered. The cap exists precisely so a
    // pathological (or adversarial) acyclic chain cannot make this recursion
    // unbounded either.
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 20 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [simpleFontObj(3), ...chainedFormObjects(15, 'Deep recovered text')],
    );
    const result = await pdfExtractor.extract({ path: 'deep-form-chain.pdf', bytes });
    expect(result.pages[0]?.units.flatMap((u) => u.text)).not.toContain('Deep recovered text');
    expect(result.pages[0]?.textLayer).toBe('unreadable');
  });

  it('recovers text through a chain well inside the depth cap — the control for the test above', async () => {
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 20 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [simpleFontObj(3), ...chainedFormObjects(5, 'Deep recovered text')],
    );
    const result = await pdfExtractor.extract({ path: 'shallow-form-chain.pdf', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Deep recovered text');
  });

  it('reports reached-but-unreadable, not a crash, for a form whose stream will not decode', async () => {
    // The malformed-resources hazard the task named: the form object exists
    // and is genuinely `/Subtype /Form` (so `sawXObjectPaint` and the forms
    // map both see it), but its content stream declares FlateDecode and is
    // not valid deflate data. `resolveFormXObject` degrades to `undefined`
    // via the same `getStreamBytes` catch every other stream in this module
    // uses — no throw, and the page still reports the honest 'unreadable'
    // ol-x1ch bought rather than a false 'absent'.
    const garbage = 'this is not deflate data and will never inflate';
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] /Filter /FlateDecode /Length ${garbage.length} >>\nstream\n${garbage}\nendstream\nendobj\n`,
      ],
    );
    const result = await pdfExtractor.extract({ path: 'undecodable-form.pdf', bytes });
    expect(result.pages[0]?.textLayer).toBe('unreadable');
    expect(result.pages[0]?.charCount).toBe(0);
    expect(result.pages[0]?.route).toBe('vision');
    expect(result.outcome).toBe('reached-but-unreadable');
  });

  it('falls back past a DANGLING /Resources reference rather than losing the form', async () => {
    // The other malformed-resources hazard: the form's own `/Resources` is an
    // indirect reference to an object that does not exist. `ownResourcesText`
    // resolves to `undefined` (`objects.get(999)` is `undefined`), which
    // this treats identically to "the form declared no /Resources at all" —
    // falling back to whatever painted it — rather than losing the form's
    // text because one dangling pointer made its OWN resources unusable.
    const formBody = 'BT /F1 12 Tf 20 150 Td (Dangling resources fallback) Tj ET';
    const bytes = buildFormGraphPdf(
      '<< /Font << /F1 3 0 R >> /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 0 0 cm /Fm1 Do Q',
      [
        simpleFontObj(3),
        `6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] /Resources 999 0 R ` +
          `/Length ${formBody.length} >>\nstream\n${formBody}\nendstream\nendobj\n`,
      ],
    );
    const result = await pdfExtractor.extract({ path: 'dangling-form-resources.pdf', bytes });
    expect(result.pages[0]?.units[0]?.text).toBe('Dangling resources fallback');
  });

  it('still reports extracted, and readable pages, for a page with no forms at all — the regression control', async () => {
    const result = await pdfExtractor.extract({
      path: 'deck.pdf',
      bytes: buildPdfBytes(['Cross-bedding in the lower unit', 'Ripple lamination above it']),
    });
    expect(result.outcome).toBe('extracted');
    expect(result.pages.map((p) => p.textLayer)).toEqual(['readable', 'readable']);
  });
});

// ---- ol-hpqn ------------------------------------------------------------
// Cross-position de-duplication for a Form XObject painted more than once.
// ol-v460's own ancestor-*path* cycle guard deliberately allows the SAME form
// to be painted twice at sibling positions (a repeated background, a
// watermark) — correctly, since that is not a cycle. What it left open is the
// narrower case this bead names: the SAME form at the EXACT SAME position,
// which is not a second rendering at all, just the same content re-stamped,
// and previously contributed its text twice with nothing to fold it. The pair
// below pins both directions from the bead's own acceptance criteria: same
// position folds, different position does not — the second case is the one
// that matters most, because folding it would delete real, legitimately
// repeated content (an MCQ answer key repeating "A B C D" per question).
describe('pdfExtractor — Form XObject position de-duplication (ol-hpqn)', () => {
  it('folds a Form XObject painted twice at the SAME cm translation into one copy of its text', async () => {
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 50 100 cm /Fm1 Do Q q 1 0 0 1 50 100 cm /Fm1 Do Q',
      [
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> >> ' +
          '/Length 44 >>\nstream\nBT /F1 12 Tf (Repeated label) Tj ET\nendstream\nendobj\n',
        simpleFontObj(3),
      ],
    );
    const result = await pdfExtractor.extract({ path: 'form-same-position.pdf', bytes });
    const text = result.pages[0]?.units[0]?.text ?? '';
    expect(text.match(/Repeated label/g)).toHaveLength(1);
  });

  it('does NOT fold a Form XObject painted twice at DIFFERENT cm translations — both copies survive', async () => {
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R >> >>',
      'q 1 0 0 1 50 100 cm /Fm1 Do Q q 1 0 0 1 50 300 cm /Fm1 Do Q',
      [
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> >> ' +
          '/Length 44 >>\nstream\nBT /F1 12 Tf (Repeated label) Tj ET\nendstream\nendobj\n',
        simpleFontObj(3),
      ],
    );
    const result = await pdfExtractor.extract({ path: 'form-different-positions.pdf', bytes });
    const text = result.pages[0]?.units[0]?.text ?? '';
    expect(text.match(/Repeated label/g)).toHaveLength(2);
  });

  it('folds only the exact same target object at the same position — a DIFFERENT form at that position still shows', async () => {
    // Guards against a key collision: two distinct forms happening to share a
    // translation must never be treated as duplicates of each other.
    const bytes = buildFormGraphPdf(
      '<< /XObject << /Fm1 6 0 R /Fm2 10 0 R >> >>',
      'q 1 0 0 1 50 100 cm /Fm1 Do Q q 1 0 0 1 50 100 cm /Fm2 Do Q',
      [
        '6 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> >> ' +
          '/Length 33 >>\nstream\nBT /F1 12 Tf (First form) Tj ET\nendstream\nendobj\n',
        '10 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
          '/Resources << /Font << /F1 3 0 R >> >> ' +
          '/Length 34 >>\nstream\nBT /F1 12 Tf (Second form) Tj ET\nendstream\nendobj\n',
        simpleFontObj(3),
      ],
    );
    const result = await pdfExtractor.extract({
      path: 'form-same-position-different-object.pdf',
      bytes,
    });
    const text = result.pages[0]?.units[0]?.text ?? '';
    expect(text).toContain('First form');
    expect(text).toContain('Second form');
  });

  it('does not carry a de-dup memo across sibling top-level pages — each page starts a fresh walk', async () => {
    // `walkContentTokens` is called fresh per page (see `getPageContent`), so
    // the position memo it owns must not survive between pages by construction
    // — this pins that no *shared* state was accidentally introduced.
    const pageBody = 'q 1 0 0 1 50 100 cm /Fm1 Do Q';
    const objects =
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>\nendobj\n' +
      `4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 6 0 R /Resources << /XObject << /Fm1 8 0 R >> >> >>\nendobj\n` +
      `5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 7 0 R /Resources << /XObject << /Fm1 8 0 R >> >> >>\nendobj\n` +
      `6 0 obj\n<< /Length ${pageBody.length} >>\nstream\n${pageBody}\nendstream\nendobj\n` +
      `7 0 obj\n<< /Length ${pageBody.length} >>\nstream\n${pageBody}\nendstream\nendobj\n` +
      '8 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 300 200] ' +
      '/Resources << /Font << /F1 3 0 R >> >> ' +
      '/Length 44 >>\nstream\nBT /F1 12 Tf (Repeated label) Tj ET\nendstream\nendobj\n' +
      simpleFontObj(3);
    const bytes = latin1ToBytes(
      `%PDF-1.4\n${objects}trailer\n<< /Size 999 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
    );
    const result = await pdfExtractor.extract({ path: 'form-same-position-two-pages.pdf', bytes });
    expect(result.pages[0]?.units[0]?.text).toContain('Repeated label');
    expect(result.pages[1]?.units[0]?.text).toContain('Repeated label');
  });
});

describe('pdfExtractor — text plausibility (ol-s3xa)', () => {
  it('refuses the text layer for a page of control characters and un-mapped glyphs', async () => {
    // The defect: this page's charCount is far above the routing threshold, so
    // it claimed a usable text layer, kept its unit, and was eligible to be
    // quoted back to her — a correct citation carrying an unreadable passage.
    const body = `BT /F1 12 Tf 20 150 Td (${unmappedGlyphRun(200)}) Tj 0 -14 Td (Aggradation) Tj ET`;
    const page = await pageOfBody(body);
    expect(page?.textLayer).toBe('unreadable');
    expect(page?.route).toBe('vision');
    expect(page?.units).toEqual([]);
    // charCount still reports what actually came out — the yield measurement
    // must not be quietly rewritten by the quality check.
    expect(page?.charCount).toBeGreaterThan(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD);
  });

  it('leaves an ordinary page alone — the control', async () => {
    const page = await pageOfBody(
      'BT /F1 12 Tf 20 150 Td (Grain size fines upward through the bed) Tj ET',
    );
    expect(page?.textLayer).toBe('readable');
    expect(page?.route).toBe('text-layer');
    expect(page?.units).toHaveLength(1);
  });

  it('cuts exactly at the calibrated share, and counts only codes no encoding maps a character to', async () => {
    const total = 200;
    const atLimit = Math.round(total * MAX_CONTROL_CHAR_SHARE);
    const filler = (n: number) => 'a'.repeat(n);
    const at = `BT /F1 12 Tf (${unmappedGlyphRun(atLimit)}${filler(total - atLimit)}) Tj ET`;
    const above = `BT /F1 12 Tf (${unmappedGlyphRun(atLimit + 1)}${filler(total - atLimit - 1)}) Tj ET`;
    expect((await pageOfBody(at))?.textLayer).toBe('readable');
    expect((await pageOfBody(above))?.textLayer).toBe('unreadable');
  });

  it('does not fire on WinAnsi punctuation, which Latin-1 calls a control code', async () => {
    // 0x92 and friends are C1 controls in Latin-1 and ordinary curly
    // punctuation in WinAnsi, which is what real producers mean by them.
    // Counting them would red on correct English prose.
    const body =
      'BT /F1 12 Tf (The bed\\222s top contact \\226 sharp, erosive \\227 is planar) Tj ET';
    const page = await pageOfBody(body);
    expect(page?.textLayer).toBe('readable');
    expect(page?.route).toBe('text-layer');
  });

  it('does not fire on the newlines the extractor emits itself', async () => {
    const body = Array.from({ length: 12 }, (_, i) => `(line ${i}) Tj 0 -14 Td`).join(' ');
    const page = await pageOfBody(`BT /F1 12 Tf 20 150 Td ${body} ET`);
    expect(page?.textLayer).toBe('readable');
  });
});

// ---- ol-avvt: the composite-font decode, and the honesty it must not trade
// away ------------------------------------------------------------------
//
// THE MEASURED SHAPE, restated without any of the material. A real corpus of
// past papers registered 42/42 and then came back three quarters unreadable,
// while poppler read a full text layer out of every one of them. Every affected
// file used the same construction: `/Subtype /Type0` fonts with `/Encoding
// /Identity-H`, i.e. a *subset* font whose content-stream string bytes are
// two-byte glyph indices, not character codes. Read as Latin-1 those indices
// are C0 controls, `plausibility.ts` correctly refused them, and the page went
// to vision at 6.5x the price with perfectly good text sitting in the file. The
// map back is the font's own `/ToUnicode` CMap, which this extractor did not
// read. The figures stay private, in `olea-service/findings/`.
//
// Every fixture below is INVENTED content in the real producers' shapes
// (INV-3). The glyph numbering — first-appearance order, numbered from 1 — is
// the shape a real subsetter produces, which is what makes the un-mapped
// reading land in the control range.

/** Allocates a subset glyph id per distinct character, first-appearance order, numbered from 1 — how a subsetting exporter actually assigns them. */
function subsetGlyphIds(text: string): Map<string, number> {
  const ids = new Map<string, number>();
  for (const ch of text) if (!ids.has(ch)) ids.set(ch, ids.size + 1);
  return ids;
}

/** `text` as the hex string a `/Identity-H` font is shown with: two bytes of glyph index per character. */
function glyphHex(text: string, ids: ReadonlyMap<string, number>): string {
  let out = '';
  for (const ch of text) out += (ids.get(ch) ?? 0).toString(16).padStart(4, '0');
  return out;
}

/**
 * A `/ToUnicode` CMap program in the shape producers emit one, mapping the
 * first `mappedCount` glyph ids back to their characters. Leaving some
 * unmapped is how a partially-resolvable font is modelled.
 */
function toUnicodeCMapSource(ids: ReadonlyMap<string, number>, mappedCount = ids.size): string {
  const entries = [...ids.entries()].slice(0, mappedCount);
  const lines = entries
    .map(
      ([ch, id]) =>
        `<${id.toString(16).padStart(4, '0')}> <${ch.charCodeAt(0).toString(16).padStart(4, '0')}>`,
    )
    .join('\n');
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /Adobe-Identity-UCS def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${entries.length} beginbfchar`,
    lines,
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

interface IdentityHOptions {
  /** Omit the `/ToUnicode` entry entirely — the un-recoverable shape. */
  readonly withoutToUnicode?: boolean;
  /** Map only this many glyph ids, leaving the rest unresolvable. */
  readonly mappedCount?: number;
  /** Position every character with its own `Tm` at the same baseline — the office-exporter shape. */
  readonly perGlyphPositioning?: boolean;
  /** Put `/Resources` on the `/Pages` node instead of the page, so the page inherits them. */
  readonly inheritResources?: boolean;
}

/** A one-page PDF whose text is painted with a subset `/Identity-H` composite font. */
function buildIdentityHPdf(text: string, options: IdentityHOptions = {}): Uint8Array {
  const ids = subsetGlyphIds(text);
  const cmapSrc = toUnicodeCMapSource(ids, options.mappedCount);

  const body = options.perGlyphPositioning
    ? `BT /F1 12 Tf ${[...text]
        .map((ch, i) => `1 0 0 1 ${20 + i * 7} 150 Tm <${glyphHex(ch, ids)}> Tj`)
        .join(' ')} ET`
    : `BT /F1 12 Tf 20 150 Td <${glyphHex(text, ids)}> Tj ET`;

  const resources = '<< /Font << /F1 3 0 R >> >>';
  const toUnicode = options.withoutToUnicode ? '' : ' /ToUnicode 6 0 R';
  const objects =
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    `2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1${options.inheritResources ? ` /Resources ${resources}` : ''} >>\nendobj\n` +
    `3 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /BAAAAA+Calibri /Encoding /Identity-H /DescendantFonts [7 0 R]${toUnicode} >>\nendobj\n` +
    `4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 5 0 R${options.inheritResources ? '' : ` /Resources ${resources}`} >>\nendobj\n` +
    `5 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n` +
    `6 0 obj\n<< /Length ${cmapSrc.length} >>\nstream\n${cmapSrc}\nendstream\nendobj\n` +
    '7 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /BAAAAA+Calibri /CIDToGIDMap /Identity >>\nendobj\n';
  return latin1ToBytes(
    `%PDF-1.5\n${objects}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n0\n%%EOF`,
  );
}

describe('pdfExtractor — subset composite fonts and their ToUnicode CMap (ol-avvt)', () => {
  // Invented, and in the same geology register as every other fixture in this
  // file — deliberately *not* in the register of the corpus that surfaced the
  // defect (INV-3: mirror the producer's structure, invent everything else).
  const SENTENCE = 'Describe how grain size fines upward through a turbidite bed';

  it('reads the text of an Identity-H subset font through its ToUnicode CMap', async () => {
    // Without the CMap this page is a run of two-byte glyph indices whose
    // Latin-1 reading is C0 controls: charCount well above the routing
    // threshold, textLayer 'unreadable', route 'vision', no unit — the exact
    // state 76% of a real corpus was in.
    const result = await pdfExtractor.extract({
      path: 'exam.pdf',
      bytes: buildIdentityHPdf(SENTENCE),
    });
    expect(result.outcome).toBe('extracted');
    expect(result.pages[0]?.textLayer).toBe('readable');
    expect(result.pages[0]?.route).toBe('text-layer');
    expect(result.pages[0]?.units[0]?.text).toBe(SENTENCE);
  });

  it('resolves the font when the page inherits /Resources from its /Pages node', async () => {
    // Not a hypothetical: a page that inherits its resources has no /Font
    // dictionary of its own, so a reader that does not chase /Parent finds no
    // fonts, consults no CMap, and shows the glyph indices raw.
    const result = await pdfExtractor.extract({
      path: 'inherited.pdf',
      bytes: buildIdentityHPdf(SENTENCE, { inheritResources: true }),
    });
    expect(result.pages[0]?.units[0]?.text).toBe(SENTENCE);
  });

  it('keeps words intact when the producer positions every glyph on its own baseline', async () => {
    // The second half of the defect, and the one a character-count check would
    // never have caught. These exporters set each glyph with its own `Tm` at
    // the *same* y. Treating every text-positioning operator as a line break
    // put a newline between almost every pair of characters: the letters were
    // right and the words were shattered, which for a corpus that feeds
    // retrieval is its own kind of unusable.
    const result = await pdfExtractor.extract({
      path: 'perglyph.pdf',
      bytes: buildIdentityHPdf(SENTENCE, { perGlyphPositioning: true }),
    });
    expect(result.pages[0]?.units[0]?.text).toBe(SENTENCE);
  });

  it('still reports unreadable — never plausible text — when the font carries no ToUnicode at all', async () => {
    // The honesty guard ol-x1ch bought, held onto. A composite font with no
    // CMap is not decodable by this extractor and must not be made to look as
    // if it were: every code reports as unresolved, the page stays
    // 'unreadable', and it still routes to vision carrying no unit.
    const result = await pdfExtractor.extract({
      path: 'nomap.pdf',
      bytes: buildIdentityHPdf(SENTENCE, { withoutToUnicode: true }),
    });
    expect(result.pages[0]?.textLayer).toBe('unreadable');
    expect(result.pages[0]?.route).toBe('vision');
    expect(result.pages[0]?.units).toEqual([]);
    expect(result.outcome).toBe('reached-but-unreadable');
    // It is refused *despite* clearing the routing threshold — one unresolved
    // marker per two-byte code, so the count is exactly the source length. That
    // is the ol-s3xa shape: plenty of characters, none of them text.
    expect(result.pages[0]?.charCount).toBe(SENTENCE.length);
    expect(result.pages[0]?.charCount).toBeGreaterThan(DEFAULT_TEXT_LAYER_CHAR_THRESHOLD);
  });

  it('still reports unreadable when the ToUnicode CMap covers only a few of the codes', async () => {
    const ids = subsetGlyphIds(SENTENCE);
    const result = await pdfExtractor.extract({
      path: 'partial.pdf',
      bytes: buildIdentityHPdf(SENTENCE, { mappedCount: Math.floor(ids.size / 4) }),
    });
    expect(result.pages[0]?.textLayer).toBe('unreadable');
    expect(result.pages[0]?.units).toEqual([]);
  });

  it('accepts a CMap with a handful of gaps — a check that reds on everything discriminates nothing', async () => {
    // The control for the test above. A subset font missing one or two glyph
    // mappings is ordinary; refusing the page for it would route good material
    // to vision, which is the misrouting failure `threshold.ts` argues against.
    const ids = subsetGlyphIds(SENTENCE);
    const result = await pdfExtractor.extract({
      path: 'nearlycomplete.pdf',
      bytes: buildIdentityHPdf(SENTENCE, { mappedCount: ids.size - 1 }),
    });
    expect(result.pages[0]?.textLayer).toBe('readable');
    expect(result.pages[0]?.units).toHaveLength(1);
  });

  it('leaves a simple WinAnsi font untouched — the material that already worked', async () => {
    // The regression control. A `/Type1` font with no `/ToUnicode` is the
    // common correct case, its bytes *are* character codes, and none of this
    // may move a byte of it.
    const result = await pdfExtractor.extract({
      path: 'plain.pdf',
      bytes: buildPdfBytes(['Cross-bedding in the lower unit', 'Ripple lamination above it']),
    });
    expect(result.pages.map((p) => p.units[0]?.text)).toEqual([
      'Cross-bedding in the lower unit',
      'Ripple lamination above it',
    ]);
  });

  it('breaks a line on a vertical move and not on a horizontal one', async () => {
    // The rule stated directly, without a font in the way. `Td` moving down
    // starts a line; `Td` moving along the same baseline does not.
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td (upper) Tj 0 -14 Td (lower) Tj ET')).toBe(
      'upper\nlower',
    );
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td (same) Tj 40 0 Td (line) Tj ET')).toBe(
      'sameline',
    );
    expect(
      await textOfBody('BT /F1 12 Tf 1 0 0 1 20 150 Tm (same) Tj 1 0 0 1 60 150 Tm (line) Tj ET'),
    ).toBe('sameline');
    expect(
      await textOfBody('BT /F1 12 Tf 1 0 0 1 20 150 Tm (upper) Tj 1 0 0 1 20 136 Tm (lower) Tj ET'),
    ).toBe('upper\nlower');
  });

  it('does not read a superscript nudge as a new line', async () => {
    expect(await textOfBody('BT /F1 12 Tf 20 150 Td (x) Tj 0 0.3 Td (2) Tj ET')).toBe('x2');
  });
});
