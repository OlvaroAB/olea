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
 *
 * **`extractDocxEmbeddedImages` (C3.3; per.md decision 1, `[D-324]`,
 * `ol-egov.141.89.8.20`, discovered from `ol-9cle`) is a separate function,
 * called beside `docxExtractor.extract`, not merged into it.** A DOCX's
 * embedded raster part(s) live in `word/media/`, reached via
 * `word/_rels/document.xml.rels`, and — following this file's own "whole
 * document is one logical page" convention above — are reported as a single
 * `page: 1` region's images, not per-paragraph. See `embedded-image.ts`'s
 * module doc for why this stays a sibling function and how a future
 * vision-page caller would consume it.
 *
 * **`docxFigureCue` (`ol-egov.141.89.8.26`) is the combine-policy trigger,
 * a second sibling function beside `extractDocxEmbeddedImages` — see
 * `pptx.ts`'s own `pptxFigureCue` doc for the shared D-324 combine ruling
 * this implements (Class B, self-ratified 2026-09-27,
 * `findings/office-image-selection.md`). This format's own denominator is
 * the **document's declared page size**, `<w:sectPr>`'s `<w:pgSz w:w=""
 * w:h=""/>` in twips (1 twip = 1/1440 inch = 635 EMU), against each
 * `<w:drawing>`'s own `<wp:extent cx="" cy=""/>` in EMU — the same
 * placement-geometry, no-pixel-decoding reading `pptxFigureCue` takes,
 * `findings/office-image-selection.md`'s own method section for both
 * formats. **No recurrence rule applies here** — this file's own "whole
 * document is one logical page" convention (above) gives DOCX no second
 * region to be a majority of, exactly as that finding's document says.
 *
 * **No guessing when the page size cannot be resolved (the ratified
 * ruling's own words).** A document with no `<w:pgSz>` at all, or one whose
 * `w:w`/`w:h` do not parse, has no page-area denominator: its images never
 * trigger this cue, and `qualifies` is `false` — never a share computed
 * against an invented default page size. Sending is not wired here either —
 * see `pptx.ts`'s own module doc for why.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { EmbeddedRasterImage, PageEmbeddedImages } from './embedded-image.js';
import { readEmbeddedRasterImages } from './embedded-image.js';
import { FIGURE_CUE_MIN_SHARE } from './figure-cue.js';
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

/**
 * The DOCX's embedded raster image(s), as a single `page: 1` region — this
 * format has exactly one logical page (see the module doc), so there is
 * exactly one `PageEmbeddedImages` record, always, even when `images` is
 * empty (a zip that doesn't unzip at all, `word/_rels/document.xml.rels` is
 * absent, or the document paints only vector shapes): marked as having no
 * image, never omitted, never faked. See this module's doc comment and
 * `embedded-image.ts`'s for why this is a sibling function rather than a
 * field on `docxExtractor.extract`'s return value.
 */
export function extractDocxEmbeddedImages(input: ExtractorInput): PageEmbeddedImages[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.bytes);
  } catch {
    // Not a valid zip at all — mirrors `docxExtractor.extract`'s own
    // `'unreadable'` case.
    return [];
  }

  const relsBytes = files['word/_rels/document.xml.rels'];
  const relsXml = relsBytes ? strFromU8(relsBytes) : undefined;
  const images = readEmbeddedRasterImages(files, relsXml, 'word');
  return [{ page: 1, images }];
}

// ---------------------------------------------------------------------------
// `docxFigureCue` — D-324's combine policy for DOCX (`ol-egov.141.89.8.26`,
// Class B, self-ratified 2026-09-27, `findings/office-image-selection.md`).
// See this file's module doc for the ruling and the "no guessing when
// absent" denominator rule.
// ---------------------------------------------------------------------------

/** Mirrors `embedded-image.ts`'s `RASTER_EXTENSION_MIME` (private there) — duplicated for the same "target path must stay visible to the caller" reason `pptx.ts`'s own copy gives. */
const RASTER_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

/** `undefined` for a non-raster or unrecognised extension (vector metafiles included). */
function rasterMimeTypeForTarget(target: string): string | undefined {
  const dot = target.lastIndexOf('.');
  if (dot < 0) return undefined;
  return RASTER_MIME_BY_EXTENSION[target.slice(dot + 1).toLowerCase()];
}

const RELATIONSHIP_RE = /<Relationship\b[^>]*\/>/g;
const ATTR_ID_RE = /\bId="([^"]+)"/;
const ATTR_TYPE_RE = /\bType="([^"]+)"/;
const ATTR_TARGET_RE = /\bTarget="([^"]+)"/;
const IMAGE_REL_TYPE_RE = /\/relationships\/image$/;
const DRAWING_RE = /<w:drawing>[\s\S]*?<\/w:drawing>/g;
const DRAWING_EMBED_RE = /r:embed="([^"]+)"/;
const WP_EXTENT_RE = /<wp:extent\b([^>]*)\/>/;
const ATTR_EXT_CX_RE = /\bcx="(\d+)"/;
const ATTR_EXT_CY_RE = /\bcy="(\d+)"/;
const PG_SZ_RE = /<w:pgSz\b([^>]*)\/>/;
const ATTR_PGSZ_W_RE = /\bw:w="(\d+)"/;
const ATTR_PGSZ_H_RE = /\bw:h="(\d+)"/;

/** 1 twip = 1/1440 inch; 1 inch = 914400 EMU; 914400 / 1440 = 635 — the fixed conversion `findings/office-image-selection.md`'s method section names for `<w:pgSz>`, which is declared in twips, not EMU like `<wp:extent>` already is. */
const TWIP_TO_EMU = 635;

/**
 * Resolves a `word/_rels/document.xml.rels` `Target` against `word` (the
 * folder that `.rels` file itself describes), walking `../` segments —
 * mirrors `embedded-image.ts`'s own general `resolveRelsTarget(baseDir,
 * target)` (private there) and `pptx.ts`'s `resolveSlideRelsTarget`. A
 * DOCX media `Target` is ordinarily `media/imageN.*` (no climbing needed),
 * but this walks `..` anyway rather than assuming that shape.
 */
function resolveDocumentRelsTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['word'];
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment.length > 0) parts.push(segment);
  }
  return parts.join('/');
}

/** Every image-type relationship in `word/_rels/document.xml.rels`, `Id` -> resolved zip-entry path. */
function documentImageRelationshipTargets(relsXml: string): Map<string, string> {
  const map = new Map<string, string>();
  let match = RELATIONSHIP_RE.exec(relsXml);
  while (match !== null) {
    const tag = match[0];
    const id = ATTR_ID_RE.exec(tag)?.[1];
    const type = ATTR_TYPE_RE.exec(tag)?.[1];
    const target = ATTR_TARGET_RE.exec(tag)?.[1];
    if (
      id !== undefined &&
      type !== undefined &&
      target !== undefined &&
      IMAGE_REL_TYPE_RE.test(type)
    ) {
      map.set(id, resolveDocumentRelsTarget(target));
    }
    match = RELATIONSHIP_RE.exec(relsXml);
  }
  return map;
}

/**
 * The document's own declared page area in EMU, from the first `<w:pgSz>`
 * found anywhere in `word/document.xml` (that tag only ever appears inside
 * a `<w:sectPr>`, so a direct search is equivalent to, and simpler than,
 * first locating the enclosing section). `null` when no `<w:pgSz>` is
 * present, or its `w:w`/`w:h` do not parse to positive numbers — this
 * file's module doc's "no guessing when absent" rule; a multi-section
 * document with differing page sizes uses whichever section's `<w:pgSz>`
 * appears first, a real declared size, never an invented default.
 */
function docxPageAreaEmu(documentXml: string): number | null {
  const match = PG_SZ_RE.exec(documentXml);
  if (!match) return null;
  const w = Number(ATTR_PGSZ_W_RE.exec(match[0])?.[1]);
  const h = Number(ATTR_PGSZ_H_RE.exec(match[0])?.[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w * TWIP_TO_EMU * (h * TWIP_TO_EMU);
}

/** D-324's combine-cue result for a DOCX — see this file's module doc's `docxFigureCue` section. Exactly one (this format has exactly one logical page/region), unlike `pptxFigureCue`'s per-slide array. */
export interface DocxFigureCueResult {
  /** `true` when the document's candidate images (non-vector, resolvable placement, a resolvable page-area denominator), summed, cover at least `minShare` of the declared page area. Always `false` when the page size cannot be resolved — see the module doc. */
  readonly qualifies: boolean;
  /** The exact candidate images that were summed to reach `qualifies` — empty when `qualifies` is `false`. Sending is not wired here — see `pptx.ts`'s own module doc. */
  readonly images: readonly EmbeddedRasterImage[];
}

/**
 * D-324's figure cue, combine policy, for a DOCX — see this file's module
 * doc for the ruling this implements (`ol-egov.141.89.8.26`,
 * `findings/office-image-selection.md`) and the "no guessing when absent"
 * page-size rule. `minShare` defaults to the same declared
 * `FIGURE_CUE_MIN_SHARE` `figure-cue.ts`/`pptx.ts`'s `pptxFigureCue` use —
 * the same named constant, cited rather than re-declared.
 *
 * Mirrors `extractDocxEmbeddedImages`'s own `'unreadable'` handling: a
 * buffer that does not unzip, or has no `word/document.xml`, yields
 * `{ qualifies: false, images: [] }` — never guessed, never thrown.
 */
export function docxFigureCue(
  input: ExtractorInput,
  minShare: number = FIGURE_CUE_MIN_SHARE,
): DocxFigureCueResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.bytes);
  } catch {
    return { qualifies: false, images: [] };
  }

  const documentBytes = files['word/document.xml'];
  if (!documentBytes) return { qualifies: false, images: [] };
  const documentXml = strFromU8(documentBytes);

  const pageAreaEmu = docxPageAreaEmu(documentXml);
  if (pageAreaEmu === null) {
    // No guessing when absent (this file's module doc, the ratified
    // ruling's own words): no page-area denominator means this document's
    // images never trigger the cue.
    return { qualifies: false, images: [] };
  }

  const relsBytes = files['word/_rels/document.xml.rels'];
  const relsXml = relsBytes ? strFromU8(relsBytes) : '';
  const relTargets = relsXml
    ? documentImageRelationshipTargets(relsXml)
    : new Map<string, string>();

  const candidates: { readonly areaShare: number; readonly image: EmbeddedRasterImage }[] = [];
  let drawingMatch = DRAWING_RE.exec(documentXml);
  while (drawingMatch !== null) {
    const block = drawingMatch[0];
    const embedId = DRAWING_EMBED_RE.exec(block)?.[1];
    const target = embedId !== undefined ? relTargets.get(embedId) : undefined;
    const mimeType = target !== undefined ? rasterMimeTypeForTarget(target) : undefined;
    const bytes = target !== undefined ? files[target] : undefined;
    if (target !== undefined && mimeType !== undefined && bytes !== undefined) {
      const extentMatch = WP_EXTENT_RE.exec(block);
      if (extentMatch) {
        const cx = Number(ATTR_EXT_CX_RE.exec(extentMatch[0])?.[1]);
        const cy = Number(ATTR_EXT_CY_RE.exec(extentMatch[0])?.[1]);
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          candidates.push({ areaShare: (cx * cy) / pageAreaEmu, image: { bytes, mimeType } });
        }
      }
    }
    drawingMatch = DRAWING_RE.exec(documentXml);
  }

  const combinedShare = candidates.reduce((sum, c) => sum + c.areaShare, 0);
  const qualifies = combinedShare >= minShare;
  return { qualifies, images: qualifies ? candidates.map((c) => c.image) : [] };
}
