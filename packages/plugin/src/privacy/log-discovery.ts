/**
 * Discovery of what Olea wrote in her vault, for F7.4 ("Data export and full
 * delete, including cache purge and vault artifact removal") — shared by
 * `export-bundle.ts` (read it), `vault-artifact-delete.ts` and
 * `full-delete.ts` (remove it). Two halves:
 *
 * - **The whole `.olea/` layer** (`ol-egov.141.8.7`): `OLEA_LAYER_FOLDERS` is
 *   the registry of every folder a store writes under `.olea/`, each with the
 *   role F7.4 gives it, and `discoverOleaLayerPaths` walks the whole root.
 *   Before this, F7.4 reached only the two event logs and the draft cache, so
 *   a full delete left concept key records, relation caches, same-as links,
 *   outcome records, near-match proposals, citation stores and the rest behind.
 *   `test/privacy/olea-layer-coverage.spec.ts` parses every core and plugin
 *   source file and fails when a `.olea/` folder is named there but not
 *   registered here, so a new writer cannot be missed silently.
 * - **The two event logs by exact path** (`ol-p6t01`, `discoverLogPaths`
 *   below): this device's own log files are probed by constructed name, so
 *   they are found even on a host that can list nothing.
 *
 * **INV-6, by construction.** Everything `discoverOleaLayerPaths` returns is
 * under `.olea/` (`isOleaLayerPath`), Olea's own directory (C6.2, C6.2a):
 * never a note she wrote, never a sibling whose name merely starts with
 * `.olea`, never a path with a `..` segment. Olea also writes outside `.olea/`
 * (accepted items into her notes, `[D-179]` home notes beside a source, the
 * export file itself under `Olea exports/`); none of that is this module's to
 * find, and none of it is reached by the export's file section or the delete.
 *
 * **`discoverLogPaths` is modelled on `today/data-source.ts`'s
 * `readReviewHistory`, deliberately not imported from it.** That function
 * returns parsed, merged `ReviewLogEntry` records — exactly right for the
 * Today panel's streak, wrong for this feature, which needs the *paths*
 * themselves (to delete) and needs to walk `.olea/misconceptions/` too, a
 * folder that function never looks at. Re-deriving the same ~15-line discovery
 * strategy here is the same call `misconception/write.ts` makes about
 * `review-log/write.js`: "kept as a near-duplicate rather than a shared
 * helper... factoring out the byte-safety logic they share would cost an
 * abstraction for a coincidence, not a real one."
 *
 * **Listing a dot folder** (`ol-egov.141.89.10.52`, `ol-egov.141.89.10.56`):
 * `ObsidianSource.list()` never surfaces a dot-prefixed folder (it is built
 * on Obsidian's `getFiles()`), so every folder here is listed through
 * `olea-core`'s `listFolder` — `listUnder` where the host has it (the adapter
 * walk on `ObsidianSource`, recursive from the folder named), plain `list`
 * otherwise — the same routing every core store and `today/data-source.ts`
 * use for `.olea/reviews/`. A host with neither route still finds this
 * device's own log files, because they are probed by exact, constructed path
 * rather than listed; record files are named by key, not by day, so such a
 * host hides them (see `discoverOleaLayerPaths`).
 */

import type { VaultPath, VaultSource } from 'olea-core';
import {
  type CalendarDay,
  CITATION_STORE_FOLDER,
  CONCEPT_KEY_STORE_FOLDER,
  CONTENT_STORE_FOLDER,
  calendarDaysEndingOn,
  DISTRACTOR_PROVENANCE_STORE_FOLDER,
  EDGE_DISPOSITION_FOLDER,
  INSTRUMENT_TARGET_STORE_FOLDER,
  isValidDeviceId,
  isVaultPath,
  listFolder,
  MANUAL_ASSESSMENT_STORE_FOLDER,
  MISCONCEPTION_LOG_FOLDER,
  misconceptionLogPath,
  OUTCOME_CONCEPT_NEAR_MATCH_FOLDER,
  OUTCOME_STORE_FOLDER,
  PAPER_STORE_FOLDER,
  PROBE_PRESENTATION_STORE_FOLDER,
  RELATION_CACHE_FOLDER,
  REVIEW_LOG_FOLDER,
  reviewLogPath,
  SAME_AS_LINK_FOLDER,
} from 'olea-core';
// `[D-402]` binding condition 3's old-merge audit persistence (`ol-egov.141.89.3.19`) — same
// reasoning as `COMPOSITION_LOG_FOLDER` immediately above: imported by module path, not the
// `olea-core` barrel, which several lanes are concurrently landing exports into today.
import {
  MERGE_AUDIT_PROPOSAL_FOLDER,
  MERGE_REPAIR_PROPOSAL_FOLDER,
} from '../../../core/src/concept/merge-audit-store.js';
// `[D-445]` (`ol-egov.141.89.8.43`): the unit manifest store's folder and path builder, imported by
// module path for the same reason as the records above.
import {
  UNIT_MANIFEST_FOLDER,
  unitManifestLogPath,
} from '../../../core/src/ingestion/unit-manifest/log.js';
// `[D-533]` (`ol-egov.141.89.7.26`): her correction history for model-decided links, imported by
// module path for the same reason as the records above.
import { OUTCOME_CONTAINMENT_CORRECTION_FOLDER } from '../../../core/src/outcome/containment-correction.js';
// `[D-395]` (`ol-egov.141.89.10.65`): imported from its own module path, never the `olea-core`
// barrel, which is another live lane's file this round (`session/holder.ts`'s stance).
import {
  COMPOSITION_LOG_FOLDER,
  compositionLogPath,
} from '../../../core/src/study-session/composition-log.js';
// `[D-411]` (`ol-v7r5.66`): the course cutoff records, imported by module path for the same reason.
import {
  COURSE_CUTOFF_LOG_FOLDER,
  courseCutoffLogPath,
} from '../../../core/src/today/course-cutoff-log.js';
import { DRAFT_CACHE_FOLDER } from '../generation/cache-store.js';
import { RETROSPECTIVE_NOTES_FOLDER } from '../retrospective/note-writer.js';
import { DUPLICATION_CONFIRMATION_FOLDER } from '../review/duplication-confirmation-store.js';

/** Olea's own directory inside her vault (C6.2). Every path `discoverOleaLayerPaths` returns sits under it. */
export const OLEA_LAYER_ROOT: VaultPath = '.olea';

/**
 * How F7.4 carries one folder:
 * - `log` — an append-only event log (C5.2): exported parsed and merged into one stream,
 *   deleted by `deleteVaultArtifacts`, and probed by exact path for this device.
 * - `cache` — D-006's draft cache: purged by `purgeCache`, exported as files.
 * - `record` — every other store: exported as the exact text on disk, deleted by
 *   `deleteVaultArtifacts`.
 */
export type OleaLayerFolderRole = 'log' | 'cache' | 'record';

export interface OleaLayerFolder {
  readonly folder: VaultPath;
  readonly role: OleaLayerFolderRole;
}

/**
 * Every folder a core or plugin store writes under `.olea/`, each constant imported from its
 * owning module wherever one is exported. Discovery walks the whole root, so a folder missing
 * here is still found on a host that can list `.olea/`; the registry is what gives each folder
 * its role, and what the coverage guard holds every writer to.
 */
export const OLEA_LAYER_FOLDERS: readonly OleaLayerFolder[] = [
  { folder: REVIEW_LOG_FOLDER, role: 'log' },
  { folder: MISCONCEPTION_LOG_FOLDER, role: 'log' },
  { folder: DRAFT_CACHE_FOLDER, role: 'cache' },
  { folder: CONTENT_STORE_FOLDER, role: 'record' },
  { folder: CONCEPT_KEY_STORE_FOLDER, role: 'record' },
  { folder: RELATION_CACHE_FOLDER, role: 'record' },
  { folder: EDGE_DISPOSITION_FOLDER, role: 'record' },
  { folder: SAME_AS_LINK_FOLDER, role: 'record' },
  { folder: OUTCOME_STORE_FOLDER, role: 'record' },
  { folder: OUTCOME_CONCEPT_NEAR_MATCH_FOLDER, role: 'record' },
  { folder: CITATION_STORE_FOLDER, role: 'record' },
  { folder: DISTRACTOR_PROVENANCE_STORE_FOLDER, role: 'record' },
  { folder: PAPER_STORE_FOLDER, role: 'record' },
  { folder: DUPLICATION_CONFIRMATION_FOLDER, role: 'record' },
  { folder: RETROSPECTIVE_NOTES_FOLDER, role: 'record' },
  { folder: MANUAL_ASSESSMENT_STORE_FOLDER, role: 'record' },
  // `ol-egov.141.8.15`: the probe presentation records (one write-once file per presented probe,
  // named by instrument id), exported as the text on disk and removed by the full delete.
  { folder: PROBE_PRESENTATION_STORE_FOLDER, role: 'record' },
  // `[D-395]`: the composition records, an append-only daily-per-device stream that is not an
  // event log of C5.2's (no review or misconception fold reads it), so F7.4 carries it as the
  // exact text on disk and the full delete removes it — `[D-331]` choice 4 (a), kept like the
  // review log and never pruned. Probed by exact path for this device too
  // (`OLEA_PROBED_DAILY_STREAMS`), since its files are named by day like the logs'.
  { folder: COMPOSITION_LOG_FOLDER, role: 'record' },
  // `[D-402]` binding condition 3 (`ol-egov.141.89.3.19`): the old-merge audit's own proposal and
  // repair-proposal records — data only, never applied, but exported/deleted like every other
  // record folder so a full delete does not leave them behind.
  { folder: MERGE_AUDIT_PROPOSAL_FOLDER, role: 'record' },
  { folder: MERGE_REPAIR_PROPOSAL_FOLDER, role: 'record' },
  // `[D-411]` (`ol-v7r5.66`): the course cutoff records, append-only and written once per course,
  // named by day and device like the composition records, so probed by exact path too. Carried as
  // the exact text on disk and removed by the full delete; never pruned.
  { folder: COURSE_CUTOFF_LOG_FOLDER, role: 'record' },
  // `[D-445]` (`ol-egov.141.89.8.43`): the unit manifest, an append-only daily-per-device stream of
  // what this install has read of her material (paths, pages, states, digests; a partial reading's
  // own coverage words). Not an event log of C5.2's, so F7.4 carries it as the exact text on disk and
  // the full delete removes it, like the composition records; never pruned. Probed by exact path for
  // this device too (`OLEA_PROBED_DAILY_STREAMS`), since its files are named by day.
  { folder: UNIT_MANIFEST_FOLDER, role: 'record' },
  // `[D-437]` (`ol-egov.141.89.2.26`, B4): the instrument target records, one write-once file per
  // newly authored instrument whose request carried an acknowledged demand, named by instrument id
  // (`{ demandBasis: 'authoring-intent', declaredDemand, origin, questionBinding, generator }`: five
  // demand words, a one-way digest and a task id, never her wording). Not a log, so F7.4 carries it
  // as the exact text on disk and the full delete removes it; never pruned, and absence of a record
  // is the permanent unspecified state, so a full delete leaves every instrument unspecified.
  { folder: INSTRUMENT_TARGET_STORE_FOLDER, role: 'record' },
  // `[D-533]` (`ol-egov.141.89.7.26`): her correction history for a model-decided objectives or
  // stated-scope link, one append-only file per (declaration, concept) named by an opaque digest.
  // Her own decisions, so F7.4 carries each file as the exact text on disk and the full delete
  // removes it, as the ruling requires; never pruned.
  { folder: OUTCOME_CONTAINMENT_CORRECTION_FOLDER, role: 'record' },
];

/**
 * True only for a file path strictly inside `.olea/`: a valid vault path whose first segment is
 * exactly `.olea`, with at least one more segment and no empty, `.` or `..` segment.
 * `.olea-harness/...`, `.oleander/...` and `notes/.olea/...` are all false.
 */
export function isOleaLayerPath(path: VaultPath): boolean {
  if (!isVaultPath(path)) return false;
  const segments = path.split('/');
  if (segments[0] !== OLEA_LAYER_ROOT || segments.length < 2) return false;
  return segments
    .slice(1)
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** True when `path` sits in a registered folder of the given role. */
export function isInOleaLayerRole(path: VaultPath, role: OleaLayerFolderRole): boolean {
  return OLEA_LAYER_FOLDERS.some(
    (entry) => entry.role === role && path.startsWith(`${entry.folder}/`),
  );
}

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
 * Every path under `folder` this call can find: whatever the folder listing
 * surfaces (any device, where the host can list it — see the module doc)
 * unioned with `deviceId`'s own file for each of the last
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
    const listed = await listFolder(vault, folder);
    for (const path of listed) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      if (LOG_FILE_RE.test(name)) candidates.add(path);
    }
  } catch {
    // A host that refuses to list a dot-prefixed folder, or whose walk
    // throws, is an expected case (see the module doc) — this device's own
    // files are still found by exact-path probing below.
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

/**
 * True when `path` is an event-log file of `folder` as `discoverLogPaths` counts one: inside the
 * folder, named `<YYYY-MM-DD>.<deviceId>.jsonl`. Lets a caller holding `discoverOleaLayerPaths`'s
 * result split the logs out without probing a second time. Any other file in a log folder is not
 * a log line source; the export carries it as a file and the delete removes it like a record.
 */
export function isEventLogPath(path: VaultPath, folder: VaultPath): boolean {
  if (!path.startsWith(`${folder}/`)) return false;
  return LOG_FILE_RE.test(path.slice(path.lastIndexOf('/') + 1));
}

/** The two event logs, each with the constructed path `discoverLogPaths` probes for this device. */
export const OLEA_EVENT_LOGS: ReadonlyArray<{
  readonly folder: VaultPath;
  readonly pathFor: (day: CalendarDay, deviceId: string) => VaultPath;
}> = [
  { folder: REVIEW_LOG_FOLDER, pathFor: reviewLogPath },
  { folder: MISCONCEPTION_LOG_FOLDER, pathFor: misconceptionLogPath },
];

/**
 * Every stream whose files are named `<YYYY-MM-DD>.<deviceId>.jsonl`, and so can be probed by
 * exact path for this device on a host that lists nothing: the two event logs, plus the
 * composition records (`[D-395]`), which share the naming but are carried as record files.
 */
export const OLEA_PROBED_DAILY_STREAMS: ReadonlyArray<{
  readonly folder: VaultPath;
  readonly pathFor: (day: CalendarDay, deviceId: string) => VaultPath;
}> = [
  ...OLEA_EVENT_LOGS,
  { folder: COMPOSITION_LOG_FOLDER, pathFor: compositionLogPath },
  { folder: COURSE_CUTOFF_LOG_FOLDER, pathFor: courseCutoffLogPath },
  { folder: UNIT_MANIFEST_FOLDER, pathFor: unitManifestLogPath },
];

export interface DiscoverOleaLayerOptions {
  readonly deviceId: string;
  readonly today: CalendarDay;
  /** Defaults to `DEFAULT_LOG_PROBE_DAYS`. */
  readonly probeDays?: number;
}

async function listedUnder(vault: VaultSource, folder: VaultPath): Promise<readonly VaultPath[]> {
  try {
    return await listFolder(vault, folder);
  } catch {
    // A host that refuses to list a dot folder, or whose walk throws: an expected case (module doc).
    return [];
  }
}

/**
 * Every file under `.olea/` this host lets us find: the whole root walked (`listFolder`, the
 * adapter walk on `ObsidianSource`), each registered folder listed as well (a host whose listing
 * serves an exact folder but not the root), and this device's own two event logs probed by exact
 * path, with this device's composition-record files (`OLEA_PROBED_DAILY_STREAMS`). Filtered to
 * `isOleaLayerPath`, checked to exist, de-duplicated and sorted.
 *
 * **What a host that lists nothing hides.** It still yields this device's own logs and
 * composition records, and nothing else: other record files are named by key, not by day, so
 * there is no path to probe. The production
 * host, `ObsidianSource`, lists `.olea/` through `listUnder`.
 */
export async function discoverOleaLayerPaths(
  vault: VaultSource,
  options: DiscoverOleaLayerOptions,
): Promise<VaultPath[]> {
  const probeDays = options.probeDays ?? DEFAULT_LOG_PROBE_DAYS;
  const candidates = new Set<VaultPath>(await listedUnder(vault, OLEA_LAYER_ROOT));
  for (const { folder } of OLEA_LAYER_FOLDERS) {
    for (const path of await listedUnder(vault, folder)) candidates.add(path);
  }

  const found = new Set<VaultPath>();
  for (const path of candidates) {
    if (isOleaLayerPath(path) && (await vault.exists(path))) found.add(path);
  }
  for (const { folder, pathFor } of OLEA_PROBED_DAILY_STREAMS) {
    const probed = await discoverLogPaths(
      vault,
      folder,
      pathFor,
      options.deviceId,
      options.today,
      probeDays,
    );
    for (const path of probed) if (isOleaLayerPath(path)) found.add(path);
  }
  return [...found].sort();
}
