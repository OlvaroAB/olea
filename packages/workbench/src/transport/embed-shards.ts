/**
 * Bundled embedding-shard lookup for `retrieval.embed.v1` (WBX-16d, `ol-3ux7.64.18.4`; design:
 * `../../../olea-service/docs/dev/simulator-design.md` §5, §7).
 *
 * `olea-service`'s `scripts/simulator-build.mjs` (`writeEmbeddingShards` /
 * `packEmbeddingEntriesIntoShards`) shards the real embedding cassette into
 * `dist/simulator-embeddings/index.json` (every content hash's shard file name) plus
 * `<n>.json` shard files, each under a declared cap — see that script's own "EMBEDDING SHARDING"
 * header for why: the whole cassette is already over Cloudflare Pages' 25 MiB per-file limit on
 * its own, so bundling it as one file was never an option. This module is the reader half: fetch
 * the (small) index once, lazily fetch and cache whichever shard a requested content hash names,
 * and answer a `retrieval.embed.v1` request from memory once its shard has already been fetched.
 *
 * ## Key derivation — imported, not reimplemented
 *
 * The key every shard entry and every index row is keyed by is `contentHash` — SHA-256 hex of the
 * chunk's UTF-8 text, produced by `olea-core`'s `hashText` (`ingestion/hash.ts`; its own module
 * doc calls it "the one hash function every job's `contentHash` must come from"). That is the
 * SAME function `retrieval/workerProvider.ts`'s `WorkerEmbeddingProvider.embed()` and
 * `retrieval/chunks.ts`'s `chunksFromIndex` already use to compute the `contentHash` a real
 * `retrieval.embed.v1` request payload carries per chunk, and the same one
 * `scripts/simulator-embed.mjs` (`olea-service`) used to build the cassette these shards are cut
 * from. `EmbedShardStore.lookup` below never calls `hashText` itself — every request chunk
 * already carries its own `contentHash`, computed by the CALLER before this transport ever sees
 * the request (`workerProvider.ts`'s own `embed()`), so a lookup is a plain map read. `hashText`
 * is re-exported here as `deriveEmbedKey` purely as the one canonical reference for "what is this
 * key, exactly" — `embed-shards.spec.ts`'s own parity test drives it, for an invented text,
 * against an independently computed SHA-256, to catch drift between this module's assumption and
 * `olea-core`'s real implementation before it could ever produce a silent, wrong-key miss.
 *
 * ## Whole-batch hit or whole-batch miss — no partial serve
 *
 * A request naming several chunks either resolves EVERY content hash through the bundled shards
 * or is treated as a miss for the WHOLE request — the same "no partial cassette hit" discipline
 * `transport/index.ts`'s `ReplayTransport`/`DirectTransport` already apply to the generation
 * cassette (one hash, one hit-or-miss, never a partially-filled response). Unlike
 * `scripts/simulator-serve.mjs`'s proxy-side `createEmbedHandler`, which forwards only the
 * MISSING chunks of a batch to staging and merges the result, this module has nowhere to forward
 * a partial miss to that would not already be `transport/index.ts`'s own mode-specific fallback
 * (replay: throw; direct: go live) — so it hands the whole request back as "not served from
 * shards" and lets that fallback handle it, rather than inventing a partial-serve protocol no
 * caller needs.
 */

import { hashText, type WorkerTaskRequest } from 'olea-core';

// Re-exported purely as the one canonical reference for the key derivation — see the module doc
// above. Nothing in this file calls it; `embed-shards.spec.ts` does, against an independently
// computed SHA-256, as the parity check the module doc describes.
export { hashText as deriveEmbedKey };

/** `dist/simulator-embeddings/index.json`'s shape — written by `writeEmbeddingShards`. */
export interface EmbedShardIndex {
  readonly version: number;
  readonly model: string;
  readonly datasetVersion: number;
  readonly shardCount: number;
  /** Content hash -> shard file name (e.g. `"0.json"`), relative to the same directory as this index. */
  readonly keys: Readonly<Record<string, string>>;
}

/** `dist/simulator-embeddings/<n>.json`'s shape — the same cassette shape the source file uses. */
export interface EmbedShardFile {
  readonly version: number;
  readonly model: string;
  readonly datasetVersion: number;
  readonly entries: ReadonlyArray<{
    readonly contentHash: string;
    readonly vector: readonly number[];
  }>;
}

function isEmbedShardIndex(value: unknown): value is EmbedShardIndex {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.model === 'string' &&
    typeof v.shardCount === 'number' &&
    typeof v.keys === 'object' &&
    v.keys !== null
  );
}

function isEmbedShardFile(value: unknown): value is EmbedShardFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.model === 'string' && Array.isArray(v.entries);
}

/** One `retrieval.embed.v1` request chunk, after validating `request.payload`'s shape. */
interface EmbedChunk {
  readonly contentHash: string;
  readonly text: string;
}

/**
 * Reads `request.payload` as `{chunks: [{contentHash, text}]}` — `olea-service`'s
 * `retrievalEmbedRequest` schema, restated here as a plain type guard (no zod dependency in this
 * package) rather than trusted blindly, since `payload` is `unknown` on the wire.
 */
function extractEmbedChunks(payload: unknown): readonly EmbedChunk[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const chunks = (payload as Record<string, unknown>).chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return undefined;
  const result: EmbedChunk[] = [];
  for (const raw of chunks) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const contentHash = (raw as Record<string, unknown>).contentHash;
    const text = (raw as Record<string, unknown>).text;
    if (typeof contentHash !== 'string' || contentHash.length === 0) return undefined;
    if (typeof text !== 'string' || text.length === 0) return undefined;
    result.push({ contentHash, text });
  }
  return result;
}

export interface EmbedShardStoreOptions {
  /**
   * Where `simulator-embeddings/index.json` and its shard files are served from, relative to
   * this origin — the dist root by default (`''`), matching `simulator/world.ts`'s
   * `loadSimulatorWorld` fetching `/simulator-world.json` with no prefix.
   */
  readonly baseUrl?: string;
  /**
   * The `fetch` this store issues its (same-origin, static-file) GETs through. Defaults to the
   * global `fetch`; tests inject a fake so nothing here ever needs a real network call, and a
   * caller that must capture the page's ORIGINAL `fetch` before installing a transport bridge
   * (`simulator/world.ts`'s own reasoning for taking one explicitly) can pass it here too.
   */
  readonly fetchFn?: typeof fetch;
}

/**
 * One instance per mounted simulator. Fetches `index.json` at most once (lazily, on the first
 * `retrieval.embed.v1` call) and each shard file at most once (lazily, the first time a key
 * inside it is needed), keeping every fetched shard's vectors in memory for the store's lifetime
 * — the same "load once, keep in memory" reasoning `scripts/simulator-serve.mjs`'s
 * `createEmbedHandler` already gives for the proxy side (a 20 MiB shard reparsed per request
 * would be its own real cost). Never throws: a missing/malformed index or shard is treated as
 * "nothing bundled for this key," the same best-effort discipline `simulator/world.ts`'s
 * `loadSimulatorWorld` already uses for the world descriptor.
 */
export class EmbedShardStore {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private indexPromise: Promise<EmbedShardIndex | null> | null = null;
  private readonly shardPromises = new Map<
    string,
    Promise<Map<string, readonly number[]> | null>
  >();

  constructor(options: EmbedShardStoreOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    // `.bind(globalThis)`, never a bare `fetch` reference: the WHATWG Fetch spec requires
    // `fetch` be invoked with a Window/WorkerGlobalScope receiver, and storing the bare function
    // on `this` and calling it as `this.fetchFn(...)` below invokes it with `this` = the store
    // instance instead — a real "Failed to execute 'fetch' on 'Window': Illegal invocation"
    // `TypeError`, caught by this class's own try/catch and silently rendered as "nothing
    // bundled" (a false miss, never a crash). Found live, in a real browser, while proving this
    // module end-to-end for WBX-16d — `simulator/controller.ts`'s own `createTransportBridge`
    // already binds its captured `originalFetch` the same way, for the same reason.
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  private loadIndex(): Promise<EmbedShardIndex | null> {
    if (this.indexPromise === null) {
      this.indexPromise = (async () => {
        try {
          const response = await this.fetchFn(`${this.baseUrl}/simulator-embeddings/index.json`);
          if (!response.ok) return null;
          const raw: unknown = await response.json();
          return isEmbedShardIndex(raw) ? raw : null;
        } catch {
          return null;
        }
      })();
    }
    return this.indexPromise;
  }

  private loadShard(shardFile: string): Promise<Map<string, readonly number[]> | null> {
    let cached = this.shardPromises.get(shardFile);
    if (cached === undefined) {
      cached = (async () => {
        try {
          const response = await this.fetchFn(`${this.baseUrl}/simulator-embeddings/${shardFile}`);
          if (!response.ok) return null;
          const raw: unknown = await response.json();
          if (!isEmbedShardFile(raw)) return null;
          return new Map(raw.entries.map((entry) => [entry.contentHash, entry.vector] as const));
        } catch {
          return null;
        }
      })();
      this.shardPromises.set(shardFile, cached);
    }
    return cached;
  }

  /**
   * Answers a `retrieval.embed.v1` `WorkerTaskRequest` from the bundled shards, or returns
   * `undefined` when it cannot — no index, an unknown key, or a shard fetch/parse failure — so
   * the caller (`transport/index.ts`) falls through to its own mode's existing miss handling.
   * `undefined` covers the WHOLE request the moment any one requested chunk cannot be resolved
   * (see the module doc's "no partial serve" section).
   */
  async answer(request: WorkerTaskRequest): Promise<unknown | undefined> {
    const chunks = extractEmbedChunks(request.payload);
    if (chunks === undefined) return undefined;

    const index = await this.loadIndex();
    if (index === null) return undefined;

    const vectors = new Map<string, readonly number[]>();
    for (const chunk of chunks) {
      const shardFile = index.keys[chunk.contentHash];
      if (shardFile === undefined) return undefined;
      const shard = await this.loadShard(shardFile);
      if (shard === null) return undefined;
      const vector = shard.get(chunk.contentHash);
      if (vector === undefined) return undefined;
      vectors.set(chunk.contentHash, vector);
    }

    return {
      ok: true,
      stamp: {
        contractVersion: request.contractVersion,
        // Embeddings carry no prompt, so there is no meaningful "prompt version" — restated as a
        // fixed literal matching scripts/simulator-serve.mjs's own embed-shaped envelope
        // (envelopeFromEmbedEntries), which the client (workerProvider.ts's readEmbeddings) never
        // validates beyond the stamped modelId below.
        promptVersion: 'v1',
        modelId: index.model,
        usage: {
          inputTokens: 0,
          inputTokensSource: 'unreported',
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
        },
      },
      result: {
        embeddings: chunks.map((chunk) => ({
          contentHash: chunk.contentHash,
          vector: vectors.get(chunk.contentHash),
        })),
      },
      budgetHeadroom: 1,
    };
  }
}
