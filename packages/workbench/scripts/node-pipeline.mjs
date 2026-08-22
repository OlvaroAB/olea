// node-pipeline.mjs — the Node-side "chunks -> hybrid retrieve -> grounded
// context" and "accept" primitives (`ol-opmb.3` [TB-3]), shared by every
// Node harness script that needs them: this package's own
// `precompute-generation.mjs`, and (via a cross-repo file:// import, the
// SAME technique `precompute-embeddings.mjs` already uses in reverse)
// `olea-service`'s `scripts/harness/e2e.mjs` and `ablate.mjs`.
//
// ================================================================================================
// WHY THIS EXISTS RATHER THAN REUSING packages/workbench/src/oracle/retrieve.ts DIRECTLY
// ================================================================================================
// `oracle/retrieve.ts` and `oracle/generate.ts` both import `../oracle-bridge.js`, which — among
// its many pure re-exports — also re-exports `GapView` from `plugin-bridge.ts`, which transitively
// imports `packages/plugin/src/review/session.ts`. That file uses a TypeScript constructor
// parameter property (`constructor(private readonly deps: ReviewSessionDeps)`), which Node's
// native type-stripping (the harness's `register.mjs`/`loader.mjs` — no full transpile, by design)
// CANNOT parse: `SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]`. Verified directly, not assumed —
// this is the exact failure `embed-corpus.mjs`'s own module doc already warns about for `olea-core`
// source, one layer further out. So no Node script in this project can import `oracle-bridge.ts` or
// anything that reaches it (`oracle/retrieve.ts`, `oracle/generate.ts`, `oracle-scenarios.ts`,
// `retrieve-scenarios.ts`, `generate-scenarios.ts`) — only the BROWSER bundle can, because esbuild
// does a real transform, not a strip.
//
// This file is the Node-safe alternative: it calls `olea-core` from its BUILT DIST (plain compiled
// JS, no parameter properties left to trip the stripper — the same reason `precompute-embeddings.mjs`
// already loads `olea-core` from `CORE_DIST` rather than source), and reimplements exactly the small
// amount of orchestration `retrieve.ts`/`generate.ts` also do — never re-derives a different answer,
// because it calls the SAME `olea-core` functions with the SAME options
// (`RECOMMENDED_COMPOSITE_THRESHOLDS`, `requireComposite: true` by default — D-042/ol-xf6x).
//
// ================================================================================================
// SPEND
// ================================================================================================
// `cassetteEmbeddingProvider` below NEVER calls a network — it only replays a pre-computed
// `EmbeddingCassette` (`ol-opmb.2` [TB-2]'s `.embedding-cassette/cassette.json`), throwing on any
// text it was not given a vector for. The generative call itself is the caller's job (this module
// has no opinion on how a `quiz.generate.v1` call gets made — see `cassette.mjs` in `olea-service`
// for that).

/** Loads a fixed set of `olea-core` exports from its BUILT dist — see the module doc for why source cannot be used here. */
export async function loadCoreDist(coreDist) {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const need = {
    chunksFromIndex: ['retrieval', 'chunks.js'],
    hashText: ['ingestion', 'hash.js'],
    EmbeddingCacheEngine: ['retrieval', 'embeddingCache.js'],
    retrieve: ['retrieval', 'engine.js'],
    RECOMMENDED_COMPOSITE_THRESHOLDS: ['retrieval', 'compositeSignals.js'],
    EMPTY_KEYWORD_INDEX: ['keyword-index', 'types.js'],
    acceptGeneratedMcq: ['instrument', 'mcq-generated.js'],
  };
  const out = {};
  for (const [name, segments] of Object.entries(need)) {
    const file = join(coreDist, ...segments);
    if (!existsSync(file)) {
      throw new Error(
        `node-pipeline.mjs: olea-core is not built for this pipeline: ${file} is missing.\n` +
          '  Fix:  pnpm --filter olea-core build     (run it in the public checkout)',
      );
    }
    const module = await import(pathToFileURL(file).href);
    if (!(name in module)) {
      throw new Error(
        `node-pipeline.mjs: olea-core's ${segments.join('/')} no longer exports ${name}.`,
      );
    }
    out[name] = module[name];
  }
  return out;
}

/** `EmbeddingCacheStore` over a plain in-memory box — same convention `oracle/retrieve.ts`'s `memoryEmbeddingCacheStore` uses. */
export function memoryEmbeddingCacheStore() {
  let value = null;
  return {
    load: () => Promise.resolve(value),
    save: (cache) => {
      value = cache;
      return Promise.resolve();
    },
  };
}

/**
 * The Node-side twin of `oracle/embedding-provider.ts`'s `CassetteEmbeddingProvider` — replays an
 * `EmbeddingCassette`, never calls a network, refuses (throws) rather than inventing a vector for
 * an unrecorded text. Needs `core.hashText` (built dist) for content hashing, same algorithm the
 * cassette was written against.
 */
export function cassetteEmbeddingProvider(core, cassette) {
  const byHash = new Map(cassette.entries.map((e) => [e.contentHash, e.vector]));
  return {
    async embed(request) {
      if (request.model !== cassette.model) {
        throw new Error(
          `cassetteEmbeddingProvider: asked to embed with model ${JSON.stringify(request.model)} but ` +
            `this cassette is pinned to ${JSON.stringify(cassette.model)}. Refusing rather than ` +
            'comparing two vector spaces.',
        );
      }
      const vectors = [];
      for (const text of request.texts) {
        const hash = await core.hashText(text);
        const vector = byHash.get(hash);
        if (vector === undefined) {
          throw new Error(
            `cassetteEmbeddingProvider: no cached vector for content hash ${hash}. Run ` +
              'precompute-embeddings.mjs to embed this text once before replaying it here.',
          );
        }
        vectors.push(vector);
      }
      return { vectors };
    },
  };
}

/**
 * `chunks -> hybrid retrieve -> grounded context or refusal`, replaying `embeddingCassette` — the
 * Node-safe equivalent of `oracle/retrieve.ts`'s `retrieveScenario`, same defaults
 * (`requireComposite: true`, `RECOMMENDED_COMPOSITE_THRESHOLDS` — D-042/ol-xf6x).
 */
export async function retrieveOverCassette({
  core,
  index,
  embeddingCassette,
  query,
  options = {},
}) {
  const provider = cassetteEmbeddingProvider(core, embeddingCassette);
  const cache = await core.EmbeddingCacheEngine.create({
    store: memoryEmbeddingCacheStore(),
    provider,
    model: embeddingCassette.model,
  });
  return core.retrieve(
    { keywordIndex: index, embeddingCache: cache, embeddingProvider: provider },
    query,
    {
      requireComposite: options.requireComposite ?? true,
      compositeThresholds: core.RECOMMENDED_COMPOSITE_THRESHOLDS,
      ...(options.minCosineScore === undefined ? {} : { minCosineScore: options.minCosineScore }),
    },
  );
}

/** `GroundedChunk[] -> string[]`, or `[]` on a refusal — same rule `oracle/generate.ts`'s `sourceChunksFrom` uses. */
export function sourceChunksFrom(groundingResult) {
  return groundingResult.status === 'grounded' ? groundingResult.chunks.map((c) => c.text) : [];
}

/**
 * INV-6's accept gate, Node-side — the same `core.acceptGeneratedMcq` call
 * `oracle/generate.ts`'s `acceptCandidates` makes, catching a per-candidate
 * refusal (blank feedback) rather than aborting the whole batch.
 */
export function acceptCandidatesNode(core, candidates) {
  const accepted = [];
  const rejected = [];
  for (const candidate of candidates) {
    try {
      accepted.push(core.acceptGeneratedMcq(candidate));
    } catch (error) {
      rejected.push({ candidate, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { accepted, rejected };
}
