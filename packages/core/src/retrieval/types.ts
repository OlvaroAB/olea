/**
 * Retrieval's domain and port types (C2.3, C2.5, C4.7, D-004, D-006, P3-T05).
 *
 * **This directory builds on the keyword index, it does not duplicate it**
 * (`../keyword-index/`, P2-T01). A `RetrievalChunk` is derived directly from
 * an already-built `PersistedKeywordIndex`'s blocks (`chunks.ts`) — the same
 * block granularity C2.2's keyword search already uses, so a hit from either
 * half of the hybrid (`hybrid.ts`) points at the same source location.
 *
 * **Vectors are content-hash-keyed, local-only (D-004).** `EmbeddingCacheStore`
 * mirrors `KeywordIndexStore`'s shape exactly: a narrow load/save port over a
 * plain-JSON persisted value, implemented by the plugin over Obsidian's
 * `loadData`/`saveData` under its own top-level key, living in the plugin
 * data folder and never the vault (D-006). Only *changed* blocks re-embed
 * (C2.3) — `EmbeddingCacheEngine` (`embeddingCache.ts`) is what makes that
 * true, by keying every cache entry on the block's own content hash rather
 * than its position or document.
 *
 * **What is stored is not the vector (`ol-l1qz`, F2.13).** The client keeps
 * the chunk identifier and an int8 direction code per dimension — enough to
 * rank by cosine and nothing else — never the provider's full-precision
 * floats. `quantise.ts` argues that trade and `quantise.accuracy.spec.ts`
 * measures what it costs. D-004 is untouched by this: retrieval still runs
 * on-device against local data, it just stops paying 19.5 KB a chunk for the
 * privilege.
 *
 * **The Worker is a calculator (C6, D-004).** `EmbeddingProvider` is the one
 * seam this package has onto "compute embeddings for this text" — it says
 * nothing about HTTP, task ids, or the Worker's envelope. A production
 * implementation (in `packages/plugin`, outside this package's scope) calls
 * the Worker's `retrieval.embed.v1` task; tests inject a fake. Same shape and
 * same reasoning for `RerankProvider`, Slot E's optional second stage.
 */

import type { BlockKind } from '../block/types.js';
import type { VaultPath } from '../vault/types.js';

/**
 * A dense embedding vector as an `EmbeddingProvider` returns it: full
 * precision, transient. This is what a *query* is embedded to, and what the
 * provider hands back for a document chunk — it is **not** what the cache
 * persists. See `quantise.ts` and `CachedEmbeddingEntry` for why (`ol-l1qz`).
 */
export type EmbeddingVector = readonly number[];

/**
 * Anything retrieval can run cosine over: a full-precision `EmbeddingVector`
 * straight off the provider, or the `Int8Array` of quantised codes the cache
 * holds (`quantise.ts`). `cosine.ts` and `hybrid.ts` are written against this
 * rather than against `EmbeddingVector` precisely because the two sides of
 * every comparison are now deliberately different representations — a
 * full-precision query against quantised documents (asymmetric quantisation).
 */
export type VectorLike = ArrayLike<number>;

/**
 * One retrievable unit: a single indexed block, carried with enough to cite
 * it (C2.5's "returning source location") and enough to key its embedding
 * (C2.3's per-block content hash). Deliberately the same block granularity
 * `IndexedBlock` already uses — see `chunks.ts`.
 */
export interface RetrievalChunk {
  readonly path: VaultPath;
  readonly blockIndex: number;
  readonly kind: BlockKind;
  readonly text: string;
  /** SHA-256 of `text`, hex-encoded (`../ingestion/hash.ts`'s `hashText`) — the embedding cache key (C2.3, D-004). */
  readonly contentHash: string;
}

/**
 * One cached embedding, keyed by the content hash of the chunk it was
 * computed from.
 *
 * **`codes`, not `vector` — the full-precision floats are never persisted**
 * (`ol-l1qz`, F2.13). What is stored is base64 of the vector's int8 direction
 * codes: ~1.37 KB instead of ~19.5 KB, because the only thing any caller ever
 * does with a cached embedding is take its cosine against a query, and cosine
 * needs the direction, not the magnitudes. `quantise.ts` carries the full
 * argument and `quantise.accuracy.spec.ts` carries the measured cost.
 */
export interface CachedEmbeddingEntry {
  readonly contentHash: string;
  /** Base64 of the int8 quantised codes (`quantise.ts`). Lossy and cosine-only by design; not the provider's vector and not reconstructible into it. */
  readonly codes: string;
}

/**
 * The whole persisted embedding cache — the unit `EmbeddingCacheStore.save`/
 * `load` moves, in the same shape as `PersistedKeywordIndex`
 * (`../keyword-index/types.ts`).
 *
 * `model` records which Slot E model + version produced every vector here
 * (the pinned choice — see the P3-T05 decision bead). The cost model's Slot E
 * criteria make swapping that model a full re-index: `EmbeddingCacheEngine`
 * treats a cache whose `model` disagrees with the currently configured model
 * as fully stale rather than trying to mix vector spaces, which would silently
 * corrupt every cosine comparison (the brute-force scan D-004 chose assumes
 * every vector in the set was produced by the same model).
 *
 * `entries` is always kept in ascending-contentHash order by every producer
 * here, mirroring `PersistedKeywordIndex.documents`'s ascending-path
 * convention — deterministic output, meaningful equality in tests.
 */
export interface PersistedEmbeddingCache {
  /**
   * Schema version tag — bump on any shape change.
   *
   * **2** since `ol-l1qz`: entries carry `codes` (base64 int8) where version 1
   * carried `vector` (a JSON number array). `EmbeddingCacheEngine.create`
   * treats any version but the current one exactly as it treats a model
   * mismatch — start from zero — so there is no migration to write and none
   * to get wrong. That is D-006's "safely deletable and rebuildable" property
   * doing the work a migration would otherwise have to.
   */
  readonly version: 2;
  /** The Slot E model id these vectors were computed with (e.g. `@cf/baai/bge-m3`). */
  readonly model: string;
  readonly entries: readonly CachedEmbeddingEntry[];
}

/** The `PersistedEmbeddingCache.version` this build writes and is willing to read. Anything else on disk is treated as absent (see the field's doc). */
export const EMBEDDING_CACHE_VERSION = 2 as const;

/** An empty cache at the current version for a given model — what a fresh install, a deleted cache, a model swap, or a version bump starts from. */
export function emptyEmbeddingCache(model: string): PersistedEmbeddingCache {
  return { version: EMBEDDING_CACHE_VERSION, model, entries: [] };
}

/**
 * The persistence port (D-004, D-006). Core depends only on this; the plugin
 * implements it over Obsidian's `loadData`/`saveData`, exactly the pattern
 * `KeywordIndexStore` already establishes. `load` returning `null` means
 * "nothing persisted yet", not an empty cache — `EmbeddingCacheEngine` treats
 * both as starting from zero entries, but the distinction is real for an
 * implementation to preserve.
 */
export interface EmbeddingCacheStore {
  load(): Promise<PersistedEmbeddingCache | null>;
  save(cache: PersistedEmbeddingCache): Promise<void>;
}

export interface EmbedRequest {
  readonly model: string;
  readonly texts: readonly string[];
}

export interface EmbedResult {
  /** One vector per input text, same order as `EmbedRequest.texts`. */
  readonly vectors: readonly EmbeddingVector[];
}

/**
 * The seam onto "compute embeddings for this text" (W1, Slot E). Nothing in
 * this package calls the network directly (C4.1: core → Worker → AI Gateway
 * → Workers AI) — a production `EmbeddingProvider` lives in `packages/plugin`
 * and calls the Worker's `retrieval.embed.v1` task; every test in this
 * directory injects a fake. This is also the only place a model swap is felt:
 * change the `model` a caller passes, and `EmbeddingCacheEngine` invalidates
 * the old vectors on its own (see `PersistedEmbeddingCache.model` above).
 */
export interface EmbeddingProvider {
  embed(request: EmbedRequest): Promise<EmbedResult>;
}

export interface RerankCandidate {
  readonly id: string;
  readonly text: string;
}

export interface RerankedCandidate {
  readonly id: string;
  readonly score: number;
}

export interface RerankRequest {
  readonly query: string;
  readonly candidates: readonly RerankCandidate[];
}

export interface RerankResult {
  readonly scores: readonly RerankedCandidate[];
}

/**
 * Slot E's optional second stage (C2.5 "reranked"). Genuinely optional:
 * `hybridRetrieve` (`hybrid.ts`) runs keyword+cosine fusion with or without
 * one, and omitting it is a valid, tested configuration — DF-16 blocks a real
 * reranker call today, and the fusion stage alone already produces a
 * deterministic, source-cited ranking.
 */
export interface RerankProvider {
  rerank(request: RerankRequest): Promise<RerankResult>;
}
