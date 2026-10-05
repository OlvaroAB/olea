/**
 * `primePreviousTextFromVault` (`ol-egov.141.89.5.66` item c): seeds the session
 * `PreviousTextTracker` after a plugin load, so a note's first save after the load is judged
 * against its settled text rather than against nothing.
 *
 * Why: the tracker starts empty, so the first small or debounced save of a note had no previous
 * text, got no pending record, and when a later edit escalated the judge compared against the
 * intermediate save instead of the settled baseline (the first material change after a load
 * could be absorbed). A note is primed ONLY when its current text hashes to the raw hash its
 * materiality record already holds, i.e. the text IS the settled baseline. A note changed while
 * Obsidian was closed does not match, is counted, and stays unprimed.
 *
 * Pure of `obsidian`: the caller supplies the recorded paths and a text reader. Hashes use
 * `computeMaterialityHashes`, the helper the trigger itself uses for a note's current hashes.
 * Never throws, never overwrites a path the tracker already holds (an edit observed first wins),
 * and reports counts only (INV-3: never a path or text).
 */

import { MATERIALITY_HASH_STORAGE_KEY } from './hash-store.js';
import { computeMaterialityHashes } from './hashes.js';
import type { PreviousTextTracker } from './previous-text.js';
import type { MaterialityHashStore } from './types.js';

export interface PrimePreviousTextCounts {
  readonly primed: number;
  readonly mismatched: number;
  readonly unreadable: number;
  /** Paths the tracker already held (an edit was observed before priming reached them). */
  readonly alreadyKnown: number;
}

export interface PrimePreviousTextDeps {
  readonly tracker: PreviousTextTracker;
  readonly store: MaterialityHashStore;
  /** Paths that have a materiality record. */
  readonly recordedPaths: readonly string[];
  /** The note's current text, or `null` when it is gone or not hers to evaluate. */
  readonly readText: (path: string) => Promise<string | null>;
}

/**
 * The paths holding a record in the plugin's `data.json` blob. Takes the blob READER rather than
 * the data host, so this file is not a settings accessor (it owns no key; `hash-store.ts` does).
 */
export async function listMaterialityRecordPaths(
  readBlob: () => Promise<unknown>,
): Promise<string[]> {
  const blob = await readBlob();
  if (typeof blob !== 'object' || blob === null) return [];
  const table = (blob as Record<string, unknown>)[MATERIALITY_HASH_STORAGE_KEY];
  if (typeof table !== 'object' || table === null) return [];
  return Object.keys(table);
}

export async function primePreviousTextFromVault(
  deps: PrimePreviousTextDeps,
): Promise<PrimePreviousTextCounts> {
  let primed = 0;
  let mismatched = 0;
  let unreadable = 0;
  let alreadyKnown = 0;
  for (const path of deps.recordedPaths) {
    try {
      if (deps.tracker.get(path) !== undefined) {
        alreadyKnown += 1;
        continue;
      }
      const record = await deps.store.load(path);
      const text = await deps.readText(path);
      if (record === null || text === null) {
        unreadable += 1;
        continue;
      }
      const current = await computeMaterialityHashes(text);
      if (current.rawHash !== record.hashes.rawHash) {
        mismatched += 1;
        continue;
      }
      // Re-checked after the awaits: an edit observed meanwhile wins.
      if (deps.tracker.get(path) !== undefined) {
        alreadyKnown += 1;
        continue;
      }
      deps.tracker.record(path, text);
      primed += 1;
    } catch {
      unreadable += 1;
    }
  }
  return { primed, mismatched, unreadable, alreadyKnown };
}
