/**
 * `runFullDelete` — F7.4's composite "full delete" action (`ol-p6t01`):
 * "delete purges cache, server config record, and vault artifacts on
 * request" (the bead's acceptance criterion, verbatim). F7.4's clause: "Data
 * export and full delete, including cache purge and vault artifact removal."
 *
 * Orchestrates these steps, each independently testable and callable:
 *
 * 0. `markPausedAfterFullDelete` (`[D-406]`) — records in the settings file that a full delete
 *    ran, before anything is removed. The reload that follows the delete (and every later start,
 *    until she chooses Start) then holds at `holdIfPausedAfterFullDelete` below: nothing is read,
 *    built or sent. Written first so that a delete interrupted at any later step (a vault step
 *    that throws, Obsidian closed mid-run) also starts paused: nothing is rebuilt from a
 *    half-deleted state until she acts. The marker is classified `delete-pause`, so step 6 keeps
 *    it and the export never carries it.
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
 * 3a. `removeEmptiedOleaFolders` (`ol-egov.141.8.9`, found by `ol-egov.141.8.7`):
 *    every file removed in 1-3 leaves its folder behind — `VaultSource` could
 *    delete files but had no way to remove a directory — so a full delete
 *    emptied `.olea/`'s stores without ever taking the (now-empty) tree down.
 *    Removes every folder that emptying could have affected, deepest first,
 *    then `.olea/` itself, using the new optional `VaultSource.removeEmptyFolder`
 *    primitive. Skipped entirely on a host without that primitive (nothing
 *    attempted, nothing reported as unremovable — a host limitation, not a
 *    failure). A folder still holding something this host could not discover
 *    is refused by the primitive itself and reported in
 *    `unremovableOleaFolders`, never thrown — the same "report, don't throw"
 *    posture `remainingOleaPaths` already takes for files.
 * 4. A last discovery pass, reported as `remainingOleaPaths`: `[]` is the
 *    state in which the delete can truthfully say Olea's `.olea/` layer is
 *    gone, as far as this host can list it (`discoverOleaLayerPaths`).
 * 5. `deleteServerConfigRecord` — the one per-user Worker-side KV record
 *    (C6.4, D-005). Skipped, honestly, when the Worker was never configured
 *    (F7.1: a blank base URL/token is a legitimate, common state per F7.8 —
 *    there is nothing server-side to delete for a device that never
 *    connected).
 * 6. `clearContentDerivedSettings` (`ol-egov.141.8.11`, ruled by `[D-393]`) —
 *    every content-derived key in the plugin's settings file (`data.json`),
 *    as classified by `data-manifest.ts`: pending work (the ingestion and
 *    regrading queues), the record stores kept there (grove streaks and read
 *    completeness, registry overrides, avoidance and scope-growth answers,
 *    material arrivals, the judge-case capture among them) and the usage
 *    record, plus any key the manifest does not list. Configuration (the
 *    Worker connection, term dates, the assessments table path, the heading
 *    offer toggle) and safety state (the explain-back audit gate) are kept.
 *    Before this step, only the five cache keys of step 1 were cleared. Runs
 *    after the vault steps, so a vault step that throws leaves this for the
 *    retry, and as late as possible, so the window in which a still-running
 *    writer could put a cleared key back is as short as the run allows.
 * 7. `resetDeviceId` — mints and persists a fresh device identity
 *    (`ol-1ttf`, ruled by `ol-ppxj.16`: a full delete mints a fresh id;
 *    `purgeCache` alone keeps preserving it). Runs last, after steps 2 to 4
 *    have already used the old id.
 *
 * **Never anything she authored (INV-6).** Every vault path removed is under
 * `.olea/` and checked again at the delete (`deleteOleaLayerPath`). Not
 * reached, deliberately, and so not claimed: her notes and the items she
 * accepted into them, `[D-179]` home notes beside a source (Olea's layer, but
 * outside `.olea/` and a note she may have written in), the export files she
 * saved under `Olea exports/`, and the settings `data-manifest.ts` classifies
 * as configuration or safety state.
 *
 * **After the delete: paused until she acts (`[D-406]`).** `holdIfPausedAfterFullDelete` is the
 * one check `main.ts`'s `onload` makes before anything else. While the marker is present it reads
 * nothing but the settings file, seals the new instance's writers for good (the same
 * `FullDeleteWriteSeal` the delete uses, so not even the unload-time gate-stage flush can write a
 * store back), shows `FULL_DELETE_PAUSE_LINE` and offers `FULL_DELETE_START_LABEL`; `onload` then
 * returns, so no view, tick, index, queue or Worker call is set up. Choosing Start lifts the
 * marker through the sealed instance's unsealed host and reloads the plugin, and the fresh
 * instance starts as usual.
 *
 * The server call, the settings clear and the device-id reset run whatever the server answers —
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
import { FULL_DELETE_PAUSE_LINE, FULL_DELETE_START_LABEL } from './copy.js';
import {
  clearContentDerivedSettings,
  isPausedAfterFullDelete,
  liftFullDeletePause,
  markPausedAfterFullDelete,
  type SettingsClearResult,
} from './data-manifest.js';
import {
  discoverOleaLayerPaths,
  isOleaLayerPath,
  OLEA_LAYER_FOLDERS,
  OLEA_LAYER_ROOT,
} from './log-discovery.js';
import {
  deleteServerConfigRecord,
  type ServerConfigDeleteOutcome,
} from './server-config-delete.js';
import type { SealedFullDeleteHost } from './settings-section.js';
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
  /**
   * Step 3a: every folder under `.olea/` (including `.olea/` itself) removed because emptying it
   * left nothing behind. `[]` on a host with no `VaultSource.removeEmptyFolder` primitive — not a
   * failure, see the module doc.
   */
  readonly removedOleaFolders: readonly VaultPath[];
  /**
   * Step 3a: a folder this host's primitive refused because it still held something the delete's
   * discovery could not find (or could not remove) — reported, never thrown, beside
   * `remainingOleaPaths`. `[]` in the ordinary case.
   */
  readonly unremovableOleaFolders: readonly VaultPath[];
  /** Step 4: anything a fresh discovery still finds under `.olea/` after every vault step. `[]` when the layer is gone. */
  readonly remainingOleaPaths: readonly VaultPath[];
  /** `{ outcome: 'not-configured' }` when `workerConfig` has no base URL or token — see the module doc. */
  readonly serverConfig: ServerConfigDeleteOutcome | { readonly outcome: 'not-configured' };
  /** Step 6: the content-derived (and any unlisted) settings keys removed — see `data-manifest.ts`. */
  readonly settings: SettingsClearResult;
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

/** Every ancestor folder of `path` that sits strictly inside `.olea/`, nearest first. */
function oleaAncestorsOf(path: VaultPath): VaultPath[] {
  const ancestors: VaultPath[] = [];
  let dir = path.slice(0, path.lastIndexOf('/'));
  while (isOleaLayerPath(dir)) {
    ancestors.push(dir);
    dir = dir.slice(0, dir.lastIndexOf('/'));
  }
  return ancestors;
}

/**
 * `ol-egov.141.8.9`: removes every folder under `.olea/` that emptying (steps 1-3) could have
 * left behind, deepest first, then `.olea/` itself. Never a folder outside `.olea/` — every
 * candidate is either a registered `OLEA_LAYER_FOLDERS` entry, an ancestor of a path this run
 * actually removed (both checked again with `isOleaLayerPath`), or the root constant itself.
 *
 * Skipped entirely when `vault.removeEmptyFolder` is not implemented: a host limitation, not a
 * failure, so nothing is reported as unremovable in that case (see the module doc).
 */
async function removeEmptiedOleaFolders(
  vault: VaultSource,
  removedPaths: readonly VaultPath[],
): Promise<{ readonly removed: readonly VaultPath[]; readonly unremovable: readonly VaultPath[] }> {
  if (vault.removeEmptyFolder === undefined) return { removed: [], unremovable: [] };

  const candidates = new Set<VaultPath>();
  for (const { folder } of OLEA_LAYER_FOLDERS) candidates.add(folder);
  for (const path of removedPaths)
    for (const ancestor of oleaAncestorsOf(path)) candidates.add(ancestor);

  const deepestFirst = [...candidates]
    .filter((folder) => isOleaLayerPath(folder))
    .sort((a, b) => b.split('/').length - a.split('/').length);
  const ordered: VaultPath[] = [...deepestFirst, OLEA_LAYER_ROOT];

  const removed: VaultPath[] = [];
  const unremovable: VaultPath[] = [];
  for (const folder of ordered) {
    try {
      await vault.removeEmptyFolder(folder);
      removed.push(folder);
    } catch {
      unremovable.push(folder);
    }
  }
  return { removed, unremovable };
}

export async function runFullDelete(deps: RunFullDeleteDeps): Promise<FullDeleteResult> {
  // Step 0 (`[D-406]`): before anything is removed — see the module doc.
  await markPausedAfterFullDelete(deps.dataHost);

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

  const allRemovedPaths = [
    ...cache.deletedDraftPaths,
    ...vaultArtifacts.deletedReviewLogPaths,
    ...vaultArtifacts.deletedMisconceptionLogPaths,
    ...vaultArtifacts.deletedRecordPaths,
    ...residualOleaPaths,
  ];
  const { removed: removedOleaFolders, unremovable: unremovableOleaFolders } =
    await removeEmptiedOleaFolders(deps.vault, allRemovedPaths);

  const remainingOleaPaths = await discoverOleaLayerPaths(deps.vault, layerDeps);

  const serverConfig = isConfigured(deps.workerConfig)
    ? await deleteServerConfigRecord(deps.workerConfig, deps.httpRequest)
    : ({ outcome: 'not-configured' } as const);

  const settings = await clearContentDerivedSettings(deps.dataHost);

  const newDeviceId = await resetDeviceId(deps.dataHost);

  return {
    cache,
    vaultArtifacts,
    residualOleaPaths,
    removedOleaFolders,
    unremovableOleaFolders,
    remainingOleaPaths,
    serverConfig,
    settings,
    newDeviceId,
  };
}

/**
 * What `holdIfPausedAfterFullDelete` needs from the plugin instance (`[D-406]`). `main.ts`
 * supplies it at the top of `onload`; each member is one Obsidian call there, so this module stays
 * free of `obsidian` and testable under Vitest.
 */
export interface FullDeletePauseHost {
  /** The settings file, read once to find the marker. The only read a paused start makes. */
  loadData(): Promise<unknown>;
  /** Seals every writer of this instance, in the settings file and under `.olea/` (`FullDeleteWriteSeal`). */
  sealForFullDelete(): Promise<SealedFullDeleteHost>;
  /** Shows her the one-line explanation. */
  explain(line: string): void;
  /** Offers her one deliberate action under `label`; choosing it runs `start`. */
  offerStart(label: string, start: () => Promise<void>): void;
  /** Reloads the plugin once the pause is lifted (`reloadPluginAfterFullDelete`). */
  reload(): Promise<void>;
}

/**
 * `[D-406]`: the check at the top of `onload`. Resolves `false`, having done nothing but read the
 * settings file, when no full delete is waiting for her Start; `onload` then runs as usual.
 * Resolves `true` when it is: the instance is sealed for good, the explanation is shown and Start
 * is offered, and `onload` must return at once (module doc). A failure to read the settings file
 * or to seal is thrown, not swallowed: an `onload` that throws builds nothing either.
 */
export async function holdIfPausedAfterFullDelete(host: FullDeletePauseHost): Promise<boolean> {
  if (!(await isPausedAfterFullDelete(host))) return false;
  // Never released: this instance only ever explains and offers Start, and a sealed instance that
  // unloads skips the gate-stage flush (`FullDeleteWriteSeal.retire`).
  const sealed = await host.sealForFullDelete();
  host.explain(FULL_DELETE_PAUSE_LINE);
  let starting = false;
  host.offerStart(FULL_DELETE_START_LABEL, async () => {
    if (starting) return;
    starting = true;
    try {
      await liftFullDeletePause(sealed.dataHost);
      await host.reload();
    } finally {
      starting = false;
    }
  });
  return true;
}
