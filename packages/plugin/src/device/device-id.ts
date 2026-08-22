/**
 * Stable per-install device id (C5.2, D-006, `ol-kud` blocker 3).
 *
 * C5.2 puts one review-log file per day **per device** in `.olea/reviews/`,
 * named `<date>.<deviceId>.jsonl`. Two devices appending on the same day merge
 * cleanly precisely because they write different files, so the id has one job:
 * be different on every install and never change on any of them. If it changes,
 * that install's history splits across two names and looks like a third device.
 *
 * ## Why it is random, and nothing else
 *
 * The obvious implementations are the wrong ones. A hostname, a username, a
 * platform string, or anything derived from them would be **a fact about her
 * written into a filename inside her own vault** — a vault that syncs, that she
 * may share a folder of, and that INV-3 says holds real content precisely
 * because it is hers. A default machine name — the kind that ships already
 * carrying its owner's own name — showing up in a file listing is a small leak
 * with no upside: nothing in the product ever needs to know *which* device, only
 * that two are distinct. A random id answers the only question asked.
 *
 * It is also deliberately not the vault path, the install path, or a hash of
 * either. Those are stable until she moves a folder, and then they silently are
 * not — which is the failure this module exists to prevent, arriving later and
 * harder to diagnose.
 *
 * ## Shape
 *
 * `olea-` plus 12 lowercase base-36 characters, e.g. `olea-k3f9zq1m7x2p`. It
 * satisfies `isValidDeviceId` (core's `review-log/path.ts`), is filename-safe on
 * every platform, and is short enough that `2026-08-10.olea-k3f9zq1m7x2p.jsonl`
 * still reads as a date at a glance. ~62 bits of entropy: collision between two
 * of her devices is not a real risk, and there is no global namespace to collide
 * in — the id only has to be unique within one vault.
 *
 * ## Persistence
 *
 * Stored in the plugin's `data.json` (D-006 — plugin data folder, never the
 * vault), under one top-level key, read-modify-written so it cannot clobber
 * `keywordIndex` or `ingestionQueue` sharing the same blob. This follows
 * `ObsidianKeywordIndexStore`'s pattern deliberately rather than inventing a
 * second convention.
 *
 * **A corrupt or missing id is repaired by minting a new one, not by throwing.**
 * That is the right call here even though it costs a history split: refusing to
 * start because a cache file is malformed would make a review session
 * impossible, and a split log is recoverable (both files are still valid,
 * append-only, and merge) whereas a session she could not run is not.
 */

import { isValidDeviceId } from 'olea-core';
import type { ObsidianDataHost } from '../keyword-index/store.js';

/** The top-level key this module owns inside the plugin's single `data.json` blob. */
export const DEVICE_ID_STORAGE_KEY = 'deviceId';

/** Characters after the `olea-` prefix. */
const ID_LENGTH = 12;

/**
 * Source of randomness, injectable so tests are deterministic and so the
 * absence of `crypto` on some future host is a call-site problem rather than a
 * module-load crash. Returns a float in `[0, 1)`, matching `Math.random`.
 */
export type RandomSource = () => number;

const defaultRandom: RandomSource = () => Math.random();

/** Mints a fresh id. Exported for tests; production goes through `ensureDeviceId`. */
export function generateDeviceId(random: RandomSource = defaultRandom): string {
  let suffix = '';
  while (suffix.length < ID_LENGTH) {
    // `toString(36)` on a random float yields "0.xxxxx"; drop the "0.".
    suffix += random().toString(36).slice(2);
  }
  return `olea-${suffix.slice(0, ID_LENGTH)}`;
}

/**
 * Returns this install's device id, minting and persisting one on first run.
 *
 * Idempotent: every later call returns the same id without writing. The write
 * happens only when there was nothing usable stored, which keeps the common
 * path free of a `saveData` on every plugin load.
 */
export async function ensureDeviceId(
  host: ObsidianDataHost,
  random: RandomSource = defaultRandom,
): Promise<string> {
  const existing = await host.loadData();
  const blob: Record<string, unknown> =
    typeof existing === 'object' && existing !== null
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const stored = blob[DEVICE_ID_STORAGE_KEY];
  // Validated on read, not merely type-checked: an id that fails
  // `isValidDeviceId` would make every `reviewLogPath` call throw, and the
  // throw would surface at the moment she finishes a review — the worst
  // possible time to discover a bad filename.
  if (typeof stored === 'string' && isValidDeviceId(stored)) return stored;

  const minted = generateDeviceId(random);
  blob[DEVICE_ID_STORAGE_KEY] = minted;
  await host.saveData(blob);
  return minted;
}
