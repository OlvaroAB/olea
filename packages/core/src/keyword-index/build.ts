/**
 * Full index rebuild (C2.4's "full reindex on demand"), chunked and
 * cancellable (C2.6, Q6.2). See `scheduling.ts` for the injected `YieldScheduler`/
 * `CancellationSignal` this is built on, and `rebuild-equivalence.spec.ts`
 * for the C2.4 acceptance test this function is one half of.
 *
 * **Chunking.** Documents are processed `chunkSize` at a time; after each
 * chunk, progress is reported and — if more remain — control is handed back
 * to the host via `scheduler.yield()` before the next chunk starts. This is
 * deliberately document-granular, not block-granular: a document's own parse
 * is fast (P1-T01's single left-to-right scan), and at the vault size D-003
 * sizes this for, a document count times a small chunk size still yields
 * often enough to keep Obsidian's renderer responsive.
 *
 * **Cancellation.** `signal.cancelled` is polled once at the top of every
 * chunk iteration — before any document in that chunk is read — so a
 * cancellation observed during the previous chunk's `yield()` stops the next
 * chunk from starting at all, rather than merely being noted and honoured
 * later. A cancelled build returns `{ status: 'cancelled' }` with no index:
 * the caller (`KeywordIndexEngine.rebuild`) keeps whatever it already had,
 * so a cancelled rebuild is a true no-op on persisted state, never a partial
 * replacement.
 *
 * **Every PDF, deck and document in the vault — `options.binarySources` (`ol-egov.141.89.1.95`,
 * David's ruling 2026-10-06, option a).** The markdown scan above is what a note gets; given
 * `binarySources`, the build also carries every PDF, slide deck and Word document the vault lists,
 * the way every note is carried, whether or not she registered it. The set is decided in one place,
 * `indexedBinaryFormatOf`: the format `../extract/registry.js#formatFromExtension` maps the path to
 * (no second extension list here), restricted to the three formats with a text layer, under the
 * same folder rule her notes get. That folder rule is the host's own: `VaultSource.list` never
 * returns a dot-prefixed path (`.obsidian/`, `.trash/`, Olea's `.olea/`), and
 * `indexedBinaryFormatOf` states the same rule for a single path so a vault event cannot index a
 * binary the scan would never list. **Text layer only:** each binary goes through the same
 * extraction the citation pipeline runs (`indexBinaryBytes`), whose vision-routed pages carry no
 * units, so a scanned page and an image never enter the index and nothing here calls a vision
 * model. Registration decides nothing about inclusion any more; it supplies the course (see
 * `binaryCourses` for the precedence). This supersedes `ol-n06g`'s registered-only fold.
 *
 * Each extracted block keeps its unit's `Provenance.location` (`IndexedBlock.location`), and
 * `KeywordIndexEngine` builds a binary's document on a change event through the same
 * `indexBinaryBytes`, so the rebuilt and the incrementally maintained index agree by construction
 * (C2.4) for binaries as for notes.
 */

import { EXTRACTORS, formatFromExtension } from '../extract/registry.js';
import type { SourceFormat } from '../extract/types.js';
import { hashContent } from '../ingestion/hash.js';
import type { RegisteredFileSpec } from '../source/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { indexDocument } from './document.js';
import { type CancellationSignal, macrotaskScheduler, type YieldScheduler } from './scheduling.js';
import type { IndexedBlock, IndexedDocument, PersistedKeywordIndex } from './types.js';

/** Documents indexed per chunk before yielding. Small enough that a slow device still stays responsive between yields. */
export const DEFAULT_INDEX_CHUNK_SIZE = 25;

/**
 * The extensions this index scans: markdown, plus `txt` (D-465: a plain-text file is a lecture
 * transcript, read into parts by `document.ts`); C3's binary formats are a separate pipeline. Exported so `KeywordIndexEngine.applyEvent` applies the IDENTICAL
 * filter to an incremental event that `buildFullIndex` applies to a full scan
 * (`ol-3ux7.64.18` found the two disagreeing: a `.olea/reviews/*.jsonl` append
 * surfaced as a `modify` event was indexed as a document, then embedded).
 */
export const DEFAULT_INDEX_EXTENSIONS: readonly string[] = ['md', 'txt'];

/**
 * The binary formats this index carries (`ol-egov.141.89.1.95`, David's ruling 2026-10-06): a PDF,
 * a slide deck, a Word document. Formats, not extensions: which extension is which format is
 * `formatFromExtension`'s alone. `'image'` is deliberately absent: an image has no text layer, and
 * reading one is vision work the ruling keeps out of this index.
 */
export type IndexedBinaryFormat = 'pdf' | 'pptx' | 'docx';

const INDEXED_BINARY_FORMATS: ReadonlySet<SourceFormat> = new Set<IndexedBinaryFormat>([
  'pdf',
  'pptx',
  'docx',
]);

/**
 * The one test of whether `path` is a binary this index carries, and as which format: `null` for
 * a note, a transcript, an image, any format no extractor reads, and any path with a dot-prefixed
 * segment. The last is the folder rule her notes already get from the host (`VaultSource.list`
 * never lists `.obsidian/`, `.trash/` or Olea's `.olea/`), stated here so a vault event for such a
 * path is refused exactly as the scan would never list it. `buildFullIndex` and
 * `KeywordIndexEngine` both decide through this, never through a list of their own.
 */
export function indexedBinaryFormatOf(path: VaultPath): IndexedBinaryFormat | null {
  if (path.split('/').some((segment) => segment.startsWith('.'))) return null;
  const format = formatFromExtension(path);
  return format !== null && INDEXED_BINARY_FORMATS.has(format)
    ? (format as IndexedBinaryFormat)
    : null;
}

/**
 * `ol-egov.141.89.1.97`: the version of what a binary's extracted blocks depend on: the extractors
 * (`../extract/`) and how `indexBinaryBytes` turns their pages into blocks. **Raise it whenever a
 * change there would alter what an unchanged file yields**; every binary document held under a
 * lower version is then extracted again at the next sync or event, where before it was read again
 * only when its bytes changed or the cache was cleared. A change that cannot alter any file's
 * blocks leaves it alone. `1` is the extractor as it stood when binaries entered the index, and is
 * what a document persisted without a version is taken to carry (`isCurrentBinaryDocument`).
 */
export const BINARY_EXTRACTOR_VERSION = 1;

/** Whether a document's extracted blocks came from the current extractor (`BINARY_EXTRACTOR_VERSION`). */
export function isCurrentBinaryDocument(doc: IndexedDocument): boolean {
  return (doc.extractorVersion ?? 1) >= BINARY_EXTRACTOR_VERSION;
}

/**
 * The course a binary's document carries, by this precedence (`ol-egov.141.89.1.95`):
 *  1. **A registration naming a course** (`RegisteredFileSpec.course`, folded from her "source
 *     registered" events, so a later correction wins): that course, exactly as before the ruling.
 *  2. **Otherwise none.** The index gives a note only the course its own `course` frontmatter
 *     names (`document.ts`), never one guessed from its folder (F1.3's folder rule is applied by
 *     consumers, `../concept/course.js#notePathCourses`). A binary has no frontmatter, so it is
 *     ungrouped, exactly as a note in the same folder with no `course` property is.
 * Registration never decides WHETHER a binary is indexed; only this.
 */
export function binaryCourses(
  path: VaultPath,
  registeredCourses: ReadonlyMap<VaultPath, string>,
): readonly string[] {
  const course = registeredCourses.get(path);
  return course !== undefined ? [course] : [];
}

/**
 * The registered course per path among `specs`, for `binaryCourses`. `projectRegisteredFiles`
 * already folds to one spec per path; were there two, the first stands, as in `registerSources`.
 * A spec with no course, or for a path this index does not carry as a binary, contributes nothing.
 */
export function registeredCoursesOf(
  specs: readonly RegisteredFileSpec[],
): ReadonlyMap<VaultPath, string> {
  const courses = new Map<VaultPath, string>();
  const seen = new Set<VaultPath>();
  for (const spec of specs) {
    if (seen.has(spec.path)) continue;
    seen.add(spec.path);
    if (spec.course !== undefined && indexedBinaryFormatOf(spec.path) !== null) {
      courses.set(spec.path, spec.course);
    }
  }
  return courses;
}

export interface BuildProgress {
  readonly documentsProcessed: number;
  readonly documentsTotal: number;
}

/**
 * `ol-egov.141.89.1.95`: what turns on the binary half of the build. Present, every PDF, deck and
 * document the vault lists is extracted and indexed (see the module doc).
 */
export interface BuildBinarySources {
  /** Her registered sources, for each binary's course (`binaryCourses`). Omitted, every binary is ungrouped. */
  readonly registeredFiles?: readonly RegisteredFileSpec[];
}

export interface BuildFullIndexOptions {
  readonly vault: VaultSource;
  /** Defaults to `macrotaskScheduler`. Tests must override — see `scheduling.ts`. */
  readonly scheduler?: YieldScheduler;
  /** Polled between chunks; omit for a build that cannot be cancelled. */
  readonly signal?: CancellationSignal;
  /** Defaults to `DEFAULT_INDEX_CHUNK_SIZE`. */
  readonly chunkSize?: number;
  /** Called after every chunk completes, including the last (C2.6: "visible progress"). */
  readonly onProgress?: (progress: BuildProgress) => void;
  /** Extensions of the note scan. Defaults to `DEFAULT_INDEX_EXTENSIONS`; binaries are `binarySources`' business. */
  readonly extensions?: readonly string[];
  /**
   * Every PDF, deck and document in the vault — see the module doc. Optional and purely additive:
   * omitting it reproduces exactly the notes-and-transcripts index, so a caller that never asked
   * for binaries (the workbench, the harness) sees no change.
   */
  readonly binarySources?: BuildBinarySources;
}

export type BuildResult =
  | { readonly status: 'complete'; readonly index: PersistedKeywordIndex }
  | { readonly status: 'cancelled' };

export async function buildFullIndex(options: BuildFullIndexOptions): Promise<BuildResult> {
  const {
    vault,
    scheduler = macrotaskScheduler,
    signal,
    chunkSize = DEFAULT_INDEX_CHUNK_SIZE,
    onProgress,
    extensions = DEFAULT_INDEX_EXTENSIONS,
    binarySources,
  } = options;

  // `VaultSource.list`'s contract guarantees a stable, sorted path order, so
  // `documents` below ends up in the same order `PersistedKeywordIndex.documents`
  // is defined to keep — no explicit sort needed here (contrast
  // `KeywordIndexEngine.toPersisted`, which does sort, since incremental event
  // order is not path order).
  const paths: readonly VaultPath[] = await vault.list({ extensions });
  const binaries = binarySources !== undefined ? await listIndexedBinaries(vault) : [];
  const documentsTotal = paths.length + binaries.length;

  const documents: IndexedDocument[] = [];
  for (let start = 0; start < paths.length; start += chunkSize) {
    if (signal?.cancelled) return { status: 'cancelled' };

    const chunk = paths.slice(start, start + chunkSize);
    for (const path of chunk) {
      documents.push(await indexDocument(vault, path));
    }

    onProgress?.({ documentsProcessed: documents.length, documentsTotal });

    const hasMore = start + chunkSize < paths.length;
    if (hasMore || binaries.length > 0) await scheduler.yield();
  }

  if (binaries.length > 0) {
    // Every binary in the vault, so vault-sized: one at a time, a cancellation check before each
    // and a yield after each, since one extraction is far heavier than one note's parse (C2.6).
    // A binary that cannot be read or extracted is left out, never fails the build: one malformed
    // file must not cost her the rest of the index. The engine's next sync retries it.
    const registeredCourses = registeredCoursesOf(binarySources?.registeredFiles ?? []);
    let processed = documents.length;
    for (const { path, format } of binaries) {
      if (signal?.cancelled) return { status: 'cancelled' };
      try {
        documents.push(
          await indexBinaryBytes(
            { path, format, courses: binaryCourses(path, registeredCourses) },
            await vault.readBinary(path),
          ),
        );
      } catch (error) {
        logBinaryFailure(error);
      }
      processed += 1;
      onProgress?.({ documentsProcessed: processed, documentsTotal });
      await scheduler.yield();
    }
    // `PersistedKeywordIndex.documents` is documented as ascending-path order
    // (see `types.ts`); the markdown scan above gets that for free from
    // `VaultSource.list`, but appended binary documents do not, so this
    // restores it explicitly.
    documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  return { status: 'complete', index: { version: 1, documents } };
}

/** One binary this index extracts: its path, its format, and the course its document carries. */
export interface IndexedBinary {
  readonly path: VaultPath;
  readonly format: IndexedBinaryFormat;
  readonly courses: readonly string[];
}

/**
 * Every binary the vault lists that this index carries (`indexedBinaryFormatOf`), in the list's
 * own sorted order. One `list()` of the whole vault, then the one test, so the set is never a
 * second extension list and never escapes the host's folder rule.
 */
export async function listIndexedBinaries(
  vault: VaultSource,
): Promise<readonly { readonly path: VaultPath; readonly format: IndexedBinaryFormat }[]> {
  const binaries: { path: VaultPath; format: IndexedBinaryFormat }[] = [];
  for (const path of await vault.list()) {
    const format = indexedBinaryFormatOf(path);
    if (format !== null) binaries.push({ path, format });
  }
  return binaries;
}

/**
 * **The one place a binary's extracted text enters the index** (`ol-egov.141.89.1.95`): a full
 * rebuild (`buildFullIndex`) and every incremental change (`KeywordIndexEngine`'s event and sync
 * paths) build a binary's `IndexedDocument` here and nowhere else. A size cap, when one is ruled,
 * belongs here, so the rebuilt and the incrementally maintained index cannot disagree about it.
 *
 * Built from the SAME extraction `../tier3-evidence/build.js#collectDerivedSources` runs for the
 * concept/citation pipeline: `EXTRACTORS[format].extract` with no options, which is exactly the
 * call `extractFromVault` makes once it has read the bytes. So a PDF is chunked from the exact
 * text the citation pipeline already cites, not a second, independently-derived copy of it. The
 * bytes are taken as given so the content hash and the extraction come from one read (the same
 * rule `../ingestion/extraction-runner.ts` follows, [D-515]), and so `KeywordIndexEngine` can hash
 * first and extract only on a change.
 *
 * **Text layer only.** A page routed to vision (`route: 'vision'`: a scanned page, or a text layer
 * that is absent or unreadable) carries no units by the extractor's own contract, and is skipped
 * here by name as well, so no vision-read text can ever reach this index; a `'both'` page keeps its
 * text-layer units and nothing of its figure. No extraction option is passed, so nothing is ever
 * sent to a vision model from here.
 *
 * Extracted text carries no block structure of its own the way a parsed markdown document does,
 * so every extracted unit becomes one `'paragraph'` block (the closest existing `BlockKind`),
 * numbered from zero within this synthesized document. **Each block keeps its unit's own
 * `Provenance.location`** (`IndexedBlock.location`): the page (or slide) number, the char range
 * within it, and the section when the format has one, so a retrieved chunk cites the same passage
 * the citation pipeline would.
 *
 * **A binary with no text-layer text is still a document, with no blocks** — the posture
 * `document.ts` takes for an empty note. Nothing can match or retrieve it, but its `contentHash`
 * lets the engine trust it as persisted, so a scanned PDF is not read and extracted again at every
 * load. (Before the ruling such a file was left out and remembered only in memory, which at vault
 * scale would re-extract every scanned file on every start.)
 *
 * `evidenceScope: 1` ([D-491]): a binary in her vault is her course material, never one of Olea's
 * own instruments or home-note scaffolding, so the exclusion holds for it trivially. Without the
 * marker `KeywordIndexEngine.create` would read the whole persisted cache as pre-[D-491] and drop
 * it on every load.
 */
export async function indexBinaryBytes(
  source: IndexedBinary,
  bytes: Uint8Array,
): Promise<IndexedDocument> {
  const result = await EXTRACTORS[source.format].extract({ path: source.path, bytes });

  const blocks: IndexedBlock[] = [];
  for (const page of result.pages) {
    if (page.route === 'vision') continue;
    for (const unit of page.units) {
      const text = unit.text.trim();
      if (text === '') continue;
      blocks.push({
        blockIndex: blocks.length,
        kind: 'paragraph',
        text,
        location: unit.provenance.location,
      });
    }
  }

  return {
    path: source.path,
    courses: source.courses,
    contentHash: await hashContent(bytes),
    evidenceScope: 1,
    extractorVersion: BINARY_EXTRACTOR_VERSION,
    blocks,
  };
}

/** D-005: the error's name only, never its message (a path or extracted text can ride in one). */
export function logBinaryFailure(error: unknown): void {
  console.error(
    'Olea: a PDF, deck or document could not be indexed',
    error instanceof Error ? error.name : 'unknown',
  );
}
