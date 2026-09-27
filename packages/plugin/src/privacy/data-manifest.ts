/**
 * The settings-storage manifest (`ol-egov.141.8.11`, ruled by `[D-393]`): every top-level key the
 * plugin reads or writes in its one settings file (Obsidian's `data.json` for this plugin) is
 * listed here exactly once, with one classification. `runFullDelete` and
 * `buildPrivacyExportBundle` act on this list and nothing else, so what the delete clears and what
 * the export carries cannot drift apart, and cannot silently miss a store.
 *
 * **The classifications, and what each one means for F7.4:**
 *
 * - `content-derived` — anything derived from her notes, her studying or her use of Olea: record
 *   stores, caches, answers she gave to Olea's questions, pending work (the ingestion and
 *   regrading queues), usage records. **Cleared by a full delete, and carried in the export.**
 *   Everything that is not one of the three classes below belongs here — `[D-393]`: a full delete
 *   "keeps only configuration she would otherwise have to re-enter ... and safety state".
 * - `configuration` — a value she entered in settings and would otherwise have to enter again
 *   (the Worker connection, term dates, the assessments table path, a toggle). **Kept by a full
 *   delete; not carried in the export.** A configuration key marked `credential` (the Worker
 *   token) could never be exported in any case — `[D-393]` binding condition 3.
 * - `safety` — state an operator sets to keep a feature from misbehaving (the explain-back audit
 *   gate). **Kept by a full delete; not exported.** Clearing it would silently re-enable a feature
 *   the audit paused.
 * - `device-identity` — this install's random device id. **Replaced, never kept:** a full delete
 *   mints a fresh one (`resetDeviceId`, ruled by `ol-ppxj.16`), after the vault steps have used the
 *   old one to find this device's own log files. Not exported: it is a random identifier, not her
 *   data, and the exported review history already names the device each entry came from.
 *
 * **The guard.** `test/privacy/data-manifest-coverage.spec.ts` parses every plugin source file
 * that reads or writes the settings file and fails when a key constant there has no entry here,
 * when an entry here names no key any source file still uses, or when a store names a key in a
 * form the scan cannot read. A new store therefore cannot be added without a classification, and
 * an omission fails the check instead of leaking past the delete.
 *
 * **A key found at runtime that is not listed here** (written by an older build, say) is cleared
 * by a full delete and not exported: the delete fails closed on her side (the button reads
 * "Delete everything"), and the export fails closed on the credential side (an unknown value
 * could hold anything). `clearContentDerivedSettings` reports such keys by name so the asymmetry
 * is visible, never silent.
 *
 * **Out of this file's reach, and handled where the writers are:** values held in memory by a
 * running plugin instance and written back later. A full delete clears what is on disk; a store
 * that later saved an in-memory copy it loaded before the delete would write that copy back, and
 * `main.ts`'s `onunload` flush of the retrieval gate-stage counts would write the pre-delete counts
 * back under `gateStagePeriod` during the reload that follows. Neither can: the settings pane seals
 * the plugin's one settings host before the delete starts (`FullDeleteWriteSeal`,
 * `settings-section.ts`, `ol-egov.141.8.12`), so every later write from that instance is dropped,
 * and the unload flush runs only when the instance was not sealed. The same seal closes the
 * instance's writes under `.olea/` (`olea-layer-write-seal.ts`, `ol-egov.141.8.14`). When no reload
 * follows (the delete threw, or the host has no reload API) the seal lifts and the instance writes
 * as before; that case stays open beside `[D-406]`. This file still names only which keys a delete
 * clears and an export carries; it holds no writer.
 */

import { CORPUS_RELATION_STATE_STORAGE_KEY } from '../concept/corpusRelationStateStore.js';
import { CONTEST_REGRADE_QUEUE_STORAGE_KEY } from '../contest-regrade/queue-store.js';
import { DEVICE_ID_STORAGE_KEY } from '../device/device-id.js';
import {
  GROVE_GROUND_STREAK_PASS_STORAGE_KEY,
  GROVE_GROUND_STREAKS_STORAGE_KEY,
} from '../grove/ground-streak-store.js';
import { GROVE_PRIOR_DENOMINATORS_STORAGE_KEY } from '../grove/prior-denominator-store.js';
import { GROVE_READ_COMPLETENESS_STORAGE_KEY } from '../grove/read-completeness-store.js';
import { HOME_AVOIDANCE_STORAGE_KEY } from '../home/avoidance.js';
import { HOME_SCOPE_GROWTH_STORAGE_KEY } from '../home/scope-growth-store.js';
import { CITATION_ANCHOR_STORAGE_KEY } from '../ingestion/materiality/citation-hash-store.js';
import { MATERIALITY_HASH_STORAGE_KEY } from '../ingestion/materiality/hash-store.js';
import { INGESTION_QUEUE_STORAGE_KEY } from '../ingestion/queue-store.js';
import { KEYWORD_INDEX_STORAGE_KEY } from '../keyword-index/store.js';
import { MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY } from '../misconception-embedder.js';
import { PLAN_POLICY_CACHE_STORAGE_KEY } from '../plan/plan-policy-wiring.js';
import { STUDY_PLAN_SETTINGS_STORAGE_KEY } from '../plan/settings-store.js';
import { STUDY_PLAN_STORAGE_KEY } from '../plan/store.js';
import { REGISTRY_OVERRIDES_STORAGE_KEY } from '../registry/overrides-store.js';
import { EMBEDDING_CACHE_STORAGE_KEY } from '../retrieval/embedding-cache-store.js';
import { GATE_STAGE_STORAGE_KEY } from '../retrieval/gate-stage-store.js';
import {
  JUDGE_CASE_CAPTURE_CONFIG_KEY,
  JUDGE_CASE_CAPTURE_STORAGE_KEY,
} from '../retrieval/judge-case-capture.js';
import { hasReadModifyWrite } from '../retrieval/serializing-data-host.js';
import { EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY } from '../settings/explain-back-audit-gate.js';
import { HEADING_OFFER_SETTING_STORAGE_KEY } from '../settings/heading-offer-setting.js';
import { MATERIAL_ARRIVAL_STORAGE_KEY } from '../today/material-arrival-store.js';
import { TERM_WINDOW_STORAGE_KEY } from '../today/term-window-store.js';
import { USAGE_LOG_STORAGE_KEY } from '../usage/log-store.js';
import { WORKER_CONFIG_STORAGE_KEY } from '../worker/config-store.js';
import type { ObsidianDataHost } from './types.js';

export type SettingsKeyClass = 'content-derived' | 'configuration' | 'safety' | 'device-identity';

export interface SettingsKeyEntry {
  readonly key: string;
  readonly classification: SettingsKeyClass;
  /** `configuration` only: the value holds a credential. Never exported (`[D-393]` condition 3). */
  readonly credential?: true;
  /** One plain line: what the key holds. For a reader of this file, never shown to her. */
  readonly holds: string;
}

/** Every settings key, once. Order groups by classification; nothing reads it as meaningful. */
export const SETTINGS_KEY_MANIFEST: readonly SettingsKeyEntry[] = [
  // Pending work: jobs waiting to run or to be sent (`[D-393]` condition 1).
  {
    key: INGESTION_QUEUE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'pending ingestion jobs for her documents',
  },
  {
    key: CONTEST_REGRADE_QUEUE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'pending regrading jobs for answers she contested',
  },
  // Caches rebuildable from her vault (D-006).
  {
    key: STUDY_PLAN_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the cached study plan',
  },
  {
    key: KEYWORD_INDEX_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the keyword index over her notes',
  },
  {
    key: CORPUS_RELATION_STATE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the corpus relation pass state',
  },
  {
    key: EMBEDDING_CACHE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'embeddings of her passages',
  },
  {
    key: MISCONCEPTION_EMBEDDING_CACHE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'embeddings of misconception text',
  },
  {
    key: PLAN_POLICY_CACHE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the cached plan policy and its input fingerprint',
  },
  // Record stores derived from her material and her studying.
  {
    key: MATERIALITY_HASH_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'content hashes of her notes, for change detection',
  },
  {
    key: CITATION_ANCHOR_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'citation revision anchors and pending revalidations per instrument',
  },
  {
    key: MATERIAL_ARRIVAL_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the day material last arrived, per course',
  },
  {
    key: GROVE_GROUND_STREAKS_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'ground streaks per concept',
  },
  {
    key: GROVE_GROUND_STREAK_PASS_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the ground-streak processing passes already counted',
  },
  {
    key: GROVE_PRIOR_DENOMINATORS_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'prior scope counts per course',
  },
  {
    key: GROVE_READ_COMPLETENESS_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'read completeness per course',
  },
  {
    key: HOME_SCOPE_GROWTH_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'scope growth inputs per course',
  },
  {
    key: HOME_AVOIDANCE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'course avoidance observations and her answers to the avoidance question',
  },
  {
    key: REGISTRY_OVERRIDES_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'her concept renames and prunes',
  },
  // Records of her use of Olea.
  {
    key: USAGE_LOG_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'the usage record of past AI calls (task, model, tokens, cost; never content)',
  },
  {
    key: GATE_STAGE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'retrieval gate stage counts for the current period',
  },
  {
    key: JUDGE_CASE_CAPTURE_STORAGE_KEY,
    classification: 'content-derived',
    holds: 'captured grounding-judge cases, when a capture is enabled by hand',
  },
  // Configuration she entered and would otherwise enter again.
  {
    key: WORKER_CONFIG_STORAGE_KEY,
    classification: 'configuration',
    credential: true,
    holds: 'the Worker address and token',
  },
  {
    key: STUDY_PLAN_SETTINGS_STORAGE_KEY,
    classification: 'configuration',
    holds: 'the path of her assessments table',
  },
  {
    key: TERM_WINDOW_STORAGE_KEY,
    classification: 'configuration',
    holds: 'her term start and end dates, or that she skipped them',
  },
  {
    key: HEADING_OFFER_SETTING_STORAGE_KEY,
    classification: 'configuration',
    holds: 'whether the heading offer is on',
  },
  {
    key: JUDGE_CASE_CAPTURE_CONFIG_KEY,
    classification: 'configuration',
    holds: 'the hand-edited judge-case capture switch',
  },
  // Safety state.
  {
    key: EXPLAIN_BACK_AUDIT_GATE_STORAGE_KEY,
    classification: 'safety',
    holds: 'the explain-back audit gate (pauses grading after sustained failure)',
  },
  // Identity.
  {
    key: DEVICE_ID_STORAGE_KEY,
    classification: 'device-identity',
    holds: "this install's random device id",
  },
];

const BY_KEY: ReadonlyMap<string, SettingsKeyEntry> = new Map(
  SETTINGS_KEY_MANIFEST.map((entry) => [entry.key, entry]),
);

/** The manifest entry for `key`, or `undefined` when the key is not listed. */
export function settingsKeyEntry(key: string): SettingsKeyEntry | undefined {
  return BY_KEY.get(key);
}

/** The keys a full delete clears and the export carries — one list, per `[D-393]`. */
export const CONTENT_DERIVED_SETTINGS_KEYS: readonly string[] = SETTINGS_KEY_MANIFEST.filter(
  (entry) => entry.classification === 'content-derived',
).map((entry) => entry.key);

/** The keys a full delete leaves exactly as they were: configuration and safety state. */
export const KEPT_SETTINGS_KEYS: readonly string[] = SETTINGS_KEY_MANIFEST.filter(
  (entry) => entry.classification === 'configuration' || entry.classification === 'safety',
).map((entry) => entry.key);

function asBlob(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/** A key present in the settings file that a full delete removes: content-derived, or not listed at all. */
function clearedByFullDelete(key: string): boolean {
  const entry = BY_KEY.get(key);
  return entry === undefined || entry.classification === 'content-derived';
}

export interface SettingsClearResult {
  /** Listed content-derived keys that were present and are now gone. */
  readonly clearedKeys: readonly string[];
  /** Keys present in the file but absent from the manifest, also removed — see the module doc. */
  readonly clearedUnlistedKeys: readonly string[];
}

/**
 * Removes every content-derived and every unlisted key from the settings file, leaving
 * configuration, safety state and the device id untouched (the device id is `resetDeviceId`'s to
 * replace). One atomic read-modify-write when the host offers one (`serializing-data-host.ts`),
 * so a store writing a sibling key at the same moment neither loses its write nor restores a
 * cleared key from a stale read; a plain load-then-save otherwise.
 */
export async function clearContentDerivedSettings(
  dataHost: ObsidianDataHost,
): Promise<SettingsClearResult> {
  const clearedKeys: string[] = [];
  const clearedUnlistedKeys: string[] = [];
  const mutate = (current: unknown): Record<string, unknown> => {
    clearedKeys.length = 0;
    clearedUnlistedKeys.length = 0;
    const blob = asBlob(current);
    for (const key of Object.keys(blob)) {
      if (!clearedByFullDelete(key)) continue;
      delete blob[key];
      (BY_KEY.has(key) ? clearedKeys : clearedUnlistedKeys).push(key);
    }
    return blob;
  };
  if (hasReadModifyWrite(dataHost)) {
    await dataHost.readModifyWrite(mutate);
  } else {
    await dataHost.saveData(mutate(await dataHost.loadData()));
  }
  return { clearedKeys, clearedUnlistedKeys };
}

/**
 * The content-derived keys present in the settings file, with their stored values, for the
 * export. Only listed content-derived keys: never configuration (the Worker token lives there),
 * never safety state or the device id, never an unlisted key (see the module doc).
 */
export async function readContentDerivedSettings(
  dataHost: ObsidianDataHost,
): Promise<Readonly<Record<string, unknown>>> {
  const blob = asBlob(await dataHost.loadData());
  const out: Record<string, unknown> = {};
  for (const key of CONTENT_DERIVED_SETTINGS_KEYS) {
    if (key in blob) out[key] = blob[key];
  }
  return out;
}
