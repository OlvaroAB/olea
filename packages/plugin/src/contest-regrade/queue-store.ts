/**
 * `ContestRegradeQueueStore` — `QueueStore` (`olea-core`) over Obsidian's
 * `loadData`/`saveData`, for the contest-regrade job queue `[D-360]`
 * authorises.
 *
 * Deliberately its own class rather than a second construction of
 * `../ingestion/queue-store.js`'s `ObsidianQueueStore`: that class hardcodes
 * `INGESTION_QUEUE_STORAGE_KEY` as its one top-level key inside the shared
 * `data.json` blob, so instantiating it a second time for this queue would
 * silently share (and corrupt) the ingestion queue's own persisted jobs.
 * This class owns a DIFFERENT top-level key
 * (`CONTEST_REGRADE_QUEUE_STORAGE_KEY`) and repeats the identical
 * read-modify-write discipline `ObsidianQueueStore`'s own module doc
 * explains — same reasoning, different namespace. `ObsidianDataHost` is
 * imported (never redefined) from that module so both stores agree on
 * exactly what a host must supply.
 */

import type { PersistedQueue, QueueStore } from 'olea-core';
import type { ObsidianDataHost } from '../ingestion/queue-store.js';
import { hasReadModifyWrite } from '../retrieval/serializing-data-host.js';

/** The top-level key this store owns inside the plugin's single `data.json` blob — distinct from `ObsidianQueueStore`'s `INGESTION_QUEUE_STORAGE_KEY`. */
export const CONTEST_REGRADE_QUEUE_STORAGE_KEY = 'contestRegradeQueue';

function isPersistedQueue(value: unknown): value is PersistedQueue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && Array.isArray(candidate.jobs);
}

export class ContestRegradeQueueStore implements QueueStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(): Promise<PersistedQueue | null> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    const candidate = (blob as Record<string, unknown>)[CONTEST_REGRADE_QUEUE_STORAGE_KEY];
    return isPersistedQueue(candidate) ? candidate : null;
  }

  /** Read-modify-write for the same reason `ObsidianQueueStore.save` is: another key in `data.json` may have changed since this store last loaded, and this must not clobber it. */
  async save(queue: PersistedQueue): Promise<void> {
    const merge = (existing: unknown): Record<string, unknown> => {
      const blob: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};
      blob[CONTEST_REGRADE_QUEUE_STORAGE_KEY] = queue;
      return blob;
    };
    if (hasReadModifyWrite(this.host)) {
      await this.host.readModifyWrite(merge);
      return;
    }
    const existing = await this.host.loadData();
    await this.host.saveData(merge(existing));
  }
}
