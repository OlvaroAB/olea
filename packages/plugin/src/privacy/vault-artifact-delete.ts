/**
 * `deleteVaultArtifacts` — F7.4's "vault artifact removal on request"
 * (`ol-p6t01`, widened by `ol-egov.141.8.7`), the stronger, disclosed half of
 * full delete that a cache purge (`cache-purge.ts`) never reaches.
 *
 * **What it removes: every file Olea wrote under `.olea/` except the draft
 * cache.** The review-event log and the misconception log (durable vault
 * content, C6.1 and C5.2, "not a rebuildable derivation"), and every record
 * store beside them: concept key records, relation caches and their
 * dispositions, same-as links, outcome records and near-match proposals,
 * citation and distractor-provenance sidecars, paper records, the explain-back
 * content store (C6.2a), duplicate-confirmation records and accepted
 * retrospective notes — the list is `OLEA_LAYER_FOLDERS` in `log-discovery.ts`,
 * and a file in a folder this build does not name (another device on a newer
 * build, say) goes too, because discovery walks the whole `.olea/` root.
 * Before `ol-egov.141.8.7` this function reached only the two logs, and a full
 * delete left every other store in her vault.
 *
 * **Why the draft cache stays out.** `.olea/drafts/` is D-006's cache and
 * `purgeCache`'s to remove; keeping this function to durable content keeps the
 * two steps separately callable and separately described. `runFullDelete`
 * closes the gap between them with `deleteRemainingOleaLayer`, which takes
 * whatever is left under `.olea/` — a draft the draft index never named is the
 * case that needs it.
 *
 * All of it lives under `.olea/` — Olea's own directory — so none of it is
 * authored content INV-6 protects, but deleting it is real, permanent loss of
 * evidence about her study history, which is exactly the class of action a
 * genuine right-to-be-forgotten request is for and a cache-clear button is
 * not. That is why this is a separate function with its own name in the
 * settings UI, not a flag on `purgeCache`.
 *
 * **Never touches anything outside `.olea/`.** Q&A/cloze/MCQ blocks are
 * embedded inside notes she authored (`generation/materialize-mcq.ts` writes
 * into *her* source path, not an Olea-owned one) — INV-6 puts writing OR
 * removing anything inside an authored note behind her own edit, never Olea's.
 * Every path removed here comes from `discoverOleaLayerPaths` and is checked
 * again by `deleteOleaLayerPath` immediately before the delete, which refuses
 * anything `isOleaLayerPath` rejects.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { type CalendarDay, MISCONCEPTION_LOG_FOLDER, REVIEW_LOG_FOLDER } from 'olea-core';
import {
  DEFAULT_LOG_PROBE_DAYS,
  discoverOleaLayerPaths,
  isEventLogPath,
  isInOleaLayerRole,
  isOleaLayerPath,
} from './log-discovery.js';
import { deleteVaultPath } from './types.js';

export interface VaultArtifactDeleteResult {
  readonly deletedReviewLogPaths: readonly VaultPath[];
  readonly deletedMisconceptionLogPaths: readonly VaultPath[];
  /**
   * Every other file removed under `.olea/` (`ol-egov.141.8.7`): each record store, any non-log
   * file sitting in a log folder, and any file in a folder this build does not name. Never a
   * `.olea/drafts/` path.
   */
  readonly deletedRecordPaths: readonly VaultPath[];
}

export interface VaultArtifactDeleteDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  /** Defaults to `DEFAULT_LOG_PROBE_DAYS` (`log-discovery.ts`). */
  readonly probeDays?: number;
}

/**
 * Deletes one path, refusing (by throwing) anything outside `.olea/`. Discovery already filters to
 * the layer; this is the second check, at the point of no return, so no future caller can reach
 * her notes through this module by passing the wrong path.
 */
export async function deleteOleaLayerPath(vault: VaultSource, path: VaultPath): Promise<void> {
  if (!isOleaLayerPath(path)) {
    throw new Error(
      `F7.4 deletes only Olea's own .olea/ layer (INV-6); refused: ${JSON.stringify(path)}`,
    );
  }
  await deleteVaultPath(vault, path);
}

function discover(deps: VaultArtifactDeleteDeps): Promise<VaultPath[]> {
  return discoverOleaLayerPaths(deps.vault, {
    deviceId: deps.deviceId,
    today: deps.today,
    probeDays: deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS,
  });
}

export async function deleteVaultArtifacts(
  deps: VaultArtifactDeleteDeps,
): Promise<VaultArtifactDeleteResult> {
  const found = await discover(deps);

  const reviewPaths = found.filter((path) => isEventLogPath(path, REVIEW_LOG_FOLDER));
  const misconceptionPaths = found.filter((path) => isEventLogPath(path, MISCONCEPTION_LOG_FOLDER));
  const logPaths = new Set([...reviewPaths, ...misconceptionPaths]);
  const recordPaths = found.filter(
    (path) => !logPaths.has(path) && !isInOleaLayerRole(path, 'cache'),
  );

  for (const path of reviewPaths) await deleteOleaLayerPath(deps.vault, path);
  for (const path of misconceptionPaths) await deleteOleaLayerPath(deps.vault, path);
  for (const path of recordPaths) await deleteOleaLayerPath(deps.vault, path);

  return {
    deletedReviewLogPaths: reviewPaths,
    deletedMisconceptionLogPaths: misconceptionPaths,
    deletedRecordPaths: recordPaths,
  };
}

/**
 * Removes every file still under `.olea/`, whatever its folder or role, and returns the paths
 * removed (`ol-egov.141.8.7`). `runFullDelete`'s last vault step, after `purgeCache` and
 * `deleteVaultArtifacts`: it takes a draft the draft index never named (`purgeCache` finds drafts
 * through that index only), and anything written under `.olea/` between the two steps.
 */
export async function deleteRemainingOleaLayer(
  deps: VaultArtifactDeleteDeps,
): Promise<readonly VaultPath[]> {
  const remaining = await discover(deps);
  for (const path of remaining) await deleteOleaLayerPath(deps.vault, path);
  return remaining;
}
