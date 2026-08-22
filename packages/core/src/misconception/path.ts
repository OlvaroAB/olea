/**
 * Misconception-log file naming — same convention as `../review-log/path.js`
 * (C5.2's pattern, applied to a sibling stream): one file per device per
 * calendar day, so a two-device same-day append merges the same way D7.1's
 * does (`./merge.js`).
 */

import type { VaultPath } from '../vault/types.js';

/** The vault folder misconception events live under. Sibling to `.olea/reviews/`, not inside it — a different event stream (see `./types.js`'s module doc). */
export const MISCONCEPTION_LOG_FOLDER: VaultPath = '.olea/misconceptions';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True when `deviceId` is non-empty and safe to use verbatim inside a file name. */
export function isValidDeviceId(deviceId: string): boolean {
  return DEVICE_ID_RE.test(deviceId);
}

/**
 * The vault path for one device's misconception log on one calendar day.
 * `date` must be `YYYY-MM-DD`; `deviceId` must satisfy `isValidDeviceId`.
 * Throws on either being malformed, matching `reviewLogPath`'s style.
 */
export function misconceptionLogPath(date: string, deviceId: string): VaultPath {
  if (!DATE_RE.test(date)) {
    throw new Error(
      `misconceptionLogPath: not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`,
    );
  }
  if (!isValidDeviceId(deviceId)) {
    throw new Error(`misconceptionLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${MISCONCEPTION_LOG_FOLDER}/${date}.${deviceId}.jsonl`;
}
