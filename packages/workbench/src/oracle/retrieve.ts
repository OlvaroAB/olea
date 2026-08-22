/**
 * The retrieval driver — query -> hybrid retrieve -> grounded context or
 * refusal, replaying a pre-computed embedding cassette
 * (`olea-service`'s `ol-opmb.2` [TB-2], extending `ol-opmb.1` [TB-1]'s
 * `oracle/derive.ts` + `oracle/trace.ts` pattern).
 *
 * ## Why `retrieveScenario` is one function, not three
 *
 * `olea-core`'s `retrieve()` (`../oracle-bridge.js`) already fuses "derive
 * chunks -> keyword search -> ensure embeddings -> embed the query -> fuse ->
 * assemble grounded context or refuse" into one call — the bead's own
 * "chunks -> hybrid retrieve -> grounded context" phrasing names stages
 * `retrieve()` already owns, not stages this file re-implements. This file's
 * job is everything AROUND that call: building the synthetic keyword index,
 * wiring a cassette-backed `EmbeddingCacheEngine`, and recording one
 * `StageRecord` (`./trace.js`) so the result renders the same way
 * `oracle/derive.ts`'s five stages already do.
 *
 * ## The ratified operating point, and the one deliberate exception
 *
 * `requireComposite: true` with `RECOMMENDED_COMPOSITE_THRESHOLDS` is the
 * default here (David's ruling, `D-042`/`ol-xf6x`) — every scenario in
 * `retrieve-scenarios.ts` except one uses it unmodified. The one exception,
 * `grounding-refused-below-threshold`, passes `requireComposite: false`
 * explicitly and says so in its own note: `assembleGroundedContext`'s
 * per-hit `below-relevance-threshold` refusal is structurally unreachable
 * downstream of a PASSING composite check on this pipeline —
 * `RECOMMENDED_COMPOSITE_THRESHOLDS.top1` (0.545) is already above
 * `DEFAULT_MIN_COSINE_SCORE` (0.25), so whichever chunk clears the composite
 * gate's `top1` signal has already, by construction, cleared the looser
 * per-hit bar too. That is not a workaround for a limitation of this corpus;
 * it is true of the shipped code for ANY corpus at these threshold values.
 * Demonstrating that refusal reason at all therefore requires isolating the
 * per-hit mechanism from the composite gate — which is exactly what
 * `requireComposite: false` does, and exactly why it is not "a third posture
 * nobody chose" (the parent bead's own warning): it is not wired as a
 * default anywhere, it is the one place this file deliberately turns the
 * ratified gate off to show the mechanism the gate sits in front of.
 *
 * ## Why corpus size is structural, not a spend nicety
 *
 * `compositeSignals.ts`'s `marginP99` is `top1 - cosinePercentile(scores,
 * 0.99)`, and `cosinePercentile` indexes at `floor(0.99 * n)`. For `n <= 100`
 * that index is always the corpus's own maximum, so `marginP99` is EXACTLY
 * zero and the composite gate can never pass, for any query. See
 * `retrieval-corpus.ts`'s module doc, which found this and is why that
 * corpus is 110 chunks rather than TB-1's 3-note gap-view corpus.
 *
 * ## The hard limit stays live here
 *
 * Nothing in this file measures, tunes or reports retrieval ranking quality
 * (parent bead, `ol-opmb`). `RetrieveScenarioResult` carries counts and a
 * `GroundingResult`, never a recall/precision/false-refusal number — there
 * is no field here for one, the same structural enforcement TB-1's
 * `OracleDeriveResult` already applies.
 */

import type {
  EmbeddingCacheStore,
  GroundingResult,
  PersistedEmbeddingCache,
  PersistedKeywordIndex,
} from '../oracle-bridge.js';
import {
  EMPTY_KEYWORD_INDEX,
  EmbeddingCacheEngine,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
  retrieve,
} from '../oracle-bridge.js';
import type { EmbeddingCassette, SyntheticQuery } from '../synthetic-bridge.js';
import { buildRetrievalIndex } from '../synthetic-bridge.js';
import { CassetteEmbeddingProvider } from './embedding-provider.js';
import { type PipelineTrace, recordStageAsync, type StageRecord } from './trace.js';

export interface RetrieveScenarioInput {
  readonly cassette: EmbeddingCassette;
  readonly query: SyntheticQuery;
  /** Defaults to `buildRetrievalIndex()`. `EMPTY_KEYWORD_INDEX` is what `grounding-refused-no-hits` passes. */
  readonly index?: PersistedKeywordIndex;
  /** Defaults to `true` — the ratified operating point. See the module doc for the one scenario that sets this `false`. */
  readonly requireComposite?: boolean;
  /**
   * Forwarded to `assembleGroundedContext`; defaults to the shipped 0.25.
   * `grounding-refused-below-threshold` is the one scenario that overrides
   * this, deliberately — see that state's own note in
   * `retrieve-scenarios.ts` for why the per-hit filter needs an
   * artificially strict bar to demonstrate at all on real embeddings.
   */
  readonly minCosineScore?: number;
}

export interface RetrieveScenarioResult {
  readonly query: SyntheticQuery;
  readonly result: GroundingResult;
  readonly trace: PipelineTrace;
  readonly requireComposite: boolean;
  readonly corpusChunkCount: number;
}

/** An `EmbeddingCacheStore` over a plain in-memory box — nothing here persists across calls, matching `oracle-scenarios.ts`'s `createMemoryStudyPlanStore` and the workbench's "rebuilt fresh every render" discipline (determinism, no ambient state). */
function memoryEmbeddingCacheStore(): EmbeddingCacheStore {
  let value: PersistedEmbeddingCache | null = null;
  return {
    load: () => Promise.resolve(value),
    save: (cache) => {
      value = cache;
      return Promise.resolve();
    },
  };
}

function chunkCountOf(index: PersistedKeywordIndex): number {
  return index.documents.reduce((sum, doc) => sum + doc.blocks.length, 0);
}

/**
 * Runs one query through `chunks -> hybrid retrieve -> grounded context or
 * refusal`, replaying `input.cassette` — never a network call (see
 * `embedding-provider.ts`). Records exactly one `'retrieve'` `StageRecord`
 * (`./trace.js`): the whole chain is one atomic call in `olea-core`, so
 * there is exactly one honest place to time and summarise it, not several
 * artificially split ones.
 *
 * `inputSummary`/`outputSummary` carry counts and ids only — never the raw
 * query text or chunk text (D-005's "no content" discipline; the query set
 * here is synthetic nonsense either way, but the discipline is the same one
 * `oracle/derive.ts`'s stages already hold).
 */
export async function retrieveScenario(
  input: RetrieveScenarioInput,
): Promise<RetrieveScenarioResult> {
  const index = input.index ?? buildRetrievalIndex();
  const requireComposite = input.requireComposite ?? true;
  const provider = new CassetteEmbeddingProvider({ cassette: input.cassette });
  const cache = await EmbeddingCacheEngine.create({
    store: memoryEmbeddingCacheStore(),
    provider,
    model: input.cassette.model,
  });

  const stage = await recordStageAsync(
    'retrieve',
    () =>
      retrieve(
        { keywordIndex: index, embeddingCache: cache, embeddingProvider: provider },
        input.query.query,
        {
          requireComposite,
          compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
          ...(input.minCosineScore !== undefined ? { minCosineScore: input.minCosineScore } : {}),
        },
      ),
    (result) => ({
      status:
        result.status === 'grounded' ? 'ok' : result.reason === 'no-hits' ? 'empty' : 'abstained',
      inputSummary: {
        queryId: input.query.id,
        queryLabel: input.query.label,
        corpusDocuments: index.documents.length,
        corpusChunks: chunkCountOf(index),
        requireComposite,
      },
      outputSummary:
        result.status === 'grounded'
          ? {
              status: 'grounded',
              citedChunks: result.chunks.length,
              // Chunk ids (path#blockIndex), never chunk text — D-005's "no
              // content" discipline held even though this corpus is
              // synthetic nonsense, and useful evidence that citations point
              // at real corpus locations (attribution), not invented ones.
              firstCitation: `${result.chunks[0]?.path ?? ''}#${result.chunks[0]?.blockIndex ?? ''}`,
            }
          : { status: 'refused', reason: result.reason },
      // Retrieval is the first stage of this pipeline — nothing upstream could
      // have blocked it (unlike `oracle/derive.ts`'s `queue` stage, which can
      // be starved by `rank`'s abstention). A refusal here is this stage's own
      // outcome, not an inherited shortfall.
      couldHaveSucceeded: true,
      attributedTo: null,
    }),
  );

  return {
    query: input.query,
    result: stage.result,
    trace: { stages: [stage.record] },
    requireComposite,
    corpusChunkCount: chunkCountOf(index),
  };
}

/** `grounding-refused-no-hits`'s index: genuinely empty — no documents, no blocks, nothing to embed or keyword-match. */
export function emptyRetrievalIndex(): PersistedKeywordIndex {
  return EMPTY_KEYWORD_INDEX;
}

export type { StageRecord };
