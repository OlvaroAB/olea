/**
 * `deleteVaultArtifacts` — F7.4's "vault artifact removal on request"
 * (`ol-p6t01`), the stronger, disclosed half of full delete that a cache
 * purge (`cache-purge.ts`) never reaches.
 *
 * The knowledge model draws a sharp line D-006 does not: the review-event
 * log is "durable vault content (C6.1, C5.2), not a rebuildable
 * derivation" and the misconception log is built to the identical rule
 * (`misconception/types.ts`'s own module doc: "cannot be reconstructed
 * retroactively... capture it from day one or lose it permanently"). Both
 * live under `.olea/` — Olea's own directory — so they are not authored
 * content INV-6 protects, but deleting them is real, permanent loss of
 * evidence about her study history, which is exactly the class of action a
 * genuine right-to-be-forgotten request is for and a cache-clear button is
 * not. That is why this is a separate function with its own name in the
 * settings UI, not a flag on `purgeCache`.
 *
 * **Never touches instrument content.** Q&A/cloze/MCQ blocks are embedded
 * inside notes she authored (`generation/materialize-mcq.ts` writes into
 * *her* source path, not an Olea-owned one) — INV-6 puts writing OR
 * removing anything inside an authored note behind her own edit, never
 * Olea's, so this function's reach stays bounded to the two dot-prefixed
 * folders Olea alone ever writes to.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import {
  type CalendarDay,
  MISCONCEPTION_LOG_FOLDER,
  misconceptionLogPath,
  REVIEW_LOG_FOLDER,
  reviewLogPath,
} from 'olea-core';
import { DEFAULT_LOG_PROBE_DAYS, discoverLogPaths } from './log-discovery.js';
import { deleteVaultPath } from './types.js';

export interface VaultArtifactDeleteResult {
  readonly deletedReviewLogPaths: readonly VaultPath[];
  readonly deletedMisconceptionLogPaths: readonly VaultPath[];
}

export interface VaultArtifactDeleteDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  /** Defaults to `DEFAULT_LOG_PROBE_DAYS` (`log-discovery.ts`). */
  readonly probeDays?: number;
}

export async function deleteVaultArtifacts(
  deps: VaultArtifactDeleteDeps,
): Promise<VaultArtifactDeleteResult> {
  const probeDays = deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS;

  const reviewPaths = await discoverLogPaths(
    deps.vault,
    REVIEW_LOG_FOLDER,
    reviewLogPath,
    deps.deviceId,
    deps.today,
    probeDays,
  );
  const misconceptionPaths = await discoverLogPaths(
    deps.vault,
    MISCONCEPTION_LOG_FOLDER,
    misconceptionLogPath,
    deps.deviceId,
    deps.today,
    probeDays,
  );

  for (const path of reviewPaths) await deleteVaultPath(deps.vault, path);
  for (const path of misconceptionPaths) await deleteVaultPath(deps.vault, path);

  return {
    deletedReviewLogPaths: reviewPaths,
    deletedMisconceptionLogPaths: misconceptionPaths,
  };
}
