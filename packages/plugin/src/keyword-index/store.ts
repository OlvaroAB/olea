/**
 * `ObsidianKeywordIndexStore` — `KeywordIndexStore`
 * (packages/core/src/keyword-index/types.ts) over Obsidian's
 * `loadData`/`saveData` (C2.1, D-006, P2-T01a).
 *
 * Modelled exactly on `../ingestion/queue-store.ts`'s `ObsidianQueueStore` —
 * same reasons, restated here for this port specifically:
 *
 * - Takes an `ObsidianDataHost` — the narrow `{ loadData, saveData }` shape
 *   a real `Plugin` instance satisfies — rather than importing `obsidian`'s
 *   `Plugin` type directly, so this file runs and is unit-tested in plain
 *   Node with a fake host. `obsidian` itself is types-only (no runtime), so
 *   anything that actually imports it can only run inside a real Obsidian
 *   host.
 * - Defined locally rather than imported from `queue-store.ts`: the two
 *   host types are structurally identical by design (any real `Plugin`
 *   satisfies both), but each persistence port names exactly what it needs
 *   from `Plugin` on its own, with no coupling between `ingestion/` and
 *   `keyword-index/`.
 *
 * **Namespacing, not ownership.** `loadData`/`saveData` read and write one
 * whole JSON blob per plugin (`data.json`) — Obsidian gives every plugin
 * exactly one such file, with no built-in per-feature partition. This class
 * owns a single top-level key (`KEYWORD_INDEX_STORAGE_KEY`) inside that
 * blob and read-modify-writes around it on every `save()`, exactly as
 * `ObsidianQueueStore` does for `INGESTION_QUEUE_STORAGE_KEY` — the two
 * keys are siblings inside the same blob, and neither implementation may
 * clobber the other's key or anything else already there.
 */

import type { KeywordIndexStore, PersistedKeywordIndex } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const KEYWORD_INDEX_STORAGE_KEY = 'keywordIndex';

function isPersistedKeywordIndex(value: unknown): value is PersistedKeywordIndex {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && Array.isArray(candidate.documents);
}

export class ObsidianKeywordIndexStore implements KeywordIndexStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<PersistedKeywordIndex | null> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[KEYWORD_INDEX_STORAGE_KEY];
    // Anything that doesn't look like a PersistedKeywordIndex — absent, or
    // corrupted by something outside this plugin's control — is treated as
    // "nothing persisted yet" rather than thrown: KeywordIndexStore.load's
    // own contract makes that a legitimate, expected outcome (D-006's "the
    // index is a cache" — a malformed cache is exactly what a rebuild
    // exists to recover from), and refusing to start over a corrupted cache
    // file is a worse failure mode for her than an empty index that a
    // rebuild repopulates.
    return isPersistedKeywordIndex(candidate) ? candidate : null;
  }

  async save(index: PersistedKeywordIndex): Promise<void> {
    // Read-modify-write, not a cached blob from construction time: another
    // part of the plugin — in particular `ObsidianQueueStore`, sharing this
    // same data.json — may have written a different key since this store
    // last loaded, and this must not clobber it.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[KEYWORD_INDEX_STORAGE_KEY] = index;
    await this.host.saveData(blob);
  }
}
