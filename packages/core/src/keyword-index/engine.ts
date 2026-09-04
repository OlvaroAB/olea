/**
 * `KeywordIndexEngine` — the stateful glue over `build.ts`/`document.ts`/
 * `query.ts` (C2.1, C1.5, C2.4, C2.6, P2-T01), in the same shape as
 * `IngestionQueueEngine` (`../ingestion/engine.ts`): a `create` that loads
 * persisted state, mutating methods that persist through the injected store
 * after every change, and no direct filesystem or Obsidian access anywhere
 * (INV-1) — everything goes through `VaultSource` and `KeywordIndexStore`.
 *
 * **Why incremental updates re-derive rather than patch.** `applyEvent`
 * never edits an existing `IndexedDocument` in place; every branch that
 * needs a document's current content calls `indexDocument` — the identical
 * function `buildFullIndex` calls for every document during a full rebuild.
 * That shared code path is what makes the incrementally-maintained index and
 * a from-scratch rebuild over the same final vault state produce the same
 * `PersistedKeywordIndex` (C2.4) — not a coincidence two implementations
 * happen to agree on, but one implementation used both ways.
 */

import type { VaultEvent, VaultPath, VaultSource } from '../vault/types.js';
import {
  type BuildProgress,
  buildFullIndex,
  DEFAULT_INDEX_CHUNK_SIZE,
  DEFAULT_INDEX_EXTENSIONS,
} from './build.js';
import { indexDocument } from './document.js';
import { type SearchHit, type SearchOptions, searchKeywordIndex } from './query.js';
import { type CancellationSignal, macrotaskScheduler, type YieldScheduler } from './scheduling.js';
import type { IndexedDocument, KeywordIndexStore, PersistedKeywordIndex } from './types.js';

export interface KeywordIndexEngineDeps {
  readonly vault: VaultSource;
  readonly store: KeywordIndexStore;
  /** Defaults to `macrotaskScheduler`; tests must override (see `scheduling.ts`). */
  readonly scheduler?: YieldScheduler;
  /** Defaults to `DEFAULT_INDEX_CHUNK_SIZE`. */
  readonly chunkSize?: number;
}

export interface RebuildOptions {
  readonly signal?: CancellationSignal;
  readonly onProgress?: (progress: BuildProgress) => void;
}

export type RebuildResult = 'complete' | 'cancelled';

export class KeywordIndexEngine {
  private readonly vault: VaultSource;
  private readonly store: KeywordIndexStore;
  private readonly scheduler: YieldScheduler;
  private readonly chunkSize: number;
  private documents: Map<VaultPath, IndexedDocument>;

  private constructor(deps: KeywordIndexEngineDeps, documents: Map<VaultPath, IndexedDocument>) {
    this.vault = deps.vault;
    this.store = deps.store;
    this.scheduler = deps.scheduler ?? macrotaskScheduler;
    this.chunkSize = deps.chunkSize ?? DEFAULT_INDEX_CHUNK_SIZE;
    this.documents = documents;
  }

  /**
   * Loads whatever `store.load()` returns. `null` (nothing persisted — a
   * fresh install, or the cache having just been deleted per D-006) and an
   * empty `documents` array are treated identically: the engine starts
   * holding zero documents either way, ready for `rebuild()` to populate it.
   */
  static async create(deps: KeywordIndexEngineDeps): Promise<KeywordIndexEngine> {
    const persisted = await deps.store.load();
    const documents = new Map((persisted?.documents ?? []).map((doc) => [doc.path, doc] as const));
    return new KeywordIndexEngine(deps, documents);
  }

  /**
   * C1.5: applies one vault event incrementally. See the module doc for why
   * every branch re-derives via `indexDocument` rather than patching state
   * in place.
   */
  async applyEvent(event: VaultEvent): Promise<void> {
    switch (event.kind) {
      case 'create':
      case 'modify':
        await this.reindexOrForget(event.path);
        break;
      case 'delete':
        // A path never indexed simply isn't a key in `documents` —
        // `Map.delete` on a missing key is a safe no-op, never a throw.
        this.documents.delete(event.path);
        break;
      case 'rename':
        if (event.oldPath !== undefined) this.documents.delete(event.oldPath);
        await this.reindexOrForget(event.path);
        break;
    }
    await this.persist();
  }

  /** Re-reads and replaces `path`'s entry, or drops any stale entry if the vault no longer has that file — defensive against an event describing a file that's since moved on. */
  private async reindexOrForget(path: VaultPath): Promise<void> {
    // The same markdown-only rule `rebuild` (`buildFullIndex`'s `extensions`)
    // applies to a full scan, applied to one event: a `create`/`modify` for a
    // path the scan would never list must not become a document here either.
    // Obsidian itself never emits an event for a dot-folder file, but a vault
    // source that does (the workbench shim surfaces `.olea/reviews/*.jsonl`
    // as a file — `ol-3ux7.64.18`) turned every review-log append into an
    // indexed, embedded, wall-clock-stamped "document" before this guard.
    if (!isIndexableExtension(path)) {
      this.documents.delete(path);
      return;
    }
    if (await this.vault.exists(path)) {
      this.documents.set(path, await indexDocument(this.vault, path));
    } else {
      this.documents.delete(path);
    }
  }

  /**
   * C2.4's "full reindex on demand", chunked and cancellable (C2.6). On
   * completion, in-memory and persisted state are replaced together; a
   * cancelled rebuild leaves both exactly as they were (D-006: skipping the
   * rebuild and losing it partway through must be equally safe).
   */
  async rebuild(options: RebuildOptions = {}): Promise<RebuildResult> {
    const result = await buildFullIndex({
      vault: this.vault,
      scheduler: this.scheduler,
      chunkSize: this.chunkSize,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    });
    if (result.status === 'cancelled') return 'cancelled';
    this.documents = new Map(result.index.documents.map((doc) => [doc.path, doc] as const));
    await this.persist();
    return 'complete';
  }

  /** D-006: delete the whole cache. Always safe — `rebuild()` reconstructs it, and C2.4 is the proof that reconstruction matches what incremental updates would have produced. */
  async clear(): Promise<void> {
    this.documents = new Map();
    await this.persist();
  }

  /** C2.2: keyword search over the current in-memory index. */
  search(query: string, options?: SearchOptions): readonly SearchHit[] {
    return searchKeywordIndex(this.toPersisted(), query, options);
  }

  /**
   * The persisted shape this engine's current state maps to — documents in
   * ascending-path order. Explicit, since `documents.values()` reflects
   * event-application (insertion) order, not path order, and `types.ts`
   * documents why every producer here must agree on path order for C2.4's
   * comparison to be meaningful.
   */
  toPersisted(): PersistedKeywordIndex {
    const documents = [...this.documents.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    return { version: 1, documents };
  }

  private async persist(): Promise<void> {
    await this.store.save(this.toPersisted());
  }
}

/** `path`'s extension (lower-cased, no dot) is one `DEFAULT_INDEX_EXTENSIONS` lists. A path with no extension is never indexable. */
function isIndexableExtension(path: VaultPath): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return DEFAULT_INDEX_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}
