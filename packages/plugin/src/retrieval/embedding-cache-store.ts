/**
 * `ObsidianEmbeddingCacheStore` — `EmbeddingCacheStore`
 * (`packages/core/src/retrieval/types.ts`) over Obsidian's
 * `loadData`/`saveData` (C2.3, D-004, D-006, `ol-odb0.1`).
 *
 * Modelled exactly on `../keyword-index/store.ts`'s `ObsidianKeywordIndexStore`
 * — same reasons, restated here for this port specifically:
 *
 * - Takes an `ObsidianDataHost` — the narrow `{ loadData, saveData }` shape a
 *   real `Plugin` instance satisfies — rather than importing `obsidian`'s
 *   `Plugin` type directly, so this file runs and is unit-tested in plain
 *   Node with a fake host.
 * - Defined locally rather than sharing a type with the other stores: the
 *   host shape is structurally identical by design (any real `Plugin`
 *   satisfies all of them), but each persistence port names exactly what it
 *   needs from `Plugin` on its own, with no coupling between `retrieval/`,
 *   `keyword-index/` and `ingestion/`.
 *
 * **Namespacing, not ownership.** `loadData`/`saveData` read and write one
 * whole JSON blob per plugin (`data.json`) — Obsidian gives every plugin
 * exactly one such file, with no built-in per-feature partition. This class
 * owns a single top-level key (`EMBEDDING_CACHE_STORAGE_KEY`) inside that
 * blob and read-modify-writes around it on every `save()`, exactly as
 * `ObsidianQueueStore`/`ObsidianKeywordIndexStore` do for their own keys —
 * the three keys are siblings inside the same blob, and none may clobber
 * another's key or anything else already there.
 *
 * **What "valid" means here is deliberately shallow.** `isPersistedEmbeddingCache`
 * checks the shape (`version`, `model`, `entries`), not that every entry's
 * `codes` actually decodes — `EmbeddingCacheEngine.create` already drops an
 * individual entry whose `codes` fail to decode rather than discarding the
 * whole cache (see its own module doc), so duplicating that check here would
 * only let one corrupt row incorrectly nuke every other entry via this
 * store's own `load` returning `null`.
 */

import type { EmbeddingCacheStore, PersistedEmbeddingCache } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const EMBEDDING_CACHE_STORAGE_KEY = 'embeddingCache';

function isPersistedEmbeddingCache(value: unknown): value is PersistedEmbeddingCache {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 2 &&
    typeof candidate.model === 'string' &&
    Array.isArray(candidate.entries)
  );
}

export class ObsidianEmbeddingCacheStore implements EmbeddingCacheStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<PersistedEmbeddingCache | null> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[EMBEDDING_CACHE_STORAGE_KEY];
    // Anything that doesn't look like a PersistedEmbeddingCache — absent, a
    // version-1 cache from before `ol-l1qz` (full-precision `vector` arrays,
    // no `codes`), or corrupted by something outside this plugin's control —
    // is treated as "nothing persisted yet" rather than thrown:
    // `EmbeddingCacheStore.load`'s own contract makes that a legitimate,
    // expected outcome, and `EmbeddingCacheEngine.create` already documents
    // that a version mismatch is meant to start the cache from zero (D-006:
    // rebuildable, not migrated).
    return isPersistedEmbeddingCache(candidate) ? candidate : null;
  }

  async save(cache: PersistedEmbeddingCache): Promise<void> {
    // Read-modify-write, not a cached blob from construction time: the
    // ingestion queue, the keyword index and the worker config all share
    // this same data.json and may have written a different key since this
    // store last loaded.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[EMBEDDING_CACHE_STORAGE_KEY] = cache;
    await this.host.saveData(blob);
  }
}
