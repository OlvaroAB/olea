/**
 * The grounding driver behind F2.7 ("explain why I got this wrong",
 * `features/F2-review.md:267`) — `olea-core`'s real `retrieve()`
 * (`packages/core/src/retrieval/engine.ts`) run over the REAL fixture vault
 * (`packages/core/fixtures/vault/`), never `packages/synthetic`'s coined
 * corpus. F2.7 has two halves; only one is this file's job:
 *
 * - The PROSE half (`explain-why.generate.v1`) is BLOCKED — `ol-rem6` is
 *   open, the task id is absent from `olea-service`'s `TASKS` map, and there
 *   is no prompt directory. This file makes no Worker call, records no
 *   cassette, and spends no model token. Full stop.
 * - The GROUNDING half — quoting her own notes and citing the source
 *   paragraph a missed answer should have come from — is real, local and
 *   free, and is everything this file does.
 *
 * Shaped the same way `oracle/retrieve.ts` shapes the synthetic retrieval
 * driver (a plain async function returning one `PipelineTrace`-carrying
 * result), for the same reason: `../explain-scenarios.ts` mounts states over
 * it exactly the way `../retrieve-scenarios.ts` mounts states over that file.
 *
 * ## Why there is no embedding cassette here, and what that means
 *
 * `oracle/retrieve.ts`'s corpus is cassette-backed because
 * `scripts/precompute-embeddings.mjs` paid once to embed `packages/synthetic`'s
 * coined text (`ol-opmb.2`). No equivalent recording exists for the fixture
 * vault's real note text, and this bead never asked for one — recording it
 * would be a second paid pass, and D-021/INV-1 forbid this package's browser
 * bundle from ever calling a real model on its own regardless. So
 * `NoEmbeddingProvider` below rejects on every call — not a mock standing in
 * for "offline," but literally the condition `engine.ts`'s own module doc
 * names: "Degrades to keyword-only rather than throwing. A query embedding
 * failure (offline, provider error) does not fail `retrieve`." Every scenario
 * built from this file runs that real degrade path, not a simulation of it.
 *
 * ## `requireComposite: true` is unreachable here — measured, not assumed
 *
 * `compositeSignals.ts`'s `computeCompositeGroundingSignals` early-returns
 * `top1: null` whenever `queryVector` is null, and `meetsCompositeThreshold`
 * requires `top1 !== null` unconditionally — so with no embedding provider,
 * EVERY query that produces at least one keyword hit refuses with
 * `below-composite-threshold`, regardless of the query's actual relevance;
 * every query with no keyword hit refuses `no-hits` before the composite
 * check ever runs. Both were verified empirically against this exact corpus
 * (a throwaway probe run against `FolderSource` over `packages/core/fixtures/
 * vault/`, not asserted from reading the code) before this file was written:
 * real-content queries grounded with `requireComposite` unset and refused
 * `below-composite-threshold` with it forced `true`; nonsense queries refused
 * `no-hits` either way. So this driver leaves `requireComposite` at its
 * default `false` (`GroundExplanationResult.requireComposite` is the literal
 * `false`, not merely un-set) — not a shortcut chosen to make a state
 * "work," but the only honest choice once composite grounding is
 * structurally unreachable in a zero-embedding demo. See the integration
 * report for the full finding; the ratified `requireComposite: true`
 * operating point (D-042/`ol-xf6x`) is simply not reachable here, on any
 * query, until a real embedding path exists for this corpus.
 */

import { buildFullIndex } from '../../../core/src/keyword-index/build.js';
import type { VaultPath, VaultSource } from '../../../core/src/vault/types.js';
import { type PipelineTrace, recordStageAsync, type StageRecord } from '../oracle/trace.js';
import type {
  EmbeddingCacheStore,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  GroundingResult,
  PersistedEmbeddingCache,
  PersistedKeywordIndex,
} from '../oracle-bridge.js';
import { EmbeddingCacheEngine, retrieve } from '../oracle-bridge.js';

/**
 * Not a note of hers — excluded from the index the same way
 * `oracle/fixture-oracle.ts`'s own comment and `queue/derive.ts`'s
 * `NOT_A_FIXTURE_NOTE` already exclude it from every other walk of this
 * vault. `buildFullIndex` has no `excludePaths` option of its own
 * (`enumerateVaultInstruments` does; the keyword-index builder does not), so
 * this file filters the built index's `documents` afterwards instead.
 */
const EXCLUDED_PATHS: readonly VaultPath[] = ['README.md'];

/**
 * An `EmbeddingProvider` that always fails — see the module doc. Not a test
 * double standing in for a real provider; this IS the provider this demo
 * ships, deliberately, because no cassette exists for this corpus and none
 * should be recorded for a zero-spend workbench surface.
 */
class NoEmbeddingProvider implements EmbeddingProvider {
  embed(_request: EmbedRequest): Promise<EmbedResult> {
    return Promise.reject(
      new Error(
        'explain/ground.ts: no embedding provider is wired for the fixture vault — this demo ' +
          "always degrades to keyword-only retrieval by design; see this file's module doc.",
      ),
    );
  }
}

/** Never actually persisted to anything durable — matches `oracle/retrieve.ts`'s `memoryEmbeddingCacheStore` (fresh every call, no ambient state). */
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

/** Never actually compared against a real model id, since `NoEmbeddingProvider` never succeeds — named for what it is, not for a real Slot E model. */
const NO_EMBEDDING_MODEL_ID = 'workbench-explain/no-embedding-provider';

function chunkCountOf(index: PersistedKeywordIndex): number {
  return index.documents.reduce((sum, doc) => sum + doc.blocks.length, 0);
}

/**
 * Builds the fixture vault's real keyword index, `README.md` excluded. Not
 * cached: rebuilt fresh on every call, matching `oracle/fixture-oracle.ts`'s
 * own "cheap enough to call once per walkthrough render" discipline — the
 * fixture vault is 52 files, and a full rebuild costs milliseconds, not
 * seconds.
 */
async function buildFixtureKeywordIndex(vault: VaultSource): Promise<PersistedKeywordIndex> {
  const built = await buildFullIndex({ vault });
  if (built.status === 'cancelled') {
    // No `signal` is ever passed above, so `buildFullIndex` can never actually
    // report cancelled — this branch exists only so the type checker sees a
    // real index on every other path, not because it is reachable.
    throw new Error('explain/ground.ts: unexpected cancellation building the fixture index');
  }
  const documents = built.index.documents.filter((doc) => !EXCLUDED_PATHS.includes(doc.path));
  return { version: built.index.version, documents };
}

export interface GroundExplanationInput {
  readonly vault: VaultSource;
  readonly query: string;
}

export interface GroundExplanationResult {
  readonly query: string;
  readonly result: GroundingResult;
  readonly trace: PipelineTrace;
  readonly corpusDocumentCount: number;
  readonly corpusChunkCount: number;
  /** Always `false` — see the module doc for why the ratified `requireComposite: true` operating point is structurally unreachable in this zero-embedding demo. */
  readonly requireComposite: false;
}

/**
 * Runs one query through the real `chunks -> hybrid retrieve -> grounded
 * context or refusal` chain over the fixture vault's real keyword index, with
 * no embedding provider (see module doc) — grounds or refuses for real,
 * never staged. Records exactly one `'retrieve'` `StageRecord`, the same
 * `StageId` `oracle/retrieve.ts` uses for its own single-call chain (the
 * mechanism is identical; only the corpus and the embedding posture differ).
 *
 * `inputSummary`/`outputSummary` carry counts and ids only, never raw query
 * or chunk text (the same discipline `oracle/retrieve.ts` holds) — the
 * caller-visible `GroundExplanationResult.result` is where quoted text
 * belongs, because that is the material this whole surface exists to show.
 */
export async function groundExplanation(
  input: GroundExplanationInput,
): Promise<GroundExplanationResult> {
  const index = await buildFixtureKeywordIndex(input.vault);
  const provider = new NoEmbeddingProvider();
  const cache = await EmbeddingCacheEngine.create({
    store: memoryEmbeddingCacheStore(),
    provider,
    model: NO_EMBEDDING_MODEL_ID,
  });

  const stage = await recordStageAsync(
    'retrieve',
    () =>
      retrieve(
        { keywordIndex: index, embeddingCache: cache, embeddingProvider: provider },
        input.query,
        {},
      ),
    (result) => ({
      status:
        result.status === 'grounded' ? 'ok' : result.reason === 'no-hits' ? 'empty' : 'abstained',
      inputSummary: {
        corpusDocuments: index.documents.length,
        corpusChunks: chunkCountOf(index),
        requireComposite: false,
      },
      outputSummary:
        result.status === 'grounded'
          ? {
              status: 'grounded',
              citedChunks: result.chunks.length,
              // Chunk id (path#blockIndex), never chunk text — the trace
              // summary stays ids/counts only; `result` below carries text.
              firstCitation: `${result.chunks[0]?.path ?? ''}#${result.chunks[0]?.blockIndex ?? ''}`,
            }
          : { status: 'refused', reason: result.reason },
      // This is the first (and only) stage of this pipeline — nothing
      // upstream could have blocked it, the same reasoning
      // `oracle/retrieve.ts`'s own stage summary uses.
      couldHaveSucceeded: true,
      attributedTo: null,
    }),
  );

  return {
    query: input.query,
    result: stage.result,
    trace: { stages: [stage.record] },
    corpusDocumentCount: index.documents.length,
    corpusChunkCount: chunkCountOf(index),
    requireComposite: false,
  };
}

export type { StageRecord };
