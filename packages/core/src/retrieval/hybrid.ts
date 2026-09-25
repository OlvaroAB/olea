/**
 * Hybrid keyword + cosine retrieval, with a rerank option (C2.5, P3-T05).
 *
 * Fuses two independently-ranked lists — `../keyword-index/query.ts`'s
 * keyword hits and `cosine.ts`'s semantic hits — into one ranked list via
 * Reciprocal Rank Fusion (RRF): `score(x) = Σ 1 / (K + rank_in_list(x))`
 * summed over every list `x` appears in. RRF is the standard, deterministic
 * way to combine two differently-scaled rankings (keyword match counts and
 * cosine similarities live on unrelated scales, so summing or averaging the
 * raw scores would let whichever list happens to have bigger numbers
 * dominate) without needing a model call — everything up to and including
 * fusion runs on plain arithmetic over already-computed scores, with zero
 * inference calls of its own.
 *
 * Reranking (Slot E's optional second stage) is a genuinely separate,
 * optional pass: if a `RerankProvider` is supplied, it scores the fused
 * top candidates directly against the query and that score wins; if not,
 * the fused RRF score stands. Both are tested configurations — see
 * `hybrid.spec.ts`.
 *
 * **Every `HybridHit` also carries `semantic` (`[ILB-EVD-4]`).** `engine.ts`'s
 * `embedQuery` swallows an offline provider, a provider error, or an empty
 * query into `queryVector: null` rather than throwing, so `retrieve()`
 * degrades to keyword-only silently from a caller's point of view — see that
 * function's doc. `semantic` is this function's additive answer: `'used'`
 * when `params.queryVector` was actually available to fuse against, else
 * `'unavailable'`. It changes no ranking and no other field.
 *
 * **Every `HybridHit` also carries `rerankFailed` (`[ILB-EVD-4]`,
 * `docs/dev/intelligence-build/evd.md` §2).** Target: "a failed rerank call
 * keeps the fused list's prior order and records the failure; it never
 * blocks the request the way a failed judge call does." Before this field
 * existed, a thrown `options.rerank.rerank(...)` call propagated straight
 * past this function to its caller — the opposite of the target's "never
 * blocks the request." Now a throw is caught: the fused order (computed
 * before the rerank call, RRF-only) is returned unchanged and every hit in
 * that result carries `rerankFailed: true`; on success, or when no
 * `options.rerank` was supplied at all, every hit carries `rerankFailed:
 * false`. Same value on every hit in one result set, exactly like
 * `semantic` — a property of the call, not of any individual chunk.
 */

import type { SearchHit } from '../keyword-index/query.js';
import type { VaultPath } from '../vault/types.js';
import { topKByCosine } from './cosine.js';
import type { EmbeddingVector, RerankProvider, RetrievalChunk, VectorLike } from './types.js';

/**
 * RRF's rank-damping constant. 60 is the value the original RRF paper
 * (Cormack et al.) found robust across corpora and is the de-facto default
 * used wherever RRF appears — that much is public, citable literature, not
 * a private finding. The shipped value has additionally been characterized
 * against private evaluation data specific to this retrieval setup, so
 * treat it as derived rather than free to retune on the paper's authority
 * alone: change it only via a decision bead. The characterization itself —
 * what was tried, what it found — is private and does not ship.
 */
const RRF_K = 60;

/**
 * How many semantic candidates `hybridRetrieve` pulls before fusing,
 * independent of the final `limit`. Generous by construction — casting a
 * wide net before fusing costs only a few extra cosine comparisons, no
 * model call — but the value has also been characterized against private
 * evaluation data alongside `RRF_K`. Treat both as derived, not as free
 * knobs: change either only via a decision bead. The characterization
 * itself is private and does not ship.
 */
const SEMANTIC_CANDIDATE_POOL = 50;

export type MatchSource = 'keyword' | 'semantic' | 'rerank';

export interface HybridHit {
  readonly path: VaultPath;
  readonly blockIndex: number;
  readonly text: string;
  readonly contentHash: string;
  /** The fused ranking score — RRF, or the rerank score when a `RerankProvider` ran. Not comparable across calls with different inputs; only meaningful for ordering within one result set. */
  readonly score: number;
  /** Raw keyword match count from `searchKeywordIndex`, or `null` if this chunk had no keyword hit. */
  readonly keywordScore: number | null;
  /** Raw cosine similarity in [-1, 1], or `null` if no query vector was available or this chunk had no cached embedding. */
  readonly cosineScore: number | null;
  readonly matchedBy: readonly MatchSource[];
  /**
   * Whether the query embedding was actually available to fuse against this
   * hit — `'unavailable'` when `queryVector` was `null` for this whole call
   * (offline, an empty query, or `EmbeddingProvider` failure; `engine.ts`'s
   * `embedQuery` swallows every one of those into `null` rather than
   * throwing — see that function's doc), `'used'` otherwise. Same value on
   * every hit in one result set, since it is a property of the query, not of
   * any individual chunk; carried per-hit rather than on a wrapper object so
   * this stays additive — `hybridRetrieve`'s return type, ranking and every
   * other field are unchanged (`[ILB-EVD-4]`). Before this field existed, a
   * caller had no way to tell "keyword-only because nothing matched
   * semantically" apart from "keyword-only because the embedding call
   * degraded silently" (`ol-egov.141.89.1.4`).
   */
  readonly semantic: 'used' | 'unavailable';
  /** `true` only when `options.rerank` was supplied AND its call threw — see this file's doc. `false` when no rerank was requested, or when it was requested and succeeded (whether or not it returned a score for this particular hit). */
  readonly rerankFailed: boolean;
}

export interface HybridRetrievalOptions {
  /** Caps the final result count, after fusion and any rerank. Omit for no cap. */
  readonly limit?: number;
  /** Slot E's optional second stage. Omitted entirely is a valid, tested configuration (DF-16 blocks a real reranker call today). */
  readonly rerank?: RerankProvider;
}

export interface HybridRetrieveParams {
  /** The original query text — only used to call `options.rerank`, if supplied; fusion itself needs no query text, only the two already-ranked lists below. */
  readonly query: string;
  /** Every indexed chunk (`chunks.ts`), the join between a keyword hit's (path, blockIndex) and a cosine hit's contentHash. */
  readonly chunks: readonly RetrievalChunk[];
  readonly keywordHits: readonly SearchHit[];
  /** The query's own embedding, or `null` if none is available (offline, empty query, provider failure) — semantic scoring is skipped entirely in that case, not silently degraded to zero-vector comparisons. */
  readonly queryVector: EmbeddingVector | null;
  /** The cache's candidate set, keyed by content hash. Since `ol-l1qz` these are `Int8Array` quantised codes rather than full-precision vectors (`quantise.ts`); the type stays `VectorLike` so a caller holding either representation fits. */
  readonly embeddings: ReadonlyMap<string, VectorLike>;
  readonly options?: HybridRetrievalOptions;
}

function chunkKey(path: VaultPath, blockIndex: number): string {
  return `${path}\u0000${blockIndex}`;
}

/**
 * Fuses keyword and cosine hits over the same chunk set into one ranked,
 * source-cited list (C2.5). Never calls a model itself for the fusion stage;
 * `options.rerank`, if supplied, is the only model call this function makes.
 */
export async function hybridRetrieve(params: HybridRetrieveParams): Promise<readonly HybridHit[]> {
  const byPositionKey = new Map<string, RetrievalChunk>();
  const byContentHash = new Map<string, RetrievalChunk>();
  for (const chunk of params.chunks) {
    byPositionKey.set(chunkKey(chunk.path, chunk.blockIndex), chunk);
    if (!byContentHash.has(chunk.contentHash)) byContentHash.set(chunk.contentHash, chunk);
  }

  // Keyword ranks: 1-based position within `keywordHits`, which is already
  // sorted highest-score-first (`searchKeywordIndex`).
  const keywordRank = new Map<string, number>();
  const keywordScoreByKey = new Map<string, number>();
  params.keywordHits.forEach((hit, index) => {
    const key = chunkKey(hit.path, hit.blockIndex);
    keywordRank.set(key, index + 1);
    keywordScoreByKey.set(key, hit.score);
  });

  // Semantic ranks: cosine over every cached embedding, capped to a
  // generous candidate pool before fusion.
  const cosineRank = new Map<string, number>();
  const cosineScoreByHash = new Map<string, number>();
  if (params.queryVector) {
    const cosineHits = topKByCosine(params.queryVector, params.embeddings, SEMANTIC_CANDIDATE_POOL);
    cosineHits.forEach((hit, index) => {
      cosineRank.set(hit.contentHash, index + 1);
      cosineScoreByHash.set(hit.contentHash, hit.score);
    });
  }

  const candidateKeys = new Set<string>([...keywordRank.keys()]);
  for (const contentHash of cosineRank.keys()) {
    const chunk = byContentHash.get(contentHash);
    if (chunk) candidateKeys.add(chunkKey(chunk.path, chunk.blockIndex));
  }

  // A property of THIS query, not of any one chunk — `params.queryVector` is
  // either present for the whole call or absent for the whole call (see
  // `engine.ts`'s `embedQuery`), so every fused hit below carries the same
  // value. See `HybridHit.semantic`'s own doc for why this is additive.
  const semantic: HybridHit['semantic'] = params.queryVector ? 'used' : 'unavailable';

  const fused: HybridHit[] = [];
  for (const key of candidateKeys) {
    const chunk = byPositionKey.get(key);
    if (!chunk) continue;

    const kRank = keywordRank.get(key);
    const cRank = cosineRank.get(chunk.contentHash);
    const matchedBy: MatchSource[] = [];
    let score = 0;
    if (kRank !== undefined) {
      score += 1 / (RRF_K + kRank);
      matchedBy.push('keyword');
    }
    if (cRank !== undefined) {
      score += 1 / (RRF_K + cRank);
      matchedBy.push('semantic');
    }

    fused.push({
      path: chunk.path,
      blockIndex: chunk.blockIndex,
      text: chunk.text,
      contentHash: chunk.contentHash,
      score,
      keywordScore: keywordScoreByKey.get(key) ?? null,
      cosineScore: cosineScoreByHash.get(chunk.contentHash) ?? null,
      matchedBy,
      semantic,
      rerankFailed: false,
    });
  }

  fused.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.blockIndex - b.blockIndex;
  });

  const rerank = params.options?.rerank;
  if (!rerank || fused.length === 0) {
    return applyLimit(fused, params.options?.limit);
  }

  let reranked: Awaited<ReturnType<RerankProvider['rerank']>>;
  try {
    reranked = await rerank.rerank({
      query: params.query,
      candidates: fused.map((hit) => ({ id: chunkKey(hit.path, hit.blockIndex), text: hit.text })),
    });
  } catch {
    // Target (evd.md §2, [ILB-EVD-4]): a failed rerank call keeps the fused list's prior
    // order and records the failure; it never blocks the request the way a failed judge
    // call does. `fused` is already sorted in RRF order above — return it unchanged, with
    // the failure recorded on every hit, rather than throwing past this function's caller.
    return applyLimit(
      fused.map((hit) => ({ ...hit, rerankFailed: true })),
      params.options?.limit,
    );
  }

  const rerankScore = new Map(reranked.scores.map((s) => [s.id, s.score] as const));

  const withRerank = fused.map((hit) => {
    const key = chunkKey(hit.path, hit.blockIndex);
    const score = rerankScore.get(key);
    return score === undefined
      ? hit
      : { ...hit, score, matchedBy: [...hit.matchedBy, 'rerank' as const] };
  });
  withRerank.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.blockIndex - b.blockIndex;
  });

  return applyLimit(withRerank, params.options?.limit);
}

function applyLimit<T>(items: readonly T[], limit: number | undefined): readonly T[] {
  return limit !== undefined ? items.slice(0, limit) : items;
}
