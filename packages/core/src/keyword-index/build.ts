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
 * **Registered (non-embedded) material — `options.registeredFiles` (`ol-n06g`).**
 * This index's own scan is markdown-only (see `BuildFullIndexOptions.extensions`),
 * which quietly excludes a registered PDF/PPTX/DOCX/image (F3.1,
 * `../source/register.js`) even though `../tier3-evidence/build.js`'s
 * `collectCandidates`/`collectDerivedSources` already makes the identical file
 * citable in the concept/citation pipeline. `registeredFiles` closes that gap
 * by mirroring the exact same mechanism rather than inventing a parallel one:
 * classify each spec with `registerSources`, then run every non-markdown
 * result through the same `extractFromVault` call `collectDerivedSources`
 * uses (see `indexRegisteredFile` below). A markdown registration needs
 * nothing extra here — `vault.list({ extensions })` above already lists every
 * markdown path in the vault, registered or not — mirroring
 * `collectCandidates`'s own `if (source.format === null) continue`.
 */

import { extractFromVault } from '../extract/registry.js';
import type { SourceFormat } from '../extract/types.js';
import { hashContent } from '../ingestion/hash.js';
import { DEFAULT_SOURCES_FOLDER, registerSources } from '../source/register.js';
import type { RegisteredFileSpec } from '../source/types.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { indexDocument } from './document.js';
import { type CancellationSignal, macrotaskScheduler, type YieldScheduler } from './scheduling.js';
import type { IndexedBlock, IndexedDocument, PersistedKeywordIndex } from './types.js';

/** Documents indexed per chunk before yielding. Small enough that a slow device still stays responsive between yields. */
export const DEFAULT_INDEX_CHUNK_SIZE = 25;

export interface BuildProgress {
  readonly documentsProcessed: number;
  readonly documentsTotal: number;
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
  /** Extensions to scan. Defaults to `['md']` — the block model, and therefore this index, is markdown-only; C3's binary formats are a separate pipeline. */
  readonly extensions?: readonly string[];
  /**
   * Registered (non-embedded) material to fold in alongside the ordinary
   * markdown scan — see the module doc's "Registered (non-embedded)
   * material" section. Optional and purely additive: omitting it reproduces
   * exactly today's behaviour (this index stays markdown-only for anything
   * it wasn't already told about), so no existing caller sees any change.
   */
  readonly registeredFiles?: readonly RegisteredFileSpec[];
  /** Forwarded to `registerSources` when `registeredFiles` is given. Defaults to `DEFAULT_SOURCES_FOLDER`, same as `registerSources` itself. */
  readonly sourcesFolder?: VaultPath;
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
    extensions = ['md'],
  } = options;

  // `VaultSource.list`'s contract guarantees a stable, sorted path order, so
  // `documents` below ends up in the same order `PersistedKeywordIndex.documents`
  // is defined to keep — no explicit sort needed here (contrast
  // `KeywordIndexEngine.toPersisted`, which does sort, since incremental event
  // order is not path order).
  const paths: readonly VaultPath[] = await vault.list({ extensions });

  const documents: IndexedDocument[] = [];
  for (let start = 0; start < paths.length; start += chunkSize) {
    if (signal?.cancelled) return { status: 'cancelled' };

    const chunk = paths.slice(start, start + chunkSize);
    for (const path of chunk) {
      documents.push(await indexDocument(vault, path));
    }

    onProgress?.({ documentsProcessed: documents.length, documentsTotal: paths.length });

    const hasMore = start + chunkSize < paths.length;
    if (hasMore) await scheduler.yield();
  }

  // Registered material — see the module doc. Deliberately not chunked/yielded
  // the way the markdown scan above is: `registeredFiles` names a handful of
  // explicit files (F3.1's "drop a file" gesture), not a vault-sized scan, so
  // there is no responsiveness case to protect the way C2.6 protects the loop
  // above. One cancellation check up front is enough to honour a cancellation
  // that landed during the markdown scan's own yields.
  const registeredFiles = options.registeredFiles ?? [];
  if (registeredFiles.length > 0) {
    if (signal?.cancelled) return { status: 'cancelled' };

    const sourcesReport = await registerSources(vault, {
      sourcesFolder: options.sourcesFolder ?? DEFAULT_SOURCES_FOLDER,
      registeredFiles,
    });
    for (const registered of sourcesReport.sources) {
      // Markdown — already covered by the scan above (mirrors
      // `collectCandidates`'s identical skip).
      if (registered.format === null) continue;
      const doc = await indexRegisteredFile(vault, {
        path: registered.path,
        format: registered.format,
        course: registered.course,
      });
      if (doc !== null) documents.push(doc);
    }
    // `PersistedKeywordIndex.documents` is documented as ascending-path order
    // (see `types.ts`); the markdown scan above gets that for free from
    // `VaultSource.list`, but appended registered documents do not, so this
    // restores it explicitly rather than letting the invariant quietly stop
    // holding the one time this option is used.
    documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  return { status: 'complete', index: { version: 1, documents } };
}

/**
 * One `IndexedDocument` for a registered non-markdown source, built from the
 * SAME extraction call `../tier3-evidence/build.js#collectDerivedSources`
 * runs for the concept/citation pipeline — a PDF registered via
 * `registeredFiles` is chunked from the exact text the citation pipeline
 * already cites, not a second, independently-derived copy of it.
 *
 * Extracted text carries no block structure of its own the way a parsed
 * markdown document does, so every extracted unit becomes one `'paragraph'`
 * block (the closest existing `BlockKind`), numbered from zero within this
 * synthesized document — a document of its own, never spliced into any real
 * note's block indices.
 *
 * Returns `null` when extraction yielded no usable text (an unreadable file,
 * a page routed to vision with nothing on the text layer): an empty document
 * with zero searchable blocks would be indistinguishable from a genuine
 * empty file, so it is left out entirely rather than added as a document
 * nothing can ever match — the same "no searchable text, no entry" rule
 * `document.ts`'s `indexBlocks` already applies per block.
 */
async function indexRegisteredFile(
  vault: VaultSource,
  source: {
    readonly path: VaultPath;
    readonly format: SourceFormat;
    readonly course: string | undefined;
  },
): Promise<IndexedDocument | null> {
  const bytes = await vault.readBinary(source.path);
  const result = await extractFromVault(vault, source.path, source.format);

  const blocks: IndexedBlock[] = [];
  for (const page of result.pages) {
    for (const unit of page.units) {
      const text = unit.text.trim();
      if (text === '') continue;
      blocks.push({ blockIndex: blocks.length, kind: 'paragraph', text });
    }
  }
  if (blocks.length === 0) return null;

  return {
    path: source.path,
    // No embedding note to derive a path-based course from the way
    // `notePathCourses` does for an embed — an explicit `course` on the
    // `RegisteredFileSpec` is honoured; otherwise this is honestly
    // ungrouped rather than guessed (same posture `document.ts` takes for a
    // markdown document with no `course` frontmatter).
    courses: source.course !== undefined ? [source.course] : [],
    contentHash: await hashContent(bytes),
    blocks,
  };
}
