/**
 * The PPTX extractor (C3.1, C3.2, P3-T04) — **real, minimal.**
 *
 * A `.pptx` is a zip archive of OOXML parts; `fflate`'s pure-JS `unzipSync`
 * (see `../../package.json`) opens it, and each slide's text lives in
 * `ppt/slides/slideN.xml` as `<a:t>` runs inside `<a:p>` paragraphs. This
 * extractor reads those directly with regexes rather than a general XML
 * parser — OOXML's text-bearing shapes are a small, well-known vocabulary,
 * and a full DOM parser would be a much heavier dependency to justify for
 * "find the runs of visible text."
 *
 * **Slide order is resolved properly, not by filename sort.** `slideN.xml`'s
 * `N` does *not* reliably match presentation order — PowerPoint numbers
 * slide files by creation order, not by their position after reordering.
 * The true order lives in `ppt/presentation.xml`'s `<p:sldIdLst>` (a
 * sequence of `r:id` references) resolved through
 * `ppt/_rels/presentation.xml.rels` (`r:id` -> slide file). This extractor
 * does that resolution — the slide/page number in every unit's provenance
 * is the number a reader would actually count clicking through the deck,
 * which is what a citation needs to mean anything to her. Falls back
 * to numeric-filename order only if `presentation.xml`/its rels are
 * missing or unparseable (a malformed or hand-edited pptx).
 *
 * **Named limitations:** text in tables, SmartArt, and grouped shapes is
 * still inside `<a:t>` runs and so is still captured; speaker notes
 * (`ppt/notesSlides/`) are not, since they're not part of what a slide
 * *shows* — a routing/citation decision, not an oversight. No OCR of
 * embedded images within a slide (out of scope — Slot V's job, C3.3).
 *
 * **A slide's title placeholder becomes its section label** (C3.2, DF-22).
 * `<p:ph type="title"/>` (or `type="ctrTitle"`, the title-slide layout's own
 * variant) is PowerPoint's own placeholder typing — the same kind of
 * author-placed structural signal Word's heading styles are — so every unit
 * from a slide with one carries that text as `provenance.location.section`.
 * A slide with no title placeholder (a divider built entirely from
 * freeform text boxes, say) carries no `section`, which is the honest
 * answer — see `types.ts`'s doc comment on `SourceLocation.section`. This
 * is deliberately per-slide, not a deck-wide outline: unlike a markdown
 * document, a deck has no nesting for `../block/outline.ts`'s tree to walk.
 *
 * **`extractPptxEmbeddedImages` (C3.3; per.md decision 1, `[D-324]`,
 * `ol-egov.141.89.8.20`, discovered from `ol-9cle`) is a separate function,
 * called beside `pptxExtractor.extract`, not merged into it.** A slide's own
 * embedded raster part(s) — its picture(s), not a render of the slide — live
 * in `ppt/media/`, reached via `ppt/slides/_rels/slideN.xml.rels`. See
 * `embedded-image.ts`'s module doc for why this stays a sibling function
 * (the shared `PageExtraction`/`ExtractionResult` types are outside this
 * bead's `owns`) and how a future vision-page caller would consume it.
 *
 * **`pptxFigureCue` (`ol-egov.141.89.8.26`) is the combine-policy trigger,
 * a second sibling function again beside `extractPptxEmbeddedImages`.**
 * `extractPptxEmbeddedImages` reports every raster relationship a slide
 * declares, honestly, whether or not it turns out to matter; this function
 * answers the different, D-324-shaped question `figure-cue.ts` already asks
 * of a PDF page — does this slide's picture content clear the same
 * `FIGURE_CUE_MIN_SHARE` floor — under the **combine** selection policy the
 * orchestrator self-ratified as Class B on this bead (2026-09-27, citing
 * `findings/office-image-selection.md`): a slide qualifies when its
 * *non-recurring* raster images, **summed**, cover at least that share,
 * which can fire even when no single image does — and the images that
 * counted toward the sum are exactly what the eventual caller would send in
 * one combined vision call, per that finding's recommendation. "Non-
 * recurring" mirrors `figure-cue.ts`'s own majority rule
 * (`RUNNING_HEAD_MIN_PAGES`), with identity taken as the resolved media
 * zip-path (`ppt/media/imageN.*`) — the OOXML analogue of a shared PDF
 * `/XObject` — the same identity `findings/office-image-selection.md`'s
 * census script used.
 *
 * **Area share is read straight out of OOXML placement geometry, never
 * decoded pixels** — `<p:pic>`'s own `<a:xfrm><a:ext cx="" cy=""/></a:xfrm>`
 * against the deck's `<p:sldSz cx="" cy=""/>` (`ppt/presentation.xml`), both
 * already in EMU, the exact quantity `figure-cue.ts`'s PDF `areaShare` is
 * for a page. A picture with no resolvable `<a:xfrm>` (inherits a
 * placeholder's size) or a slide with no resolvable `<p:sldSz>` contributes
 * nothing to the sum — never guessed — matching
 * `findings/office-image-selection.md`'s own candidate-set scope note.
 *
 * **Sending is not wired here.** `vision.extract.v2`'s wire request
 * (`olea-service/src/tasks/visionExtract.ts`, outside this bead's `owns`)
 * carries exactly one image per call; turning several qualifying images
 * into that one call (a stitched composite, or a schema change) is left as
 * a follow-up — see `vision-page-runner.ts`'s own module doc.
 */

import { strFromU8, unzipSync } from 'fflate';
import type { EmbeddedRasterImage, PageEmbeddedImages } from './embedded-image.js';
import { readEmbeddedRasterImages } from './embedded-image.js';
import { FIGURE_CUE_MIN_SHARE } from './figure-cue.js';
import { applyFurnitureDetection, RUNNING_HEAD_MIN_PAGES } from './furniture.js';
import { classifyPageText, isReachedButUnreadable } from './plausibility.js';
import { routePage } from './threshold.js';
import type {
  ExtractedUnit,
  ExtractionOutcome,
  ExtractionResult,
  ExtractOptions,
  Extractor,
  ExtractorInput,
  PageExtraction,
  RouteDecision,
} from './types.js';
import { decodeXmlEntities } from './xml-entities.js';

const RELATIONSHIP_RE = /<Relationship\b[^>]*\/>/g;
const ATTR_ID_RE = /\bId="([^"]+)"/;
const ATTR_TARGET_RE = /\bTarget="([^"]+)"/;
const SLD_ID_RE = /<p:sldId\b[^>]*\/>/g;
const ATTR_RID_RE = /r:id="([^"]+)"/;
const SLIDE_FILE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const PARAGRAPH_RE = /<a:p>([\s\S]*?)<\/a:p>/g;
const TEXT_RUN_RE = /<a:t>([\s\S]*?)<\/a:t>/g;
const SHAPE_RE = /<p:sp>([\s\S]*?)<\/p:sp>/g;
const TITLE_PLACEHOLDER_RE = /<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/;
const TX_BODY_RE = /<p:txBody>([\s\S]*?)<\/p:txBody>/;

/** `Target` in a `.rels` file is relative to the folder the `.rels` file itself describes (here, `ppt/`), or occasionally package-root-absolute (a leading `/`). Normalises both to a full zip-entry path. */
function resolveRelsTarget(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `ppt/${target}`;
}

/** True presentation order via `presentation.xml` + its rels. `null` when either part is missing or yields nothing usable — see the module doc's fallback note. */
function resolvePresentationOrder(files: Record<string, Uint8Array>): string[] | null {
  const presBytes = files['ppt/presentation.xml'];
  const relsBytes = files['ppt/_rels/presentation.xml.rels'];
  if (!presBytes || !relsBytes) return null;

  const relsText = strFromU8(relsBytes);
  const relMap = new Map<string, string>();
  let relMatch = RELATIONSHIP_RE.exec(relsText);
  while (relMatch !== null) {
    const tag = relMatch[0];
    const id = ATTR_ID_RE.exec(tag)?.[1];
    const target = ATTR_TARGET_RE.exec(tag)?.[1];
    if (id !== undefined && target !== undefined) relMap.set(id, resolveRelsTarget(target));
    relMatch = RELATIONSHIP_RE.exec(relsText);
  }

  const presText = strFromU8(presBytes);
  const order: string[] = [];
  let sldMatch = SLD_ID_RE.exec(presText);
  while (sldMatch !== null) {
    const rid = ATTR_RID_RE.exec(sldMatch[0])?.[1];
    const target = rid !== undefined ? relMap.get(rid) : undefined;
    if (target !== undefined) order.push(target);
    sldMatch = SLD_ID_RE.exec(presText);
  }
  return order.length > 0 ? order : null;
}

/** Numeric-filename-order fallback (see module doc — not presentation order, only used when the real order can't be resolved). */
function fallbackSlideOrder(files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .filter((key) => SLIDE_FILE_RE.test(key))
    .sort((a, b) => {
      const na = Number(SLIDE_FILE_RE.exec(a)?.[1] ?? 0);
      const nb = Number(SLIDE_FILE_RE.exec(b)?.[1] ?? 0);
      return na - nb;
    });
}

/** Concatenates a slide's visible text, one line per `<a:p>` paragraph. Falls back to a flat scan for `<a:t>` runs if no `<a:p>` boundaries are found (defensive; normal decks always have them). */
function extractSlideText(xml: string): string {
  const paragraphs: string[] = [];
  let paraMatch = PARAGRAPH_RE.exec(xml);
  while (paraMatch !== null) {
    const body = paraMatch[1] ?? '';
    let runText = '';
    let runMatch = TEXT_RUN_RE.exec(body);
    while (runMatch !== null) {
      runText += decodeXmlEntities(runMatch[1] ?? '');
      runMatch = TEXT_RUN_RE.exec(body);
    }
    if (runText.length > 0) paragraphs.push(runText);
    paraMatch = PARAGRAPH_RE.exec(xml);
  }
  if (paragraphs.length === 0) {
    let runMatch = TEXT_RUN_RE.exec(xml);
    while (runMatch !== null) {
      const t = decodeXmlEntities(runMatch[1] ?? '');
      if (t.length > 0) paragraphs.push(t);
      runMatch = TEXT_RUN_RE.exec(xml);
    }
  }
  return paragraphs.join('\n');
}

/**
 * The slide's title-placeholder text, when it has one — see the module doc's
 * "A slide's title placeholder becomes its section label" (C3.2, DF-22).
 * Walks each `<p:sp>` shape looking for a `<p:ph type="title"/>` (or
 * `ctrTitle`) marker; the first one found wins, since a well-formed slide
 * has at most one title placeholder. Reuses `extractSlideText`'s own
 * paragraph/run join on just that shape's `<p:txBody>`, so multi-run and
 * multi-paragraph titles decode exactly the same way slide body text does.
 *
 * **`SHAPE_RE.lastIndex` is reset on every call, not just relied on to reach
 * zero by exhaustion.** This function returns as soon as it finds a title
 * placeholder — deliberately, since a well-formed slide has at most one —
 * which means the loop below does not always run `SHAPE_RE.exec` to `null`
 * the way every other loop in this file does. A global regex's `lastIndex`
 * only self-resets on a failed match, so an early return here would leave it
 * pointing partway into *this* slide's XML, and the very next slide's call
 * would start scanning from that stale offset instead of from the start of
 * its own (unrelated, differently-sized) string.
 */
function extractSlideTitle(xml: string): string | undefined {
  SHAPE_RE.lastIndex = 0;
  let shapeMatch = SHAPE_RE.exec(xml);
  while (shapeMatch !== null) {
    const shapeXml = shapeMatch[1] ?? '';
    if (TITLE_PLACEHOLDER_RE.test(shapeXml)) {
      const txBody = TX_BODY_RE.exec(shapeXml)?.[1];
      const title = txBody !== undefined ? extractSlideText(txBody).trim() : '';
      if (title.length > 0) {
        SHAPE_RE.lastIndex = 0; // don't leave state dangling for the next call
        return title;
      }
    }
    shapeMatch = SHAPE_RE.exec(xml);
  }
  return undefined;
}

/**
 * Classifies a pptx extraction per `ExtractionOutcome` (ol-voen). The zip
 * opened, so `'unreadable'` is already ruled out by the caller; what is left
 * is telling "this presentation has no slides" from "this presentation has
 * slides we could not enumerate", and the presence of `ppt/presentation.xml`
 * is what separates them: a package with a presentation part is claiming to
 * be a deck, so zero slides out of it is a reach failure, not an empty deck.
 */
function pptxOutcome(
  files: Record<string, Uint8Array>,
  pages: readonly PageExtraction[],
): ExtractionOutcome {
  // ol-x1ch: reaching the slides is no longer the whole of the question. See
  // `isReachedButUnreadable`. SCAN-1/ol-738i: nor is decoding fine — see
  // `furniture.ts`. `pages` here has already been through
  // `applyFurnitureDetection`, so this reads `PageExtraction.furniture`
  // rather than recomputing it.
  if (pages.length > 0) {
    if (isReachedButUnreadable(pages)) return 'reached-but-unreadable';
    if (pages.some((page) => page.furniture)) return 'furniture-only';
    return 'extracted';
  }
  return files['ppt/presentation.xml'] ? 'no-pages-found' : 'empty-document';
}

export const pptxExtractor: Extractor = {
  format: 'pptx',

  async extract(input: ExtractorInput, options?: ExtractOptions): Promise<ExtractionResult> {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(input.bytes);
    } catch {
      // Not a valid zip at all — nothing to extract. An empty page list
      // (rather than throwing) lets a batch ingestion job report "this one
      // failed" per-source instead of aborting a whole run, and `outcome:
      // 'unreadable'` is what makes that report legible: the caller can tell
      // it from a presentation that genuinely has no slides.
      return { sourcePath: input.path, format: 'pptx', outcome: 'unreadable', pages: [] };
    }

    const order = resolvePresentationOrder(files) ?? fallbackSlideOrder(files);

    const pages: PageExtraction[] = order.map((key, idx) => {
      const slideBytes = files[key];
      const slideXml = slideBytes ? strFromU8(slideBytes) : '';
      const slideText = slideBytes ? extractSlideText(slideXml) : '';
      const section = slideBytes ? extractSlideTitle(slideXml) : undefined;
      const charCount = slideText.length;
      // A slide with no `<a:t>` runs is `'absent'`, not `'unreadable'`: an
      // image-only slide is ordinary PowerPoint, and calling it a decode
      // failure would red on a large share of real decks. OOXML text nodes
      // need no decoding, so the only failure this format can report is the
      // plausibility one (ol-s3xa), applied here for uniformity.
      const textLayer = classifyPageText(slideText, charCount > 0);
      const route: RouteDecision =
        textLayer === 'unreadable'
          ? 'vision'
          : routePage(charCount, options?.textLayerCharThreshold);
      const page = idx + 1;

      const units: ExtractedUnit[] =
        route === 'text-layer' && slideText.length > 0
          ? [
              {
                text: slideText,
                provenance: {
                  sourcePath: input.path,
                  location: {
                    page,
                    charRange: { start: 0, end: slideText.length },
                    ...(section !== undefined ? { section } : {}),
                  },
                  ...(input.embeddedIn ? { embeddedIn: input.embeddedIn } : {}),
                },
              },
            ]
          : [];

      // `furniture` is decided below, once every slide's text is known — see
      // `pdf.ts`'s equivalent comment.
      return { page, charCount, textLayer, route, units, furniture: false };
    });

    const finalPages = applyFurnitureDetection(pages);

    return {
      sourcePath: input.path,
      format: 'pptx',
      outcome: pptxOutcome(files, finalPages),
      pages: finalPages,
    };
  },
};

/** `ppt/slides/slideN.xml`'s own `.rels` part — `ppt/slides/_rels/slideN.xml.rels`, PowerPoint's fixed convention for a part's relationships. */
function slideRelsPath(slideKey: string): string {
  const slash = slideKey.lastIndexOf('/');
  const dir = slideKey.slice(0, slash);
  const file = slideKey.slice(slash + 1);
  return `${dir}/_rels/${file}.rels`;
}

/**
 * Every slide's embedded raster image(s), in the same presentation order
 * `pptxExtractor.extract` uses — so `page` numbers line up between the two
 * — read from `ppt/media/` via each slide's own `.rels` part. See this
 * module's doc comment and `embedded-image.ts`'s for why this is a sibling
 * function rather than a field on `pptxExtractor.extract`'s return value,
 * and how a future caller would consume it.
 *
 * A slide with no picture relationship, or whose only picture is a vector
 * metafile (EMF/WMF — see `embedded-image.ts`'s `RASTER_EXTENSION_MIME`),
 * gets `images: []`: marked as having no image, never omitted from the
 * result and never faked.
 */
export function extractPptxEmbeddedImages(input: ExtractorInput): PageEmbeddedImages[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.bytes);
  } catch {
    // Not a valid zip at all — mirrors `pptxExtractor.extract`'s own
    // `'unreadable'` case: nothing about this source could be read, so
    // nothing is reported rather than a fabricated page.
    return [];
  }

  const order = resolvePresentationOrder(files) ?? fallbackSlideOrder(files);
  return order.map((key, idx) => {
    const relsBytes = files[slideRelsPath(key)];
    const relsXml = relsBytes ? strFromU8(relsBytes) : undefined;
    const images = readEmbeddedRasterImages(files, relsXml, 'ppt/slides');
    return { page: idx + 1, images };
  });
}

// ---------------------------------------------------------------------------
// `pptxFigureCue` — D-324's combine policy (`ol-egov.141.89.8.26`, Class B,
// self-ratified 2026-09-27, `findings/office-image-selection.md`). See the
// module doc's own section for what this answers and why area share is read
// from placement geometry, not decoded pixels.
// ---------------------------------------------------------------------------

/** Mirrors `embedded-image.ts`'s `RASTER_EXTENSION_MIME` (private there). Duplicated rather than imported: this cue needs each candidate's resolved target path threaded through its own geometry match and through slide-to-slide recurrence, which `readEmbeddedRasterImages`'s return value (bytes + mimeType only) does not carry. Same small, stable OOXML vocabulary, same reasoning `findings/office-image-selection.md`'s census script already gives for its own duplicate of this list. */
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

const PIC_RE = /<p:pic>[\s\S]*?<\/p:pic>/g;
const PIC_EMBED_RE = /r:embed="([^"]+)"/;
const EXT_TAG_RE = /<a:ext\b([^>]*)\/>/;
const ATTR_TYPE_RE = /\bType="([^"]+)"/;
const IMAGE_REL_TYPE_RE = /\/relationships\/image$/;
const ATTR_CX_RE = /\bcx="(\d+)"/;
const ATTR_CY_RE = /\bcy="(\d+)"/;
const SLD_SZ_RE = /<p:sldSz\b([^>]*)\/>/;

/** Resolves a slide's own `.rels` `Target` against `ppt/slides` (the folder the `.rels` file itself describes), walking `../` segments — mirrors `embedded-image.ts`'s own general `resolveRelsTarget(baseDir, target)` (private there): a slide's picture `Target` is typically `../media/imageN.*`, which must climb OUT of `ppt/slides` into `ppt/media`. **Not** this file's own top-level `resolveRelsTarget` (used only for `presentation.xml.rels`, whose targets are `slides/slideN.xml` and never need to climb) — reusing that simpler one here would literally join `ppt/../media/...`, wrong. */
function resolveSlideRelsTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['ppt', 'slides'];
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment.length > 0) parts.push(segment);
  }
  return parts.join('/');
}

/** Every image-type relationship in a slide's own `.rels` XML, `Id` -> resolved zip-entry path (`resolveSlideRelsTarget`, above). Unlike `extractImageRelationshipTargets` (`embedded-image.ts`, private there), this is duplicated for the same "target path must stay visible to the caller" reason `rasterMimeTypeForTarget`'s own doc gives. */
function slideImageRelationshipTargets(relsXml: string): Map<string, string> {
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
      map.set(id, resolveSlideRelsTarget(target));
    }
    match = RELATIONSHIP_RE.exec(relsXml);
  }
  return map;
}

/** The deck's own `<p:sldSz>` area in EMU, or `null` when `ppt/presentation.xml` is missing or the tag does not resolve to two positive numbers — never guessed (mirrors this file's own `resolvePresentationOrder` "`null` when either part is missing or yields nothing usable" posture). */
function pptxSlideAreaEmu(files: Record<string, Uint8Array>): number | null {
  const presBytes = files['ppt/presentation.xml'];
  if (!presBytes) return null;
  const match = SLD_SZ_RE.exec(strFromU8(presBytes));
  if (!match) return null;
  const cx = Number(ATTR_CX_RE.exec(match[0])?.[1]);
  const cy = Number(ATTR_CY_RE.exec(match[0])?.[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return null;
  return cx * cy;
}

/** One `<p:pic>` placement this cue could resolve to a raster image and an area share — `identity` is the resolved media zip-path (this cue's recurrence key), `areaShare` is `null` when the picture's own `<a:xfrm><a:ext>` did not resolve or the slide's own area could not be (never guessed, never zero-filled). */
interface PptxImagePlacement {
  readonly identity: string;
  readonly areaShare: number | null;
  readonly image: EmbeddedRasterImage;
}

/** Every raster `<p:pic>` placement on one slide, in document order — vector-metafile and non-picture relationships are silently excluded (same as `extractPptxEmbeddedImages`), and a target the `.rels` names but the zip does not actually contain is skipped, never thrown. */
function pptxSlideImagePlacements(
  files: Record<string, Uint8Array>,
  slideXml: string,
  relTargets: ReadonlyMap<string, string>,
  slideAreaEmu: number | null,
): PptxImagePlacement[] {
  const placements: PptxImagePlacement[] = [];
  let picMatch = PIC_RE.exec(slideXml);
  while (picMatch !== null) {
    const block = picMatch[0];
    const embedId = PIC_EMBED_RE.exec(block)?.[1];
    const target = embedId !== undefined ? relTargets.get(embedId) : undefined;
    const mimeType = target !== undefined ? rasterMimeTypeForTarget(target) : undefined;
    const bytes = target !== undefined ? files[target] : undefined;
    if (target !== undefined && mimeType !== undefined && bytes !== undefined) {
      const extMatch = EXT_TAG_RE.exec(block);
      let areaShare: number | null = null;
      if (extMatch && slideAreaEmu !== null) {
        const cx = Number(ATTR_CX_RE.exec(extMatch[0])?.[1]);
        const cy = Number(ATTR_CY_RE.exec(extMatch[0])?.[1]);
        if (Number.isFinite(cx) && Number.isFinite(cy)) areaShare = (cx * cy) / slideAreaEmu;
      }
      placements.push({ identity: target, areaShare, image: { bytes, mimeType } });
    }
    picMatch = PIC_RE.exec(slideXml);
  }
  return placements;
}

/** Majority-rule recurrence over the deck's slides, mirroring `figure-cue.ts`'s `findRecurringImages` with identity taken as the resolved media zip-path instead of a PDF object number — see the module doc. Needs at least `RUNNING_HEAD_MIN_PAGES` slides before "more than half" is even a meaningful question, same guard `figure-cue.ts` and `furniture.ts` both apply. */
function findRecurringPptxImages(
  slidePlacements: readonly (readonly PptxImagePlacement[])[],
): ReadonlySet<string> {
  if (slidePlacements.length < RUNNING_HEAD_MIN_PAGES) return new Set();

  const slidesContaining = new Map<string, number>();
  for (const placements of slidePlacements) {
    const onThisSlide = new Set(placements.map((p) => p.identity));
    for (const identity of onThisSlide) {
      slidesContaining.set(identity, (slidesContaining.get(identity) ?? 0) + 1);
    }
  }

  const majority = Math.floor(slidePlacements.length / 2) + 1;
  const recurring = new Set<string>();
  for (const [identity, count] of slidesContaining) {
    if (count >= majority) recurring.add(identity);
  }
  return recurring;
}

/** One slide's D-324 combine-cue result — see the module doc's `pptxFigureCue` section. */
export interface PptxFigureCueSlide {
  readonly page: number;
  /** `true` when this slide's non-recurring candidate images, summed, cover at least `minShare` of the slide's own declared area. */
  readonly qualifies: boolean;
  /** The exact non-recurring, resolvable-area-share images that were summed to reach `qualifies` — empty when `qualifies` is `false`. This is the candidate set a combined vision call would send (sending itself is not wired here — see the module doc). */
  readonly images: readonly EmbeddedRasterImage[];
}

/**
 * D-324's figure cue, combine policy, for a PPTX deck — see the module
 * doc's `pptxFigureCue` section for the ruling this implements
 * (`ol-egov.141.89.8.26`, `findings/office-image-selection.md`) and for why
 * area share is read from placement geometry rather than decoded pixels.
 * `minShare` defaults to the same declared `FIGURE_CUE_MIN_SHARE`
 * `figure-cue.ts` uses for PDF — this is the *same* named constant, not a
 * second one, per the finding's own instruction to cite it rather than
 * re-declare it.
 *
 * Returns `[]` for a buffer that does not unzip at all — mirrors
 * `extractPptxEmbeddedImages`'s own `'unreadable'` handling.
 */
export function pptxFigureCue(
  input: ExtractorInput,
  minShare: number = FIGURE_CUE_MIN_SHARE,
): PptxFigureCueSlide[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input.bytes);
  } catch {
    return [];
  }

  const order = resolvePresentationOrder(files) ?? fallbackSlideOrder(files);
  const slideAreaEmu = pptxSlideAreaEmu(files);

  const perSlide = order.map((key) => {
    const slideBytes = files[key];
    const slideXml = slideBytes ? strFromU8(slideBytes) : '';
    const relsBytes = files[slideRelsPath(key)];
    const relsXml = relsBytes ? strFromU8(relsBytes) : '';
    const relTargets = relsXml ? slideImageRelationshipTargets(relsXml) : new Map<string, string>();
    return pptxSlideImagePlacements(files, slideXml, relTargets, slideAreaEmu);
  });

  const recurring = findRecurringPptxImages(perSlide);

  return perSlide.map((placements, idx) => {
    const candidates = placements.filter(
      (p): p is PptxImagePlacement & { areaShare: number } =>
        p.areaShare !== null && !recurring.has(p.identity),
    );
    const combinedShare = candidates.reduce((sum, c) => sum + c.areaShare, 0);
    const qualifies = combinedShare >= minShare;
    return {
      page: idx + 1,
      qualifies,
      images: qualifies ? candidates.map((c) => c.image) : [],
    };
  });
}
