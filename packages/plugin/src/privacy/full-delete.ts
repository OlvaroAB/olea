/**
 * `runFullDelete` — F7.4's composite "full delete" action (`ol-p6t01`):
 * "delete purges cache, server config record, and vault artifacts on
 * request" (the bead's acceptance criterion, verbatim).
 *
 * Orchestrates the four steps this bead and `ol-1ttf` build, each
 * independently testable and independently callable:
 *
 * 1. `purgeCache` — the five `data.json` cache keys + `.olea/drafts/`.
 * 2. `deleteVaultArtifacts` — `.olea/reviews/` + `.olea/misconceptions/`
 *    (durable, non-rebuildable — deliberately not part of a cache purge).
 *    Runs against the OLD `deviceId`, before it is reset (step 4) — this is
 *    what lets it find and remove *this install's own* review/misconception
 *    log files, named by that id.
 * 3. `deleteServerConfigRecord` — the one per-user Worker-side KV record
 *    (C6.4, D-005). Skipped, honestly, when the Worker was never configured
 *    (F7.1: a blank base URL/token is a legitimate, common state per F7.8 —
 *    there is nothing server-side to delete for a device that never
 *    connected).
 * 4. `resetDeviceId` — mints and persists a fresh device identity
 *    (`ol-1ttf`, ruled by `ol-ppxj.16`: a full delete mints a fresh id;
 *    `purgeCache` alone keeps preserving it). Runs last, after step 2 has
 *    already used the old id. Any per-device log files left in the vault
 *    (outside step 2's probe window, or belonging to another device) are
 *    untouched by this — C5.2 — the new id simply never links to them.
 *
 * Runs all four regardless of any one failing — a full delete should not
 * leave the vault-side purge undone because the network call to the Worker
 * timed out, or vice versa. Every outcome is reported, never swallowed.
 */

import type { CalendarDay, VaultSource } from 'olea-core';
import { resetDeviceId } from '../device/device-id.js';
import type { WorkerConfig } from '../worker/transport.js';
import { type CachePurgeResult, purgeCache } from './cache-purge.js';
import {
  deleteServerConfigRecord,
  type ServerConfigDeleteOutcome,
} from './server-config-delete.js';
import type { DeleteHttpRequestFn, ObsidianDataHost } from './types.js';
import { deleteVaultArtifacts, type VaultArtifactDeleteResult } from './vault-artifact-delete.js';

export interface FullDeleteResult {
  readonly cache: CachePurgeResult;
  readonly vaultArtifacts: VaultArtifactDeleteResult;
  /** `{ outcome: 'not-configured' }` when `workerConfig` has no base URL or token — see the module doc. */
  readonly serverConfig: ServerConfigDeleteOutcome | { readonly outcome: 'not-configured' };
  /** The freshly minted, freshly persisted device id (`ol-1ttf`) — replaces `deps.deviceId` going forward. */
  readonly newDeviceId: string;
}

export interface RunFullDeleteDeps {
  readonly dataHost: ObsidianDataHost;
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  readonly probeDays?: number;
  /** `null`/blank fields mean "never configured" — see the module doc. */
  readonly workerConfig: WorkerConfig;
  readonly httpRequest: DeleteHttpRequestFn;
}

function isConfigured(config: WorkerConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.token.trim().length > 0;
}

export async function runFullDelete(deps: RunFullDeleteDeps): Promise<FullDeleteResult> {
  const cache = await purgeCache({
    dataHost: deps.dataHost,
    vault: deps.vault,
  });

  const vaultArtifacts = await deleteVaultArtifacts({
    vault: deps.vault,
    deviceId: deps.deviceId,
    today: deps.today,
    ...(deps.probeDays !== undefined ? { probeDays: deps.probeDays } : {}),
  });

  const serverConfig = isConfigured(deps.workerConfig)
    ? await deleteServerConfigRecord(deps.workerConfig, deps.httpRequest)
    : ({ outcome: 'not-configured' } as const);

  const newDeviceId = await resetDeviceId(deps.dataHost);

  return { cache, vaultArtifacts, serverConfig, newDeviceId };
}
