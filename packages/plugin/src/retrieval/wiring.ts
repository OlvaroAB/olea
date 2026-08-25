/**
 * `buildRetrievalWiring` / `drainIntoEmbeddingCache` — the two pieces
 * `ol-odb0.1` asks for on top of the storage adapter
 * (`embedding-cache-store.ts`) and the chunk mapper (`units-to-chunks.ts`):
 * a real, production `EmbeddingCacheEngine` wired to the Worker, and the
 * consumer that actually feeds it.
 *
 * **What was missing before this file existed.** `olea-core` already ships
 * everything retrieval-side: `EmbeddingCacheEngine` (the stateful cache),
 * `WorkerEmbeddingProvider` (the production `EmbeddingProvider`, built in
 * `ol-k57j`), `chunksFromIndex` (markdown blocks → chunks). And the plugin
 * already ships a real `WorkerTaskTransport` (`worker/transport.ts` +
 * `worker/obsidian-transport.ts`, also `ol-k57j`) — proven reachable by
 * `worker/test-connection.ts`. Nothing before this bead ever put those two
 * halves in the same object graph: `packages/plugin` had no directory named
 * `retrieval` at all (`ol-odb0`'s own sizing note). This module is that
 * composition, obsidian-free and unit-tested against fakes — `main.ts`
 * supplies the real `ObsidianDataHost` and `createObsidianWorkerTransport`.
 *
 * **Why the embeddings engine is `null` rather than absent when unconfigured.**
 * F7.8 requires AI features to grey out, not crash, when no Worker token is
 * pasted yet — the same reason `WorkerConfig` is optional everywhere else in
 * this package. Building a `WorkerEmbeddingProvider` against a blank
 * `baseUrl`/`token` would not fail loudly at construction; it would fail on
 * the first real call, mid-drain, which is a worse place to discover it. So
 * this module checks `isWorkerConfigured` once, up front, and callers get an
 * honest `null` to skip past instead of a provider destined to error.
 *
 * **The model id is a local constant for the same reason
 * `workerProvider.ts` keeps `RETRIEVAL_EMBED_TASK_ID` local rather than
 * importing it "as a value"** (see that file's module doc) — except here
 * there is no shared catalogue to import from at all: `SLOT_MODEL_CONFIG`
 * (`olea-service/src/slots.ts`) is server-side config in the *other*,
 * private repo, and the client is not supposed to choose the model (C4.6).
 * `SLOT_E_MODEL_ID` below is this package's belief about what Slot E is
 * currently pinned to, used only to (a) key the local cache and (b) fail
 * loudly — never silently — if the Worker ever serves a different model:
 * `WorkerEmbeddingProvider.embed` throws `WorkerEmbeddingError` the instant a
 * response's stamped `modelId` disagrees (see that file), so a drift between
 * this constant and the server's actual pin is a loud error on the very next
 * embed call, not a silently corrupted cache. There is no cross-repo test
 * that can assert equality against `olea-service`'s private source the way
 * `workerProvider.spec.ts` asserts equality against the *public*
 * `olea-contracts` catalogue — this is recorded as a known, self-healing gap
 * rather than papered over with a false sense of pinning.
 */

import {
  chunksFromIndex,
  EmbeddingCacheEngine,
  type EmbeddingProvider,
  type KeywordIndexEngine,
  type RetrievalChunk,
  WorkerEmbeddingProvider,
  type WorkerTaskTransport,
} from 'olea-core';
import type { PendingIndexingSink } from '../ingestion/pending-indexing-sink.js';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from '../worker/config-store.js';
import type { WorkerConfig } from '../worker/transport.js';
import { ObsidianEmbeddingCacheStore } from './embedding-cache-store.js';
import { chunksFromExtractedUnits } from './units-to-chunks.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * Mirrors `SLOT_MODEL_CONFIG.E.modelId` in `olea-service/src/slots.ts`
 * (private repo) — see the module doc for why this cannot be a shared,
 * tested constant and what happens if it drifts.
 */
export const SLOT_E_MODEL_ID = '@cf/baai/bge-m3';

export interface RetrievalWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface RetrievalWiring {
  /**
   * `null` when the Worker isn't configured yet (F7.8) — see the module doc.
   * A caller checks this exactly once, the same shape `main.ts` already uses
   * for `this.ingestion`/`this.review`.
   */
  readonly embeddingCache: EmbeddingCacheEngine | null;
  /**
   * The same `EmbeddingProvider` instance `embeddingCache` was built with —
   * exposed so a `retrieve()` caller (`ol-odb0.2`) can assemble a
   * `RetrieveDeps` (`{keywordIndex, embeddingCache, embeddingProvider}`)
   * without constructing a second one. `retrieve()` needs it directly for
   * embedding the QUERY text itself, which is not something `embeddingCache`
   * does on a caller's behalf (`embeddingCache` only ever embeds corpus
   * chunks via `ensureEmbeddings`). `null` on exactly the same condition as
   * `embeddingCache` — the two are always both-or-neither.
   */
  readonly embeddingProvider: EmbeddingProvider | null;
  /**
   * The same `WorkerTaskTransport` instance `embeddingProvider` sends
   * `retrieval.embed.v1` through — exposed so a generative caller
   * downstream of a grounded retrieval (`ol-odb0.2`'s
   * `draft-quiz-cards.ts`) can send its own task envelope over the same
   * connection, rather than every retrieval-adjacent caller constructing
   * its own transport from `deps.createTransport` independently. `null` on
   * the same condition as the other two fields.
   */
  readonly transport: WorkerTaskTransport | null;
}

export async function buildRetrievalWiring(deps: RetrievalWiringDeps): Promise<RetrievalWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) {
    return { embeddingCache: null, embeddingProvider: null, transport: null };
  }

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  const provider = new WorkerEmbeddingProvider({ transport });
  const store = new ObsidianEmbeddingCacheStore(deps.dataHost);
  const embeddingCache = await EmbeddingCacheEngine.create({
    store,
    provider,
    model: SLOT_E_MODEL_ID,
  });
  return { embeddingCache, embeddingProvider: provider, transport };
}

export interface DrainIntoEmbeddingCacheParams {
  readonly embeddingCache: EmbeddingCacheEngine;
  /** Extracted PDF/PPTX/DOCX/image content accumulated since the last drain (`ol-odb0`'s sizing note — the sink this bead's own diagnosis names). */
  readonly sink: PendingIndexingSink;
  /**
   * The markdown half of the corpus, when the keyword index is wired
   * (`ol-tuvx`) and live — optional so this function still does something
   * useful for a caller that hasn't wired that yet, or has it wired but
   * empty. `chunksFromIndex` is `olea-core`'s own designed bridge from an
   * already-built index to retrieval chunks (see its module doc) — this is
   * not a second document walk.
   */
  readonly keywordIndex?: KeywordIndexEngine;
}

/**
 * Feeds everything currently available — extracted (non-markdown) units and,
 * when supplied, the markdown keyword index — into the embedding cache via
 * `ensureEmbeddings`. Safe to call repeatedly and often: `ensureEmbeddings`
 * only ever sends chunks whose content hash isn't already cached (C2.3), so
 * a call that finds nothing new costs one comparison per chunk and zero
 * network requests. A no-op call (no chunks at all) skips `ensureEmbeddings`
 * entirely rather than making a needless zero-chunk round trip.
 */
export async function drainIntoEmbeddingCache(
  params: DrainIntoEmbeddingCacheParams,
): Promise<void> {
  const chunks: RetrievalChunk[] = [
    ...(await chunksFromExtractedUnits(params.sink.all())),
    ...(params.keywordIndex ? await chunksFromIndex(params.keywordIndex.toPersisted()) : []),
  ];
  if (chunks.length === 0) return;
  await params.embeddingCache.ensureEmbeddings(chunks);
}
