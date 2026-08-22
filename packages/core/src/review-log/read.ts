/**
 * Reads and parses one known review-log file from the vault (C5.2, P2-T03).
 *
 * Deliberately takes an exact `VaultPath` rather than discovering files
 * itself — see ./path.ts's doc on why a `VaultSource.list()`-based
 * "enumerate every device's log for today" helper does not belong in this
 * module yet (`FolderSource.list()` skips the dot-prefixed `.olea/` tree
 * entirely). Callers that already know which device/day files exist (e.g. a
 * two-device merge, or a test) compose this with `./merge.ts`.
 */

import type { VaultPath, VaultSource } from '../vault/types.js';
import { type ParseReviewLogResult, parseReviewLog } from './parse.js';

/** A file that has never been written to reads as no records, not an error. */
export async function readReviewLogFile(
  vault: VaultSource,
  path: VaultPath,
): Promise<ParseReviewLogResult> {
  if (!(await vault.exists(path))) {
    return { records: [], invalidLines: [] };
  }
  const content = await vault.read(path);
  return parseReviewLog(content);
}
