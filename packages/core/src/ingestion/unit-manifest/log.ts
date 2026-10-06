/**
 * The unit manifest log (`[D-445]`, `ol-egov.141.89.8.43`): where the records of `./records.ts` are
 * written in her vault, and how they are read back. **Olea's own layer under `.olea/unit-manifests/`,
 * never her authored notes (INV-6), never the Worker (the boundary document, section 1).**
 *
 * **The established shape, reused.** One file per day per device, named
 * `<YYYY-MM-DD>.<deviceId>.jsonl` as C5.2 names the review log's (`../../review-log/path.ts`), so two
 * devices never append to one file and her vault sync merges by carrying both. The day in the name is
 * the day the record was written, a storage grain only; the fold never reads it. This is the same
 * pattern, and the same append technique, as `../../study-session/composition-log.ts` and
 * `../../today/course-cutoff-log.ts`.
 *
 * **Append-only, and extending is not rewriting.** {@link appendUnitManifestRecords} adds lines after
 * whatever bytes the day's file already holds. A partial trailing line from an interrupted earlier
 * append survives as a literal prefix, closed off by its own `\n` before the new line, so a
 * well-formed record is never welded onto garbage (INV-2). Nothing here edits, replaces, sorts or
 * compacts a line, and older files are kept as read-only input for the fold.
 *
 * **Reading.** {@link readUnitManifestLog} takes the paths to read; finding them is the caller's job
 * (the plugin lists the folder and probes this device's own files by exact path, since a host may
 * list nothing under a dot-prefixed folder: `../../vault/list-folder.ts`).
 *
 * **Retention.** Kept like the composition log: carried by the F7.4 export and removed by its full
 * delete once the plugin's `privacy/log-discovery.ts` registers {@link UNIT_MANIFEST_FOLDER}; never
 * pruned by anything here. Deleting the folder loses only what the fold reads: a source with no
 * record reads unknown until it is enumerated again (`./projection.ts`).
 */

import { isValidDeviceId } from '../../review-log/path.js';
import { withPathQueue } from '../../vault/path-queue.js';
import type { VaultPath, VaultSource } from '../../vault/types.js';
import {
  type InvalidUnitManifestLogLine,
  parseUnitManifestLog,
  serialiseUnitManifestRecord,
  type UnitManifestRecord,
} from './records.js';

/** The vault folder unit manifest records live under: Olea's own layer, beside `.olea/compositions/`. */
export const UNIT_MANIFEST_FOLDER: VaultPath = '.olea/unit-manifests';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The vault path for one device's unit manifest log on one calendar day. Throws on a malformed date or device id, matching `reviewLogPath`. */
export function unitManifestLogPath(date: string, deviceId: string): VaultPath {
  if (!DATE_RE.test(date)) {
    throw new Error(
      `unitManifestLogPath: not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`,
    );
  }
  if (!isValidDeviceId(deviceId)) {
    throw new Error(`unitManifestLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${UNIT_MANIFEST_FOLDER}/${date}.${deviceId}.jsonl`;
}

/**
 * The calendar day a record belongs to, taken verbatim from its own `at` (an ISO-8601 timestamp
 * carrying its offset): "which local day was this written" is a substring, not a timezone
 * calculation, once the offset is on the string. Same reasoning as the review-log writer.
 */
function localDateOf(at: string): string {
  const t = at.indexOf('T');
  if (t === -1) {
    throw new Error(`unit-manifest append: not a valid ISO-8601 timestamp: ${JSON.stringify(at)}`);
  }
  return at.slice(0, t);
}

/**
 * Appends `records` to their devices' daily files, one `vault.write` per file, extending and never
 * rewriting. Records for the same file are written together, in the order given, so a writer that
 * needs several records to land as a unit (a retirement, an enumeration and the page states it
 * found) passes them in one call: a crash cannot leave the enumeration without its retirement.
 * Returns the paths written, sorted. Each file's read and write run as one task on that file's
 * queue (`../../vault/path-queue.ts`), one file after another, so two overlapping appends both land.
 */
export async function appendUnitManifestRecords(
  vault: VaultSource,
  records: readonly UnitManifestRecord[],
): Promise<readonly VaultPath[]> {
  const byPath = new Map<VaultPath, string[]>();
  for (const record of records) {
    const path = unitManifestLogPath(localDateOf(record.at), record.deviceId);
    const lines = byPath.get(path) ?? [];
    lines.push(serialiseUnitManifestRecord(record));
    byPath.set(path, lines);
  }
  const written: VaultPath[] = [];
  for (const [path, lines] of byPath) {
    await withPathQueue(path, async () => {
      const existing = (await vault.exists(path)) ? await vault.read(path) : '';
      const needsSeparator = existing.length > 0 && !existing.endsWith('\n');
      const prefix = needsSeparator ? `${existing}\n` : existing;
      await vault.write(path, prefix + lines.join(''));
    });
    written.push(path);
  }
  return written.sort();
}

export interface ReadUnitManifestLogResult {
  /** Every valid record across the files read, in file order (files sorted by path). */
  readonly records: readonly UnitManifestRecord[];
  readonly invalidLines: readonly {
    readonly path: VaultPath;
    readonly lines: readonly InvalidUnitManifestLogLine[];
  }[];
}

/**
 * Reads every file in `paths` that exists, sorted by path, parsing each tolerantly. A file that
 * cannot be read throws: a caller that would treat "could not read" as "no records" must catch it
 * and decide, because an unread log is unknown, not empty.
 */
export async function readUnitManifestLog(
  vault: VaultSource,
  paths: readonly VaultPath[],
): Promise<ReadUnitManifestLogResult> {
  const records: UnitManifestRecord[] = [];
  const invalidLines: { path: VaultPath; lines: readonly InvalidUnitManifestLogLine[] }[] = [];
  for (const path of [...new Set(paths)].sort()) {
    if (!(await vault.exists(path))) continue;
    const parsed = parseUnitManifestLog(await vault.read(path));
    records.push(...parsed.records);
    if (parsed.invalidLines.length > 0) invalidLines.push({ path, lines: parsed.invalidLines });
  }
  return { records, invalidLines };
}
