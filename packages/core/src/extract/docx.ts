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
 *
 * **Section labels come from Word's own heading styles, not a guess**
 * (C3.2, DF-22). Unlike PDF, DOCX genuinely carries author-placed structure:
 * a paragraph styled `Heading1`-`Heading9` is Word's own signal, the same
 * kind of thing a markdown `#`/`##` line is to `../block/outline.js`. Every
 * unit's `provenance.location.section` is the text of the nearest
 * **preceding** heading-styled paragraph — flattened to one label rather
 * than a level-aware tree, because a citation needs a name to read out, not
 * a rebuilt table of contents. A paragraph before the first heading (or a
 * document with none) carries no `section`, which is the honest answer, not
 * a missing one — see `types.ts`'s doc comment on `SourceLocation.section`.
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
/** `w:pStyle` names the paragraph's style ID, when it has a non-default one — the mandatory `<w:pPr>` wrapper this always sits inside is not itself matched, since the style ID is all extraction needs. */
const STYLE_RE = /<w:pStyle\b[^>]*\bw:val="([^"]*)"/;
/** Word's own default English heading-style IDs — `Heading1` through `Heading9`, case-insensitively (a document authored or re-saved with different style-ID casing is still a heading). Not `Title`/`Subtitle`: those name the document's own title, not a section within it. */
const HEADING_STYLE_RE = /^Heading[1-9]$/i;

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

/** Whether a paragraph carries one of Word's own heading styles — see `HEADING_STYLE_RE`. */
function isHeadingParagraph(paragraphXml: string): boolean {
  const styleId = STYLE_RE.exec(paragraphXml)?.[1];
  return styleId !== undefined && HEADING_STYLE_RE.test(styleId);
}

/** One non-empty paragraph's text plus whether it is itself a heading — see `isHeadingParagraph`. */
interface DocxParagraph {
  readonly text: string;
  readonly isHeading: boolean;
}

/** Every non-empty paragraph, in document order, each tagged with whether it is itself a heading-styled paragraph. Empty paragraphs (spacing-only) are dropped — they carry no citable content. */
function extractDocumentParagraphs(documentXml: string): DocxParagraph[] {
  const body = BODY_RE.exec(documentXml)?.[1] ?? documentXml;
  const paragraphs: DocxParagraph[] = [];
  let paraMatch = PARAGRAPH_RE.exec(body);
  while (paraMatch !== null) {
    const inner = paraMatch[1] ?? '';
    const text = extractParagraphText(inner);
    if (text.length > 0) paragraphs.push({ text, isHeading: isHeadingParagraph(inner) });
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
    const fullText = paragraphs.map((p) => p.text).join('\n');
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
      // The nearest *preceding* heading's text — see `types.ts`'s doc comment
      // on `SourceLocation.section`. A heading paragraph's own unit is tagged
      // with whatever section was open *before* it (its parent, or `undefined`
      // at the top), and only paragraphs after it inherit its own text —
      // mirroring `../block/outline.ts`'s "a heading's own contentIndices
      // exclude the heading itself" convention.
      let currentSection: string | undefined;
      for (const paragraph of paragraphs) {
        const start = offset;
        const end = start + paragraph.text.length;
        units.push({
          text: paragraph.text,
          provenance: {
            sourcePath: input.path,
            location: {
              page: 1,
              charRange: { start, end },
              ...(currentSection !== undefined ? { section: currentSection } : {}),
            },
            ...(input.embeddedIn ? { embeddedIn: input.embeddedIn } : {}),
          },
        });
        offset = end + 1; // account for the '\n' joining paragraphs in `fullText`
        if (paragraph.isHeading) currentSection = paragraph.text;
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
