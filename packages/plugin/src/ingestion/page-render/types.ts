/**
 * The page-render port (`ol-9cle`, C3.3, per.md section 7 decision 1
 * `[D-324]`) — turns one page of a PDF document into a PNG image, so a
 * `'vision-page'` job for `format: 'pdf'` (`extraction-runner.ts`'s
 * `runVisionPageJob`) has bytes to hand `vision.extract.v2`
 * (`vision-page-runner.ts`'s `VisionPageExtractPort`) the same way a
 * standalone image source already does. Today only PDF is built here; PPTX
 * and DOCX are a different shape (their pages already carry embedded raster
 * parts — see this directory's report in the `ol-9cle` lane record, not a
 * file, since no code was owed for that half).
 *
 * **Why this is a port, not a direct `loadPdfJs` call.** Two seams are
 * injected rather than reached for directly: the pdf.js loader
 * (`PdfJsLoader`) and the render target (`CanvasFactory`). Neither this file
 * nor `pdf-page-renderer.ts` imports `obsidian` or touches `document` —
 * `relation-composition-root.spec.ts`'s own comment (this repo,
 * `packages/plugin/test/explain-back/`) records why this repo's established
 * pattern avoids `vi.mock('obsidian', ...)` (an ever-growing hand-maintained
 * fake); keeping the seam injected instead means `PdfJsPageRenderer` is
 * fully testable with plain fakes, and the two real adapters — `import {
 * loadPdfJs } from 'obsidian'` and `document.createElement('canvas')` —
 * are left for the composition root that wires this port into
 * `vision-page-runner.ts` (a different bead; see the `ol-9cle` report).
 *
 * **Scale is declared, not defaulted here.** Per
 * `docs/design/component-baseline.md`'s declared-vs-derived line, "how many
 * pixels per PDF point" is a plain-English legibility choice for whoever
 * wires this port against a real vision model's input limits — not a number
 * this renderer should invent silently. Every caller of `renderPage` must
 * pass one.
 */

/** One page of a PDF document, rendered to a raster image. `width`/`height` are the rendered pixel dimensions (the declared `scale` already applied), useful to a caller sizing the image against a model's input limits without re-deriving them from the PDF's own point size. */
export interface RenderedPage {
  readonly dataUrl: string;
  readonly mimeType: 'image/png';
  readonly width: number;
  readonly height: number;
}

/** `pageNumber` is 1-based, matching pdf.js's own `getPage` convention (page 1 is the first page) — never 0-based, never the page's index in some other document's numbering. */
export interface PdfPageRenderRequest {
  readonly pdfBytes: Uint8Array;
  readonly pageNumber: number;
  readonly scale: number;
}

/** The port a `'vision-page'` job for `format: 'pdf'` renders through. One method, same one-method-port idiom `VisionPageExtractPort` (`vision-page-runner.ts`) and `GroundingJudgePort`/`ConceptReaderPort` already use in this repo. */
export interface PageRenderPort {
  renderPage(request: PdfPageRenderRequest): Promise<RenderedPage>;
}

/**
 * The minimal slice of pdf.js's own public API this port needs —
 * `getDocument(...).promise`, `getPage(n)`, `page.getViewport({ scale
 * })`, `page.render({ canvasContext, viewport }).promise` — mirroring the
 * real shape (`pdfjs-dist`'s `PDFDocumentLoadingTask`/`PDFPageProxy`) so a
 * real `loadPdfJs()` result can be handed to `PdfJsPageRenderer` without an
 * adapter layer in between, once a caller supplies one. `canvasContext` is
 * typed `unknown` here on purpose: this module never calls a method on it
 * itself, only passes through whatever `CanvasFactory.createCanvas` handed
 * back, so it never needs `CanvasRenderingContext2D`'s own (large,
 * DOM-lib-only) type.
 */
export interface PdfJsPageViewport {
  readonly width: number;
  readonly height: number;
}

export interface PdfJsPageProxy {
  getViewport(params: { scale: number }): PdfJsPageViewport;
  render(params: { canvasContext: unknown; viewport: PdfJsPageViewport }): {
    promise: Promise<void>;
  };
}

export interface PdfJsDocumentProxy {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPageProxy>;
}

export interface PdfJsLib {
  getDocument(params: { data: Uint8Array }): { promise: Promise<PdfJsDocumentProxy> };
}

/** Mirrors Obsidian's own `loadPdfJs(): Promise<any>` (`obsidian.d.ts:3870`, obsidian 1.13.1, confirmed a public API — no new dependency: pdf.js ships inside Obsidian itself). Typed here as returning `PdfJsLib` rather than `any` so `PdfJsPageRenderer` gets real type-checking against the slice it uses; the real adapter casts Obsidian's own `any` to this shape at the composition root. */
export type PdfJsLoader = () => Promise<PdfJsLib>;

/**
 * The render target `page.render` draws into. Deliberately narrow —
 * `width`/`height` (settable, so the renderer can size it to the viewport),
 * `getContext('2d')` (opaque return: pdf.js's `render` call is handed it
 * directly and this module never inspects it), and `toDataURL` (how the
 * finished raster leaves the canvas). A real adapter is
 * `document.createElement('canvas')`; nothing here requires it — any object
 * shaped like this satisfies the port, which is what makes it fake-able
 * without a DOM.
 */
export interface RenderTargetCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
  toDataURL(mimeType: 'image/png'): string;
}

export type CanvasFactory = (width: number, height: number) => RenderTargetCanvas;

/** Closed set of ways `PdfJsPageRenderer.renderPage` can fail — see `errors.ts`'s `PageRenderError` for what each means and how a caller should map it against per.md section 3's `not-read` reasons. Retry policy is deliberately NOT decided here (same split `vision-page-runner.ts`'s `isUnavailableVisionFailure` draws for its own port): this module only names what went wrong. */
export const PAGE_RENDER_ERROR_CODES = [
  'renderer-unavailable',
  'render-failed',
  'page-not-found',
] as const;
export type PageRenderErrorCode = (typeof PAGE_RENDER_ERROR_CODES)[number];
