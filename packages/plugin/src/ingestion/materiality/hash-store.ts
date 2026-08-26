/**
 * `ObsidianMaterialityHashStore` — persists one `MaterialityRecord` per vault
 * path inside Obsidian's `data.json`, the same read-modify-write-a-single-key
 * pattern `queue-store.ts`'s `ObsidianQueueStore` uses and argues for (see
 * that file's module doc: `loadData`/`saveData` move one whole JSON blob per
 * plugin, so this store owns its own top-level key and never touches
 * anything else living in that blob).
 *
 * Keyed by vault path rather than by content hash: row 1.4 needs "what did
 * this path last look like" to decide `'unchanged'`/`'formatting-only'`, not
 * "have I seen this exact content before" (that question is the ingestion
 * queue's, over content hash, for a different purpose — dedup, not
 * materiality).
 */

import type { MaterialityHashStore, MaterialityRecord } from './types.js';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this store needs — same narrow-port pattern every store in this plugin uses. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/** The top-level key this store owns inside the plugin's single `data.json` blob. */
export const MATERIALITY_HASH_STORAGE_KEY = 'materialityHashes';

function isMaterialityRecord(value: unknown): value is MaterialityRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.path !== 'string') return false;
  if (typeof candidate.canonicalLength !== 'number') return false;
  if (typeof candidate.lastChangedAt !== 'number') return false;
  if (candidate.lastVerdictAt !== null && typeof candidate.lastVerdictAt !== 'number') return false;
  const hashes = candidate.hashes as Record<string, unknown> | undefined;
  if (typeof hashes !== 'object' || hashes === null) return false;
  return typeof hashes.rawHash === 'string' && typeof hashes.canonicalHash === 'string';
}

export class ObsidianMaterialityHashStore implements MaterialityHashStore {
  constructor(private readonly host: ObsidianDataHost) {}

  async load(path: string): Promise<MaterialityRecord | null> {
    const blob = await this.host.loadData();
    if (typeof blob !== 'object' || blob === null) return null;
    const table = (blob as Record<string, unknown>)[MATERIALITY_HASH_STORAGE_KEY];
    if (typeof table !== 'object' || table === null) return null;
    const candidate = (table as Record<string, unknown>)[path];
    // Corrupted or unrecognised entries are treated as "never seen" rather
    // than thrown — same posture ObsidianQueueStore takes, and for the same
    // reason: refusing to evaluate a file over a malformed cache entry is a
    // worse failure than treating it as a first sighting.
    return isMaterialityRecord(candidate) ? candidate : null;
  }

  async save(record: MaterialityRecord): Promise<void> {
    // Read-modify-write, not a cached blob from construction time — another
    // part of the plugin (or another path's save call) may have written
    // since this store last loaded.
    const existing = await this.host.loadData();
    const blob: Record<string, unknown> =
      typeof existing === 'object' && existing !== null
        ? { ...(existing as Record<string, unknown>) }
        : {};
    const existingTable = blob[MATERIALITY_HASH_STORAGE_KEY];
    const table: Record<string, unknown> =
      typeof existingTable === 'object' && existingTable !== null
        ? { ...(existingTable as Record<string, unknown>) }
        : {};
    table[record.path] = record;
    blob[MATERIALITY_HASH_STORAGE_KEY] = table;
    await this.host.saveData(blob);
  }
}
