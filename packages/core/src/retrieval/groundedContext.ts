/**
 * Grounding assembly and refusal (C4.7, INV-5, P3-T05).
 *
 * This is the enforcement point for C4.7's grounding requirement: a
 * generative task over her material has to cite the source blocks retrieval
 * returned, and when retrieval comes back with nothing it flags or refuses
 * instead of inventing. It is deliberately client-side and
 * pure: `assembleGroundedContext` never calls a model and never touches the
 * network, so the refusal decision is made *before* a generative task id is
 * ever called — cheaper than a wasted model call, and testable without any
 * mock at all.
 *
 * **Why the return type is a discriminated union, not a possibly-empty
 * array.** A generative task consuming retrieval can't build a prompt from a
 * `GroundingResult` without a `switch`/narrowing on `status` first —
 * TypeScript will not let `chunks` be read off the `refused` branch. That is
 * the structural half of "no exceptions" INV-5 asks for: a caller can still
 * choose to ignore the refusal, but it cannot do so *by accident*, the way
 * it could if this returned `readonly GroundedChunk[]` and an empty array
 * silently looked the same as "nothing worth citing" and "found one weak
 * hit worth citing anyway."
 *
 * C4.7's reasoning is that a wrong card stated confidently does more damage
 * than a card she never got — refusal
 * is a success of this pipeline, not a fault (see `errorCode`'s
 * `grounding-refused` in `olea-service/contracts/worker.ts`).
 */

import type { VaultPath } from '../vault/types.js';
import {
  type CompositeGroundingSignals,
  type CompositeGroundingThresholds,
  isCompositeSemanticSignalAvailable,
  meetsCompositeThreshold,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
} from './compositeSignals.js';
import type { HybridHit } from './hybrid.js';

export interface GroundedChunk {
  readonly path: VaultPath;
  readonly blockIndex: number;
  /** Transient — assembled fresh from the current index on every call, never persisted by this function or expected to be persisted by its caller (plan §7.1, D-005). */
  readonly text: string;
}

export type GroundingRefusalReason =
  /** Retrieval produced no hits at all — an empty index, or a query with no keyword or semantic match whatsoever. */
  | 'no-hits'
  /** Retrieval produced hits, but none cleared the relevance bar — present in the index, but not actually about the query. Confabulation's actual failure mode: a model handed these chunks would have "context," just not relevant context. */
  | 'below-relevance-threshold'
  /**
   * `options.requireComposite` was set, the semantic signal WAS computed, and
   * the query's `CompositeGroundingSignals` (`compositeSignals.ts`) still did
   * not clear every clause of `options.compositeThresholds` — `ol-azo7`.
   * "Checked and found nothing": her material genuinely does not support
   * this query at the ratified operating point. Distinct from
   * `below-relevance-threshold`, which is about individual hits failing a
   * per-hit filter rather than a single whole-query gate evaluated before
   * per-hit filtering runs at all — and distinct from
   * `composite-check-unavailable`, below, which is about the check never
   * having run at all.
   */
  | 'below-composite-threshold'
  /**
   * `options.requireComposite` was set, but the semantic half of the
   * composite signal could not be computed at all — no query embedding
   * (offline, provider failure) or nothing in the corpus is embedded yet, so
   * `computeCompositeGroundingSignals` returned a null `top1`
   * (`compositeSignals.ts`) — or a caller passed `requireComposite: true`
   * without ever computing `compositeSignals` in the first place. `ol-riwn`
   * (`[D-089]`): "we could not check just now", never "her notes do not
   * cover this" — the two are different facts and this reason is what keeps
   * a caller from conflating them the way `below-composite-threshold` alone
   * would. `lexBest` failing on its own is NOT this reason: it never depends
   * on the embedding provider, so its shortfall alone still means
   * `below-composite-threshold`, not this.
   */
  | 'composite-check-unavailable';

export type GroundingResult =
  | { readonly status: 'grounded'; readonly chunks: readonly GroundedChunk[] }
  | { readonly status: 'refused'; readonly reason: GroundingRefusalReason };

export interface AssembleGroundedContextOptions {
  /** Caps how many chunks travel as context. Defaults to 8 — generous enough for multi-source grounding, small enough to keep a generative prompt's context section actually readable/citable. */
  readonly topK?: number;
  /**
   * The cosine similarity a hit must clear to count as "relevant" whenever a
   * cosine score is available for it. A hit with no cosine score at all — no
   * query vector, offline or a provider failure — falls back to keyword
   * overlap alone (`ol-hp9x`; see `isRelevant`'s doc for why keyword can no
   * longer override a cosine score that IS present). Defaults to 0.25: not a
   * number the contract specifies, a conservative heuristic, deliberately
   * overridable per call once real retrieval quality data exists (cost
   * model §6, question 3).
   */
  readonly minCosineScore?: number;
  /**
   * The query's own `CompositeGroundingSignals` (`compositeSignals.ts`),
   * computed by a caller that holds corpus-wide access — `engine.ts`'s
   * `retrieve` — since this function deliberately does not. Only ever
   * consulted when `requireComposite` is true; harmless to pass and ignore
   * otherwise, which is what keeps this function's default behaviour
   * unchanged for every existing caller (`ol-azo7`).
   */
  readonly compositeSignals?: CompositeGroundingSignals;
  /** Defaults to `RECOMMENDED_COMPOSITE_THRESHOLDS` (`compositeSignals.ts`) — the harness's own `RECOMMENDED` constant. Only read when `requireComposite` is true. */
  readonly compositeThresholds?: CompositeGroundingThresholds;
  /**
   * Opt-in (`ol-azo7`): also require the composite grounding-refusal rule
   * `olea-service/scripts/harness/grounding-eval.mjs` measured and
   * recommended — idf lexical coverage AND absolute cosine AND a
   * corpus-percentile margin, evaluated once for the whole query before any
   * per-hit filtering. Defaults to `false`.
   *
   * **This is plumbing, not a ratification.** David's Ruling 1a ratified
   * `eval/grounding/grounding-set-v1.0.1.json` as a measurement basis; it did
   * not ratify replacing `minCosineScore`'s per-hit filter as the shipped
   * default (a Class C, "changes what the alpha user experiences" call —
   * run charter). No caller in this codebase sets this true today. When it
   * is true but `compositeSignals` is absent, this refuses conservatively
   * (`composite-check-unavailable`, `ol-riwn` — an opt-in gate a caller
   * forgot to wire the signals for genuinely never ran the check) rather
   * than silently skipping it — INV-5 does not get to fail open either way.
   */
  readonly requireComposite?: boolean;
}

const DEFAULT_TOP_K = 8;
const DEFAULT_MIN_COSINE_SCORE = 0.25;

/**
 * `ol-hp9x`: a keyword hit alone used to make a hit relevant, full stop —
 * `if (hit.keywordScore > 0) return true`, before cosine was even read. The
 * keyword index has no stopword list and no rarity/idf notion (deliberately;
 * see `hybrid.ts`'s module doc and the eval harness's `buildLexicon`), so an
 * ordinary natural-language query matches a large fraction of the corpus on
 * keyword alone — measured at a median 45% (`ol-cmpl`). That made the
 * short-circuit fire on nearly every query, which means cosine was never
 * actually consulted: `minCosineScore` existed but nothing reached it.
 *
 * The fix keeps the docblock's original argument — a raw per-hit signal
 * clearing its own bar is real evidence, a fused ranking score is not — but
 * narrows what "keyword is its own evidence" means. It is sufficient on its
 * own only when cosine could not be consulted at all (`cosineScore === null`:
 * no query vector, offline or a provider failure — see `engine.ts`'s
 * "degrades to keyword-only" note). When a cosine score IS present, it is
 * consulted: a keyword hit whose cosine score fails the bar no longer gets a
 * free pass. This does not fix the keyword index's lack of rarity weighting
 * (a separate, larger change — an idf-weighted lexical-coverage measure is
 * prior art in `olea-service/scripts/harness/grounding-eval.mjs`, not
 * required here); it fixes only that the short-circuit bypassed cosine
 * entirely.
 */
function isRelevant(hit: HybridHit, minCosineScore: number): boolean {
  if (hit.cosineScore !== null) return hit.cosineScore >= minCosineScore;
  return hit.keywordScore !== null && hit.keywordScore > 0;
}

/**
 * Turns a ranked hybrid result set into either grounded, citable context or
 * an explicit refusal (C4.7, INV-5). Relevance is judged per hit on its own
 * raw signal (keyword overlap, or cosine similarity past the bar) rather
 * than on the fused RRF `score`, which is a ranking device, not a calibrated
 * relevance measure — a fused score is only ever meaningful for *ordering*
 * hits against each other, never for deciding whether the best of them is
 * actually good enough.
 */
export function assembleGroundedContext(
  hits: readonly HybridHit[],
  options: AssembleGroundedContextOptions = {},
): GroundingResult {
  if (hits.length === 0) {
    return { status: 'refused', reason: 'no-hits' };
  }

  if (options.requireComposite) {
    // No signals at all: the caller opted into the gate but never wired the
    // computation (or is offline in a way that stopped it happening).
    // Either way, the check never ran — that's the same fact as the null-
    // semantic-signal case below, so it gets the same reason (`ol-riwn`).
    if (
      !options.compositeSignals ||
      !isCompositeSemanticSignalAvailable(options.compositeSignals)
    ) {
      return { status: 'refused', reason: 'composite-check-unavailable' };
    }
    const thresholds = options.compositeThresholds ?? RECOMMENDED_COMPOSITE_THRESHOLDS;
    if (!meetsCompositeThreshold(options.compositeSignals, thresholds)) {
      return { status: 'refused', reason: 'below-composite-threshold' };
    }
  }

  const minCosineScore = options.minCosineScore ?? DEFAULT_MIN_COSINE_SCORE;
  const relevant = hits.filter((hit) => isRelevant(hit, minCosineScore));
  if (relevant.length === 0) {
    return { status: 'refused', reason: 'below-relevance-threshold' };
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const chunks: GroundedChunk[] = relevant
    .slice(0, topK)
    .map((hit) => ({ path: hit.path, blockIndex: hit.blockIndex, text: hit.text }));

  return { status: 'grounded', chunks };
}
