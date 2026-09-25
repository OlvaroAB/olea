import type { PageRenderErrorCode } from './types';

/**
 * Everything `PdfJsPageRenderer.renderPage` can throw — one class, a closed
 * `code`, same idiom `WorkerVisionPageExtractorError`
 * (`vision-page-runner.ts`) uses for its own port. A caller maps `code`
 * against per.md section 3's `not-read` reasons rather than this module
 * inventing that mapping itself, since the mapping is a job-runner-level
 * policy call (retryable or not), not a renderer-level fact.
 *
 * D-005: `message` never carries page bytes, a vault path or any content —
 * only the structural fact named by `code`, matching `WorkerVisionPage
 * ExtractorError`'s own posture.
 *
 * - `renderer-unavailable`: `loadPdfJs()` itself could not be reached
 *   (platform/host problem, not this page's fault) — closest to per.md's
 *   "no renderer for this content" `not-read` reason, though at the
 *   platform level rather than the content-type level that phrase names.
 * - `render-failed`: pdf.js loaded, but opening the bytes, reading the
 *   page, or rendering it failed (corrupt/unsupported PDF, a pdf.js
 *   internal error) — per.md's "render failed" `not-read` reason.
 * - `page-not-found`: `pageNumber` is less than 1 or greater than the
 *   document's `numPages` — a caller bug (wrong page requested), never a
 *   pdf.js failure.
 */
export class PageRenderError extends Error {
  readonly code: PageRenderErrorCode;

  constructor(message: string, code: PageRenderErrorCode) {
    super(message);
    this.name = 'PageRenderError';
    this.code = code;
  }
}
