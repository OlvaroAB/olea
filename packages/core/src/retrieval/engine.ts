/**
 * `retrieve` — the one call a generative task makes to go from a query to
 * grounded context or a refusal (C2.5, C4.7, INV-5, P3-T05).
 *
 * Composes the rest of this directory in order: derive chunks from the
 * current keyword index (`chunks.ts`) → keyword search (already built,
 * `../keyword-index/query.ts`) → ensure every chunk has a cached embedding
 * (`embeddingCache.ts`) → embed the query itself → fuse keyword + cosine,
 * with an optional rerank (`hybrid.ts`) → assemble transient top-k context or
 * refuse (`groundedContext.ts`). Nothing here persists anything beyond the
 * embedding cache's own content-hash-keyed entries (D-004); the returned
 * chunk text exists only in the caller's memory for the duration of one
 * generative call (plan §7.1).
 *
 * **The two sides of the semantic comparison are different representations
 * (`ol-l1qz`).** `embedQuery` gets a full-precision vector from the provider
 * and it is never persisted; `embeddingCache.snapshot()` returns int8
 * quantised codes, which is all the cache has ever held since the ruling on
 * `ol-l1qz`. `hybridRetrieve` fuses the two without caring, because cosine
 * does not care. See `quantise.ts` for the argument and
 * `quantise.accuracy.spec.ts` for what it measured.
 *
 * **Degrades to keyword-only rather than throwing.** A query embedding
 * failure (offline, provider error) does not fail `retrieve` — it proceeds
 * with `queryVector: null`, so `hybridRetrieve` fuses keyword hits alone.
 * The alternative — throwing and forcing every caller to add its own
 * try/catch before it can even ask "did retrieval find anything" — would
 * make the refusal path (the one INV-5 cares about) reachable by two
 * different mechanisms, an exception and a `GroundingResult`, which is
 * exactly the kind of seam a caller forgets to handle on one of the two
 * paths. One return type, always.
 */

import { searchKeywordIndex } from '../keyword-index/query.js';
import type { PersistedKeywordIndex } from '../keyword-index/types.js';
import { chunksFromIndex } from './chunks.js';
import type { CompositeGroundingThresholds } from './compositeSignals.js';
import { computeCompositeGroundingSignals } from './compositeSignals.js';
import type { EmbeddingCacheEngine } from './embeddingCache.js';
import { assembleGroundedContext, type GroundingResult } from './groundedContext.js';
import { hybridRetrieve } from './hybrid.js';
import type { EmbeddingProvider, EmbeddingVector, RerankProvider } from './types.js';

export interface RetrieveDeps {
  readonly keywordIndex: PersistedKeywordIndex;
  readonly embeddingCache: EmbeddingCacheEngine;
  readonly embeddingProvider: EmbeddingProvider;
}

export interface RetrieveOptions {
  readonly topK?: number;
  readonly minCosineScore?: number;
  readonly rerank?: RerankProvider;
  /**
   * Forwarded to `assembleGroundedContext` (`ol-azo7`). Defaults to `false` —
   * see that option's own doc for why turning this on is a separate,
   * David-only ratification, not implied by it existing. When `true`, this
   * function computes `CompositeGroundingSignals` (`compositeSignals.ts`)
   * itself, since it is the layer that already holds `chunks` and
   * `embeddings` — `assembleGroundedContext` never does. Left uncomputed
   * (and the extra corpus-wide cosine/lexicon pass skipped entirely) when
   * this is not set.
   */
  readonly requireComposite?: boolean;
  readonly compositeThresholds?: CompositeGroundingThresholds;
}

/**
 * Retrieves grounded context for `query` against `deps.keywordIndex`, or an
 * explicit refusal — the single function any generative task built on
 * retrieval (P3-T07a, P3-T08, P4-T02, P4-T04) is meant to call before
 * building a prompt.
 */
export async function retrieve(
  deps: RetrieveDeps,
  query: string,
  options: RetrieveOptions = {},
): Promise<GroundingResult> {
  const chunks = await chunksFromIndex(deps.keywordIndex);
  const keywordHits = searchKeywordIndex(deps.keywordIndex, query);

  // Best-effort: fills in whatever embeddings are missing, but never blocks
  // or fails retrieval if the provider is unreachable (see module doc).
  await deps.embeddingCache.ensureEmbeddings(chunks).catch(() => undefined);
  const embeddings = deps.embeddingCache.snapshot();

  const queryVector = await embedQuery(deps.embeddingProvider, deps.embeddingCache.modelId, query);

  const hits = await hybridRetrieve({
    query,
    chunks,
    keywordHits,
    queryVector,
    embeddings,
    options: {
      ...(options.rerank !== undefined ? { rerank: options.rerank } : {}),
    },
  });

  const compositeSignals = options.requireComposite
    ? computeCompositeGroundingSignals({ query, chunks, queryVector, embeddings })
    : undefined;

  return assembleGroundedContext(hits, {
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.minCosineScore !== undefined ? { minCosineScore: options.minCosineScore } : {}),
    ...(options.requireComposite !== undefined
      ? { requireComposite: options.requireComposite }
      : {}),
    ...(options.compositeThresholds !== undefined
      ? { compositeThresholds: options.compositeThresholds }
      : {}),
    ...(compositeSignals !== undefined ? { compositeSignals } : {}),
  });
}

async function embedQuery(
  provider: EmbeddingProvider,
  model: string,
  query: string,
): Promise<EmbeddingVector | null> {
  if (query.trim() === '') return null;
  try {
    const result = await provider.embed({ model, texts: [query] });
    return result.vectors[0] ?? null;
  } catch {
    return null;
  }
}
