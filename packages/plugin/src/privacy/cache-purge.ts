/**
 * `purgeCache` — F7.4's cache-purge leg (`ol-p6t01`, D-006).
 *
 * D-006: "the cache is a derivation... always safe to delete." Two
 * different homes hold what D-006 means by "the cache" in the codebase
 * today:
 *
 * - Five `data.json` top-level keys, each already a rebuildable derivation
 *   per its own store's module doc: `studyPlan`, `keywordIndex`,
 *   `ingestionQueue`, `corpusRelationState`, `embeddingCache`. Each store's
 *   `STORAGE_KEY` constant is imported rather than re-typed, so this file
 *   cannot drift from the string those stores actually read/write.
 * - `.olea/drafts/` inside the vault — the one vault-resident cache that
 *   exists in code today (`generation/cache-store.ts`, `[CACHE-1]`/C6.2).
 *   Unlike the review and misconception logs (also under `.olea/`), this
 *   one IS a pure derivation: an unreviewed draft is a proposal Olea's own
 *   generation pipeline can produce again, never evidence of something she
 *   did.
 *
 * **Deliberately excluded, and why:**
 * - `workerConfig` (`worker/config-store.ts`) — settings (F7.1's base URL
 *   and token), not a cache. Purging it would silently disconnect her from
 *   the Worker, which is not what a cache-clear control promises.
 * - `deviceId` (`device/device-id.ts`) — identity, not a cache. Clearing it
 *   loses no vault content, but it splits this device's future review-log
 *   files under a new id, fragmenting history going forward. That is a
 *   real, disclosed side effect this bead's report flags as a separate
 *   Class B decision rather than folding it silently into "purge cache".
 * - `usageLog` (`usage/log-store.ts`) — a D-005-governed log, not a
 *   derivation: it is a record of past calls, not recomputable from
 *   anything. It is an export target (`export-bundle.ts`), never a purge
 *   target.
 * - `.olea/reviews/` and `.olea/misconceptions/` — durable vault content
 *   per the knowledge model ("not a rebuildable derivation"), handled by
 *   `vault-artifact-delete.ts` under F7.4's separate, stronger "vault
 *   artifact removal on request" — never implied by a cache purge.
 *
 * See `../../test/privacy/rebuild-equivalence.spec.ts` for the
 * delete-then-rebuild proof this function exists to make possible (D-006's
 * standing requirement, this bead's acceptance criterion).
 */

import type { VaultSource } from 'olea-core';
import { CORPUS_RELATION_STATE_STORAGE_KEY } from '../concept/corpusRelationStateStore.js';
import { createVaultDraftCacheStore, DRAFT_CACHE_FOLDER } from '../generation/cache-store.js';
import { INGESTION_QUEUE_STORAGE_KEY } from '../ingestion/queue-store.js';
import { KEYWORD_INDEX_STORAGE_KEY } from '../keyword-index/store.js';
import { STUDY_PLAN_STORAGE_KEY } from '../plan/store.js';
import { EMBEDDING_CACHE_STORAGE_KEY } from '../retrieval/embedding-cache-store.js';
import type { ObsidianDataHost, VaultDeletePort } from './types.js';

/**
 * The five `data.json` keys D-006 calls a pure derivation. Order is
 * insertion order in `clearedDataJsonKeys` below, not otherwise meaningful.
 */
export const CACHE_DATA_JSON_KEYS = [
  STUDY_PLAN_STORAGE_KEY,
  KEYWORD_INDEX_STORAGE_KEY,
  INGESTION_QUEUE_STORAGE_KEY,
  CORPUS_RELATION_STATE_STORAGE_KEY,
  EMBEDDING_CACHE_STORAGE_KEY,
] as const;

export interface CachePurgeResult {
  /** Which of `CACHE_DATA_JSON_KEYS` were actually present (and so removed) — a fresh install purging an already-empty cache reports `[]`, not an error. */
  readonly clearedDataJsonKeys: readonly string[];
  /** Every `.olea/drafts/` vault path removed, including `index.json`. */
  readonly deletedDraftPaths: readonly string[];
}

export interface CachePurgeDeps {
  readonly dataHost: ObsidianDataHost;
  readonly vault: VaultSource;
  readonly vaultDelete: VaultDeletePort;
}

export async function purgeCache(deps: CachePurgeDeps): Promise<CachePurgeResult> {
  const existing = await deps.dataHost.loadData();
  const blob: Record<string, unknown> =
    typeof existing === 'object' && existing !== null
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const clearedDataJsonKeys: string[] = [];
  for (const key of CACHE_DATA_JSON_KEYS) {
    if (key in blob) {
      delete blob[key];
      clearedDataJsonKeys.push(key);
    }
  }
  await deps.dataHost.saveData(blob);

  const draftStore = createVaultDraftCacheStore(deps.vault);
  const drafts = await draftStore.list();
  const deletedDraftPaths: string[] = [];
  for (const draft of drafts) {
    const path = `${DRAFT_CACHE_FOLDER}/${draft.draftId}.json`;
    await deps.vaultDelete.delete(path);
    deletedDraftPaths.push(path);
  }
  const indexPath = `${DRAFT_CACHE_FOLDER}/index.json`;
  if (await deps.vault.exists(indexPath)) {
    await deps.vaultDelete.delete(indexPath);
    deletedDraftPaths.push(indexPath);
  }

  return { clearedDataJsonKeys, deletedDraftPaths };
}
