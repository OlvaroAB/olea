/**
 * `runFullDelete` — F7.4's composite "full delete" action (`ol-p6t01`):
 * "delete purges cache, server config record, and vault artifacts on
 * request" (the bead's acceptance criterion, verbatim).
 *
 * Orchestrates the three purges this bead builds, each independently
 * testable and independently callable:
 *
 * 1. `purgeCache` — the five `data.json` cache keys + `.olea/drafts/`.
 * 2. `deleteVaultArtifacts` — `.olea/reviews/` + `.olea/misconceptions/`
 *    (durable, non-rebuildable — deliberately not part of a cache purge).
 * 3. `deleteServerConfigRecord` — the one per-user Worker-side KV record
 *    (C6.4, D-005). Skipped, honestly, when the Worker was never configured
 *    (F7.1: a blank base URL/token is a legitimate, common state per F7.8 —
 *    there is nothing server-side to delete for a device that never
 *    connected).
 *
 * Runs all three regardless of any one failing — a full delete should not
 * leave the vault-side purge undone because the network call to the Worker
 * timed out, or vice versa. Every outcome is reported, never swallowed.
 */

import type { CalendarDay, VaultSource } from 'olea-core';
import type { WorkerConfig } from '../worker/transport.js';
import { type CachePurgeResult, purgeCache } from './cache-purge.js';
import {
  deleteServerConfigRecord,
  type ServerConfigDeleteOutcome,
} from './server-config-delete.js';
import type { DeleteHttpRequestFn, ObsidianDataHost, VaultDeletePort } from './types.js';
import { deleteVaultArtifacts, type VaultArtifactDeleteResult } from './vault-artifact-delete.js';

export interface FullDeleteResult {
  readonly cache: CachePurgeResult;
  readonly vaultArtifacts: VaultArtifactDeleteResult;
  /** `{ outcome: 'not-configured' }` when `workerConfig` has no base URL or token — see the module doc. */
  readonly serverConfig: ServerConfigDeleteOutcome | { readonly outcome: 'not-configured' };
}

export interface RunFullDeleteDeps {
  readonly dataHost: ObsidianDataHost;
  readonly vault: VaultSource;
  readonly vaultDelete: VaultDeletePort;
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
    vaultDelete: deps.vaultDelete,
  });

  const vaultArtifacts = await deleteVaultArtifacts({
    vault: deps.vault,
    vaultDelete: deps.vaultDelete,
    deviceId: deps.deviceId,
    today: deps.today,
    ...(deps.probeDays !== undefined ? { probeDays: deps.probeDays } : {}),
  });

  const serverConfig = isConfigured(deps.workerConfig)
    ? await deleteServerConfigRecord(deps.workerConfig, deps.httpRequest)
    : ({ outcome: 'not-configured' } as const);

  return { cache, vaultArtifacts, serverConfig };
}
