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
 *
 * ## The two-threshold band (`[D-089]`)
 *
 * `assembleGroundedContext` above is the single-gate mechanism. `[D-089]`
 * ratified a different posture on top of the same signals, and it lives in
 * this file beside the old one rather than replacing it, because the old one
 * still has a production caller and the band's operating point is not ruled
 * yet:
 *
 * - **above the upper bar** — ground from the cheap numeric signals alone; no
 *   judge runs, because running one above the bar buys nothing;
 * - **below the lower bar** — refuse from the numeric signals alone, and send
 *   *nothing* over the network. This tier is what lets the per-tier network
 *   promise be kept at all, so the classification has to happen before any
 *   port is touched — which is why `assembleBandedGroundedContext` is pure and
 *   synchronous and `resolveGroundedContext` is the only thing that can call
 *   out;
 * - **inside the band** — escalate to the grounding judge, which reads the
 *   query and the retrieved passages *together*. A band query is therefore a
 *   query that leaves the device and may still be refused; that is the ruled
 *   price of judging content by reading it, restated per tier in C4.7.
 *
 * **This module still never touches the network itself.** The judge arrives as
 * an injected `GroundingJudgePort`, the same shape as every other provider in
 * this directory, so the band's decision logic stays testable with no mock
 * transport and the "pure and local" property above survives the addition.
 *
 * **Fail closed, always.** A judge that errors, times out, or returns
 * something unusable produces a refusal — never a generation — and the refusal
 * carries a *transient* reason (`judge-unavailable`) rather than the
 * insufficient-notes one. Those are different facts about her vault and
 * conflating them spends trust on a transient (`[D-089]` §5).
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
  | 'composite-check-unavailable'
  /**
   * BAND PATH ONLY (`[D-089]`). Every numeric signal sat below the band's
   * lower bar, so the refusal was decided from numbers alone and **nothing
   * left the device** — not the query, not a passage, not a scoring call.
   * Distinct from `below-composite-threshold`, which is the single-gate
   * mechanism's verdict, and from `judge-rejected`, which is a refusal that
   * was reached by sending her material for judgment.
   */
  | 'below-band'
  /**
   * BAND PATH ONLY (`[D-089]`). The query fell inside the band, the grounding
   * judge read the query and the retrieved passages together, and judged the
   * passages not to support it. "Checked, by reading it, and found not
   * enough" — the one refusal reason in this union that implies her material
   * was sent for judgment.
   */
  | 'judge-rejected'
  /**
   * BAND PATH ONLY (`[D-089]` §5). The query fell inside the band and the
   * judge could not be consulted — no port wired, an error, a timeout, or a
   * verdict that did not typecheck. **Fail closed:** the band refuses, and it
   * says so with a TRANSIENT reason. This exists precisely so an error never
   * borrows the insufficient-notes message: telling her that her material is
   * thin when the check simply failed is a false claim about her vault
   * wearing a refusal's clothes. Sibling of
   * `composite-check-unavailable`, which is the same fact one layer earlier
   * (the numeric signals themselves never computed).
   */
  | 'judge-unavailable';

/**
 * One hit, reduced to the three facts a diagnostic refusal is permitted to
 * state (`[D-089]` §3): which note, which passage, at what strength.
 *
 * **What is missing from this type is the point of it.** There is no field for
 * a summary verdict about what her vault does or does not contain, and no
 * field for chunk text. "Here is what I found and it wasn't enough" is
 * checkable by her in one click; "your notes don't cover this" is a universal
 * claim nothing verified, and asserted wrongly it impugns *her* material
 * rather than the tool. Making that structural rather than a review rule is
 * cheaper than trusting every future caller to remember it.
 */
export interface GroundingDiagnosticHit {
  readonly path: VaultPath;
  readonly blockIndex: number;
  /** The hit's own raw cosine score, or `null` when cosine could not be consulted for it at all (offline, provider failure) — never a fused RRF score, which is a ranking device and not a calibrated strength. */
  readonly strength: number | null;
}

/** What retrieval actually returned, for a refusal that is allowed to say so (`[D-089]` §3). */
export interface GroundingDiagnostic {
  readonly found: readonly GroundingDiagnosticHit[];
}

export type GroundingResult =
  | { readonly status: 'grounded'; readonly chunks: readonly GroundedChunk[] }
  | {
      readonly status: 'refused';
      readonly reason: GroundingRefusalReason;
      /** Present only on the band path, and only where a diagnostic is truthful — a refusal reached because retrieval returned nothing has nothing to diagnose. */
      readonly diagnostic?: GroundingDiagnostic;
    };

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

  return { status: 'grounded', chunks: toGroundedChunks(relevant, options.topK ?? DEFAULT_TOP_K) };
}

function toGroundedChunks(hits: readonly HybridHit[], topK: number): readonly GroundedChunk[] {
  return hits
    .slice(0, topK)
    .map((hit) => ({ path: hit.path, blockIndex: hit.blockIndex, text: hit.text }));
}

// ---------------------------------------------------------------------------
// The two-threshold band (`[D-089]`) — see this module's header.
// ---------------------------------------------------------------------------

/**
 * The band's two bars, plus one optional corroboration floor.
 *
 * **Both bars are placed on `top1`** — the best absolute cosine any chunk in
 * the corpus reaches for this query — and deliberately NOT on `marginP99`,
 * which the single-gate mechanism uses. That choice is the whole answer to
 * `ol-3h2f`, so it is worth stating where a reader will meet it:
 *
 * `marginP99` is `top1` minus the corpus's own 99th-percentile cosine, so its
 * value is a function of **how many chunks exist**, not of whether the
 * material answering the query is among them. It is not even monotone in
 * corpus size. A bar placed on it is therefore fitted at one corpus size and
 * applied at every other one, which is the run charter's own warning about a
 * number measured on one distribution and used on another.
 *
 * `top1` does not have that property. It is a maximum over the corpus, so
 * adding unrelated chunks can only ever raise it — never lower it — and for a
 * query whose answering material is present, its value is set by that material
 * rather than by the volume of everything else. A query that clears the upper
 * bar at one corpus size still clears it at every larger one. Where `top1` IS
 * low because the answering material genuinely is not there, refusing is the
 * *correct* answer rather than a scale artifact.
 *
 * `marginP99` is not deleted — `compositeSignals.ts` still computes it and the
 * single-gate path still uses it — it is simply not what the band is placed
 * on.
 */
export interface GroundingBandThresholds {
  /** Strictly below this `top1`, refuse from numbers alone and send nothing. */
  readonly lower: number;
  /** At or above this `top1`, ground from numbers alone and consult no judge. Must be >= `lower`; equal bars collapse the band to a single gate, which is legal but is not what `[D-089]` ruled. */
  readonly upper: number;
  /**
   * Optional idf-weighted lexical-coverage floor (`lexBest`,
   * `compositeSignals.ts`). Its ONLY effect is to demote a query that would
   * otherwise be above the band into the band, where the judge decides — it
   * can never move a query below the lower bar, so it can never manufacture a
   * refusal that no judge ever looked at. Left undefined, `top1` alone places
   * both bars.
   */
  readonly lex?: number;
}

/** Which of `[D-089]`'s three tiers a query's numeric signals put it in. */
export type GroundingBandTier = 'above-band' | 'in-band' | 'below-band';

/**
 * A PROVISIONAL band, for measurement and for tests that need *some* bars.
 *
 * **This is not a ratified operating point and no production caller may treat
 * it as one.** Where the two bars finally sit is a Class C call — it changes
 * what the alpha user experiences — and it is made on a decision bead against
 * the measured refusal / false-refusal curve, not here. The values are
 * derived (fitted against a labelled set), so per the component register only
 * the numbers travel; the derivation stays private. `band` is a REQUIRED
 * option on every band entry point for exactly this reason: there is no
 * default operating point that can be in force by accident.
 */
export const PROVISIONAL_GROUNDING_BAND: GroundingBandThresholds = {
  lower: 0.45,
  upper: 0.62,
};

/**
 * Pure tier classification from the numeric signals alone. Exported because
 * "which tier did this land in" is the question every band test and every
 * measurement asks, and deriving it from a `BandDecision` after the fact would
 * conflate the tier with what happened next.
 *
 * Returns `null` when the semantic signal was never computed — the band cannot
 * classify what it cannot measure, and the caller must fail closed rather than
 * guess a tier.
 */
export function classifyGroundingBand(
  signals: CompositeGroundingSignals,
  band: GroundingBandThresholds,
): GroundingBandTier | null {
  if (!isCompositeSemanticSignalAvailable(signals)) return null;
  const top1 = signals.top1 as number;
  if (top1 < band.lower) return 'below-band';
  if (top1 < band.upper) return 'in-band';
  if (band.lex !== undefined && signals.lexBest < band.lex) return 'in-band';
  return 'above-band';
}

export interface AssembleBandedGroundedContextOptions extends AssembleGroundedContextOptions {
  /** Required: there is no default operating point (see `PROVISIONAL_GROUNDING_BAND`). */
  readonly band: GroundingBandThresholds;
}

/**
 * The band's decision, before anything is sent anywhere. Three arms, matching
 * the three tiers — `escalate` is the one the single-gate mechanism has no
 * equivalent of, and it carries everything the judge needs so that the caller
 * that DOES touch the network never has to re-derive it.
 */
export type BandDecision =
  | { readonly status: 'grounded'; readonly chunks: readonly GroundedChunk[] }
  | {
      readonly status: 'refused';
      readonly reason: GroundingRefusalReason;
      readonly diagnostic?: GroundingDiagnostic;
    }
  | {
      readonly status: 'escalate';
      readonly chunks: readonly GroundedChunk[];
      readonly diagnostic: GroundingDiagnostic;
    };

/**
 * `[D-089]`'s band, decided from the numeric signals alone — **pure,
 * synchronous, and incapable of touching the network by construction.**
 *
 * That property is not stylistic. The below-band tier's promise is that
 * nothing was sent, and the only way to make that checkable rather than
 * asserted is for the function producing the below-band refusal to have no
 * means of sending anything. `resolveGroundedContext` is the one that can
 * call out, and it only ever does so on the `escalate` arm.
 */
export function assembleBandedGroundedContext(
  hits: readonly HybridHit[],
  options: AssembleBandedGroundedContextOptions,
): BandDecision {
  if (hits.length === 0) {
    return { status: 'refused', reason: 'no-hits' };
  }

  const signals = options.compositeSignals;
  if (!signals || !isCompositeSemanticSignalAvailable(signals)) {
    // The bars are placed on a signal that was never computed. Fail closed,
    // with the reason that is actually true: the check did not run.
    return { status: 'refused', reason: 'composite-check-unavailable' };
  }

  const tier = classifyGroundingBand(signals, options.band);
  const diagnostic = buildDiagnostic(hits);

  if (tier === 'below-band') {
    return { status: 'refused', reason: 'below-band', diagnostic };
  }

  const minCosineScore = options.minCosineScore ?? DEFAULT_MIN_COSINE_SCORE;
  const relevant = hits.filter((hit) => isRelevant(hit, minCosineScore));
  if (relevant.length === 0) {
    // Corpus-wide `top1` cleared a bar, but nothing that actually came back as
    // a hit is citable. There is nothing to hand a judge and nothing to cite,
    // so this is the per-hit gate's own verdict rather than the band's.
    return { status: 'refused', reason: 'below-relevance-threshold', diagnostic };
  }

  const chunks = toGroundedChunks(relevant, options.topK ?? DEFAULT_TOP_K);
  if (tier === 'above-band') {
    return { status: 'grounded', chunks };
  }
  return { status: 'escalate', chunks, diagnostic };
}

function buildDiagnostic(hits: readonly HybridHit[]): GroundingDiagnostic {
  return {
    found: hits.slice(0, DIAGNOSTIC_HIT_LIMIT).map((hit) => ({
      path: hit.path,
      blockIndex: hit.blockIndex,
      strength: hit.cosineScore,
    })),
  };
}

/** Enough hits for her to see what was actually found, few enough that a refusal stays readable. Declared, not fitted. */
const DIAGNOSTIC_HIT_LIMIT = 5;

// ---------------------------------------------------------------------------
// The judge seam
// ---------------------------------------------------------------------------

/**
 * The client half of `grounding.judge.v1`. Field-for-field the service task's
 * own request shape (`olea-service/src/tasks/groundingJudge.ts`): `context` is
 * a plain string because that task judges support, not provenance, and an
 * empty string is a first-class value there.
 */
export interface GroundingJudgeRequest {
  readonly query: string;
  readonly context: string;
}

/** `grounding.judge.v1`'s response, field-for-field. */
export interface GroundingJudgeVerdict {
  readonly supported: boolean;
  readonly reason: string;
}

/**
 * The injected port the band escalates through. An interface rather than a
 * direct transport call so this module keeps the property its header claims —
 * the band decides, something else sends — and so the judge can be swapped for
 * a cached/replayed one in measurement without a fake network.
 */
export interface GroundingJudgePort {
  judge(request: GroundingJudgeRequest): Promise<GroundingJudgeVerdict>;
}

export interface ResolveGroundedContextOptions extends AssembleBandedGroundedContextOptions {
  /**
   * Consulted for band queries only. **Absent is not "skip the check"** — a
   * band query with no judge wired refuses (`judge-unavailable`), because an
   * escalation that silently became a generation is exactly the confabulation
   * the invariant is about.
   */
  readonly judge?: GroundingJudgePort;
  /** Fail-closed budget for the judge call. Defaults to 20s — above the measured tail, so a timeout means something is actually wrong rather than merely slow. Declared, not fitted. */
  readonly judgeTimeoutMs?: number;
  /** The query text, needed only to escalate. A band query with no query text to send cannot be judged, so it refuses like any other unavailable check. */
  readonly query?: string;
}

const DEFAULT_JUDGE_TIMEOUT_MS = 20_000;

/**
 * The full band path: classify from numbers, then — for band queries only —
 * consult the judge and fold its verdict into a `GroundingResult`.
 *
 * Returns the same `GroundingResult` union `assembleGroundedContext` and
 * `retrieve` already return, so nothing downstream has to learn a second
 * result shape. The `escalate` arm exists inside this function and never
 * escapes it: a caller sees grounded or refused, exactly as before.
 */
export async function resolveGroundedContext(
  hits: readonly HybridHit[],
  options: ResolveGroundedContextOptions,
): Promise<GroundingResult> {
  const decision = assembleBandedGroundedContext(hits, options);
  if (decision.status !== 'escalate') return decision;

  const query = options.query;
  if (!options.judge || query === undefined || query.trim() === '') {
    return { status: 'refused', reason: 'judge-unavailable', diagnostic: decision.diagnostic };
  }

  const verdict = await judgeWithinBudget(
    options.judge,
    { query, context: decision.chunks.map((chunk) => chunk.text).join('\n\n') },
    options.judgeTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS,
  );

  if (verdict === null) {
    return { status: 'refused', reason: 'judge-unavailable', diagnostic: decision.diagnostic };
  }
  if (!verdict.supported) {
    return { status: 'refused', reason: 'judge-rejected', diagnostic: decision.diagnostic };
  }
  return { status: 'grounded', chunks: decision.chunks };
}

/**
 * Runs the judge under a time budget, returning `null` for every way of not
 * getting a usable verdict — throw, timeout, or a shape that is not a verdict.
 * One `null` rather than three because the caller does the same thing with all
 * three (`[D-089]` §5's fail-closed rule), and a distinction the caller cannot
 * act on is a distinction that eventually gets acted on wrongly.
 */
async function judgeWithinBudget(
  judge: GroundingJudgePort,
  request: GroundingJudgeRequest,
  budgetMs: number,
): Promise<GroundingJudgeVerdict | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    const verdict = await Promise.race([judge.judge(request).catch(() => null), timeout]);
    if (!verdict || typeof verdict.supported !== 'boolean') return null;
    return verdict;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
