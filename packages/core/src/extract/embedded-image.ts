/**
 * Embedded raster images for page-level vision (C3.3; per.md decision 1,
 * `[D-324]`) — shared by `pptx.ts` and `docx.ts` (`ol-egov.141.89.8.20`,
 * discovered from `ol-9cle`).
 *
 * A PDF page has no image of its own; the plugin's page-render port
 * (`packages/plugin/src/ingestion/page-render/types.ts`) rasterises it with
 * Obsidian's bundled pdf.js. A PPTX slide or a DOCX page region is
 * different: it already carries its own raster part inside the OOXML zip
 * (`ppt/media/imageN.*`, `word/media/imageN.*`), reached the same way
 * `pptx.ts`/`docx.ts` already reach `ppt/slides/slideN.xml` and
 * `word/document.xml` — `fflate`'s `unzipSync` (`../../package.json`,
 * already a dependency; no new one added here). This module only reads
 * bytes already open in memory; there is nothing to render.
 *
 * **Mirrors the page-render port's honesty, not its shape.** `RenderedPage`
 * (`page-render/types.ts`) always has exactly one image, because rendering
 * a PDF page always produces exactly one raster. A slide or a DOCX region
 * can carry zero, one, or several embedded raster parts (a photo collage
 * slide, a diagram plus a logo), so `PageEmbeddedImages.images` is an array,
 * honestly empty rather than a fabricated single image, when a slide paints
 * only vector shapes (DrawingML autoshapes with no picture, or a picture
 * whose only embedded part is a vector metafile — EMF/WMF, see
 * `RASTER_EXTENSION_MIME` below) or has no embedded picture at all. Field
 * naming (`mimeType`) still follows `RenderedPage`'s, so a caller composing
 * the two sources treats them alike.
 *
 * **Why this is not folded into `PageExtraction`/`ExtractionResult`
 * (`types.ts`).** Those types are shared by every format's extractor
 * (`pdf.ts`, `image.ts`, `registry.ts`; none of them are this bead's
 * `owns`), and per.md's completeness record — the actual place a "not read"
 * outcome belongs (section 3; decision 3, `[D-326]`) — is `[ILB-PER-4]`'s
 * unit-manifest module, not yet built. Widening the shared type here would
 * touch files this lane does not own to add a field only two of four
 * formats can ever populate. `extractPptxEmbeddedImages` and
 * `extractDocxEmbeddedImages` (in `pptx.ts`/`docx.ts`) are therefore called
 * *beside* `pptxExtractor.extract`/`docxExtractor.extract`, not merged into
 * their return value — which is also why those two functions' existing
 * output stays byte-identical.
 *
 * **How the vision page runner would consume this** (`packages/plugin/src/ingestion/vision-page-runner.ts`,
 * not this bead's file — `ol-egov.141.89.8.4`/`[ILB-PER-4]` wires it): for a
 * `'vision-page'` job on a `pptx`/`docx` source, call the matching
 * `extract*EmbeddedImages` function once per source revision, index the
 * result by `page` the same way `extraction-runner.ts` already indexes
 * `PageExtraction` by page/slide number, and hand `images[0].bytes` (or, for
 * a slide with several, whichever selection policy `[ILB-PER-4]` decides —
 * not decided here) to `VisionPageExtractPort.extract` as `mimeType` the
 * same way the standalone-image branch already does via `bytesToBase64`. An
 * empty `images` array is the "a slide drawn only in vector shapes" case
 * per.md decision 1 names: the record marks that unit not read, reason
 * `failed` ("no renderer for this content" — per.md section 3), never a
 * silent skip.
 */

/**
 * One embedded raster part's bytes and real media type — never guessed past
 * what the file extension inside the OOXML zip actually declares (see
 * `RASTER_EXTENSION_MIME`).
 */
export interface EmbeddedRasterImage {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/**
 * One slide's (PPTX) or page region's (DOCX — always exactly one, `page: 1`,
 * the same "whole document is one logical page" convention `docx.ts`'s
 * module doc already establishes for text) embedded-image read.
 *
 * `images` is an empty array — never omitted, never faked — when the
 * slide/region has nothing raster to extract: a vector-only slide is marked
 * as having no image, not silently dropped (this bead's acceptance
 * criterion; per.md decision 1).
 */
export interface PageEmbeddedImages {
  readonly page: number;
  readonly images: readonly EmbeddedRasterImage[];
}

/**
 * The raster media types this module recognises among OOXML embedded parts,
 * keyed by the zip-entry's own file extension (lower-cased) — the same
 * "small, well-known vocabulary, read directly" posture `pptx.ts`'s module
 * doc already argues for over a general parser. **Deliberately excludes**
 * `emf`/`wmf`: those are vector metafile formats Office itself sometimes
 * uses for pasted vector art, and a slide whose only embedded picture is one
 * of these has no raster image to extract — the same "vector only, marked
 * as having no image" outcome as a slide with no picture relationship at
 * all.
 */
const RASTER_EXTENSION_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
};

const RELATIONSHIP_RE = /<Relationship\b[^>]*\/>/g;
const ATTR_TYPE_RE = /\bType="([^"]+)"/;
const ATTR_TARGET_RE = /\bTarget="([^"]+)"/;
/** OOXML's own relationship type URI for an image part — the suffix is stable across the schema's `.../officeDocument/2006/relationships/image` and any vendor variant. */
const IMAGE_REL_TYPE_RE = /\/relationships\/image$/;

/**
 * Resolves a `.rels` file's `Target` attribute to a full zip-entry path.
 * `Target` is relative to `baseDir` (the folder the `.rels` file itself
 * describes — see `pptx.ts`'s `resolveRelsTarget`, generalised here to walk
 * arbitrary `../` segments: `word/_rels/document.xml.rels` targets stay
 * inside `word/media/`, but `ppt/slides/_rels/slideN.xml.rels` targets climb
 * out of `ppt/slides/` into `ppt/media/`), or occasionally
 * package-root-absolute (a leading `/`).
 */
function resolveRelsTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir.length > 0 ? baseDir.split('/') : [];
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment.length > 0) parts.push(segment);
  }
  return parts.join('/');
}

/** Every image relationship's zip-entry path (`Type` ending in `.../relationships/image`) found in a `.rels` file's XML, resolved against `baseDir` — see `resolveRelsTarget`. */
function extractImageRelationshipTargets(relsXml: string, baseDir: string): string[] {
  const targets: string[] = [];
  let match = RELATIONSHIP_RE.exec(relsXml);
  while (match !== null) {
    const tag = match[0];
    const type = ATTR_TYPE_RE.exec(tag)?.[1];
    const target = ATTR_TARGET_RE.exec(tag)?.[1];
    if (type !== undefined && target !== undefined && IMAGE_REL_TYPE_RE.test(type)) {
      targets.push(resolveRelsTarget(baseDir, target));
    }
    match = RELATIONSHIP_RE.exec(relsXml);
  }
  return targets;
}

/** The raster media type for a zip-entry path's extension, or `undefined` for a non-raster or unrecognised part (vector metafiles included — see `RASTER_EXTENSION_MIME`). */
function rasterMimeType(zipPath: string): string | undefined {
  const dot = zipPath.lastIndexOf('.');
  if (dot < 0) return undefined;
  return RASTER_EXTENSION_MIME[zipPath.slice(dot + 1).toLowerCase()];
}

/**
 * Reads every raster image relationship's bytes out of the already-unzipped
 * `files`, in relationship order. `relsXml` absent (no `.rels` part at all —
 * a slide/document with no relationships) yields no images, honestly, same
 * as a target the `.rels` file names but the zip does not actually contain
 * (a malformed or hand-edited package): skipped, never thrown.
 */
export function readEmbeddedRasterImages(
  files: Readonly<Record<string, Uint8Array>>,
  relsXml: string | undefined,
  baseDir: string,
): EmbeddedRasterImage[] {
  if (relsXml === undefined) return [];
  const images: EmbeddedRasterImage[] = [];
  for (const target of extractImageRelationshipTargets(relsXml, baseDir)) {
    const mimeType = rasterMimeType(target);
    if (mimeType === undefined) continue;
    const bytes = files[target];
    if (bytes === undefined) continue;
    images.push({ bytes, mimeType });
  }
  return images;
}
