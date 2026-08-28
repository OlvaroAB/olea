/**
 * `MisconceptionEmbeddingCacheEngine` — a content-hash-keyed cache over
 * `MisconceptionEmbedder` (M1, `ol-nagi`), the same architecture
 * `../retrieval/embeddingCache.ts`'s `EmbeddingCacheEngine` uses for corpus
 * chunks, reimplemented against this store's own shape rather than imported
 * (`./types.ts`'s module doc already rules out importing retrieval's port;
 * the same reasoning applies to its cache engine).
 *
 * ===========================================================================
 * WHAT IS CACHED AND WHY
 * ===========================================================================
 * `matchExistingMisconception` (`./matcher.ts`) compares a NEW statement's
 * embedding against every active/fading record on the same concept, every
 * time an observation might match one of them. Those candidate records'
 * `statement` text does not change between calls — the same misconception
 * gets compared against again and again as she keeps making it — so
 * re-embedding every candidate on every observation would spend one Worker
 * call per comparison for text this store has already embedded. Keying on
 * the content hash of `statement` (`../ingestion/hash.js`'s `hashText`, the
 * same hash function `WorkerEmbeddingProvider` already uses) makes a repeat
 * comparison free, mirroring `EmbeddingCacheEngine`'s "only *changed* blocks
 * re-embed" argument exactly.
 *
 * The NEW statement being observed right now is deliberately never cached
 * here — it is fresh text on every call, by definition never a cache hit.
 * `./observe.ts` embeds it directly through the `MisconceptionEmbedder`,
 * outside this engine.
 *
 * ===========================================================================
 * SCALE, AND WHY THIS SKIPS RETRIEVAL'S QUANTISATION
 * ===========================================================================
 * `EmbeddingCacheEngine` quantises to int8 codes (`ol-l1qz`) because it
 * caches one entry per indexed corpus chunk — potentially thousands. This
 * cache holds one entry per DISTINCT misconception statement ever recorded
 * for one student — a count M1's own conservative threshold keeps small by
 * design (`matcher.ts`'s doc: distinct wrong answers are supposed to stay
 * distinct records, not accumulate unboundedly against one concept).
 * Full-precision storage costs at most a few KB at any scale this store is
 * designed for. Importing `../retrieval/quantise.ts` into this directory to
 * save a difference that small would be a real, live coupling for no
 * measured benefit, so this cache persists `EmbeddingVector` (full
 * precision) directly rather than quantised codes — a deliberate departure
 * from the retrieval cache's shape, flagged here rather than silently
 * copied.
 *
 * ===========================================================================
 * MODEL AND VERSION INVALIDATION
 * ===========================================================================
 * Identical rule to `EmbeddingCacheEngine.create`: a persisted cache computed
 * under a different model, or written at a different schema version, is
 * treated as nothing persisted at all — D-006's "safely deletable and
 * rebuildable" property, never a migration.
 */

import { hashText } from '../ingestion/hash.js';
import type { MisconceptionMatchCandidate } from './matcher.js';
import type { EmbeddingVector, MisconceptionEmbedder, MisconceptionRecord } from './types.js';

/** Schema version this build writes and is willing to read. See the module doc's "MODEL AND VERSION INVALIDATION" section. */
export const MISCONCEPTION_EMBEDDING_CACHE_VERSION = 1 as const;

export interface CachedMisconceptionEmbeddingEntry {
  readonly contentHash: string;
  /** Full precision — see the module doc for why this cache does not quantise. */
  readonly vector: EmbeddingVector;
}

/** The whole persisted cache — the unit `MisconceptionEmbeddingCacheStore.save`/`load` moves. */
export interface PersistedMisconceptionEmbeddingCache {
  readonly version: 1;
  readonly model: string;
  readonly entries: readonly CachedMisconceptionEmbeddingEntry[];
}

/** An empty cache at the current version for a given model — what a fresh install, a deleted cache, or a model swap starts from. */
export function emptyMisconceptionEmbeddingCache(
  model: string,
): PersistedMisconceptionEmbeddingCache {
  return { version: MISCONCEPTION_EMBEDDING_CACHE_VERSION, model, entries: [] };
}

/**
 * The persistence port. Implemented in `packages/plugin` over Obsidian's
 * `loadData`/`saveData`, exactly the pattern `EmbeddingCacheStore`
 * establishes for the retrieval cache. `load` returning `null` means
 * "nothing persisted yet", not an empty cache.
 */
export interface MisconceptionEmbeddingCacheStore {
  load(): Promise<PersistedMisconceptionEmbeddingCache | null>;
  save(cache: PersistedMisconceptionEmbeddingCache): Promise<void>;
}

export interface MisconceptionEmbeddingCacheEngineDeps {
  readonly store: MisconceptionEmbeddingCacheStore;
  readonly embedder: MisconceptionEmbedder;
  /** The pinned embedding model id — see `./embedder.ts`'s doc for why `olea-core` takes this as a dependency rather than a constant. */
  readonly model: string;
}

function isUsable(persisted: PersistedMisconceptionEmbeddingCache | null, model: string): boolean {
  if (persisted === null) return false;
  const version = (persisted as { readonly version: number }).version;
  if (version !== MISCONCEPTION_EMBEDDING_CACHE_VERSION) return false;
  return persisted.model === model;
}

export class MisconceptionEmbeddingCacheEngine {
  private readonly store: MisconceptionEmbeddingCacheStore;
  private readonly embedder: MisconceptionEmbedder;
  private readonly model: string;
  private entries: Map<string, EmbeddingVector>;

  private constructor(
    deps: MisconceptionEmbeddingCacheEngineDeps,
    entries: Map<string, EmbeddingVector>,
  ) {
    this.store = deps.store;
    this.embedder = deps.embedder;
    this.model = deps.model;
    this.entries = entries;
  }

  /**
   * Loads whatever `store.load()` returns. `null` (nothing persisted), a
   * cache computed under a different model, and one written at a different
   * schema version are all treated as "start from zero" — see the module
   * doc for why none of the three can be partially trusted.
   */
  static async create(
    deps: MisconceptionEmbeddingCacheEngineDeps,
  ): Promise<MisconceptionEmbeddingCacheEngine> {
    const persisted = await deps.store.load();
    const usable = isUsable(persisted, deps.model) ? persisted : null;
    const entries = new Map<string, EmbeddingVector>();
    for (const entry of usable?.entries ?? []) {
      entries.set(entry.contentHash, entry.vector);
    }
    return new MisconceptionEmbeddingCacheEngine(deps, entries);
  }

  get modelId(): string {
    return this.model;
  }

  /** Every cached entry's vector, keyed by content hash. */
  snapshot(): ReadonlyMap<string, EmbeddingVector> {
    return new Map(this.entries);
  }

  /**
   * Ensures every record's `statement` has a cached embedding, computing
   * only the missing ones (see the module doc) and persisting the merged
   * result once. Two records sharing identical statement text are embedded
   * once, not once per record — the same "content hash, not identity"
   * discipline `EmbeddingCacheEngine.ensureEmbeddings` documents.
   *
   * Never throws on an embedder failure: it returns whatever was already
   * cached plus whatever progress it made before the failure, mirroring
   * `EmbeddingCacheEngine`'s own "partial progress is the honest failure
   * mode" argument — a caller with a down Worker still gets to run M1
   * against whichever candidates already had cached vectors, degrading to
   * "match fewer things" (the conservative direction M1 already prefers)
   * rather than throwing out of whatever is recording the observation.
   */
  async ensureEmbeddings(
    records: readonly MisconceptionRecord[],
  ): Promise<ReadonlyMap<string, EmbeddingVector>> {
    const hashes = await Promise.all(records.map((record) => hashText(record.statement)));
    const textByHash = new Map<string, string>();
    const missing: string[] = [];
    const seen = new Set<string>();
    records.forEach((record, index) => {
      const hash = hashes[index] ?? '';
      if (!textByHash.has(hash)) textByHash.set(hash, record.statement);
      if (seen.has(hash) || this.entries.has(hash)) return;
      seen.add(hash);
      missing.push(hash);
    });

    if (missing.length > 0) {
      const texts = missing.map((hash) => textByHash.get(hash) ?? '');
      try {
        const vectors = await this.embedder.embed(texts);
        let changed = false;
        missing.forEach((hash, index) => {
          const vector = vectors[index];
          if (vector) {
            this.entries.set(hash, vector);
            changed = true;
          }
        });
        if (changed) await this.persist();
      } catch {
        // Honest degradation — see method doc.
      }
    }

    return this.snapshot();
  }

  /**
   * `ensureEmbeddings` plus the mapping into `matcher.ts`'s candidate shape
   * — what a real caller actually wants (`./observe.ts`). A record whose
   * embedding could not be resolved (embedder failure, or a batch that
   * failed before reaching it) is simply omitted from the result rather
   * than represented with a placeholder vector — omitting a candidate can
   * only make M1 match less, never fabricate a match.
   */
  async candidatesFor(
    records: readonly MisconceptionRecord[],
  ): Promise<readonly MisconceptionMatchCandidate[]> {
    const vectorsByHash = await this.ensureEmbeddings(records);
    const candidates: MisconceptionMatchCandidate[] = [];
    for (const record of records) {
      const hash = await hashText(record.statement);
      const vector = vectorsByHash.get(hash);
      if (vector) candidates.push({ id: record.id, embedding: vector });
    }
    return candidates;
  }

  /** Delete the whole cache. Always safe — the next `ensureEmbeddings`/`candidatesFor` call reconstructs whatever it's asked for. */
  async clear(): Promise<void> {
    this.entries = new Map();
    await this.persist();
  }

  toPersisted(): PersistedMisconceptionEmbeddingCache {
    const entries: CachedMisconceptionEmbeddingEntry[] = [...this.entries.entries()]
      .map(([contentHash, vector]) => ({ contentHash, vector }))
      .sort((a, b) => (a.contentHash < b.contentHash ? -1 : a.contentHash > b.contentHash ? 1 : 0));
    return { version: MISCONCEPTION_EMBEDDING_CACHE_VERSION, model: this.model, entries };
  }

  private async persist(): Promise<void> {
    await this.store.save(this.toPersisted());
  }
}
