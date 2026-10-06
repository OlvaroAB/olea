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
 * **Every PDF, deck and document in the vault (`ol-egov.141.89.1.95`, David's ruling 2026-10-06,
 * option a).** Given `deps.binarySources`, the engine keeps every binary `build.ts` carries
 * (`indexedBinaryFormatOf`: a PDF, a deck or a Word document, outside every dot-folder) in this
 * same index beside her notes, registered or not, text layer only:
 *  - `rebuild` passes `binarySources` to `buildFullIndex`, unless told to defer them to the next
 *    sync (`RebuildOptions.deferBinaries`, the wiring's first run);
 *  - a `create`/`modify` of such a binary rebuilds its document through `indexBinaryBytes` (the
 *    function the rebuild uses), so its old chunks are replaced. When the bytes hash to the
 *    document's own `contentHash` nothing is re-extracted: extraction is a function of the bytes;
 *  - a `delete` drops the document; a `rename` drops the old path and indexes the new one when it
 *    is itself a carried binary — moving the old document across without extracting again when
 *    the bytes and format are unchanged. A rename into a dot-folder therefore leaves the index,
 *    and one out of a dot-folder enters it;
 *  - `syncBinarySources` reconciles the index against the vault (at every load, and after a
 *    registration): a binary gone from the vault leaves, one the index lacks is extracted, and one
 *    already indexed is trusted as persisted, exactly as a persisted note is. It also re-reads her
 *    registrations, since a registration (or a correction) now changes only a binary's course
 *    (`build.ts#binaryCourses`), applied without extracting anything.
 * Markdown and transcript paths never take this route. Her registrations are read at `rebuild`
 * and at `syncBinarySources`, and an event uses the courses last read: her event log lives in a
 * dot-folder that raises no vault event, so a registration reaches this engine through a sync.
 *
 * **One change at a time.** `applyEvent`, `rebuild`, `clear` and each step of
 * `syncBinarySources` run only after the previous one has finished, so a binary's extraction
 * (slow, and awaited) cannot interleave with a delete of the same path and leave a stale document
 * behind. A sync extracts each missing binary as its own step, so a vault event waits behind at
 * most one extraction, never behind the whole vault's.
 */

import { hashContent } from '../ingestion/hash.js';
import type { RegisteredFileSpec } from '../source/types.js';
import type { VaultEvent, VaultPath, VaultSource } from '../vault/types.js';
import {
  type BuildProgress,
  binaryCourses,
  buildFullIndex,
  DEFAULT_INDEX_CHUNK_SIZE,
  DEFAULT_INDEX_EXTENSIONS,
  type IndexedBinaryFormat,
  indexBinaryBytes,
  indexedBinaryFormatOf,
  listIndexedBinaries,
  logBinaryFailure,
  registeredCoursesOf,
} from './build.js';
import { indexDocument } from './document.js';
import { type SearchHit, type SearchOptions, searchKeywordIndex } from './query.js';
import { type CancellationSignal, macrotaskScheduler, type YieldScheduler } from './scheduling.js';
import type { IndexedDocument, KeywordIndexStore, PersistedKeywordIndex } from './types.js';

/**
 * `ol-egov.141.89.1.95`: what turns on the binary half of the index. Present, every PDF, deck and
 * document in the vault is indexed and kept current (see the module doc); omitted, the index holds
 * notes and transcripts only, exactly as before.
 */
export interface BinarySourcesDeps {
  /**
   * Her registered sources, read fresh on each call (the plugin folds her "source registered"
   * events, `../source/register.js#projectRegisteredFiles`). They decide only a binary's course
   * (`build.ts#binaryCourses`), never whether it is indexed. Omitted, every binary is ungrouped.
   */
  readonly registeredFiles?: () => Promise<readonly RegisteredFileSpec[]>;
}

export interface KeywordIndexEngineDeps {
  readonly vault: VaultSource;
  readonly store: KeywordIndexStore;
  /** Defaults to `macrotaskScheduler`; tests must override (see `scheduling.ts`). */
  readonly scheduler?: YieldScheduler;
  /** Defaults to `DEFAULT_INDEX_CHUNK_SIZE`. */
  readonly chunkSize?: number;
  /** `ol-egov.141.89.1.95`: every PDF, deck and document in the vault. See `BinarySourcesDeps`. */
  readonly binarySources?: BinarySourcesDeps;
}

/** What one `syncBinarySources` did, in counts only (D-005: no paths, no content). */
export interface BinarySourcesSync {
  /** Binaries extracted into a document with text by this call. */
  readonly indexed: number;
  /** Binaries extracted by this call whose text layer held no text: kept with no blocks, never read again for the same bytes. */
  readonly textless: number;
  /** Binary documents dropped because the file is no longer in the vault. */
  readonly removed: number;
  /** Binary documents whose course changed with her registrations, with nothing extracted. */
  readonly regrouped: number;
  /** Binaries that could not be read or extracted this time; left out, and retried at the next load. */
  readonly failed: number;
}

export interface RebuildOptions {
  readonly signal?: CancellationSignal;
  readonly onProgress?: (progress: BuildProgress) => void;
  /**
   * `ol-egov.141.89.1.95`: rebuild notes and transcripts only, leaving every binary for the next
   * `syncBinarySources` to extract. The wiring's first run sets it, so plugin load waits on her
   * notes, never on extracting every PDF in the vault; after that sync the index is the one a full
   * rebuild produces (C2.4). Ignored without `deps.binarySources`.
   */
  readonly deferBinaries?: boolean;
}

export type RebuildResult = 'complete' | 'cancelled';

/** How one binary's document changed (`KeywordIndexEngine.reindexBinary`). */
type BinaryOutcome =
  | 'absent'
  | 'unchanged'
  | 'regrouped'
  | 'moved'
  | 'indexed'
  | 'textless'
  | 'unextractable';

export class KeywordIndexEngine {
  private readonly vault: VaultSource;
  private readonly store: KeywordIndexStore;
  private readonly scheduler: YieldScheduler;
  private readonly chunkSize: number;
  private readonly binarySources: BinarySourcesDeps | undefined;
  private documents: Map<VaultPath, IndexedDocument>;
  /** Her registered course per binary path, as last read (`null` before the first read). */
  private registeredCourses: ReadonlyMap<VaultPath, string> | null = null;
  /**
   * In memory only: a binary whose bytes (by content hash) could not be extracted this session,
   * so a later sync or event does not extract the same bytes again. Never persisted: a restart
   * retries it, in case what failed was transient.
   */
  private readonly unextractable = new Map<VaultPath, string>();
  /** The tail of the one-at-a-time chain (see the module doc). */
  private tail: Promise<void> = Promise.resolve();

  private constructor(deps: KeywordIndexEngineDeps, documents: Map<VaultPath, IndexedDocument>) {
    this.vault = deps.vault;
    this.store = deps.store;
    this.scheduler = deps.scheduler ?? macrotaskScheduler;
    this.chunkSize = deps.chunkSize ?? DEFAULT_INDEX_CHUNK_SIZE;
    this.binarySources = deps.binarySources;
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
      case 'rename': {
        // `ol-egov.141.89.1.95`: the old document travels to `reindexOrForget`, so a moved binary
        // whose bytes did not change is not extracted again (`reindexBinary`).
        const previous =
          event.oldPath !== undefined ? this.documents.get(event.oldPath) : undefined;
        if (event.oldPath !== undefined) this.documents.delete(event.oldPath);
        await this.reindexOrForget(event.path, previous);
        break;
      }
    }
    await this.persist();
  }

  /** Re-reads and replaces `path`'s entry, or drops any stale entry if the vault no longer has that file — defensive against an event describing a file that's since moved on. */
  private async reindexOrForget(path: VaultPath, renamedFrom?: IndexedDocument): Promise<void> {
    // `ol-egov.141.89.1.95`: a PDF, deck or document outside every dot-folder is the one
    // non-markdown path this index carries, and only when `deps.binarySources` turns binaries on.
    const format = this.binarySources !== undefined ? indexedBinaryFormatOf(path) : null;
    if (format !== null) {
      try {
        await this.reindexBinary(path, format, renamedFrom);
      } catch (error) {
        // An unreadable file keeps no chunks from an earlier revision; the next load retries it.
        this.documents.delete(path);
        logBinaryFailure(error);
      }
      return;
    }
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
   * Re-reads her registrations into `registeredCourses`. Reports whether the read succeeded; on a
   * failure the courses last read stand (none, before the first read) and the next sync retries.
   */
  private async refreshRegisteredCourses(): Promise<boolean> {
    const read = this.binarySources?.registeredFiles;
    if (read === undefined) {
      this.registeredCourses = new Map();
      return true;
    }
    try {
      this.registeredCourses = registeredCoursesOf(await read());
      return true;
    } catch (error) {
      // Her log could not be read: courses stay as last read (none, before any read) until a
      // later sync can read it. Not retried per binary in the meantime.
      this.registeredCourses ??= new Map();
      logBinaryFailure(error);
      return false;
    }
  }

  /** The course `path`'s document carries, from the registrations last read (`build.ts#binaryCourses`). */
  private coursesOf(path: VaultPath): readonly string[] {
    return binaryCourses(path, this.registeredCourses ?? new Map());
  }

  /**
   * Brings one binary's document in line with its current bytes and course. Gone from the vault:
   * its document leaves. Same bytes as the indexed document: kept, its course updated if her
   * registrations moved it. A rename's old document with the same bytes and format: moved to the
   * new path. Bytes that already failed to extract this session: left out. Otherwise extracted
   * again (`indexBinaryBytes`) and replaced whole. Throws only when the file cannot be read.
   */
  private async reindexBinary(
    path: VaultPath,
    format: IndexedBinaryFormat,
    renamedFrom?: IndexedDocument,
  ): Promise<BinaryOutcome> {
    if (!(await this.vault.exists(path))) {
      this.documents.delete(path);
      return 'absent';
    }
    if (this.registeredCourses === null) await this.refreshRegisteredCourses();
    const courses = this.coursesOf(path);
    const bytes = await this.vault.readBinary(path);
    const contentHash = await hashContent(bytes);

    const current = this.documents.get(path);
    if (current !== undefined && current.contentHash === contentHash) {
      if (sameCourses(current.courses, courses)) return 'unchanged';
      this.documents.set(path, { ...current, courses });
      return 'regrouped';
    }
    if (
      current === undefined &&
      renamedFrom !== undefined &&
      renamedFrom.contentHash === contentHash &&
      indexedBinaryFormatOf(renamedFrom.path) === format
    ) {
      // Extraction reads only the bytes, and a block's anchor names no path, so the moved
      // document is the one extracting the same bytes at the new path would build.
      this.documents.set(path, { ...renamedFrom, path, courses });
      return 'moved';
    }
    if (this.unextractable.get(path) === contentHash) {
      this.documents.delete(path);
      return 'unextractable';
    }
    let doc: IndexedDocument;
    try {
      doc = await indexBinaryBytes({ path, format, courses }, bytes);
    } catch (error) {
      this.unextractable.set(path, contentHash);
      this.documents.delete(path);
      logBinaryFailure(error);
      return 'unextractable';
    }
    this.unextractable.delete(path);
    this.documents.set(path, doc);
    return doc.blocks.length > 0 ? 'indexed' : 'textless';
  }

  /**
   * `ol-egov.141.89.1.95`: reconciles the index's binaries against the vault and her registrations
   * (see the module doc). A binary document whose file the vault no longer lists leaves; one whose
   * course her registrations changed is regrouped in place; one the vault lists and the index
   * lacks is extracted and added; one already indexed is trusted as persisted. Notes and
   * transcripts are untouched. Each missing binary is extracted as its own step, with a yield
   * between, and progress is persisted every `chunkSize` binaries, so a sync over a whole vault
   * neither holds vault events back nor loses its work to an early quit. A file that cannot be
   * read is counted and skipped, never thrown. A no-op without `deps.binarySources`.
   */
  async syncBinarySources(): Promise<BinarySourcesSync> {
    const counts = { indexed: 0, textless: 0, removed: 0, regrouped: 0, failed: 0 };
    if (this.binarySources === undefined) return counts;

    const missing = await this.serially(async () => {
      const coursesRead = await this.refreshRegisteredCourses();
      const listed = new Map(
        (await listIndexedBinaries(this.vault)).map((b) => [b.path, b.format] as const),
      );
      let changed = false;
      for (const doc of [...this.documents.values()]) {
        if (isIndexableExtension(doc.path)) continue;
        if (!listed.has(doc.path)) {
          this.documents.delete(doc.path);
          counts.removed += 1;
          changed = true;
          continue;
        }
        const courses = this.coursesOf(doc.path);
        if (coursesRead && !sameCourses(doc.courses, courses)) {
          this.documents.set(doc.path, { ...doc, courses });
          counts.regrouped += 1;
          changed = true;
        }
      }
      if (changed) await this.persist();
      return [...listed].filter(([path]) => !this.documents.has(path));
    });

    let unsaved = 0;
    for (const [path, format] of missing) {
      await this.scheduler.yield();
      const outcome = await this.serially(async (): Promise<BinaryOutcome | 'failed'> => {
        // An event may have indexed or removed it since the list was taken.
        if (this.documents.has(path)) return 'unchanged';
        try {
          return await this.reindexBinary(path, format);
        } catch (error) {
          logBinaryFailure(error);
          return 'failed';
        }
      });
      if (outcome === 'indexed') counts.indexed += 1;
      else if (outcome === 'textless') counts.textless += 1;
      else if (outcome === 'failed' || outcome === 'unextractable') counts.failed += 1;
      if (outcome === 'indexed' || outcome === 'textless') {
        unsaved += 1;
        if (unsaved >= this.chunkSize) {
          unsaved = 0;
          await this.serially(() => this.persist());
        }
      }
    }
    if (unsaved > 0) await this.serially(() => this.persist());
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
    // `ol-egov.141.89.1.95`: every binary goes into the build itself, unless deferred to the next
    // sync. Her registrations are re-read for their courses; a log that cannot be read builds the
    // binaries ungrouped rather than failing, and the next sync regroups them.
    const withBinaries = this.binarySources !== undefined && options.deferBinaries !== true;
    let registeredFiles: readonly RegisteredFileSpec[] = [];
    if (withBinaries && this.binarySources?.registeredFiles !== undefined) {
      try {
        registeredFiles = await this.binarySources.registeredFiles();
        this.registeredCourses = registeredCoursesOf(registeredFiles);
      } catch (error) {
        logBinaryFailure(error);
      }
    }
    const result = await buildFullIndex({
      vault: this.vault,
      scheduler: this.scheduler,
      chunkSize: this.chunkSize,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
      ...(withBinaries ? { binarySources: { registeredFiles } } : {}),
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

function sameCourses(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((course, i) => course === b[i]);
}
