/**
 * The format registry and dispatcher (C3.1, P3-T04) — the one place that
 * knows all four `Extractor` implementations exist and picks between them.
 * Everything upstream (a future `JobRunner`, `embeds.ts`) should go through
 * `formatFromExtension` and `extractFromVault` rather than importing
 * `pdf.ts`/`pptx.ts`/`docx.ts`/`image.ts` directly — that keeps "which
 * extractor handles which format" a single decision made here, not
 * something every call site re-derives.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { docxExtractor } from './docx.js';
import { guardExtractor } from './guard.js';
import { imageExtractor } from './image.js';
import { pdfExtractor } from './pdf.js';
import { pptxExtractor } from './pptx.js';
import type {
  EmbeddedInNote,
  ExtractionResult,
  ExtractOptions,
  Extractor,
  SourceFormat,
} from './types.js';

/**
 * Every registered format, keyed by `SourceFormat` — see each module's own
 * doc comment for what "real" means for that format.
 *
 * **Every entry is wrapped in `guardExtractor`** (`guard.ts`), so no result
 * reaching a production caller through this registry can report success with
 * zero yield. That is a standing check on the interface, not a per-extractor
 * courtesy: a fifth format added here inherits it without anyone remembering
 * to wire it, which is the only version of this rule that survives the next
 * three defects wearing the same shape (N-013).
 */
export const EXTRACTORS: Readonly<Record<SourceFormat, Extractor>> = {
  pdf: guardExtractor(pdfExtractor),
  pptx: guardExtractor(pptxExtractor),
  docx: guardExtractor(docxExtractor),
  image: guardExtractor(imageExtractor),
};

/**
 * Extensions this module treats as `'image'`. Deliberately excludes `svg`:
 * an SVG is XML markup, not a raster photo/scan, and "does this page have a
 * text layer" doesn't apply to it the way it does to a JPEG of a
 * handwritten page — an SVG belongs to a different ingestion path if she
 * ever embeds one, not this bead's C3.3 vision routing.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
]);

/** Maps a file's extension to the `SourceFormat` this module extracts, or `null` for anything C3.1 doesn't name (e.g. `.md`, `.mp3`, `.canvas` — not this bead's concern). */
export function formatFromExtension(path: string): SourceFormat | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'docx') return 'docx';
  return IMAGE_EXTENSIONS.has(ext) ? 'image' : null;
}

/**
 * Reads `path` from `vault` and runs it through the registered extractor
 * for `format`. This is the usual entry point — it owns the
 * `VaultSource.readBinary` call (A2.1/A2.2: core reads through the vault
 * boundary, never assumes a filesystem) so callers never have to remember
 * the read-then-dispatch order themselves.
 */
export async function extractFromVault(
  vault: VaultSource,
  path: VaultPath,
  format: SourceFormat,
  options?: ExtractOptions,
  embeddedIn?: EmbeddedInNote,
): Promise<ExtractionResult> {
  const bytes = await vault.readBinary(path);
  return EXTRACTORS[format].extract(
    { path, bytes, ...(embeddedIn ? { embeddedIn } : {}) },
    options,
  );
}
