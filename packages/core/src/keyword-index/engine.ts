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
 *
 * **Registered binary sources (`ol-egov.141.89.1.95`).** Given `deps.registeredFiles` (the
 * plugin folds her "source registered" events, `../source/register.js#projectRegisteredFiles`),
 * the engine keeps her registered PDFs, decks and documents in this same index, beside her notes:
 *  - `rebuild` passes them to `buildFullIndex`;
 *  - a `create`/`modify` of a registered binary rebuilds its document through
 *    `indexRegisteredBytes` (the function the rebuild uses), so its old chunks are replaced. When
 *    the bytes hash to the document's own `contentHash` nothing is re-extracted: extraction is a
 *    function of the bytes, so it would reproduce the same document;
 *  - a `delete` or `rename` drops the old path's document; a renamed file is indexed at its new
 *    path only if that path is itself registered (a registration names a path);
 *  - `syncRegisteredSources` brings the index in line with the registered set after it changes
 *    (a registration, or another device's events folding in at load): a binary no longer
 *    registered leaves, a registered one the index lacks is extracted, and one already indexed is
 *    trusted as persisted, exactly as a persisted note is.
 * Markdown and transcript paths never take this route. The registered set is read at `rebuild`
 * and at `syncRegisteredSources`, and an event uses the set last read: registration changes reach
 * this engine through a sync, never through a vault event (her event log lives in a dot-folder,
 * which raises none).
 *
 * **One change at a time.** `applyEvent`, `rebuild`, `clear` and `syncRegisteredSources` each run
 * only after the previous one has finished, so a binary's extraction (slow, and awaited) cannot
 * interleave with a delete of the same path and leave a stale document behind.
 */

import { hashContent } from '../ingestion/hash.js';
import type { RegisteredFileSpec } from '../source/types.js';
import type { VaultEvent, VaultPath, VaultSource } from '../vault/types.js';
import {
  type BuildProgress,
  buildFullIndex,
  DEFAULT_INDEX_CHUNK_SIZE,
  DEFAULT_INDEX_EXTENSIONS,
  indexRegisteredBytes,
  type RegisteredBinary,
  registeredBinaryOf,
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
  /**
   * `ol-egov.141.89.1.95`: the vault's registered sources, read fresh on each call. Omitted, the
   * index holds notes and transcripts only, exactly as before. See the module doc.
   */
  readonly registeredFiles?: () => Promise<readonly RegisteredFileSpec[]>;
}

/** What one `syncRegisteredSources` did, in counts only (D-005: no paths, no content). */
export interface RegisteredSourcesSync {
  /** Registered binaries the index now holds a document for, from this call. */
  readonly indexed: number;
  /** Documents dropped because their binary is no longer registered (or yields no text now). */
  readonly removed: number;
  /** Registered binaries whose extraction yielded no text, left out (`indexRegisteredBytes`). */
  readonly textless: number;
  /** Registered binaries that could not be read or extracted this time; retried at the next sync. */
  readonly failed: number;
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
  private readonly registeredFiles: (() => Promise<readonly RegisteredFileSpec[]>) | undefined;
  private documents: Map<VaultPath, IndexedDocument>;
  /** The registered binaries as last read from `registeredFiles` (`null` before the first read). */
  private registered: ReadonlyMap<VaultPath, RegisteredBinary> | null = null;
  /**
   * In memory only: a registered binary whose bytes (by content hash) extracted to no text this
   * session, so a later sync does not extract the same bytes again. Never persisted.
   */
  private readonly textless = new Map<VaultPath, string>();
  /** The tail of the one-at-a-time chain (see the module doc). */
  private tail: Promise<void> = Promise.resolve();

  private constructor(deps: KeywordIndexEngineDeps, documents: Map<VaultPath, IndexedDocument>) {
    this.vault = deps.vault;
    this.store = deps.store;
    this.scheduler = deps.scheduler ?? macrotaskScheduler;
    this.chunkSize = deps.chunkSize ?? DEFAULT_INDEX_CHUNK_SIZE;
    this.registeredFiles = deps.registeredFiles;
    this.documents = documents;
  }

  /** Runs `op` after every change already started has finished, and before any started later. */
  private serially<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(op, op);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Loads whatever `store.load()` returns. `null` (nothing persisted — a
   * fresh install, or the cache having just been deleted per D-006) and an
   * empty `documents` array are treated identically: the engine starts
   * holding zero documents either way, ready for `rebuild()` to populate it.
   */
  static async create(deps: KeywordIndexEngineDeps): Promise<KeywordIndexEngine> {
    const persisted = await deps.store.load();
    // [D-491]: a cache indexed before Olea's instruments were excluded still holds them. It is a
    // cache (D-006), so it is dropped whole, and the wiring's existing empty-index rebuild refills it.
    const current = (persisted?.documents ?? []).every((doc) => doc.evidenceScope === 1);
    const documents = new Map(
      (current ? (persisted?.documents ?? []) : []).map((doc) => [doc.path, doc] as const),
    );
    return new KeywordIndexEngine(deps, documents);
  }

  /**
   * C1.5: applies one vault event incrementally. See the module doc for why
   * every branch re-derives via `indexDocument` rather than patching state
   * in place.
   */
  applyEvent(event: VaultEvent): Promise<void> {
    return this.serially(() => this.applyEventNow(event));
  }

  private async applyEventNow(event: VaultEvent): Promise<void> {
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
      // `ol-egov.141.89.1.95`: a registered binary is the one non-markdown path that is indexed.
      let registered: ReadonlyMap<VaultPath, RegisteredBinary>;
      try {
        registered = await this.registeredBinaries(false);
      } catch (error) {
        // Her log could not be read: the document stays as it was until the next sync.
        logRegisteredFailure(error);
        return;
      }
      const binary = registered.get(path);
      if (binary === undefined) {
        this.documents.delete(path);
        return;
      }
      try {
        await this.reindexRegisteredBinary(binary);
      } catch (error) {
        // An unreadable file keeps no chunks from an earlier revision; the next sync retries it.
        this.documents.delete(path);
        logRegisteredFailure(error);
      }
      return;
    }
    if (await this.vault.exists(path)) {
      this.documents.set(path, await indexDocument(this.vault, path));
    } else {
      this.documents.delete(path);
    }
  }

  /**
   * The registered binaries, keyed by path: re-read from `deps.registeredFiles` when `refresh` is
   * set or nothing has been read yet, otherwise the set last read (see the module doc). Empty when
   * no `registeredFiles` was given.
   */
  private async registeredBinaries(
    refresh: boolean,
  ): Promise<ReadonlyMap<VaultPath, RegisteredBinary>> {
    if (this.registeredFiles === undefined) return new Map();
    if (refresh || this.registered === null) {
      this.registered = binariesOf(await this.registeredFiles());
    }
    return this.registered;
  }

  /**
   * Brings one registered binary's document in line with its current bytes, and reports whether
   * the index changed. Gone from the vault: its document leaves. Same bytes and the same course as
   * the indexed document: nothing to do. Otherwise it is extracted again and its document replaced
   * whole, or dropped when the new bytes yield no text.
   */
  private async reindexRegisteredBinary(binary: RegisteredBinary): Promise<boolean> {
    const { path } = binary;
    if (!(await this.vault.exists(path))) return this.documents.delete(path);
    const bytes = await this.vault.readBinary(path);
    const contentHash = await hashContent(bytes);
    const current = this.documents.get(path);
    if (
      current !== undefined &&
      current.contentHash === contentHash &&
      hasCourses(current, binary)
    ) {
      return false;
    }
    if (current === undefined && this.textless.get(path) === contentHash) return false;
    const doc = await indexRegisteredBytes(binary, bytes);
    if (doc === null) {
      this.textless.set(path, contentHash);
      return this.documents.delete(path);
    }
    this.textless.delete(path);
    this.documents.set(path, doc);
    return true;
  }

  /**
   * `ol-egov.141.89.1.95`: re-reads the registered sources and brings the index's registered
   * binaries in line with them (see the module doc): a binary indexed here that is no longer
   * registered leaves, a registered one the index lacks is extracted and added, and one already
   * indexed under the same course is trusted as persisted. Notes and transcripts are untouched.
   * Persists only when something changed. A file that cannot be read is counted and skipped, never
   * thrown; the next sync retries it. A no-op without `deps.registeredFiles`.
   */
  syncRegisteredSources(): Promise<RegisteredSourcesSync> {
    return this.serially(() => this.syncRegisteredSourcesNow());
  }

  private async syncRegisteredSourcesNow(): Promise<RegisteredSourcesSync> {
    const counts = { indexed: 0, removed: 0, textless: 0, failed: 0 };
    if (this.registeredFiles === undefined) return counts;
    const registered = await this.registeredBinaries(true);

    let changed = false;
    for (const path of [...this.documents.keys()]) {
      if (isIndexableExtension(path) || registered.has(path)) continue;
      this.documents.delete(path);
      counts.removed += 1;
      changed = true;
    }

    for (const binary of registered.values()) {
      const current = this.documents.get(binary.path);
      if (current !== undefined && hasCourses(current, binary)) continue;
      try {
        if (await this.reindexRegisteredBinary(binary)) {
          changed = true;
          if (this.documents.has(binary.path)) counts.indexed += 1;
          else counts.removed += 1;
        }
        if (!this.documents.has(binary.path) && this.textless.has(binary.path)) {
          counts.textless += 1;
        }
      } catch (error) {
        counts.failed += 1;
        logRegisteredFailure(error);
      }
    }

    if (changed) await this.persist();
    return counts;
  }

  /**
   * C2.4's "full reindex on demand", chunked and cancellable (C2.6). On
   * completion, in-memory and persisted state are replaced together; a
   * cancelled rebuild leaves both exactly as they were (D-006: skipping the
   * rebuild and losing it partway through must be equally safe).
   */
  rebuild(options: RebuildOptions = {}): Promise<RebuildResult> {
    return this.serially(() => this.rebuildNow(options));
  }

  private async rebuildNow(options: RebuildOptions): Promise<RebuildResult> {
    // `ol-egov.141.89.1.95`: the registered sources go into the build itself, re-read now. A log
    // that cannot be read degrades the build to notes and transcripts, never fails it; the next
    // `syncRegisteredSources` brings the registered files in.
    let registered: readonly RegisteredFileSpec[] | undefined;
    if (this.registeredFiles !== undefined) {
      try {
        registered = await this.registeredFiles();
        this.registered = binariesOf(registered);
      } catch (error) {
        logRegisteredFailure(error);
      }
    }
    const result = await buildFullIndex({
      vault: this.vault,
      scheduler: this.scheduler,
      chunkSize: this.chunkSize,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      ...(registered !== undefined ? { registeredFiles: registered } : {}),
    });
    if (result.status === 'cancelled') return 'cancelled';
    this.documents = new Map(result.index.documents.map((doc) => [doc.path, doc] as const));
    await this.persist();
    return 'complete';
  }

  /** D-006: delete the whole cache. Always safe — `rebuild()` reconstructs it, and C2.4 is the proof that reconstruction matches what incremental updates would have produced. */
  clear(): Promise<void> {
    return this.serially(async () => {
      this.documents = new Map();
      await this.persist();
    });
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

/**
 * The registered binaries among `specs`, keyed by path (`registeredBinaryOf`). `projectRegisteredFiles`
 * already folds to one spec per path; were there two, the first stands, as in `registerSources`.
 */
function binariesOf(
  specs: readonly RegisteredFileSpec[],
): ReadonlyMap<VaultPath, RegisteredBinary> {
  const binaries = new Map<VaultPath, RegisteredBinary>();
  for (const spec of specs) {
    const binary = registeredBinaryOf(spec);
    if (binary !== null && !binaries.has(binary.path)) binaries.set(binary.path, binary);
  }
  return binaries;
}

/** Whether `doc` carries exactly the courses `indexRegisteredBytes` would give `binary`. */
function hasCourses(doc: IndexedDocument, binary: RegisteredBinary): boolean {
  const expected = binary.course !== undefined ? [binary.course] : [];
  return doc.courses.length === expected.length && doc.courses.every((c, i) => c === expected[i]);
}

/** D-005: the error's name only, never its message (a path or extracted text can ride in one). */
function logRegisteredFailure(error: unknown): void {
  console.error(
    'Olea: a registered source could not be indexed',
    error instanceof Error ? error.name : 'unknown',
  );
}
