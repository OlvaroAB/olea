/**
 * `ObsidianQueueStore` — `QueueStore` (packages/core/src/ingestion/types.ts)
 * over Obsidian's `loadData`/`saveData` (D-002, D-003, P3-T03).
 *
 * Takes an `ObsidianDataHost` — the narrow `{ loadData, saveData }` shape a
 * real `Plugin` instance satisfies — rather than importing `obsidian`'s
 * `Plugin` type directly. Two reasons, both real:
 *
 * - It lets this file be unit-tested in plain Node with a fake host. The
 *   `obsidian` package itself is types-only (no runtime — see
 *   `package.json`'s `main: ""`), so anything that actually imports it can
 *   only run inside a real Obsidian host; `vault/obsidian-source.ts` makes
 *   the identical argument for why *that* class has no test file. This one
 *   avoids the problem instead of accepting it, because the shape it
 *   actually needs from `Plugin` is this small.
 * - It documents the real contract this class needs rather than the whole
 *   surface of `Plugin`.
 *
 * **Namespacing, not ownership.** `loadData`/`saveData` read and write one
 * whole JSON blob per plugin (`data.json`) — Obsidian gives every plugin
 * exactly one such file, with no built-in per-feature partition. A queue
 * store that treated the entire blob as its own would silently destroy
 * whatever settings or cache (D-003) another part of the plugin persists
 * there later. This class instead owns a single top-level key
 * (`INGESTION_QUEUE_STORAGE_KEY`) inside that blob and read-modify-writes
 * around it on every `save()`, so it composes safely with whatever else
 * eventually shares `data.json` rather than assuming it's the only writer.
 */

import type { PersistedQueue, QueueStore } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see the module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const INGESTION_QUEUE_STORAGE_KEY = 'ingestionQueue';

function isPersistedQueue(value: unknown): value is PersistedQueue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && Array.isArray(candidate.jobs);
}

export class ObsidianQueueStore implements QueueStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<PersistedQueue | null> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[INGESTION_QUEUE_STORAGE_KEY];
    // Anything that doesn't look like a PersistedQueue — absent, or
    // corrupted by something outside this plugin's control — is treated as
    // "nothing persisted yet" rather than thrown: QueueStore.load's own
    // contract makes that a legitimate, expected outcome (see core's
    // ingestion/types.ts), and refusing to start over a malformed cache
    // file is a worse failure mode for her than an empty queue.
    return isPersistedQueue(candidate) ? candidate : null;
  }

  async save(queue: PersistedQueue): Promise<void> {
    // Read-modify-write, not a cached blob from construction time: another
    // part of the plugin may have written a different key into data.json
    // since this store last loaded, and this must not clobber it.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    blob[INGESTION_QUEUE_STORAGE_KEY] = queue;
    await this.host.saveData(blob);
  }
}
