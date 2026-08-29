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
 * deliberately skips dotfiles/dot-directories (`.obsidian`, `.trash`, ...)
 * while *walking* — see its own doc — but that exclusion is applied to
 * entries it passes on the way down, not to a caller-named `under` root:
 * `list({ under: REVIEW_LOG_FOLDER })` starts its walk directly inside
 * `.olea/reviews/` and reads it fine (`FolderSource.listUnder()`, `ol-df19`,
 * is the same walk under a name that makes the dot-directory intent explicit
 * at the call site; both work). **`ObsidianSource` is the real gap**: it
 * lists over `vault.getFiles()`, which Obsidian itself never populates with
 * dot-prefixed paths, so no method built on it can see this folder at all —
 * a host limitation, not a choice any file in this repo makes. That does not
 * affect this module or the writer (`read`, `write`, and `exists` all address
 * a file directly by path, with no dependence on `list()`), but it is a real
 * gap for a multi-device *discovery* reader on a real Obsidian install —
 * tracked on `ol-yk1c` (C5.2a), since it is a `VaultSource`/`ObsidianSource`
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
