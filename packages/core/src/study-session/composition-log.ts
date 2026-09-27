/**
 * The composition log (`[D-395]`, `ol-egov.141.89.10.65`): where composition records
 * (`./composition-record.ts`) are written, and how they are read back and resolved by id.
 *
 * **One append-only stream of its own, one file per day per device.** `[D-395]` choice 1 (option
 * a, ruled 2026-09-27; C5.5 as amended): records go to Olea's own layer under
 * `.olea/compositions/`, named `<YYYY-MM-DD>.<deviceId>.jsonl` exactly as the review and
 * misconception logs name theirs (C5.2's convention), so two devices never append to one file and
 * a daily file is a storage grain only. Every session still has its own record with its own
 * `sessionId` (condition 1): two sessions on one day and device are two records in one file, and
 * an extension is a further record naming the same `sessionId` (condition 2). Nothing here ever
 * rewrites or merges a record.
 *
 * **Never study activity** (condition 4). This is a sibling stream to `.olea/reviews/`, never a
 * review-event kind inside it, so no review, attention, mastery, window, effort or streak fold
 * reads it: they all read the review log's folder and nothing else. A session started and left
 * with no answer therefore leaves this record and no review, and every received-time reading
 * over the review log still sees nothing.
 *
 * **Joins are by id, never by time** (condition 5). A review carries the `compositionId` of the
 * record that served it (review log v6); {@link resolveCompositionRecord} is the one lookup, and
 * it resolves only an id matching exactly one record. No function here, or anywhere reading this
 * stream, maps a timestamp to a record.
 *
 * **Retention** (`[D-331]` choice 4, option a, a Class B build default the ruling did not
 * address): kept like the review log, carried by the F7.4 export and removed by its full delete
 * (the plugin's `privacy/log-discovery.ts` registers the folder), never pruned.
 */

import { listFolder } from '../vault/list-folder.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import {
  type CompositionRecord,
  type InvalidCompositionLogLine,
  parseCompositionLog,
  serializeCompositionRecord,
} from './composition-record.js';

/** The vault folder composition records live under: Olea's own layer, beside `.olea/reviews/`, never inside it. */
export const COMPOSITION_LOG_FOLDER: VaultPath = '.olea/compositions';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** `<YYYY-MM-DD>.<deviceId>.jsonl`, the name {@link compositionLogPath} builds. */
const LOG_FILE_RE = /^\d{4}-\d{2}-\d{2}\.[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/;

/**
 * The vault path for one device's composition log on one calendar day. Throws on a malformed date
 * or device id, matching `reviewLogPath` and `misconceptionLogPath`.
 */
export function compositionLogPath(date: string, deviceId: string): VaultPath {
  if (!DATE_RE.test(date)) {
    throw new Error(
      `compositionLogPath: not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`,
    );
  }
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new Error(`compositionLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${COMPOSITION_LOG_FOLDER}/${date}.${deviceId}.jsonl`;
}

export interface AppendCompositionRecordResult {
  readonly record: CompositionRecord;
  readonly path: VaultPath;
}

/**
 * Appends one record, as built by `buildCompositionRecord` or `buildExtendedCompositionRecord`,
 * to its device's daily file. The day is the local date of the record's own `composedAt` (a
 * substring, since every timestamp carries its offset — the review log's `localDateOf`
 * reasoning). Extends, never rewrites: a partial trailing line from an interrupted earlier append
 * survives as a literal prefix, closed off by its own `\n` before this line (INV-2, the review
 * and misconception writers' own technique, kept as a near-duplicate for the reason
 * `../misconception/write.ts` gives).
 */
export async function appendCompositionRecord(
  vault: VaultSource,
  record: CompositionRecord,
  deviceId: string,
): Promise<AppendCompositionRecordResult> {
  const path = compositionLogPath(record.composedAt.slice(0, 10), deviceId);
  const line = serializeCompositionRecord(record);
  const existing = (await vault.exists(path)) ? await vault.read(path) : '';
  const needsSeparator = existing.length > 0 && !existing.endsWith('\n');
  const prefix = needsSeparator ? `${existing}\n` : existing;
  await vault.write(path, prefix + line);
  return { record, path };
}

export interface ReadCompositionLogResult {
  /** Every valid record across the files read, in file order (files sorted by path). */
  readonly records: readonly CompositionRecord[];
  /** Per file, the lines that did not parse — reported by line number only, never by text. */
  readonly invalidLines: readonly {
    readonly path: VaultPath;
    readonly lines: readonly InvalidCompositionLogLine[];
  }[];
}

/**
 * Every composition record this host lets us find: the folder listed (`listFolder`, which reaches
 * a dot folder through `listUnder` where the host has it) unioned with `additionalPaths` probed
 * by exact path, for a host that lists nothing — the same union the review log's readers take.
 */
export async function readCompositionLog(
  vault: VaultSource,
  additionalPaths: readonly VaultPath[] = [],
): Promise<ReadCompositionLogResult> {
  const candidates = new Set<VaultPath>();
  try {
    for (const path of await listFolder(vault, COMPOSITION_LOG_FOLDER)) {
      if (LOG_FILE_RE.test(path.slice(path.lastIndexOf('/') + 1))) candidates.add(path);
    }
  } catch {
    // A host that cannot list a dot folder: the probed paths below still find this device's files.
  }
  for (const path of additionalPaths) candidates.add(path);

  const records: CompositionRecord[] = [];
  const invalidLines: { path: VaultPath; lines: readonly InvalidCompositionLogLine[] }[] = [];
  for (const path of [...candidates].sort()) {
    if (!(await vault.exists(path))) continue;
    const parsed = parseCompositionLog(await vault.read(path));
    records.push(...parsed.records);
    if (parsed.invalidLines.length > 0) invalidLines.push({ path, lines: parsed.invalidLines });
  }
  return { records, invalidLines };
}

/**
 * The one record `compositionId` names, or `null` when no record or more than one carries it
 * (`[D-395]` condition 5: an id resolves to exactly one record, or it does not resolve). Never
 * falls back to any other key, least of all a time.
 */
export function resolveCompositionRecord(
  records: readonly CompositionRecord[],
  compositionId: string,
): CompositionRecord | null {
  let found: CompositionRecord | null = null;
  for (const record of records) {
    if (record.compositionId !== compositionId) continue;
    if (found !== null) return null;
    found = record;
  }
  return found;
}

/**
 * Every record of one session — its first record, then each extension — in the order they were
 * appended (file order). The session's current snapshot is the last entry.
 */
export function compositionRecordsOfSession(
  records: readonly CompositionRecord[],
  sessionId: string,
): readonly CompositionRecord[] {
  return records.filter((record) => record.sessionId === sessionId);
}
