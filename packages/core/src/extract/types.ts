/**
 * The extraction interface (C3, F1.6, P3-T04).
 *
 * `packages/core/src/ingestion/` (P3-T03, just landed) is the queue that
 * decides *when* a submission runs and *whether* to retry it; it never
 * inspects `PersistedJob.payload`, which is deliberately opaque to it (see
 * `ingestion/types.ts`). This module is what eventually produces that
 * payload's content: given a vault source (a PDF, PPTX, DOCX, or image),
 * turn it into extracted text plus a routing decision, per page, for
 * whichever model slot handles it next — Slot G if the text layer is real,
 * Slot V (vision/OCR, W2) if it isn't. Dispatching the actual Slot V call is
 * out of this module's scope: per the task-id catalogue
 * (`packages/contracts/src/tasks.ts`), there is no perception/OCR task id —
 * "W2 is reached through ingestion, not called directly by the client." What
 * this module owes the rest of the pipeline is the routing *decision* and,
 * for pages that stay on the text layer, the extracted text itself.
 *
 * **Provenance is not optional metadata.** F3.10/F3.11 and the exam oracle
 * (F4.2-F4.4) all depend on citing generated material back to where it came
 * from — "say the thing, then say why" only works if every extracted unit
 * can answer "which page, which offset." `Provenance` is therefore a
 * required, non-optional field of `ExtractedUnit`: there is no code path in
 * this package that can construct a unit of extracted text without it,
 * because the field has no `?` and no default. An extractor that "forgot"
 * provenance is a type error, not a runtime surprise discovered downstream
 * when a citation can't be built.
 */

import type { VaultPath } from '../vault/types.js';

/** A half-open character range, `[start, end)`, into whatever text `SourceLocation` says it's relative to. */
export interface CharRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Where inside the source document a unit of text came from.
 *
 * `page` is always present and always 1-based, but what it *means* is
 * format-dependent and each extractor documents its own convention:
 *  - PDF: the real page number from the page tree (`pdf.ts`).
 *  - PPTX: the slide number in presentation order (`pptx.ts`).
 *  - DOCX: always `1` — OOXML paragraphs carry no page number of their own
 *    (Word computes page breaks from fonts, margins and layout at render
 *    time, none of which this extractor has), so rather than guess, the
 *    whole document is treated as one logical page. See `docx.ts`.
 *  - image: always `1` — a single image is a single page by construction.
 *
 * `charRange` is always relative to that page's own extracted text (or, for
 * DOCX where there is only one logical page, the whole document's
 * concatenated paragraph text) — precise enough that a citation can quote
 * the exact span, not just name the source and page.
 */
export interface SourceLocation {
  readonly page: number;
  readonly charRange: CharRange;
}

/**
 * Present on `Provenance` only when the source itself was discovered as a
 * note embed (F1.6, `embeds.ts`) rather than being ingested directly (F3.1,
 * dropped into the vault). Names the note and the exact block within it
 * where the `![[...]]` reference was found, so a citation can point at
 * "this paragraph in the Bedform Stratification note" in addition to "page 4
 * of the embedded deck."
 */
export interface EmbeddedInNote {
  readonly notePath: VaultPath;
  /** `Block.start`/`Block.end` (see `../block/types.js`) of the block containing the `![[...]]` reference. */
  readonly blockStart: number;
  readonly blockEnd: number;
}

/** Where one unit of extracted text came from — see the module doc for why this is required, not optional. */
export interface Provenance {
  readonly sourcePath: VaultPath;
  readonly location: SourceLocation;
  readonly embeddedIn?: EmbeddedInNote;
}

/** One citable unit of extracted text. Never constructed without `provenance` — see the module doc. */
export interface ExtractedUnit {
  readonly text: string;
  readonly provenance: Provenance;
}

/**
 * The text-layer-first routing outcome for one page (cost model §5.1).
 * `'text-layer'` means the page's own extracted text is good enough to feed
 * Slot G directly; `'vision'` means it wasn't, and a later stage owes this
 * page a Slot V (W2) pass instead — this module does not perform that pass.
 */
export type RouteDecision = 'text-layer' | 'vision';

/**
 * What happened to one page's **text layer**, as distinct from how much came
 * out of it (ol-s3xa, ol-x1ch). See `plausibility.ts` for the signals behind
 * each value and why they are measured the way they are.
 *
 * **This field exists because `charCount` was a lie by omission**, in both
 * directions and for two different consumers:
 *
 *  - `charCount: 0` said the same thing about a scanned page, which honestly
 *    has no text, as about a page whose perfectly good text layer this parser
 *    failed to decode. Both routed to vision; only one of them should. The
 *    second is a silent bill, measured on real material and recorded in
 *    `olea-service/findings/H-past-papers-inventory-and-text-layer.md` §5.1
 *    (private).
 *  - A large `charCount` said "usable text layer" for a page made of NULs and
 *    unresolved glyph indices. That page cleared the routing threshold, kept
 *    its units, and became eligible to be **quoted back to the user** — see
 *    `olea-service/findings/G1-concept-review.md` §(b) (private).
 *
 *  - `'readable'` — text came out and it is plausibly text.
 *  - `'absent'` — there was no text layer to read. A scanned or image-only
 *    page. Routing it to vision is the correct answer, not a defect.
 *  - `'unreadable'` — a text layer was **reached** and could not be turned
 *    into text: a content stream that would not decode, text drawn through a
 *    construct this parser does not walk, or characters that are not
 *    characters. Never routed to the text layer, whatever its `charCount`.
 */
export type PageTextLayer = 'readable' | 'absent' | 'unreadable';

/**
 * One page's (or slide's, or — for DOCX — the whole document's) extraction
 * outcome: how many characters its text layer yielded, whether those
 * characters are usable at all, which slot that routes it to, and — only when
 * it stayed on the text layer — the units extracted from it. `units` is an
 * empty array rather than an optional field when `route === 'vision'`: there
 * is genuinely nothing here to hand to Slot G, and an empty array says that
 * directly instead of forcing every caller to null-check an optional.
 */
export interface PageExtraction {
  readonly page: number;
  readonly charCount: number;
  /**
   * Non-optional for the same reason `ExtractionOutcome` is: an optional
   * quality signal defaults to silence, and silence is the defect. See
   * `PageTextLayer`.
   */
  readonly textLayer: PageTextLayer;
  readonly route: RouteDecision;
  readonly units: readonly ExtractedUnit[];
  /**
   * Whether this page's own text — decoded fine, plausibly text,
   * comfortably clearing the routing threshold — is nonetheless *furniture*
   * rather than content: a running head and/or a page-number stamp repeated
   * across the document, and nothing else (SCAN-1, ol-738i; see
   * `furniture.ts`). Non-optional for the same reason `textLayer` is: a
   * signal that defaults to silence is the exact shape of the defect this
   * field exists to close (`olea-service/docs/Olea_ai_workload_and_cost_model.md`
   * §5.1's "quality failure that looks like success" — a scanned page's
   * 30-60 characters of running-head noise clears `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`
   * and would otherwise be handed to Slot G as though it were her content).
   *
   * **Always `false` for `'docx'` and `'image'`** — both formats produce
   * exactly one logical page (see the `page` convention above), and this
   * signal is inherently cross-page: repetition cannot be observed on a
   * single page. It is not that a one-page furniture document is impossible,
   * only that this signal structurally cannot distinguish it from genuine
   * terse content, so it does not try — see `furniture.ts`'s module doc.
   *
   * **When `true`, `route` is always `'vision'` and `units` is always
   * empty**, exactly as for any other page with nothing to offer Slot G
   * (`ExtractionOutcome`'s `'furniture-only'` value is the document-level
   * report of the same fact) — a page that is furniture must not be offered
   * to Slot G or quoted, the same posture ol-s3xa established for unreadable
   * text.
   */
  readonly furniture: boolean;
}

/** The four ingestion source formats C3.1 names. */
export type SourceFormat = 'pdf' | 'pptx' | 'docx' | 'image';

/**
 * Whether an extraction produced anything, and — when it didn't — *why not*
 * (ol-voen / [P3-T04b]).
 *
 * **This field exists because `pages: []` was a lie by omission.** Real
 * lecture PDFs came out of `pdfExtractor` with nothing thrown and an empty
 * page list, which every caller then took for a successful extraction; the
 * run over them truthfully reported no extraction failures while those
 * sources produced nothing at all. This was found by measuring against a real-world vault,
 * and what it found stays private, in
 * `olea-service/findings/E4-corpus-and-zero-yield.md`. An empty page list
 * cannot distinguish "this source genuinely contains no pages" from "this
 * source has pages and the parser could not reach them", and the second is
 * not a failure *or* a success —
 * it is a **silent empty**, which is the worse shape of the two, because the
 * pipeline reports success and produces nothing.
 *
 * `outcome` is therefore **non-optional**, for the same reason `Provenance`
 * is (see the module doc): an optional discriminant defaults to silence, and
 * silence is precisely the bug. A caller that wants to ignore the
 * distinction has to write the code that ignores it.
 *
 *  - `'extracted'` — at least one `PageExtraction` record was produced. Says
 *    nothing about *yield*: a page that routed to vision with zero characters
 *    is still a page record, and that case is already reported honestly by
 *    `PageExtraction.route`.
 *  - `'empty-document'` — the source genuinely contains no pages (a PDF whose
 *    page tree resolves to a `/Count 0` root, a presentation with no slides).
 *    Nothing is wrong; there was nothing there.
 *  - `'no-pages-found'` — the structure parsed, but the parser could not
 *    enumerate pages it has reason to believe exist. **This is the state the
 *    affected files were in, and the one that must never again read as
 *    success.**
 *  - `'unreadable'` — the structural parse failed outright: not a zip, not a
 *    PDF, empty input. No claim is made about what the source contains,
 *    because nothing about it could be read.
 *  - `'reached-but-unreadable'` — page records *were* produced, and not one of
 *    them yielded readable text while at least one had a text layer we reached
 *    and could not read (`PageTextLayer`). **This is ol-voen's shape recurring
 *    one level down**: `pages.length > 0` satisfied the old discriminant, so a
 *    document that decoded to nothing at all reported `'extracted'` and every
 *    page of it was escalated to the vision slot at full price, silently. It
 *    is deliberately *not* the report for a genuine scan, whose pages are
 *    honestly `'absent'` and whose extraction really did succeed. Established
 *    by measuring against real material; the figures stay private, in
 *    `olea-service/findings/H-past-papers-inventory-and-text-layer.md` §5.1.
 *  - `'furniture-only'` — page records *were* produced, every one of them
 *    decoded to plausible, readable characters, and none of it was content:
 *    what came out of every text-layer page is entirely a running head
 *    and/or a page-number stamp repeated across the document (`PageExtraction.furniture`,
 *    `furniture.ts`). **This is ol-voen's shape recurring a second way**:
 *    `charCount` clears `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` (D-022, unchanged
 *    by this signal) on real, decodable characters, so the old discriminant —
 *    and the routing threshold itself — is satisfied honestly and still says
 *    the wrong thing. This is the measured scan failure mode named in
 *    `olea-service/docs/Olea_ai_workload_and_cost_model.md` §5.1: a scanned
 *    page typically yields not zero characters but 30-60 characters of
 *    running-head/page-number noise, which clears the threshold and would be
 *    handed to Slot G as though it were content (SCAN-1, ol-738i). Deliberately
 *    *not* the report for a document that is merely terse — see
 *    `furniture.ts` for why the check requires the repetition itself, not
 *    just a low count, and never re-fits `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`.
 */
export type ExtractionOutcome =
  | 'extracted'
  | 'empty-document'
  | 'no-pages-found'
  | 'unreadable'
  | 'reached-but-unreadable'
  | 'furniture-only';

/**
 * One source's full extraction outcome — every page it contains, each
 * independently routed, plus the `outcome` discriminant that says whether an
 * empty `pages` array means "nothing was there" or "we could not reach it"
 * (see `ExtractionOutcome`).
 */
export interface ExtractionResult {
  readonly sourcePath: VaultPath;
  readonly format: SourceFormat;
  /** Never optional — see `ExtractionOutcome`. `pages.length > 0` iff the outcome is `'extracted'`, `'reached-but-unreadable'` or `'furniture-only'`. */
  readonly outcome: ExtractionOutcome;
  readonly pages: readonly PageExtraction[];
}

/**
 * Configures the one number that decides text-layer-vs-vision routing. See
 * `threshold.ts` for `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD` and why it is
 * provisional. Deliberately the *only* tunable here — an extractor's actual
 * parsing behaviour is not meant to be configurable per call.
 */
export interface ExtractOptions {
  /** Overrides `DEFAULT_TEXT_LAYER_CHAR_THRESHOLD`. Characters-per-page strictly below this route to Slot V. */
  readonly textLayerCharThreshold?: number;
}

/** What an `Extractor` needs to run. `bytes` come from `VaultSource.readBinary` — see `registry.ts` for the usual way to obtain this. */
export interface ExtractorInput {
  readonly path: VaultPath;
  readonly bytes: Uint8Array;
  /** Present only when this source was discovered via a note embed (F1.6); threaded through to every resulting unit's `provenance.embeddedIn`. */
  readonly embeddedIn?: EmbeddedInNote;
}

/**
 * The one interface every format implements (C3.1: "PDF, DOCX, PPTX, and
 * image inputs"). A `JobRunner` (see `../ingestion/types.js`) built on top of
 * this module dispatches on `format` to pick the right `Extractor`, calls
 * `extract`, and turns each `'vision'`-routed page into whatever Slot V
 * submission a later task defines — this interface's job ends at the
 * routing decision.
 */
export interface Extractor {
  readonly format: SourceFormat;
  extract(input: ExtractorInput, options?: ExtractOptions): Promise<ExtractionResult>;
}
