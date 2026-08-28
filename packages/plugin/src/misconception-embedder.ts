/**
 * `buildMisconceptionEmbedderWiring` — the plugin-side composition for the
 * `MisconceptionEmbedder` port (`packages/core/src/misconception/types.ts`,
 * M1, `ol-nagi`). Mirrors `retrieval/wiring.ts`'s shape for the analogous
 * retrieval port (`ol-odb0.1`) and `grading/wiring.ts`'s F7.8 grey-out
 * contract: load the persisted Worker config, build a real transport and
 * provider when (and only when) one is usable, and hand back `null`
 * otherwise rather than a caller doomed to fail on its first real request.
 *
 * ===========================================================================
 * NO NEW WORKER ENDPOINT
 * ===========================================================================
 * `olea-core`'s `WorkerMisconceptionEmbedder` is a thin adapter over
 * `TextEmbeddingBackend` — structurally identical to retrieval's own
 * `EmbeddingProvider` (see that file's module doc) — and this module hands
 * it a `WorkerEmbeddingProvider` built exactly the way
 * `retrieval/wiring.ts` builds its own: the same task id
 * (`retrieval.embed.v1`, inside `WorkerEmbeddingProvider`), the same pinned
 * model (`SLOT_E_MODEL_ID`, imported from `./retrieval/wiring.js` rather
 * than re-declared, so a future model repin has exactly one constant to
 * change), the same transport shape (`WorkerTaskTransport`, built by
 * `deps.createTransport` over Obsidian's `requestUrl`, same as every other
 * AI-gated wiring module in this plugin).
 *
 * This is a second, lightweight `WorkerEmbeddingProvider` instance, not a
 * second endpoint or a second HTTP client type: `main.ts` already builds one
 * independent wiring object per AI-gated feature this way (`this.retrieval`,
 * `this.grading`, `this.concept`), each loading the Worker config and
 * building its own transport/provider rather than one composing through
 * another's already-built object — this module follows that established
 * pattern rather than introducing a new one.
 *
 * ===========================================================================
 * THE CACHE
 * ===========================================================================
 * `ObsidianMisconceptionEmbeddingCacheStore` persists
 * `olea-core`'s `MisconceptionEmbeddingCacheEngine` state under its own
 * `data.json` top-level key, namespaced exactly like
 * `retrieval/embedding-cache-store.ts`'s `ObsidianEmbeddingCacheStore` —
 * never the same key, never clobbering it (see that file's module doc for
 * the shared-blob discipline this class follows identically).
 *
 * ===========================================================================
 * REACHABILITY (`ol-nagi`) — READ BEFORE WIRING THIS INTO `main.ts`
 * ===========================================================================
 * This wiring has no production caller yet, deliberately, and building one
 * is out of this bead's scope — see
 * `packages/core/src/misconception/observe.ts`'s module doc for the full
 * argument: the thing that would actually use a resolved
 * `MisconceptionEmbedder` (turning an accepted explain-back grading into an
 * appended misconception event) does not exist anywhere in this plugin, and
 * building it now would mean building the explain-back UI destination that
 * `grading/wiring.ts` already documents is deliberately not built (two open
 * Class C questions block it: `ol-tka5`, `ol-548w`). This file exists so
 * that work, whenever it lands, composes against a real embedder+cache
 * instead of discovering it still needs to build one.
 */

import {
  type MisconceptionEmbedder,
  MisconceptionEmbeddingCacheEngine,
  type MisconceptionEmbeddingCacheStore,
  type PersistedMisconceptionEmbeddingCache,
  WorkerEmbeddingProvider,
  WorkerMisconceptionEmbedder,
  type WorkerTaskTransport,
} from 'olea-core';
import { SLOT_E_MODEL_ID } from './retrieval/wiring.js';
import { isWorkerConfigured, ObsidianWorkerConfigStore } from './worker/config-store.js';
import type { WorkerConfig } from './worker/transport.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this module needs — same narrow-port pattern every other store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY = 'misconceptionEmbeddingCache';

function isPersistedMisconceptionEmbeddingCache(
  value: unknown,
): value is PersistedMisconceptionEmbeddingCache {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    typeof candidate.model === 'string' &&
    Array.isArray(candidate.entries)
  );
}

/**
 * `MisconceptionEmbeddingCacheStore` over Obsidian's `loadData`/`saveData` —
 * modelled exactly on `retrieval/embedding-cache-store.ts`'s
 * `ObsidianEmbeddingCacheStore`; see that file's module doc for the
 * namespacing and read-modify-write reasoning this class follows
 * identically for its own key.
 */
export class ObsidianMisconceptionEmbeddingCacheStore implements MisconceptionEmbeddingCacheStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<PersistedMisconceptionEmbeddingCache | null> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY];
    return isPersistedMisconceptionEmbeddingCache(candidate) ? candidate : null;
  }

  async save(cache: PersistedMisconceptionEmbeddingCache): Promise<void> {
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY] = cache;
    await this.host.saveData(blob);
  }
}

export interface MisconceptionEmbedderWiringDeps {
  readonly dataHost: ObsidianDataHost;
  readonly createTransport: (config: WorkerConfig) => WorkerTaskTransport;
}

export interface MisconceptionEmbedderWiring {
  /** `null` when the Worker isn't configured yet (F7.8) — the same contract `retrieval/wiring.ts` and `grading/wiring.ts` use for their own ports. */
  readonly embedder: MisconceptionEmbedder | null;
  /** `null` on the same condition as `embedder` — the two are always both-or-neither, mirroring `RetrievalWiring`'s `embeddingCache`/`embeddingProvider` pair. */
  readonly cache: MisconceptionEmbeddingCacheEngine | null;
}

export async function buildMisconceptionEmbedderWiring(
  deps: MisconceptionEmbedderWiringDeps,
): Promise<MisconceptionEmbedderWiring> {
  const configStore = new ObsidianWorkerConfigStore(deps.dataHost);
  const config = await configStore.load();
  if (!isWorkerConfigured(config)) return { embedder: null, cache: null };

  const transport = deps.createTransport({ baseUrl: config.baseUrl, token: config.token });
  const backend = new WorkerEmbeddingProvider({ transport });
  const embedder = new WorkerMisconceptionEmbedder({ backend, model: SLOT_E_MODEL_ID });
  const store = new ObsidianMisconceptionEmbeddingCacheStore(deps.dataHost);
  const cache = await MisconceptionEmbeddingCacheEngine.create({
    store,
    embedder,
    model: SLOT_E_MODEL_ID,
  });
  return { embedder, cache };
}
