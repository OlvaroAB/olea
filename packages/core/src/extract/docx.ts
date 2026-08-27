/**
 * The DOCX extractor (C3.1, C3.2, P3-T04) — **real, minimal.**
 *
 * A `.docx` is a zip archive; the document body lives in
 * `word/document.xml` as `<w:p>` paragraphs containing `<w:t>` text runs.
 * As with `pptx.ts`, this reads that directly with regexes over OOXML's
 * small text-bearing vocabulary rather than pulling in a general XML
 * parser or a `mammoth`-style conversion library — the latter drag in far
 * more (style/table/image handling, HTML rendering) than "get the text
 * layer's characters" needs, and would need auditing for Node-only
 * internals before it could ship into a mobile Obsidian bundle (INV-1's
 * mobile-compatibility concern, same reasoning as the PDF extractor's
 * module doc).
 *
 * **DOCX gets no page number — deliberately, not as an oversight.** Word
 * computes page breaks from fonts, margins, and full layout at render time;
 * OOXML paragraphs don't carry that number, and guessing from the rare
 * explicit `<w:br w:type="page"/>` would produce a page count that silently
 * disagrees with what Word itself shows, which is worse than admitting the
 * limitation. `Provenance.location.page` is `1` for every unit — see
 * `types.ts`'s doc comment on `SourceLocation` — and citation precision
 * instead comes entirely from `charRange`, which *is* exact: an offset
 * range into the whole document's paragraph text, paragraph by paragraph.
 * A DOCX therefore has exactly one `PageExtraction` (`page: 1`) covering
 * the whole document; the char-yield-per-page threshold still applies to
 * it, because a Word document built around a single pasted scanned image
 * (unusual, but possible) is exactly the "genuinely no text layer" case
 * routing exists to catch.
 */

import { strFromU8, unzipSync } from 'fflate';
import { classifyPageText } from './plausibility.js';
import { routePage } from './threshold.js';
import type {
  ExtractedUnit,
  ExtractionResult,
  ExtractOptions,
  Extractor,
  ExtractorInput,
  RouteDecision,
} from './types.js';
import { decodeXmlEntities } from './xml-entities.js';

const BODY_RE = /<w:body>([\s\S]*?)<\/w:body>/;
const PARAGRAPH_RE = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
const TEXT_RUN_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;

/** One paragraph's visible text, runs concatenated in document order. Formatting boundaries within a paragraph (bold/italic runs, etc.) are invisible here on purpose — only the characters matter for extraction and yield counting. */
function extractParagraphText(paragraphXml: string): string {
  let text = '';
  let runMatch = TEXT_RUN_RE.exec(paragraphXml);
  while (runMatch !== null) {
    text += decodeXmlEntities(runMatch[1] ?? '');
    runMatch = TEXT_RUN_RE.exec(paragraphXml);
  }
  return text;
}

/** Every non-empty paragraph's text, in document order. Empty paragraphs (spacing-only) are dropped — they carry no citable content. */
function extractDocumentParagraphs(documentXml: string): string[] {
  const body = BODY_RE.exec(documentXml)?.[1] ?? documentXml;
  const paragraphs: string[] = [];
  let paraMatch = PARAGRAPH_RE.exec(body);
  while (paraMatch !== null) {
    const text = extractParagraphText(paraMatch[1] ?? '');
    if (text.length > 0) paragraphs.push(text);
    paraMatch = PARAGRAPH_RE.exec(body);
  }
  return paragraphs;
}

export const docxExtractor: Extractor = {
  format: 'docx',

  async extract(input: ExtractorInput, options?: ExtractOptions): Promise<ExtractionResult> {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(input.bytes);
    } catch {
      // Not a valid zip at all, so nothing about the document could be read
      // — `'unreadable'`, which is distinct from "a document with no pages"
      // (see `ExtractionOutcome`).
      return { sourcePath: input.path, format: 'docx', outcome: 'unreadable', pages: [] };
    }

    const documentBytes = files['word/document.xml'];
    const paragraphs = documentBytes ? extractDocumentParagraphs(strFromU8(documentBytes)) : [];
    const fullText = paragraphs.join('\n');
    const charCount = fullText.length;
    // OOXML text nodes are already characters, so there is no decode step here
    // to fail the way `pdf.ts`'s does — but the plausibility check still runs,
    // because "the check is applied uniformly" is what keeps it from being one
    // more thing someone has to remember (ol-s3xa).
    const textLayer = classifyPageText(fullText, charCount > 0);
    const route: RouteDecision =
      textLayer === 'unreadable' ? 'vision' : routePage(charCount, options?.textLayerCharThreshold);

    const units: ExtractedUnit[] = [];
    if (route === 'text-layer') {
      let offset = 0;
      for (const paragraph of paragraphs) {
        const start = offset;
        const end = start + paragraph.length;
        units.push({
          text: paragraph,
          provenance: {
            sourcePath: input.path,
            location: { page: 1, charRange: { start, end } },
            ...(input.embeddedIn ? { embeddedIn: input.embeddedIn } : {}),
          },
        });
        offset = end + 1; // account for the '\n' joining paragraphs in `fullText`
      }
    }

    return {
      sourcePath: input.path,
      format: 'docx',
      // A DOCX that unzips is always exactly one logical page (see the
      // `page` convention in `types.ts`), so a page record is always
      // produced — including for a document whose `word/document.xml` is
      // missing or empty, where the honest report is a zero-yield page
      // routed to vision, not a missing one.
      outcome: 'extracted',
      // `furniture: false`, always: the running-head/page-number signal
      // (SCAN-1, ol-738i; `furniture.ts`) needs a line to recur *across*
      // pages, and a DOCX is exactly one logical page by this format's own
      // convention above — there is no second page to compare against.
      pages: [{ page: 1, charCount, textLayer, route, units, furniture: false }],
    };
  },
};
