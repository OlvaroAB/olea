/**
 * `EmbeddingCacheEngine` — the stateful glue over the embedding cache
 * (C2.3, D-004, D-006, P3-T05), in the same shape as `KeywordIndexEngine`
 * (`../keyword-index/engine.ts`): a `create` that loads persisted state, a
 * mutating method that persists through the injected store after every
 * change, and no direct filesystem or Obsidian access anywhere (INV-1) —
 * everything goes through the injected `EmbeddingCacheStore` and
 * `EmbeddingProvider` ports.
 *
 * **Why regeneration is keyed on content hash, not "is this chunk in the
 * cache at all."** C2.3 exists specifically so that editing one paragraph of
 * a 40-page reading doesn't re-embed the other 39 pages ("regeneration costs
 * money"). `ensureEmbeddings` computes the *missing* set purely from content
 * hashes already present in the persisted cache — a chunk whose text hasn't
 * changed since it was last embedded is never re-sent to the provider, no
 * matter how many times `ensureEmbeddings` is called for it.
 *
 * **Why a model mismatch invalidates the whole cache.** The cost model's
 * Slot E note requires the index to be rebuilt in full whenever the embedding
 * model changes (`../../../../olea-service/docs/Olea_ai_workload_and_cost_model.md`).
 * Two vectors from different models are not comparable — cosine similarity
 * between them is meaningless, not just less accurate — so mixing them
 * would silently corrupt every ranking downstream. `create` treats a
 * persisted cache whose `model` disagrees with `deps.model` as if nothing
 * were persisted at all, which is the same "safely deletable and
 * rebuildable" property D-006 already gives the keyword index.
 *
 * **Why the cache holds int8 codes and not vectors (`ol-l1qz`, F2.13).** The
 * provider returns full-precision 1024-dimension floats; this engine
 * quantises each one on arrival (`quantise.ts`) and neither persists nor
 * retains the original. Every read path out of here — `snapshot`, `codesFor`
 * — leads to exactly one operation: `cosineSimilarity` against a fresh query
 * vector. Cosine needs a direction, not magnitudes, so the full-precision
 * floats were never the thing the client actually needed. The saving is not
 * marginal — ~19.5 KB down to ~1.37 KB per entry on disk, and ~8 KB down to
 * 1 KB per entry in heap — which is the difference between a cache a phone
 * can hold and one it cannot. The measured accuracy cost is in
 * `quantise.accuracy.spec.ts`.
 *
 * **Why the same "start from zero" rule now covers the schema version.** A
 * cache written by an older build carries `vector` number arrays this build
 * cannot read. Rather than a migration, `create` treats a version mismatch
 * exactly as it treats a model mismatch: D-006 makes a discarded cache cost
 * re-embedding and nothing else, and a one-shot migration that has to run
 * correctly on every user's machine is a strictly worse thing to own than a
 * rebuild that is already a supported, tested path.
 */

import {
  decodeQuantisedVector,
  encodeQuantisedVector,
  type QuantisedVector,
  quantiseVector,
} from './quantise.js';
import type {
  CachedEmbeddingEntry,
  EmbeddingCacheStore,
  EmbeddingProvider,
  PersistedEmbeddingCache,
  RetrievalChunk,
} from './types.js';
import { EMBEDDING_CACHE_VERSION, emptyEmbeddingCache } from './types.js';

export interface EmbeddingCacheEngineDeps {
  readonly store: EmbeddingCacheStore;
  readonly provider: EmbeddingProvider;
  /** The pinned Slot E model id (see the P3-T05 decision bead). */
  readonly model: string;
  /** How many missing chunks to send the provider per `embed` call. Defaults to 32 — small enough to stay a background-friendly unit of work (C2.6), large enough that a large backlog doesn't become one round trip per chunk. */
  readonly batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 32;

/**
 * `true` when a persisted value can be read by this build: it exists, it was
 * written at the current schema version, and it was computed with the model
 * we are about to compare against. Anything else is treated as nothing
 * persisted — see the module doc for why both mismatches get the same
 * treatment.
 *
 * The `version` cast is deliberate. The field is typed as the literal
 * `EMBEDDING_CACHE_VERSION`, but this value came off disk as untyped JSON
 * through a port that promises a shape it cannot enforce; an older tree's
 * version-1 cache satisfies no type here at all. The comparison has to happen
 * at runtime whatever the declaration says.
 */
function isUsable(persisted: PersistedEmbeddingCache | null, model: string): boolean {
  if (persisted === null) return false;
  const version = (persisted as { readonly version: number }).version;
  if (version !== EMBEDDING_CACHE_VERSION) return false;
  return persisted.model === model;
}

export class EmbeddingCacheEngine {
  private readonly store: EmbeddingCacheStore;
  private readonly provider: EmbeddingProvider;
  private readonly model: string;
  private readonly batchSize: number;
  private entries: Map<string, QuantisedVector>;

  private constructor(deps: EmbeddingCacheEngineDeps, entries: Map<string, QuantisedVector>) {
    this.store = deps.store;
    this.provider = deps.provider;
    this.model = deps.model;
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
    this.entries = entries;
  }

  /**
   * Loads whatever `store.load()` returns. `null` (nothing persisted — a
   * fresh install, or the cache having just been deleted per D-006), a
   * persisted cache computed under a *different* model, and one written at a
   * different schema version are all treated as "start from zero" — see the
   * module doc for why none of the three can be partially trusted.
   *
   * An individual entry whose `codes` do not decode is dropped rather than
   * failing the load. That chunk simply re-embeds on the next
   * `ensureEmbeddings`, which is the cheapest possible response to one
   * corrupt row and keeps a single bad byte from costing a whole re-index.
   */
  static async create(deps: EmbeddingCacheEngineDeps): Promise<EmbeddingCacheEngine> {
    const persisted = await deps.store.load();
    const usable = isUsable(persisted, deps.model) ? persisted : null;
    const entries = new Map<string, QuantisedVector>();
    for (const entry of usable?.entries ?? []) {
      const codes = decodeQuantisedVector(entry.codes);
      if (codes !== null) entries.set(entry.contentHash, codes);
    }
    return new EmbeddingCacheEngine(deps, entries);
  }

  /** The pinned Slot E model id this cache is keyed against — what `engine.ts`'s `retrieve` passes when embedding the query itself, so the query vector and the cached document codes are always comparable. */
  get modelId(): string {
    return this.model;
  }

  /**
   * The quantised codes cached for one content hash, if any.
   *
   * Named `codesFor` rather than `vectorFor` on purpose: this is not the
   * vector the provider returned and cannot be turned back into it
   * (`quantise.ts`). It is usable for cosine ranking and for nothing else.
   */
  codesFor(contentHash: string): QuantisedVector | undefined {
    return this.entries.get(contentHash);
  }

  /** Every cached entry's codes, keyed by content hash — the candidate set `cosine.ts`'s brute-force search runs over (D-004). */
  snapshot(): ReadonlyMap<string, QuantisedVector> {
    return new Map(this.entries);
  }

  /**
   * Ensures every chunk in `chunks` has a cached embedding, computing only the
   * ones missing (see the module doc) and persisting the merged result once.
   * Chunks that share a content hash (identical text in two places — the
   * common case being a duplicated heading or boilerplate line) are embedded
   * once, not once per occurrence.
   *
   * The provider's full-precision vectors are quantised on arrival and the
   * originals are dropped on the spot — they are never held in this engine's
   * state, never written through the store, and never handed to a caller.
   *
   * Never throws on a provider failure: it returns whatever it managed to
   * add before the failure occurred, cache already updated with the partial
   * progress. Retrieval degrading to whatever is cached (keyword-only, in the
   * worst case) is the honest failure mode here, not a thrown exception that
   * would take down a caller who has no other reason to fail — see
   * `engine.ts`'s `retrieve`, which is exactly that caller.
   */
  async ensureEmbeddings(
    chunks: readonly RetrievalChunk[],
  ): Promise<ReadonlyMap<string, QuantisedVector>> {
    const missingHashes: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      if (seen.has(chunk.contentHash) || this.entries.has(chunk.contentHash)) continue;
      seen.add(chunk.contentHash);
      missingHashes.push(chunk.contentHash);
    }
    if (missingHashes.length === 0) return this.snapshot();

    const textByHash = new Map<string, string>();
    for (const chunk of chunks) {
      if (!textByHash.has(chunk.contentHash)) textByHash.set(chunk.contentHash, chunk.text);
    }

    let changed = false;
    for (let i = 0; i < missingHashes.length; i += this.batchSize) {
      const batch = missingHashes.slice(i, i + this.batchSize);
      const texts = batch.map((hash) => textByHash.get(hash) ?? '');
      try {
        const result = await this.provider.embed({ model: this.model, texts });
        batch.forEach((hash, index) => {
          const vector = result.vectors[index];
          if (vector) {
            this.entries.set(hash, quantiseVector(vector));
            changed = true;
          }
        });
      } catch {
        // Partial progress is kept (see the module doc); stop trying further
        // batches this call — a still-down provider would only fail
        // identically on the next batch.
        break;
      }
    }

    if (changed) await this.persist();
    return this.snapshot();
  }

  /** D-006: delete the whole cache. Always safe — the next `ensureEmbeddings` call reconstructs whatever it's asked for. */
  async clear(): Promise<void> {
    this.entries = new Map();
    await this.persist();
  }

  toPersisted(): PersistedEmbeddingCache {
    const entries: CachedEmbeddingEntry[] = [...this.entries.entries()]
      .map(([contentHash, codes]) => ({ contentHash, codes: encodeQuantisedVector(codes) }))
      .sort((a, b) => (a.contentHash < b.contentHash ? -1 : a.contentHash > b.contentHash ? 1 : 0));
    return { version: EMBEDDING_CACHE_VERSION, model: this.model, entries };
  }

  private async persist(): Promise<void> {
    await this.store.save(this.toPersisted());
  }
}

/** Re-exported for callers that want an empty cache shape without constructing an engine (e.g. tests). */
export { emptyEmbeddingCache };
