/**
 * Brute-force cosine similarity (C2.3, D-004, P3-T05).
 *
 * D-004 settles the approach: cosine similarity computed by brute force over
 * the few thousand chunks at this scale, which costs milliseconds. No ANN
 * index, no
 * approximate search — a full scan over every cached vector, same
 * restraint D-003 already applies to the keyword index's plain in-memory
 * scan (`../keyword-index/query.ts`). Revisit only if real scale proves this
 * too slow, exactly as D-004/D-003 say.
 *
 * **Both sides are `VectorLike`, not `EmbeddingVector`, and that is the
 * point.** Since `ol-l1qz` the two sides of every comparison are deliberately
 * different representations: a full-precision query vector fresh from the
 * provider against `Int8Array` quantised codes out of the cache
 * (`quantise.ts`). Cosine is scale-invariant, so the quantiser's discarded
 * per-vector scale changes nothing here, and comparing an exact query against
 * approximate documents loses less than quantising both would.
 */

import type { VectorLike } from './types.js';

export interface CosineHit {
  readonly contentHash: string;
  readonly score: number;
}

/**
 * Cosine similarity in [-1, 1] (1 = identical direction). Returns 0 for a
 * zero-length vector on either side (undefined mathematically; treated as
 * "no signal" rather than thrown) and for a dimension mismatch (a caller
 * comparing vectors from two different models — `embeddingCache.ts`'s
 * model-invalidation is what's supposed to make that impossible in
 * practice, so this is a defensive floor, not the primary guard).
 */
export function cosineSimilarity(a: VectorLike, b: VectorLike): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Every candidate's cosine similarity to `query`, highest first. Ties break
 * by content hash ascending, so results are deterministic for a given
 * candidate set — the same reason `../keyword-index/query.ts`'s
 * `searchKeywordIndex` breaks ties explicitly rather than leaving sort order
 * to chance.
 */
export function topKByCosine(
  query: VectorLike,
  candidates: ReadonlyMap<string, VectorLike>,
  k?: number,
): readonly CosineHit[] {
  const hits: CosineHit[] = [];
  for (const [contentHash, vector] of candidates) {
    hits.push({ contentHash, score: cosineSimilarity(query, vector) });
  }
  hits.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.contentHash < b.contentHash ? -1 : a.contentHash > b.contentHash ? 1 : 0;
  });
  return k !== undefined ? hits.slice(0, k) : hits;
}

/**
 * `olea-service/scripts/harness/grounding-eval.mjs`'s own quantile function
 * `q(p)`, ported exactly (`ol-azo7`): given `scoresAscending` sorted lowest
 * first, floor-index into it. `topKByCosine`'s own tie-break (by content
 * hash) can leave equal-valued scores in a different physical order than the
 * harness's plain numeric sort does, but that never changes the VALUE this
 * returns — ties are, by definition, equal at every index they occupy.
 *
 * Returns 0 for an empty input, matching no real corpus (guards a caller
 * that fails to special-case "nothing embedded" itself, same defensive
 * floor as `cosineSimilarity`'s own zero-vector case).
 */
export function cosinePercentile(scoresAscending: readonly number[], p: number): number {
  const n = scoresAscending.length;
  if (n === 0) return 0;
  const index = Math.min(n - 1, Math.floor(p * n));
  return scoresAscending[index] ?? 0;
}
