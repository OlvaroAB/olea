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
 */

import { strFromU8, unzipSync } from 'fflate';
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
  // `isReachedButUnreadable`.
  if (pages.length > 0) {
    return isReachedButUnreadable(pages) ? 'reached-but-unreadable' : 'extracted';
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
      const slideText = slideBytes ? extractSlideText(strFromU8(slideBytes)) : '';
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
                  location: { page, charRange: { start: 0, end: slideText.length } },
                  ...(input.embeddedIn ? { embeddedIn: input.embeddedIn } : {}),
                },
              },
            ]
          : [];

      return { page, charCount, textLayer, route, units };
    });

    return {
      sourcePath: input.path,
      format: 'pptx',
      outcome: pptxOutcome(files, pages),
      pages,
    };
  },
};
