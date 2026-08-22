/**
 * The corpus's own idea of which words carry information (`ol-azo7`).
 *
 * Ported field-for-field from `olea-service/scripts/harness/grounding-eval.mjs`'s
 * `tokenize`/`buildLexicon`/`idfFor` — search that file for those names. That
 * script measured that an idf-weighted lexical-coverage signal, combined with
 * an absolute cosine floor and a corpus-percentile margin, is the strongest
 * candidate grounding-refusal rule against the labelled set
 * (`eval/grounding/grounding-set-v1.0.1.json`, RATIFIED). It could measure
 * that because it has independent access to the whole chunk set.
 * `assembleGroundedContext` (`groundedContext.ts`) never has that access —
 * it only ever sees the already-fused `HybridHit[]` — so a rule needing this
 * signal was unimplementable in the shipped path until this file existed.
 * `hybridRetrieve` (`hybrid.ts`) already receives the full chunk set as
 * `HybridRetrieveParams.chunks`; `compositeSignals.ts` is what actually calls
 * this against those chunks.
 *
 * Deliberately NO stopword list, same reasoning as the harness: idf computed
 * over her own corpus is a filter derived from evidence, not a hand-written,
 * English-specific constant.
 */

import type { RetrievalChunk } from './types.js';

/** Document frequency per token, plus each chunk's own token set, over the chunk list this was built from. */
export interface Lexicon {
  readonly df: ReadonlyMap<string, number>;
  /** Chunk index -> the distinct tokens that chunk contains, same order/length as the `chunks` array passed to `buildLexicon`. */
  readonly tokensByChunk: readonly ReadonlySet<string>[];
  readonly n: number;
}

/**
 * The harness's own tokenizer (`grounding-eval.mjs`'s `tokenize`), mirrored
 * exactly so a match means the same thing on both sides: lowercase, split on
 * any run of characters that is neither a Unicode letter nor a Unicode digit.
 */
export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** `grounding-eval.mjs`'s `idfFor`: smoothed inverse document frequency. */
export function idfFor(df: number, n: number): number {
  return Math.log((n + 1) / (df + 1));
}

/** `grounding-eval.mjs`'s `buildLexicon`, over an arbitrary chunk list. */
export function buildLexicon(chunks: readonly RetrievalChunk[]): Lexicon {
  const df = new Map<string, number>();
  const tokensByChunk: Set<string>[] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const tokens = new Set(tokenize(chunks[i]?.text ?? ''));
    tokensByChunk[i] = tokens;
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { df, tokensByChunk, n: chunks.length };
}

/**
 * The idf-weighted lexical coverage of `query` against the single
 * best-covering chunk in `chunks` — `grounding-eval.mjs`'s `lexBest`.
 *
 * Unlike the harness, this carries no `excludeChunks` concept: that
 * machinery exists solely so the eval script can score a query without
 * letting it match its own source chunk verbatim, a measurement-only
 * concern (`eval/grounding/README.md`). Production always scores against
 * every chunk it currently holds — a caller that wants the harness's
 * exclusion behaviour (as the equivalence test does, to reproduce a cached
 * report) gets it by pre-filtering `chunks` itself before calling this, at
 * which point the formula below is identical: a token's document frequency
 * conditioned on a reduced chunk set is exactly what excluding its
 * occurrences from the full-corpus count computes.
 *
 * Returns 0 if the query tokenizes to nothing, or if `chunks` is empty.
 */
export function lexicalCoverage(
  query: string,
  chunks: readonly RetrievalChunk[],
  lexicon: Lexicon,
): number {
  const queryTokens = [...new Set(tokenize(query))];
  const idf = new Map<string, number>();
  let idfTotal = 0;
  for (const token of queryTokens) {
    const value = idfFor(lexicon.df.get(token) ?? 0, lexicon.n);
    idf.set(token, value);
    idfTotal += value;
  }

  let best = 0;
  for (let i = 0; i < chunks.length; i++) {
    const tokens = lexicon.tokensByChunk[i];
    if (!tokens) continue;
    let covered = 0;
    for (const token of queryTokens) {
      if (tokens.has(token)) covered += idf.get(token) ?? 0;
    }
    const coverage = idfTotal === 0 ? 0 : covered / idfTotal;
    if (coverage > best) best = coverage;
  }
  return best;
}
