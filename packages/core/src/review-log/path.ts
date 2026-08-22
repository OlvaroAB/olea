/**
 * Review-log file naming (C5.2, P2-T03).
 *
 * C5.2 puts every rating she gives into her vault as append-only JSONL under
 * `.olea/reviews/`, split so that **one device's ratings for one day** land in
 * one file. The folder name is fixed by the
 * contract; this module fixes the file-name convention inside it, which the
 * contract leaves open — both dimensions (day, device) are encoded in the
 * name so the folder stays flat: `<date>.<deviceId>.jsonl`.
 *
 * **`.olea/reviews/` is a dot-prefixed path.** `FolderSource.list()`
 * deliberately skips dotfiles/dot-directories (`.obsidian`, `.trash`, ...) —
 * see its own doc — which means a future "enumerate every device's log for a
 * day" reader cannot discover files here via `VaultSource.list()` against
 * `FolderSource`. That does not affect this module or the writer (`read`,
 * `write`, and `exists` all address a file directly by path, with no
 * dependence on `list()`), but it is a real gap for whoever builds
 * multi-device *discovery* later — flagged in the P2-T03 report rather than
 * silently worked around here, since it is a `VaultSource`/`FolderSource`
 * contract question, not a review-log one.
 */

import type { VaultPath } from '../vault/types.js';

/** The vault folder C5.2 names for review logs. */
export const REVIEW_LOG_FOLDER: VaultPath = '.olea/reviews';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True when `deviceId` is non-empty and safe to use verbatim inside a file name. */
export function isValidDeviceId(deviceId: string): boolean {
  return DEVICE_ID_RE.test(deviceId);
}

/**
 * The vault path for one device's review log on one calendar day.
 * `date` must be `YYYY-MM-DD`; `deviceId` must satisfy `isValidDeviceId`.
 * Throws on either being malformed — a bad path here is a bug at the call
 * site, not a recoverable runtime condition, matching `FolderSource`'s own
 * `toAbsolute` validation style.
 */
export function reviewLogPath(date: string, deviceId: string): VaultPath {
  if (!DATE_RE.test(date)) {
    throw new Error(`reviewLogPath: not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  }
  if (!isValidDeviceId(deviceId)) {
    throw new Error(`reviewLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${REVIEW_LOG_FOLDER}/${date}.${deviceId}.jsonl`;
}
