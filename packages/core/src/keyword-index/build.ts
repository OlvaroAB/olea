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
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { indexDocument } from './document.js';
import { type CancellationSignal, macrotaskScheduler, type YieldScheduler } from './scheduling.js';
import type { IndexedDocument, PersistedKeywordIndex } from './types.js';

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

  return { status: 'complete', index: { version: 1, documents } };
}
