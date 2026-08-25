/**
 * `ObsidianUsageLogStore` — persists recorded `UsageLogEntry` rows in the
 * plugin's `data.json`, following the exact pattern
 * `worker/config-store.ts`/`ingestion/queue-store.ts` already establish: a
 * narrow `ObsidianDataHost` port (so this runs under plain Vitest), one
 * owned top-level key, and read-modify-write on every save so this store
 * never clobbers whatever else shares the blob.
 *
 * **Capped, not unbounded.** A call log with no ceiling is exactly the kind
 * of "queue holding documents" shape C6/D-005 are wary of in spirit even
 * though these rows carry no content — task id, prompt version and model
 * id only (see `types.ts`). Capping is plain hygiene for a JSON blob
 * Obsidian round-trips on every save, not a privacy control. Oldest
 * entries are dropped first (FIFO) so the summary always reflects the most
 * recent activity.
 *
 * **Wiring gap, named rather than silently left:** nothing calls
 * `recordUsageEntry` yet. The one call site that would populate it for
 * real is `worker/transport.ts`'s `sendWorkerTask`, on a successful
 * response — see this bead's report for the exact patch, held out of this
 * file because `worker/transport.ts` is outside `ol-p3t09`'s owned paths.
 */

import type { UsageLogEntry } from './types.js';
import { isUsageLogEntry } from './types.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — see `worker/config-store.ts`'s module doc for why it's spelled out rather than imported. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const USAGE_LOG_STORAGE_KEY = 'usageLog';

/** Oldest entries are dropped once the log holds this many rows. */
export const USAGE_LOG_MAX_ENTRIES = 500;

interface PersistedUsageLog {
  readonly version: 1;
  readonly entries: readonly UsageLogEntry[];
}

function isPersistedUsageLog(value: unknown): value is PersistedUsageLog {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isUsageLogEntry)
  );
}

export class ObsidianUsageLogStore {
  constructor(private readonly host: ObsidianDataHost) {}

  /** `[]` — never a throw — when nothing usable is stored, matching a fresh install or a corrupted blob alike (same posture as `ObsidianWorkerConfigStore.load`). */
  async load(): Promise<readonly UsageLogEntry[]> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return [];
    const candidate = (blob as Record<string, unknown>)[USAGE_LOG_STORAGE_KEY];
    return isPersistedUsageLog(candidate) ? candidate.entries : [];
  }

  /** Appends one entry, dropping the oldest once the cap is reached. */
  async record(entry: UsageLogEntry): Promise<void> {
    const existing = await this.load();
    const next = [...existing, entry];
    const capped =
      next.length > USAGE_LOG_MAX_ENTRIES ? next.slice(next.length - USAGE_LOG_MAX_ENTRIES) : next;

    const blobExisting = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof blobExisting === 'object' && blobExisting !== null
        ? { ...(blobExisting as Record<string, unknown>) }
        : {};
    const persisted: PersistedUsageLog = { version: 1, entries: capped };
    blob[USAGE_LOG_STORAGE_KEY] = persisted;
    await this.host.saveData(blob);
  }
}
