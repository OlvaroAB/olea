/**
 * `obsidianDeviceCapability` — `DeviceCapability` (packages/core/src/ingestion/types.ts)
 * sourced from Obsidian's `Platform.isMobile` (D-002, P3-T03).
 *
 * One of the two places in `packages/plugin/src/ingestion/` permitted to
 * import `obsidian` (the other is `queue-store.ts`'s deliberate *avoidance*
 * of the import — this file is the one that actually needs it) — see INV-1,
 * `scripts/check-inv1.mjs`, and `biome.json`'s `noRestrictedImports`
 * override for `packages/core` and `packages/contracts`.
 *
 * Cannot be unit-tested without a real Obsidian host (`obsidian` is a
 * types-only package with no runtime — see `vault/obsidian-source.ts`'s doc
 * for the same reasoning), so there is no test file here and none is
 * expected. Every behaviour `canDrain: false` is supposed to produce is
 * exercised by `IngestionQueueEngine`'s own tests in `packages/core`,
 * against a plain `{ canDrain: false }` object literal — this function's
 * only job is supplying that flag correctly, and it is a one-line, direct
 * read of a single Obsidian constant with nothing else to get wrong.
 *
 * D-002's teeth, restated: a drain long enough to be useful cannot survive a
 * mobile OS suspending a backgrounded Obsidian, so the decision gives mobile
 * the enqueue and withholds the drain entirely; desktop drains.
 */

import { Platform } from 'obsidian';
import type { DeviceCapability } from 'olea-core';

export function obsidianDeviceCapability(): DeviceCapability {
  return { canDrain: !Platform.isMobile };
}
