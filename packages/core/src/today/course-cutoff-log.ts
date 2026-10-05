/**
 * The course cutoff log (`[D-411]`, option a): where course cutoff records
 * (`./course-cutoff-record.ts`) are written, and how they are read back.
 *
 * **Beside the composition log, in the same shape** (`../study-session/composition-log.ts`,
 * `[D-395]`): Olea's own layer under `.olea/course-cutoffs/`, one file per day per device, named
 * `<YYYY-MM-DD>.<deviceId>.jsonl` as C5.2 names the review log's, so two devices never append to
 * one file. The day in the name is the day the cutoff was TAKEN, not the cutoff day itself; a
 * daily file is a storage grain only. Never server-side (the boundary document, section 1).
 *
 * **Written once, never rewritten.** {@link recordCourseCutoffs} appends a record only for a
 * course that has none yet; nothing here edits, replaces or merges a line. Reading resolves one
 * record per course, the first in path order (`firstCourseCutoffByCourse`).
 *
 * **Never study activity.** A sibling stream to `.olea/reviews/`, never an event kind inside it,
 * so no review, attention, mastery, window, effort or streak fold reads it.
 *
 * **Retention**: kept like the composition log — carried by the F7.4 export and removed by its
 * full delete once the plugin's `privacy/log-discovery.ts` registers {@link COURSE_CUTOFF_LOG_FOLDER}
 * (that registry is another lane's file; the registration is reported on `ol-v7r5.66`), never
 * pruned.
 */

import { listFolder } from '../vault/list-folder.js';
import { withPathQueue } from '../vault/path-queue.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import type { CalendarDay } from './calendar-day.js';
import {
  buildCourseCutoffRecord,
  type CourseCutoffRecord,
  type CutoffAssessment,
  firstCourseCutoffByCourse,
  type InvalidCourseCutoffLogLine,
  parseCourseCutoffLog,
  serializeCourseCutoffRecord,
  takeCourseCutoff,
} from './course-cutoff-record.js';

/** The vault folder course cutoff records live under: Olea's own layer, beside `.olea/compositions/`. */
export const COURSE_CUTOFF_LOG_FOLDER: VaultPath = '.olea/course-cutoffs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LOG_FILE_RE = /^\d{4}-\d{2}-\d{2}\.[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/;

/** The vault path for one device's cutoff log on one calendar day. Throws on a malformed date or device id, matching `compositionLogPath`. */
export function courseCutoffLogPath(date: CalendarDay, deviceId: string): VaultPath {
  if (!DATE_RE.test(date)) {
    throw new Error(
      `courseCutoffLogPath: not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`,
    );
  }
  if (!DEVICE_ID_RE.test(deviceId)) {
    throw new Error(`courseCutoffLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  return `${COURSE_CUTOFF_LOG_FOLDER}/${date}.${deviceId}.jsonl`;
}

/**
 * Appends one record to this device's file for `takenOn`. Extends, never rewrites: a partial
 * trailing line from an interrupted earlier append survives as a literal prefix, closed off by its
 * own `\n` before this line (INV-2, the composition log's technique). The read and the write run as
 * one task on the day file's queue (`../vault/path-queue.ts`), so two overlapping appends both land.
 */
export async function appendCourseCutoffRecord(
  vault: VaultSource,
  record: CourseCutoffRecord,
  deviceId: string,
  takenOn: CalendarDay,
): Promise<VaultPath> {
  const path = courseCutoffLogPath(takenOn, deviceId);
  const line = serializeCourseCutoffRecord(record);
  await withPathQueue(path, async () => {
    const existing = (await vault.exists(path)) ? await vault.read(path) : '';
    const needsSeparator = existing.length > 0 && !existing.endsWith('\n');
    const prefix = needsSeparator ? `${existing}\n` : existing;
    await vault.write(path, prefix + line);
  });
  return path;
}

export interface ReadCourseCutoffLogResult {
  /** Every valid record across the files read, in file order (files sorted by path). */
  readonly records: readonly CourseCutoffRecord[];
  readonly invalidLines: readonly {
    readonly path: VaultPath;
    readonly lines: readonly InvalidCourseCutoffLogLine[];
  }[];
}

/**
 * Every cutoff record this host lets us find: the folder listed (`listFolder`), unioned with
 * `additionalPaths` probed by exact path for a host that lists nothing.
 */
export async function readCourseCutoffLog(
  vault: VaultSource,
  additionalPaths: readonly VaultPath[] = [],
): Promise<ReadCourseCutoffLogResult> {
  const candidates = new Set<VaultPath>();
  try {
    for (const path of await listFolder(vault, COURSE_CUTOFF_LOG_FOLDER)) {
      if (LOG_FILE_RE.test(path.slice(path.lastIndexOf('/') + 1))) candidates.add(path);
    }
  } catch {
    // A host that cannot list a dot folder: the probed paths below still find this device's files.
  }
  for (const path of additionalPaths) candidates.add(path);

  const records: CourseCutoffRecord[] = [];
  const invalidLines: { path: VaultPath; lines: readonly InvalidCourseCutoffLogLine[] }[] = [];
  for (const path of [...candidates].sort()) {
    if (!(await vault.exists(path))) continue;
    const parsed = parseCourseCutoffLog(await vault.read(path));
    records.push(...parsed.records);
    if (parsed.invalidLines.length > 0) invalidLines.push({ path, lines: parsed.invalidLines });
  }
  return { records, invalidLines };
}

export interface RecordCourseCutoffsInput {
  /** The earlier courses whose cutoff is wanted. */
  readonly courseIds: readonly string[];
  /** Records already on disk (`readCourseCutoffLog`). A course with one is never written again. */
  readonly existing: readonly CourseCutoffRecord[];
  /** The concept-to-course join as read now: each course's covered concept ids are taken from it. */
  readonly concepts: readonly { readonly conceptId: string; readonly courses: readonly string[] }[];
  readonly assessments: readonly CutoffAssessment[];
  /** Her leaving gesture's day per course, once C7.8's record exists. Absent today. */
  readonly leavingGestureDays?: ReadonlyMap<string, CalendarDay>;
  /** `attainmentArithmeticVersion` in force now. */
  readonly arithmeticVersion: string;
  readonly today: CalendarDay;
  readonly deviceId: string;
}

export interface RecordCourseCutoffsResult {
  /** One record per course: every pre-existing one, plus each written now. */
  readonly byCourse: ReadonlyMap<string, CourseCutoffRecord>;
  /** Only the records this call appended. */
  readonly written: readonly CourseCutoffRecord[];
}

/**
 * Takes and records each course's cutoff the first time it is available (`[D-411]`): a course
 * that already has a record is left exactly as recorded, whatever its calendar or the rules now
 * say; a course with no cutoff available (`takeCourseCutoff` returns `null`) writes nothing.
 * A write that throws is not retried here and is not reported as recorded — the course simply has
 * no record this time, so no dated line is shown from an unpreserved cutoff.
 */
export async function recordCourseCutoffs(
  vault: VaultSource,
  input: RecordCourseCutoffsInput,
): Promise<RecordCourseCutoffsResult> {
  const byCourse = new Map(firstCourseCutoffByCourse(input.existing));
  const written: CourseCutoffRecord[] = [];
  for (const courseId of [...new Set(input.courseIds)].sort()) {
    if (courseId === '' || byCourse.has(courseId)) continue;
    const cutoff = takeCourseCutoff({
      courseId,
      leavingGestureDay: input.leavingGestureDays?.get(courseId) ?? null,
      assessments: input.assessments,
      today: input.today,
    });
    if (cutoff === null) continue;
    const record = buildCourseCutoffRecord({
      courseId,
      cutoff,
      arithmeticVersion: input.arithmeticVersion,
      conceptIds: input.concepts
        .filter((concept) => concept.courses.includes(courseId))
        .map((concept) => concept.conceptId),
    });
    try {
      await appendCourseCutoffRecord(vault, record, input.deviceId, input.today);
    } catch {
      continue;
    }
    byCourse.set(courseId, record);
    written.push(record);
  }
  return { byCourse, written };
}
