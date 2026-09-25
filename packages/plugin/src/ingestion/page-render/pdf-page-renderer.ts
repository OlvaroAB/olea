/**
 * `PdfJsPageRenderer` — the one built implementation of `PageRenderPort`
 * (`ol-9cle`; see `types.ts`'s module doc for the port's shape and why it is
 * injected rather than reaching for `obsidian`/`document` directly).
 *
 * Orchestration only: load pdf.js, open the bytes, fetch the requested
 * page, compute its viewport at the caller's declared `scale`, size the
 * injected canvas to that viewport, render into it, and read back a PNG
 * data URL. Every step's failure becomes a typed `PageRenderError` (see
 * `errors.ts`) — this class never throws a raw pdf.js/host error, and never
 * logs page bytes or any derived content (D-005).
 *
 * **No new dependency.** `loadPdfJs` is Obsidian's own public API
 * (`obsidian.d.ts:3870`, confirmed at obsidian 1.13.1) — pdf.js ships
 * inside Obsidian and is loaded lazily through it, exactly the same
 * mobile-safe path the plugin already depends on for everything else it
 * gets from the `obsidian` package. Nothing here adds `pdfjs-dist` or any
 * other package.
 */

import { PageRenderError } from './errors';
import type {
  CanvasFactory,
  PageRenderPort,
  PdfJsDocumentProxy,
  PdfJsLib,
  PdfJsLoader,
  PdfJsPageProxy,
  PdfPageRenderRequest,
  RenderedPage,
} from './types';

export interface PdfJsPageRendererDeps {
  readonly loadPdfJs: PdfJsLoader;
  readonly createCanvas: CanvasFactory;
}

export class PdfJsPageRenderer implements PageRenderPort {
  private readonly loadPdfJs: PdfJsLoader;
  private readonly createCanvas: CanvasFactory;

  constructor(deps: PdfJsPageRendererDeps) {
    this.loadPdfJs = deps.loadPdfJs;
    this.createCanvas = deps.createCanvas;
  }

  async renderPage(request: PdfPageRenderRequest): Promise<RenderedPage> {
    const { pdfBytes, pageNumber, scale } = request;

    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new PageRenderError(
        `PdfJsPageRenderer: pageNumber must be a positive integer, got ${pageNumber}.`,
        'page-not-found',
      );
    }
    if (!(scale > 0)) {
      throw new PageRenderError(
        `PdfJsPageRenderer: scale must be a positive number, got ${scale}.`,
        'render-failed',
      );
    }

    let pdfjs: PdfJsLib;
    try {
      pdfjs = await this.loadPdfJs();
    } catch {
      throw new PageRenderError(
        'PdfJsPageRenderer: loadPdfJs() could not be reached — no renderer available on this host.',
        'renderer-unavailable',
      );
    }

    let doc: PdfJsDocumentProxy;
    try {
      doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
    } catch {
      throw new PageRenderError(
        'PdfJsPageRenderer: pdf.js could not open the document bytes.',
        'render-failed',
      );
    }

    if (pageNumber > doc.numPages) {
      throw new PageRenderError(
        `PdfJsPageRenderer: page ${pageNumber} requested, document has ${doc.numPages}.`,
        'page-not-found',
      );
    }

    let page: PdfJsPageProxy;
    try {
      page = await doc.getPage(pageNumber);
    } catch {
      throw new PageRenderError(
        `PdfJsPageRenderer: pdf.js could not open page ${pageNumber}.`,
        'render-failed',
      );
    }

    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    if (!(width > 0) || !(height > 0)) {
      throw new PageRenderError(
        `PdfJsPageRenderer: page ${pageNumber} rendered a non-positive viewport (${width}x${height}).`,
        'render-failed',
      );
    }

    const canvas = this.createCanvas(width, height);
    canvas.width = width;
    canvas.height = height;
    const canvasContext = canvas.getContext('2d');

    try {
      await page.render({ canvasContext, viewport }).promise;
    } catch {
      throw new PageRenderError(
        `PdfJsPageRenderer: pdf.js could not render page ${pageNumber}.`,
        'render-failed',
      );
    }

    return {
      dataUrl: canvas.toDataURL('image/png'),
      mimeType: 'image/png',
      width,
      height,
    };
  }
}
