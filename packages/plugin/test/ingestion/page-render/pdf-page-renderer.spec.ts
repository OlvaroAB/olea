/**
 * `PdfJsPageRenderer` — proves the orchestration in `pdf-page-renderer.ts`:
 * bytes and scale reach pdf.js unchanged, the viewport it reports sizes the
 * canvas, the rendered result comes back as a PNG data URL, and every
 * failure seam (no renderer, bad bytes, bad page, a render failure) becomes
 * the right `PageRenderError` code — never a raw thrown value, never a
 * silent wrong answer.
 *
 * No `obsidian` import here (INV-1; same reasoning
 * `relation-composition-root.spec.ts`'s own comment gives for avoiding
 * `vi.mock('obsidian', ...)`): `loadPdfJs` and the canvas are both fakes
 * built below, matching the injected-port shape `types.ts` declares. What
 * this file does NOT prove: that the real `import { loadPdfJs } from
 * 'obsidian'` adapter and a real `document.createElement('canvas')` satisfy
 * these same interfaces at runtime — that is the composition root's job
 * (see the `ol-9cle` lane report for what's left undone).
 */

import { describe, expect, it, vi } from 'vitest';
import { PageRenderError } from '../../../src/ingestion/page-render/errors';
import { PdfJsPageRenderer } from '../../../src/ingestion/page-render/pdf-page-renderer';
import type {
  CanvasFactory,
  PdfJsDocumentProxy,
  PdfJsLib,
  PdfJsPageProxy,
  PdfJsPageViewport,
  RenderTargetCanvas,
} from '../../../src/ingestion/page-render/types';

/**
 * A tiny synthetic PDF fixture, built here rather than reused from anywhere
 * — mirrors `packages/core/src/extract/pdf.spec.ts`'s own hand-built-PDF
 * style (a literal `%PDF-1.4` byte stream) closely enough to document
 * intent, but is never actually parsed in this file: `renderPage` hands
 * whatever bytes it is given straight to the injected fake pdf.js loader,
 * so these bytes only need to be a real `Uint8Array`, not a structurally
 * valid PDF. The one-page/two-page fakes below stand in for what a real
 * pdf.js would report after actually parsing bytes like these.
 */
function tinySyntheticPdfBytes(): Uint8Array {
  const text =
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n' +
    'trailer<</Root 1 0 R>>';
  return new TextEncoder().encode(text);
}

interface FakeCanvas extends RenderTargetCanvas {
  toDataURLCalls: Array<'image/png'>;
  contextRequested: boolean;
}

function makeFakeCanvasFactory(): { createCanvas: CanvasFactory; canvases: FakeCanvas[] } {
  const canvases: FakeCanvas[] = [];
  const createCanvas: CanvasFactory = (width, height) => {
    const canvas: FakeCanvas = {
      width,
      height,
      toDataURLCalls: [],
      contextRequested: false,
      getContext(kind) {
        expect(kind).toBe('2d');
        canvas.contextRequested = true;
        return { fakeContext: true };
      },
      toDataURL(mimeType) {
        canvas.toDataURLCalls.push(mimeType);
        return `data:image/png;base64,FAKE-${canvas.width}x${canvas.height}`;
      },
    };
    canvases.push(canvas);
    return canvas;
  };
  return { createCanvas, canvases };
}

function makeFakePage(
  viewport: PdfJsPageViewport,
  renderImpl?: () => Promise<void>,
): PdfJsPageProxy & {
  renderCalls: Array<{ canvasContext: unknown; viewport: PdfJsPageViewport }>;
} {
  const renderCalls: Array<{ canvasContext: unknown; viewport: PdfJsPageViewport }> = [];
  return {
    renderCalls,
    getViewport: () => viewport,
    render(params) {
      renderCalls.push(params);
      const impl = renderImpl ?? (() => Promise.resolve());
      return { promise: impl() };
    },
  };
}

function makeFakePdfJs(
  doc: PdfJsDocumentProxy,
): PdfJsLib & { getDocumentCalls: Array<{ data: Uint8Array }> } {
  const getDocumentCalls: Array<{ data: Uint8Array }> = [];
  return {
    getDocumentCalls,
    getDocument(params) {
      getDocumentCalls.push(params);
      return { promise: Promise.resolve(doc) };
    },
  };
}

describe('PdfJsPageRenderer.renderPage', () => {
  it('renders the requested page: bytes and scale reach pdf.js unchanged, the canvas is sized to the reported viewport, and the result is a PNG data URL', async () => {
    const pdfBytes = tinySyntheticPdfBytes();
    const viewport: PdfJsPageViewport = { width: 300.4, height: 150.1 };
    const page = makeFakePage(viewport);
    const getPageCalls: number[] = [];
    const doc: PdfJsDocumentProxy = {
      numPages: 3,
      getPage: async (pageNumber) => {
        getPageCalls.push(pageNumber);
        return page;
      },
    };
    const pdfjs = makeFakePdfJs(doc);
    const { createCanvas, canvases } = makeFakeCanvasFactory();
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => pdfjs,
      createCanvas,
    });

    const result = await renderer.renderPage({ pdfBytes, pageNumber: 2, scale: 1.5 });

    // Bytes reached pdf.js unchanged — same reference, not a copy or a mutation.
    expect(pdfjs.getDocumentCalls).toHaveLength(1);
    expect(pdfjs.getDocumentCalls[0]?.data).toBe(pdfBytes);

    expect(getPageCalls).toEqual([2]);
    expect(page.renderCalls).toHaveLength(1);
    expect(page.renderCalls[0]?.viewport).toBe(viewport);

    // Viewport dimensions are ceiled to whole pixels for the canvas.
    expect(canvases).toHaveLength(1);
    expect(canvases[0]?.width).toBe(301);
    expect(canvases[0]?.height).toBe(151);
    expect(canvases[0]?.contextRequested).toBe(true);
    expect(canvases[0]?.toDataURLCalls).toEqual(['image/png']);

    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,FAKE-301x151',
      mimeType: 'image/png',
      width: 301,
      height: 151,
    });
  });

  it('passes the canvas context straight through to page.render without inspecting it', async () => {
    const marker = { fakeContext: 'marker' };
    const page = makeFakePage({ width: 10, height: 10 });
    const doc: PdfJsDocumentProxy = { numPages: 1, getPage: async () => page };
    const createCanvas: CanvasFactory = (width, height) => ({
      width,
      height,
      getContext: () => marker,
      toDataURL: () => 'data:image/png;base64,X',
    });
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => makeFakePdfJs(doc),
      createCanvas,
    });

    await renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 });

    expect(page.renderCalls[0]?.canvasContext).toBe(marker);
  });

  it('rejects a non-positive page number without ever loading pdf.js', async () => {
    const loadPdfJs = vi.fn();
    const renderer = new PdfJsPageRenderer({
      loadPdfJs,
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 0, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'page-not-found' });
    expect(loadPdfJs).not.toHaveBeenCalled();
  });

  it('rejects a page number beyond the document, after loadPdfJs and getDocument but before getPage', async () => {
    const getPage = vi.fn();
    const doc: PdfJsDocumentProxy = { numPages: 2, getPage };
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => makeFakePdfJs(doc),
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 5, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'page-not-found' });
    expect(getPage).not.toHaveBeenCalled();
  });

  it('rejects a non-positive scale without ever loading pdf.js', async () => {
    const loadPdfJs = vi.fn();
    const renderer = new PdfJsPageRenderer({
      loadPdfJs,
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 0 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'render-failed' });
    expect(loadPdfJs).not.toHaveBeenCalled();
  });

  it('turns a loadPdfJs() failure into renderer-unavailable', async () => {
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => {
        throw new Error('pdf.js could not be loaded on this host');
      },
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'renderer-unavailable' });
  });

  it('turns a getDocument() failure into render-failed', async () => {
    const pdfjs: PdfJsLib = {
      getDocument: () => ({ promise: Promise.reject(new Error('not a PDF')) }),
    };
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => pdfjs,
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'render-failed' });
  });

  it('turns a getPage() failure into render-failed', async () => {
    const doc: PdfJsDocumentProxy = {
      numPages: 1,
      getPage: async () => {
        throw new Error('page tree broken');
      },
    };
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => makeFakePdfJs(doc),
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'render-failed' });
  });

  it('turns a page.render() failure into render-failed', async () => {
    const page = makeFakePage({ width: 10, height: 10 }, () =>
      Promise.reject(new Error('rasteriser choked')),
    );
    const doc: PdfJsDocumentProxy = { numPages: 1, getPage: async () => page };
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => makeFakePdfJs(doc),
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'render-failed' });
  });

  it('turns a non-positive reported viewport into render-failed', async () => {
    const page = makeFakePage({ width: 0, height: 0 });
    const doc: PdfJsDocumentProxy = { numPages: 1, getPage: async () => page };
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => makeFakePdfJs(doc),
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    await expect(
      renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 }),
    ).rejects.toMatchObject({ name: 'PageRenderError', code: 'render-failed' });
  });

  it('PageRenderError carries only a structural code and message, never page bytes or content (D-005)', async () => {
    const renderer = new PdfJsPageRenderer({
      loadPdfJs: async () => {
        throw new Error('boom');
      },
      createCanvas: makeFakeCanvasFactory().createCanvas,
    });

    try {
      await renderer.renderPage({ pdfBytes: tinySyntheticPdfBytes(), pageNumber: 1, scale: 1 });
      expect.unreachable('renderPage should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PageRenderError);
      const renderError = error as PageRenderError;
      expect(renderError.code).toBe('renderer-unavailable');
      expect(renderError.message).not.toContain('%PDF');
    }
  });
});
