/**
 * `buildPrivacyExportBundle` — F7.4's export leg (`ol-p6t01`, widened by
 * `ol-egov.141.8.7`): "export bundles logs + instruments" into one object she
 * can save, and now every other file Olea wrote under `.olea/` as well. F7.4's
 * clause: "Data export and full delete, including cache purge and vault
 * artifact removal."
 *
 * **Logs** — her review-event history and misconception history, both
 * durable vault content (`vault-artifact-delete.ts`'s module doc). Found by
 * `discoverOleaLayerPaths` (the same discovery the delete uses), then parsed
 * with `olea-core`'s own tolerant parsers (`parseReviewLog`,
 * `parseMisconceptionLog` — a corrupt trailing line is skipped, never fails
 * the whole export) and merged into one deduplicated, deterministically
 * ordered stream per log (`mergeReviewLogRecords`, `mergeMisconceptionEvents`)
 * so a multi-device vault exports one coherent timeline rather than one blob
 * per device file.
 *
 * **Olea's other files** (`oleaFiles`, `ol-egov.141.8.7`) — every other file
 * under `.olea/`: concept key records, relation caches and dispositions,
 * same-as links, outcome records and near-match proposals, citation and
 * distractor-provenance sidecars, paper records, the explain-back content
 * store, duplicate-confirmation records, accepted retrospective notes, the
 * draft cache, and any file in a folder this build does not name
 * (`OLEA_LAYER_FOLDERS` in `log-discovery.ts` is the list). Each travels as
 * the exact text read from disk with its vault path, never re-serialised, so
 * the export is what is actually there. Before `ol-egov.141.8.7` none of these
 * were exported. A file that is found but cannot be read is named in
 * `unreadableOleaPaths`, never silently dropped.
 *
 * **Instruments** — practice items (Q&A/cloze/MCQ) parsed out of her own
 * notes via `enumerateVaultInstruments`, the single join point
 * `olea-core`'s `session/enumerate.ts` already owns ("deliberately the
 * *only* place a note's bytes become an instrument record"). Each carries
 * its exact source `raw` text — no paraphrase, no re-serialization — so the
 * export reflects what is actually in her notes. This is the one part of the
 * bundle read from outside `.olea/`, as `ol-p6t01`'s acceptance criterion
 * ("export bundles logs + instruments") asks; nothing else here is.
 *
 * **Read-only, with one exception it inherits.** This function writes
 * nothing itself — not to `data.json`, not to the vault, never to anything she
 * authored. The exception is `[D-357]`'s concept-key stamping inside
 * `enumerateVaultInstruments`: a concept with no permanent key record yet gets
 * one minted under `.olea/concepts/`, the same write every production concept
 * read makes (`olea-layer-fixture.spec.ts` pins that nothing else is written).
 * Nothing here is a delete-target discussion; see
 * `cache-purge.ts`/`vault-artifact-delete.ts` for those.
 *
 * **Settings-stored records** (`settings`, `ol-egov.141.8.11`, ruled by
 * `[D-393]`) — every key of the plugin's settings file (`data.json`) that
 * `data-manifest.ts` classifies as content-derived, with its stored value:
 * pending work, the record stores kept there, and the usage record. The same
 * list a full delete clears, so what the export carries and what the delete
 * removes are one list. Never configuration, so never the Worker token
 * (`[D-393]` condition 3); never safety state, the device id, or a key the
 * manifest does not list. Before `ol-egov.141.8.11` no settings key was
 * exported. `null` when the caller passes no `dataHost`.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type CalendarDay,
  type EnumerateVaultInstrumentsOptions,
  enumerateVaultInstruments,
  MISCONCEPTION_LOG_FOLDER,
  type MisconceptionEvent,
  mergeMisconceptionEvents,
  mergeReviewLogRecords,
  parseMisconceptionLog,
  parseReviewLog,
  REVIEW_LOG_FOLDER,
  type VaultInstrumentRecord,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { readContentDerivedSettings } from './data-manifest.js';
import {
  DEFAULT_LOG_PROBE_DAYS,
  discoverOleaLayerPaths,
  isEventLogPath,
  isOleaLayerPath,
} from './log-discovery.js';
import type { ObsidianDataHost } from './types.js';

/**
 * 3 since `ol-egov.141.8.11` added `settings`; 2 since `ol-egov.141.8.7` added `oleaFiles` and
 * `unreadableOleaPaths`; a version-1 bundle carries none of them.
 */
export const PRIVACY_EXPORT_BUNDLE_VERSION = 3 as const;

/** One file Olea wrote under `.olea/`, as the exact text on disk. */
export interface PrivacyExportFile {
  readonly path: VaultPath;
  readonly content: string;
}

export interface PrivacyExportBundle {
  readonly version: typeof PRIVACY_EXPORT_BUNDLE_VERSION;
  /** ISO-8601, when this bundle was built (not stored anywhere — computed at export time). */
  readonly exportedAt: string;
  readonly reviewLog: readonly ReviewLogEntry[];
  readonly misconceptionLog: readonly MisconceptionEvent[];
  readonly instruments: readonly VaultInstrumentRecord[];
  /** Every file under `.olea/` other than the event-log files parsed into the two logs above, sorted by path. */
  readonly oleaFiles: readonly PrivacyExportFile[];
  /** Files under `.olea/` found but not readable, log files included — so a partial export says it is one. */
  readonly unreadableOleaPaths: readonly VaultPath[];
  /** Every content-derived settings key present, by key (`data-manifest.ts`); `null` when no `dataHost` was given. */
  readonly settings: Readonly<Record<string, unknown>> | null;
}

export interface BuildPrivacyExportBundleDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  /**
   * The plugin's settings file, read for its content-derived keys (`settings`). Optional only so
   * a caller predating `ol-egov.141.8.11` still compiles; the settings pane must pass it, or the
   * bundle carries `settings: null` and misses every settings-stored record.
   */
  readonly dataHost?: ObsidianDataHost;
  /** Defaults to `DEFAULT_LOG_PROBE_DAYS` (`log-discovery.ts`). */
  readonly probeDays?: number;
  /** Passed through to `enumerateVaultInstruments` unchanged — a caller that needs a non-default Zettelkasten folder or a pinned instrument-id source. */
  readonly instrumentOptions?: EnumerateVaultInstrumentsOptions;
  /** Injectable for a deterministic `exportedAt` in tests. Defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
}

async function readOrNull(vault: VaultSource, path: VaultPath): Promise<string | null> {
  try {
    return await vault.read(path);
  } catch {
    return null;
  }
}

export async function buildPrivacyExportBundle(
  deps: BuildPrivacyExportBundleDeps,
): Promise<PrivacyExportBundle> {
  const probeDays = deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS;
  const now = deps.now ?? (() => new Date().toISOString());

  // `[D-357]`: each exported instrument names its concepts by their permanent keys — the keys her
  // exported review log carries — so the bundle joins with itself. A caller's own `concepts`
  // options (a non-default folder, say) are kept; stamping is not one of them to switch off.
  // Enumerated BEFORE `.olea/` is read: stamping mints and persists a key record under
  // `.olea/concepts/` for a concept that has none yet, and reading the layer afterwards is what
  // puts that record in `oleaFiles` beside the instrument that names it.
  const { records: instruments } = await enumerateVaultInstruments(deps.vault, {
    ...(deps.instrumentOptions ?? {}),
    concepts: { ...(deps.instrumentOptions?.concepts ?? {}), stampConceptKeys: true },
  });

  const layerPaths = await discoverOleaLayerPaths(deps.vault, {
    deviceId: deps.deviceId,
    today: deps.today,
    probeDays,
  });
  const unreadableOleaPaths: VaultPath[] = [];

  const reviewSources: ReviewLogEntry[][] = [];
  const misconceptionSources: MisconceptionEvent[][] = [];
  const oleaFiles: PrivacyExportFile[] = [];
  for (const path of layerPaths) {
    // Discovery returns only `.olea/` paths; checked again here because this is what leaves the vault.
    if (!isOleaLayerPath(path)) continue;
    const content = await readOrNull(deps.vault, path);
    if (content === null) {
      unreadableOleaPaths.push(path);
    } else if (isEventLogPath(path, REVIEW_LOG_FOLDER)) {
      reviewSources.push([...parseReviewLog(content).records]);
    } else if (isEventLogPath(path, MISCONCEPTION_LOG_FOLDER)) {
      misconceptionSources.push([...parseMisconceptionLog(content).events]);
    } else {
      oleaFiles.push({ path, content });
    }
  }
  const reviewLog = mergeReviewLogRecords(...reviewSources).records;
  const misconceptionLog = mergeMisconceptionEvents(...misconceptionSources).events;
  const settings =
    deps.dataHost === undefined ? null : await readContentDerivedSettings(deps.dataHost);

  return {
    version: PRIVACY_EXPORT_BUNDLE_VERSION,
    exportedAt: now(),
    reviewLog,
    misconceptionLog,
    instruments,
    oleaFiles,
    unreadableOleaPaths,
    settings,
  };
}
