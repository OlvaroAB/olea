/**
 * `runFullDelete` — F7.4's composite "full delete" action (`ol-p6t01`):
 * "delete purges cache, server config record, and vault artifacts on
 * request" (the bead's acceptance criterion, verbatim). F7.4's clause: "Data
 * export and full delete, including cache purge and vault artifact removal."
 *
 * Orchestrates these steps, each independently testable and callable:
 *
 * 1. `purgeCache` — the five `data.json` cache keys + `.olea/drafts/`.
 * 2. `deleteVaultArtifacts` — every file under `.olea/` except the draft
 *    cache: the two event logs and every record store (`ol-egov.141.8.7`;
 *    before it, only `.olea/reviews/` + `.olea/misconceptions/`). Durable,
 *    non-rebuildable — deliberately not part of a cache purge. Runs against
 *    the OLD `deviceId`, before it is reset (step 6) — this is what lets it
 *    find *this install's own* log files by exact path even on a host that
 *    cannot list `.olea/`.
 * 3. `deleteRemainingOleaLayer` (`ol-egov.141.8.7`) — whatever is still under
 *    `.olea/` after 1 and 2: a draft the draft index never named (the purge
 *    finds drafts only through that index), or a file written between steps.
 * 4. A last discovery pass, reported as `remainingOleaPaths`: `[]` is the
 *    state in which the delete can truthfully say Olea's `.olea/` layer is
 *    gone, as far as this host can list it (`discoverOleaLayerPaths`).
 * 5. `deleteServerConfigRecord` — the one per-user Worker-side KV record
 *    (C6.4, D-005). Skipped, honestly, when the Worker was never configured
 *    (F7.1: a blank base URL/token is a legitimate, common state per F7.8 —
 *    there is nothing server-side to delete for a device that never
 *    connected).
 * 6. `resetDeviceId` — mints and persists a fresh device identity
 *    (`ol-1ttf`, ruled by `ol-ppxj.16`: a full delete mints a fresh id;
 *    `purgeCache` alone keeps preserving it). Runs last, after steps 2 to 4
 *    have already used the old id.
 *
 * **Never anything she authored (INV-6).** Every vault path removed is under
 * `.olea/` and checked again at the delete (`deleteOleaLayerPath`). Not
 * reached, deliberately, and so not claimed: her notes and the items she
 * accepted into them, `[D-179]` home notes beside a source (Olea's layer, but
 * outside `.olea/` and a note she may have written in), the export files she
 * saved under `Olea exports/`, and every `data.json` key other than the five
 * cache keys and the device id: settings, the usage log, and the other stores
 * kept there (the grove's ground streaks and read completeness among them).
 *
 * The server call and the device-id reset run whatever the server answers —
 * a full delete should not leave the vault-side purge undone because the
 * network call to the Worker timed out, or vice versa. A vault step that
 * throws (a delete the host refuses) stops the run before the reset, so the
 * old id still names the files a retry must find. Every outcome is reported,
 * never swallowed.
 */

import type { CalendarDay, VaultPath, VaultSource } from 'olea-core';
import { resetDeviceId } from '../device/device-id.js';
import type { WorkerConfig } from '../worker/transport.js';
import { type CachePurgeResult, purgeCache } from './cache-purge.js';
import { discoverOleaLayerPaths } from './log-discovery.js';
import {
  deleteServerConfigRecord,
  type ServerConfigDeleteOutcome,
} from './server-config-delete.js';
import type { DeleteHttpRequestFn, ObsidianDataHost } from './types.js';
import {
  deleteRemainingOleaLayer,
  deleteVaultArtifacts,
  type VaultArtifactDeleteResult,
} from './vault-artifact-delete.js';

export interface FullDeleteResult {
  readonly cache: CachePurgeResult;
  readonly vaultArtifacts: VaultArtifactDeleteResult;
  /** Step 3: what was still under `.olea/` after the purge and the artifact removal, now removed. */
  readonly residualOleaPaths: readonly VaultPath[];
  /** Step 4: anything a fresh discovery still finds under `.olea/` after every vault step. `[]` when the layer is gone. */
  readonly remainingOleaPaths: readonly VaultPath[];
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

  const layerDeps = {
    vault: deps.vault,
    deviceId: deps.deviceId,
    today: deps.today,
    ...(deps.probeDays !== undefined ? { probeDays: deps.probeDays } : {}),
  };
  const vaultArtifacts = await deleteVaultArtifacts(layerDeps);
  const residualOleaPaths = await deleteRemainingOleaLayer(layerDeps);
  const remainingOleaPaths = await discoverOleaLayerPaths(deps.vault, layerDeps);

  const serverConfig = isConfigured(deps.workerConfig)
    ? await deleteServerConfigRecord(deps.workerConfig, deps.httpRequest)
    : ({ outcome: 'not-configured' } as const);

  const newDeviceId = await resetDeviceId(deps.dataHost);

  return {
    cache,
    vaultArtifacts,
    residualOleaPaths,
    remainingOleaPaths,
    serverConfig,
    newDeviceId,
  };
}
