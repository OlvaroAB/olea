/**
 * The composite grounding-refusal signals `assembleGroundedContext` cannot
 * compute on its own (`ol-azo7`).
 *
 * `olea-service/scripts/harness/grounding-eval.mjs`'s strongest candidates —
 * including its `RECOMMENDED` constant — combine three signals: idf-weighted
 * lexical coverage of the query against the corpus's own document
 * frequencies (`lexicon.ts`), absolute cosine (`top1`), and a margin over the
 * corpus cosine distribution's own p99 (`marginP99`). The harness can compute
 * all three because it has independent access to the full chunk set and runs
 * a fresh cosine pass over every candidate per query.
 *
 * `assembleGroundedContext` (`groundedContext.ts`) is pure and operates ONLY
 * on the `HybridHit[]` `hybridRetrieve` produced — it has no access to
 * corpus-wide document frequency, and no access to the score distribution of
 * candidates that did not become hits. This module is that access, computed
 * as a SEPARATE pure pass over the same four inputs `hybridRetrieve` already
 * takes (`query`, `chunks`, `queryVector`, `embeddings`), by whichever layer
 * already holds them — `engine.ts`'s `retrieve` today. Deliberately not
 * folded into `hybridRetrieve` itself: that keeps `hybridRetrieve`'s fusion
 * logic, its return type and its existing tests completely untouched, at the
 * cost of one extra brute-force cosine scan per retrieval call — the same
 * scan D-004 already calls "milliseconds" at this project's corpus size, and
 * this one only runs at all when a caller opts in (`requireComposite`).
 *
 * Every formula here is ported field-for-field from the harness — see
 * `compositeSignals.equivalence.spec.ts`, which replays a real, cached
 * harness run (`.olea-harness/grounding/`, RATIFIED set v1.0.1) and asserts
 * this code reproduces the SAME numbers on the SAME corpus, not just the
 * same pass/fail verdict.
 */

import { cosinePercentile, topKByCosine } from './cosine.js';
import { buildLexicon, lexicalCoverage } from './lexicon.js';
import type { EmbeddingVector, RetrievalChunk, VectorLike } from './types.js';

/**
 * One query's composite grounding signals. `top1`/`marginP99` are `null`
 * under exactly the conditions `hybridRetrieve` itself degrades to
 * keyword-only for (`engine.ts`'s "degrades to keyword-only rather than
 * throwing"): no query vector, or nothing embedded to compare it against.
 */
export interface CompositeGroundingSignals {
  readonly lexBest: number;
  readonly top1: number | null;
  readonly marginP99: number | null;
}

export interface CompositeGroundingThresholds {
  readonly lex: number;
  readonly top1: number;
  readonly marginP99: number;
}

/**
 * `grounding-eval.mjs`'s `RECOMMENDED` constant, ported verbatim. David's
 * Ruling 1a (2026-08-16) ratified the *labelled set* this was measured
 * against as a measurement basis — it did not ratify this specific threshold
 * as the shipped default. `assembleGroundedContext` therefore only applies
 * these when a caller opts in (`requireComposite`); nothing wires that opt-in
 * on by default. See that function's doc.
 */
export const RECOMMENDED_COMPOSITE_THRESHOLDS: CompositeGroundingThresholds = {
  lex: 0.18,
  top1: 0.545,
  marginP99: 0.055,
};

export interface ComputeCompositeGroundingSignalsParams {
  readonly query: string;
  /** Every candidate chunk — the full corpus, not just what `hybridRetrieve` returned as a hit. Same array a caller also passes as `HybridRetrieveParams.chunks`. */
  readonly chunks: readonly RetrievalChunk[];
  readonly queryVector: EmbeddingVector | null;
  /** Every cached embedding, content-hash keyed — same map a caller also passes as `HybridRetrieveParams.embeddings`. */
  readonly embeddings: ReadonlyMap<string, VectorLike>;
}

/**
 * Computes one query's `CompositeGroundingSignals` against the full
 * candidate corpus. Pure and local — no network, no model call, same
 * property `assembleGroundedContext` itself has (module doc there).
 */
export function computeCompositeGroundingSignals(
  params: ComputeCompositeGroundingSignalsParams,
): CompositeGroundingSignals {
  const lexicon = buildLexicon(params.chunks);
  const lexBest = lexicalCoverage(params.query, params.chunks, lexicon);

  if (!params.queryVector || params.embeddings.size === 0) {
    return { lexBest, top1: null, marginP99: null };
  }

  // The FULL cosine distribution, not capped to `hybridRetrieve`'s
  // SEMANTIC_CANDIDATE_POOL: the harness's `marginP99` is a percentile over
  // every embedded chunk, and capping this pass to a small candidate pool
  // would make it a different (and much noisier) statistic.
  const allCosineHits = topKByCosine(params.queryVector, params.embeddings);
  const top1 = allCosineHits[0]?.score ?? null;
  if (top1 === null) return { lexBest, top1: null, marginP99: null };

  const ascending = allCosineHits.map((h) => h.score).reverse();
  const p99 = cosinePercentile(ascending, 0.99);
  return { lexBest, top1, marginP99: top1 - p99 };
}

/** `grounding-eval.mjs`'s `RECOMMENDED` decision function, ported verbatim: a conjunction of all three signals, each `null`-safe. */
export function meetsCompositeThreshold(
  signals: CompositeGroundingSignals,
  thresholds: CompositeGroundingThresholds,
): boolean {
  return (
    signals.lexBest >= thresholds.lex &&
    signals.top1 !== null &&
    signals.top1 >= thresholds.top1 &&
    signals.marginP99 !== null &&
    signals.marginP99 >= thresholds.marginP99
  );
}
