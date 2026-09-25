/**
 * `createObsidianPageRenderer` — the real `PageRenderPort` adapter over
 * Obsidian's own `loadPdfJs` and a DOM `canvas` (`[D-324]`, resolving
 * `ol-9cle`). `page-render/pdf-page-renderer.ts`'s own module doc left this
 * composition deliberately for "a different bead" — this one
 * (`ol-egov.141.89.8.4`) — so `PdfJsPageRenderer` itself stays fully
 * testable with plain fakes (no `obsidian` import, no DOM) and this file is
 * the one place the two real seams meet.
 *
 * **Deliberately the only file that imports `loadPdfJs` from `obsidian`**
 * for page rendering, matching this package's own established composition-
 * root pattern (`commands/diagnostics-clipboard.ts`, `rank/obsidian-rank
 * -weights-transport.ts`): a thin function wiring a real Obsidian/DOM value
 * into an already-tested, injection-seamed class, with no `describe`/`it`
 * of its own — there is nothing to fake a real `loadPdfJs()`/`canvas`
 * against without reimplementing Obsidian or a browser, and per.md section
 * 8 marks mobile rendering `@manual` for exactly that reason. What IS
 * checked here is structural: `vision-page-runner.ts`'s own tests exercise
 * `PdfJsPageRenderer` (the class this composes) against fakes, and this
 * file's only job is to satisfy its `PdfJsPageRendererDeps` shape with the
 * two real adapters, which the type checker verifies on every build.
 *
 * **No new dependency, no INV-1 exposure.** `loadPdfJs` ships inside
 * Obsidian and reaches this file only because `packages/plugin` (not
 * `packages/core`) is the sanctioned Obsidian importer (INV-1). Nothing
 * here touches `packages/core`.
 *
 * **Composing this into `vision-page-runner.ts`'s `pageRenderer` dependency**
 * is a wiring-root change (`main.ts`/`ingestion/wiring.ts`) outside this
 * bead's `owns` — per.md section 8 lists that composition as "shared,
 * staged by the orchestrator." This file only builds the port; wiring it in
 * is reported as a follow-up (see this bead's report).
 */

import { loadPdfJs } from 'obsidian';
import { PdfJsPageRenderer } from './page-render/pdf-page-renderer.js';
import type {
  CanvasFactory,
  PageRenderPort,
  PdfJsLib,
  RenderTargetCanvas,
} from './page-render/types.js';

/**
 * `document.createElement('canvas')`, cast to the narrow `RenderTargetCanvas`
 * shape `PdfJsPageRenderer` needs — see `page-render/types.ts`'s own doc for
 * why that narrow slice, not the full DOM `HTMLCanvasElement`, is what
 * travels into the port. The cast is safe: every member `RenderTargetCanvas`
 * declares (`width`, `height`, `getContext('2d')`, `toDataURL('image/png')`)
 * is one `HTMLCanvasElement` genuinely has.
 */
const domCanvasFactory: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as RenderTargetCanvas;
};

/**
 * Builds the production `PageRenderPort`: Obsidian's bundled pdf.js,
 * rendered into a real DOM canvas. No new dependency — see the module doc.
 */
export function createObsidianPageRenderer(): PageRenderPort {
  return new PdfJsPageRenderer({
    loadPdfJs: () => loadPdfJs() as Promise<PdfJsLib>,
    createCanvas: domCanvasFactory,
  });
}
