/**
 * The keyword index's domain and persistence types (C2.1, C2.2, C2.4, D-003,
 * D-006, P2-T01).
 *
 * **The index is a cache, not truth (D-006).** Everything in this directory
 * derives entirely from the vault via `VaultSource`; nothing here is ever the
 * only copy of anything. It lives in the plugin data folder (C2.1), never in
 * the vault, which is exactly what makes it safe to delete at any moment —
 * `KeywordIndexEngine.clear` plus a rebuild must always be able to reconstruct
 * it byte-for-field identically to whatever incremental updates would have
 * produced (C2.4; see `rebuild-equivalence.spec.ts`).
 *
 * **Persistence goes through a narrow injectable port**, in the same shape as
 * the ingestion queue's `QueueStore` (`../ingestion/types.ts`): a structural
 * interface here, a plain-JSON persisted shape written where D-003 puts the
 * client cache — the plugin data folder — and an Obsidian-aware adapter in
 * `packages/plugin` — outside this package, which never imports `obsidian`
 * (INV-1).
 */

import type { BlockKind } from '../block/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * One searchable block within a document. Positional, not content-addressed:
 * `blockIndex` is this block's index into the `ParsedDocument.blocks` array
 * that `parseDocument` produced for the document's current content, so it
 * stays meaningful for later citation (C2.5, a later task) without this
 * module inventing its own block-identity scheme.
 *
 * Only blocks with genuine searchable text produce an entry — frontmatter,
 * blank runs and thematic breaks never do (see `document.ts`'s
 * `extractBlockText`), so `blockIndex` values are not contiguous from zero.
 */
export interface IndexedBlock {
  readonly blockIndex: number;
  readonly kind: BlockKind;
  /** The block's searchable text — trimmed, otherwise verbatim; see `document.ts` for exactly what's captured per `kind`. */
  readonly text: string;
}

/**
 * One indexed document. `courses` is the M:N binding C2.1's "course →
 * document" grouping is built from, read the same way `extractConcepts`
 * reads its `course` frontmatter property: both a bare scalar
 * (`course: GEOL204`) and a list contribute, and a document with none is
 * still indexed (just ungrouped — see `query.ts`'s `documentsByCourse`).
 */
export interface IndexedDocument {
  readonly path: VaultPath;
  /** Sorted, de-duplication is not attempted beyond what `readList` already gives. */
  readonly courses: readonly string[];
  /**
   * SHA-256 of the document's current raw content, hex-encoded (`../ingestion/hash.ts`).
   * Not used to skip re-indexing here — a `modify` event always re-reads and
   * re-derives (see `engine.ts`) — but carried through so a later consumer
   * (e.g. C2.3 embeddings, keyed by content hash) doesn't have to re-hash.
   */
  readonly contentHash: string;
  readonly blocks: readonly IndexedBlock[];
}

/**
 * The whole persisted index — the unit `KeywordIndexStore.save`/`load` moves,
 * mirroring `PersistedQueue`'s shape in `../ingestion/types.ts`.
 *
 * `documents` is always kept in ascending-path order by every producer in
 * this directory (`buildFullIndex` inherits it from `VaultSource.list`'s own
 * "stable, sorted order" contract; `KeywordIndexEngine.toPersisted` sorts
 * explicitly, since incremental event application order is not path order).
 * That agreement is exactly what C2.4's equivalence test checks — two
 * differently-produced document lists that merely contain the same *set* of
 * entries, in a different order, are **not** the same `PersistedKeywordIndex`
 * by `toEqual`, and are not meant to be.
 */
export interface PersistedKeywordIndex {
  /** Schema version tag (D-003 treats the persisted shape as settled whatever engine ends up storing it) — bump on any shape change. */
  readonly version: 1;
  readonly documents: readonly IndexedDocument[];
}

/** An empty, version-1 index — what a fresh plugin install, or a deleted cache, starts from. */
export const EMPTY_KEYWORD_INDEX: PersistedKeywordIndex = { version: 1, documents: [] };

/**
 * The persistence port. Core depends only on this; the plugin implements it
 * over Obsidian's `loadData`/`saveData` the same way `ObsidianQueueStore`
 * does for `QueueStore` (`packages/plugin/src/ingestion/queue-store.ts`) —
 * its own top-level key inside the shared `data.json` blob, read-modify-write
 * on every `save` so it composes with whatever else persists there. A test
 * implements this in memory.
 *
 * `load` returning `null` means "nothing persisted yet" (first run, or the
 * cache was just deleted per D-006), not an empty index — `KeywordIndexEngine`
 * treats both as starting from zero documents, but the distinction is real
 * for an implementation to preserve, exactly as `QueueStore.load` documents.
 */
export interface KeywordIndexStore {
  load(): Promise<PersistedKeywordIndex | null>;
  save(index: PersistedKeywordIndex): Promise<void>;
}
