/**
 * Best-effort discovery of Olea's own dot-prefixed log files (F7.4,
 * `ol-p6t01`) — shared by `export-bundle.ts` (read them) and
 * `vault-artifact-delete.ts` (remove them).
 *
 * **Modelled on `today/data-source.ts`'s `readReviewHistory`, deliberately
 * not imported from it.** That function returns parsed, merged
 * `ReviewLogEntry` records — exactly right for the Today panel's streak,
 * wrong for this feature, which needs the *paths* themselves (to delete)
 * and needs to walk `.olea/misconceptions/` too, a folder that function
 * never looks at. Re-deriving the same ~15-line discovery strategy here is
 * the same call `misconception/write.ts` makes about `review-log/write.js`:
 * "kept as a near-duplicate rather than a shared helper... factoring out
 * the byte-safety logic they share would cost an abstraction for a
 * coincidence, not a real one."
 *
 * **Same known limitation as the function this mirrors, inherited rather
 * than introduced here**: `vault.list()` only surfaces a dot-prefixed
 * folder on hosts that choose to allow it (most do not — see
 * `review-log/path.ts`'s own doc), so a second device's files are found
 * only where the host cooperates. This device's own files are always found,
 * because they are probed by exact, constructed path rather than listed.
 * There is currently no way to discover *another* device's id at all
 * (`today/data-source.ts`'s module doc names the identical gap) — flagged
 * as follow-on work in this bead's report, not solved here.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { type CalendarDay, calendarDaysEndingOn, isValidDeviceId } from 'olea-core';

/** Matches `<YYYY-MM-DD>.<deviceId>.jsonl` — the C5.2 file name, whoever wrote it. */
const LOG_FILE_RE = /^\d{4}-\d{2}-\d{2}\.[^/]+\.jsonl$/;

/**
 * ~10 years. A full-delete/full-export request is not the Today panel's
 * streak — it should not silently miss old history the way a 120-day
 * window may (`DEFAULT_STREAK_WINDOW_DAYS` in `today/data-source.ts`).
 * Class B: a reversible default, easy to widen if it ever proves short.
 */
export const DEFAULT_LOG_PROBE_DAYS = 3650;

/**
 * Every path under `folder` this call can find: whatever `vault.list()`
 * surfaces (any device, when the host allows listing a dot-prefixed
 * folder) unioned with `deviceId`'s own file for each of the last
 * `probeDays` calendar days (found by exact path, regardless of host
 * listing support). Returned paths are de-duplicated and sorted.
 */
export async function discoverLogPaths(
  vault: VaultSource,
  folder: VaultPath,
  pathFor: (day: CalendarDay, deviceId: string) => VaultPath,
  deviceId: string,
  today: CalendarDay,
  probeDays: number = DEFAULT_LOG_PROBE_DAYS,
): Promise<VaultPath[]> {
  const candidates = new Set<VaultPath>();

  try {
    const listed = await vault.list({ under: folder });
    for (const path of listed) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (LOG_FILE_RE.test(name)) candidates.add(path);
    }
  } catch {
    // A host that refuses to list a dot-prefixed folder is the expected
    // case (see the module doc) — this device's own files are still found
    // by exact-path probing below.
  }

  if (isValidDeviceId(deviceId)) {
    for (const day of calendarDaysEndingOn(today, probeDays)) {
      candidates.add(pathFor(day, deviceId));
    }
  }

  const found: VaultPath[] = [];
  for (const path of candidates) {
    if (await vault.exists(path)) found.push(path);
  }
  return found.sort();
}
