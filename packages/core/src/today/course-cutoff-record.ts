/**
 * The course cutoff record (`[D-411]`, option a; `[D-387]`; F8.7, C7.8).
 *
 * `[D-387]` (ruled 2026-09-27): earlier-course recognition shows the historical attainment at a
 * cutoff apart from the current reading, and the cutoff and the rule versions in force at it are
 * preserved once taken, so a later edit to her calendar or a later change of rule cannot silently
 * revise the dated line. The audit that ruling required (`ol-v7r5.66`'s notes) found that nothing
 * Olea kept preserved either. `[D-411]` (ruled the same day) is the record that does: **a small,
 * append-only record in Olea's own layer of her vault, beside the composition log, never
 * server-side; one record per course cutoff, written once the first time a cutoff is taken and
 * never rewritten.**
 *
 * This module builds the record, serializes it as one JSONL line and parses it back, and decides
 * which cutoff is available to take. **It writes nothing.** `./course-cutoff-log.ts` is the stream
 * it is written to; `./earlier-course-recognition.ts` reads it; the plugin's
 * `course-setup/recognition-source.ts` takes and writes it at the moment a recognition is read.
 *
 * ## What the record holds, and nothing else (`[D-411]`'s field list)
 *
 * - the **cutoff day**;
 * - its **source**: her leaving gesture (C7.8), or **provisional**: the earlier course's last
 *   passed assessment;
 * - the **attainment arithmetic version** in force (`../mastery/attainment.ts`'s
 *   `attainmentArithmeticVersion`) and the **historical-award rule version** in force
 *   ({@link HISTORICAL_AWARD_RULE_VERSION});
 * - the **course id** and the **concept ids it covered** when the cutoff was taken — ids only, no
 *   display name, no note title, no path.
 *
 * No stage, vitality or other per-concept value is stored (`[D-387]` condition 6: option (b)'s
 * stored per-concept value was not adopted). The dated line is folded from her log each time it is
 * read, under the recorded versions, over the log up to the recorded day.
 *
 * ## A provisional cutoff is not a leaving (`[D-387]` condition 2)
 *
 * A passed assessment date does not by itself prove the course is finished. The record therefore
 * **has no field for a leaving reason, a completion or an archive** under any source: the shape
 * cannot say one, so no writer can write one. The source value names what the day was read from
 * (`'provisional-last-passed-assessment'`), never what it means about the course.
 *
 * `[D-411]`: a provisional record stands as first taken; whether a later leaving gesture replaces
 * it is left to the C7.8 course-record decision. Nothing here replaces one.
 *
 * ## The leaving gesture has no producer yet
 *
 * C7.8's course record is unbuilt (`../course/lifecycle.ts`'s module doc), so no caller has a
 * leaving-gesture day to hand. {@link takeCourseCutoff} accepts one, and prefers it, so the day
 * that record exists the gesture wins without a change here; until then every cutoff taken in
 * production is provisional.
 *
 * ## INV-2: byte-identical round trips
 *
 * The composition record's discipline (`../study-session/composition-record.ts`): one canonical
 * line, keys in one fixed order, `conceptIds` sorted and deduplicated, a strict parser with exact
 * key sets that reads `schemaVersion` first and never guesses. For every line this module writes,
 * `serialize(parse(line)) === line`.
 */

import type { SaplingRule } from '../mastery/rollup.js';
import { type CalendarDay, isCalendarDay } from './calendar-day.js';

/** Bumped only on a breaking change to {@link CourseCutoffRecord}'s shape; a reader never guesses at a version it does not know. */
export const COURSE_CUTOFF_RECORD_SCHEMA_VERSION = 1;

/**
 * **The historical-award rule version** (`[D-411]`'s second version field; `[D-345]`'s "preserve
 * enough rule-version information to reproduce historical awards"). It names the rule that turns
 * a cutoff day into a dated attainment, which the arithmetic version alone does not:
 *
 * the growth stage is folded from **only the log entries whose own local day (the first ten
 * characters of the timestamp, which carries its offset) is on or before the cutoff day**, with
 * **instrument validity as known from those same entries** (`../mastery/validity.ts`'s projection
 * over that prefix): a defect proven, a contest resolved or a re-grade logged after the cutoff day
 * does not reach back into it (`[D-338]` item 1, `[D-345]`). An entry whose timestamp has no
 * readable day is left out, never counted.
 *
 * Bumped whenever that rule changes meaning. A reader that does not implement the recorded
 * version shows no dated line rather than refolding under a later rule
 * (`./earlier-course-recognition.ts`).
 */
export const HISTORICAL_AWARD_RULE_VERSION = 'cutoff-asof-1';

/**
 * Where a cutoff day came from.
 * - `'leaving-gesture'` — her leaving gesture, once C7.8's course record exists.
 * - `'provisional-last-passed-assessment'` — the date of the earlier course's last passed
 *   assessment, labelled provisional wherever it is shown (`[D-387]` condition 1).
 */
export const COURSE_CUTOFF_SOURCES = [
  'leaving-gesture',
  'provisional-last-passed-assessment',
] as const;
export type CourseCutoffSource = (typeof COURSE_CUTOFF_SOURCES)[number];

/** True for every source other than her leaving gesture: the line says provisional, and nothing reads it as a leaving. */
export function isProvisionalCutoffSource(source: CourseCutoffSource): boolean {
  return source !== 'leaving-gesture';
}

/** The durable course cutoff record, schema version 1. Field order here is the serialized order. */
export interface CourseCutoffRecord {
  readonly schemaVersion: 1;
  /** The earlier course, by the same id the concept-to-course join uses. */
  readonly courseId: string;
  readonly cutoffDay: CalendarDay;
  readonly source: CourseCutoffSource;
  /** `attainmentArithmeticVersion` as it was when the cutoff was taken. */
  readonly arithmeticVersion: string;
  /** {@link HISTORICAL_AWARD_RULE_VERSION} as it was when the cutoff was taken. */
  readonly historicalAwardRuleVersion: string;
  /** Every concept id the join placed in the course when the cutoff was taken; sorted, deduplicated. */
  readonly conceptIds: readonly string[];
}

const RECORD_KEYS = [
  'schemaVersion',
  'courseId',
  'cutoffDay',
  'source',
  'arithmeticVersion',
  'historicalAwardRuleVersion',
  'conceptIds',
] as const satisfies readonly (keyof CourseCutoffRecord)[];

function sortedDistinct(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The record rebuilt key by key in its one serialized order. Every writer and the parser go through it. */
function canonical(record: CourseCutoffRecord): CourseCutoffRecord {
  return {
    schemaVersion: record.schemaVersion,
    courseId: record.courseId,
    cutoffDay: record.cutoffDay,
    source: record.source,
    arithmeticVersion: record.arithmeticVersion,
    historicalAwardRuleVersion: record.historicalAwardRuleVersion,
    conceptIds: sortedDistinct(record.conceptIds),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates one parsed JSON value as a {@link CourseCutoffRecord} and returns it in canonical form,
 * or `null` on any failure. `schemaVersion` is read first; exact key sets throughout, so a line
 * carrying a field this build does not know (a reason, a stored stage) is refused, never narrowed.
 */
export function parseCourseCutoffRecord(json: unknown): CourseCutoffRecord | null {
  if (!isPlainObject(json)) return null;
  if (json.schemaVersion !== COURSE_CUTOFF_RECORD_SCHEMA_VERSION) return null;
  if (!hasExactKeys(json, RECORD_KEYS)) return null;
  const v = json;
  if (!isNonEmptyString(v.courseId)) return null;
  if (typeof v.cutoffDay !== 'string' || !isCalendarDay(v.cutoffDay)) return null;
  if (
    typeof v.source !== 'string' ||
    !(COURSE_CUTOFF_SOURCES as readonly string[]).includes(v.source)
  ) {
    return null;
  }
  if (!isNonEmptyString(v.arithmeticVersion)) return null;
  if (!isNonEmptyString(v.historicalAwardRuleVersion)) return null;
  if (!Array.isArray(v.conceptIds) || !v.conceptIds.every(isNonEmptyString)) return null;
  return canonical(v as unknown as CourseCutoffRecord);
}

/** One record as one JSONL line, `\n`-terminated, in canonical form. */
export function serializeCourseCutoffRecord(record: CourseCutoffRecord): string {
  return `${JSON.stringify(canonical(record))}\n`;
}

export interface InvalidCourseCutoffLogLine {
  /** 1-based, as an editor shows it. */
  readonly lineNumber: number;
  readonly reason: string;
}

export interface ParseCourseCutoffLogResult {
  readonly records: readonly CourseCutoffRecord[];
  /** Lines that failed JSON or the schema, reported by number only, never by text. */
  readonly invalidLines: readonly InvalidCourseCutoffLogLine[];
}

/** Append-only JSONL, the composition log's line discipline: `\r\n` tolerated, blank lines skipped, each line validated on its own. */
export function parseCourseCutoffLog(content: string): ParseCourseCutoffLogResult {
  const records: CourseCutoffRecord[] = [];
  const invalidLines: InvalidCourseCutoffLogLine[] = [];
  const lines = content.split('\n');
  lines.forEach((rawLine, index) => {
    if (index === lines.length - 1 && rawLine === '') return;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === '') return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      invalidLines.push({ lineNumber: index + 1, reason: 'invalid JSON' });
      return;
    }
    const record = parseCourseCutoffRecord(json);
    if (record === null) {
      invalidLines.push({
        lineNumber: index + 1,
        reason: 'not a course cutoff record this build can read at its declared schemaVersion',
      });
      return;
    }
    records.push(record);
  });
  return { records, invalidLines };
}

// ---------------------------------------------------------------------------
// Taking a cutoff
// ---------------------------------------------------------------------------

/** The two fields of an assessment this module reads: which course, and its date. `AssessmentRecord` satisfies it. */
export interface CutoffAssessment {
  readonly course: string | undefined;
  readonly due: string | undefined;
}

/**
 * The date of `courseId`'s last passed assessment as of `today`, or `null` when none has passed.
 * "Passed" is the rule every other reader uses (`../retrospective/offer.ts`'s
 * `hasAssessmentPassed`, `../oracle/rank.ts`'s `'assessment-passed'` veto): the due day is before
 * today. A due value that is not a calendar day is never read as passed. The course match is exact,
 * as every other assessment-to-course join in this package is.
 */
export function lastPassedAssessmentDay(
  courseId: string,
  assessments: readonly CutoffAssessment[],
  today: CalendarDay,
): CalendarDay | null {
  let last: CalendarDay | null = null;
  for (const assessment of assessments) {
    if (assessment.course !== courseId) continue;
    const due = assessment.due;
    if (due === undefined || !isCalendarDay(due)) continue;
    if (!(due < today)) continue;
    if (last === null || due > last) last = due;
  }
  return last;
}

export interface TakeCourseCutoffInput {
  readonly courseId: string;
  /** Her leaving gesture's day, once C7.8's course record exists; `null` or absent today. */
  readonly leavingGestureDay?: CalendarDay | null;
  readonly assessments: readonly CutoffAssessment[];
  readonly today: CalendarDay;
}

export interface TakenCourseCutoff {
  readonly cutoffDay: CalendarDay;
  readonly source: CourseCutoffSource;
}

/**
 * `[D-387]` condition 1: the leaving gesture when there is one; otherwise the last passed
 * assessment's date, as a provisional cutoff; with neither, `null` — no cutoff, so no dated line,
 * and none fabricated (condition 5). Pure: reading a cutoff is not recording it.
 */
export function takeCourseCutoff(input: TakeCourseCutoffInput): TakenCourseCutoff | null {
  const gesture = input.leavingGestureDay ?? null;
  if (gesture !== null && isCalendarDay(gesture)) {
    return { cutoffDay: gesture, source: 'leaving-gesture' };
  }
  const passed = lastPassedAssessmentDay(input.courseId, input.assessments, input.today);
  if (passed !== null) return { cutoffDay: passed, source: 'provisional-last-passed-assessment' };
  return null;
}

export interface BuildCourseCutoffRecordInput {
  readonly courseId: string;
  readonly cutoff: TakenCourseCutoff;
  /** `attainmentArithmeticVersion` in force now. */
  readonly arithmeticVersion: string;
  /** Every concept id the join places in the course now; order and duplicates do not matter. */
  readonly conceptIds: readonly string[];
}

/**
 * The record of one cutoff as first taken. The historical-award rule version is this build's
 * {@link HISTORICAL_AWARD_RULE_VERSION}. Throws when the result would not read back (an empty
 * course id, a malformed day): a record that cannot be parsed is a bug at the call site, never
 * something to write.
 */
export function buildCourseCutoffRecord(input: BuildCourseCutoffRecordInput): CourseCutoffRecord {
  const record = parseCourseCutoffRecord(
    canonical({
      schemaVersion: 1,
      courseId: input.courseId,
      cutoffDay: input.cutoff.cutoffDay,
      source: input.cutoff.source,
      arithmeticVersion: input.arithmeticVersion,
      historicalAwardRuleVersion: HISTORICAL_AWARD_RULE_VERSION,
      conceptIds: input.conceptIds,
    }),
  );
  if (record === null) {
    throw new Error(
      'buildCourseCutoffRecord: the cutoff does not make a valid course cutoff record',
    );
  }
  return record;
}

/**
 * One record per course: the first in the order given (`./course-cutoff-log.ts` reads files in
 * path order, day first, so the earliest-written record wins on every device alike). `[D-411]`:
 * written once, never rewritten — a later record for the same course, from a second device that
 * took the cutoff before it saw the first, never displaces the first.
 */
export function firstCourseCutoffByCourse(
  records: readonly CourseCutoffRecord[],
): ReadonlyMap<string, CourseCutoffRecord> {
  const byCourse = new Map<string, CourseCutoffRecord>();
  for (const record of records) {
    if (!byCourse.has(record.courseId)) byCourse.set(record.courseId, record);
  }
  return byCourse;
}

// ---------------------------------------------------------------------------
// Reading the recorded arithmetic version back
// ---------------------------------------------------------------------------

/** What a recorded arithmetic version says the stage fold needs: the fold rule's version and the sapling rule. */
export interface RecordedStageArithmetic {
  readonly foldVersion: string;
  readonly saplingRule: SaplingRule;
}

const SAPLING_RULES: readonly SaplingRule[] = [
  'any-scored-success',
  'unaided-recall',
  'strict-unaided-recall',
  'mix-with-unaided-recall',
];

/**
 * Reads `attainmentArithmeticVersion`'s `;`-joined form back
 * (`att-fold-N;sapling=...;withheld=...;scheduler=...`). Only the parts a growth-stage fold depends
 * on are returned: the withheld-evidence policy and the scheduler version do not move the stage
 * (`../mastery/attainment.ts`: the displayed stage keeps withheld evidence under every option, and
 * the stage reads no scheduler). `null` when the string is not in that form or names a sapling
 * rule this build does not know, or has no `sapling=` part at all: a version this reader cannot
 * take apart is never guessed at.
 */
export function parseRecordedStageArithmetic(version: string): RecordedStageArithmetic | null {
  const parts = version.split(';');
  const foldVersion = parts[0];
  if (foldVersion === undefined || foldVersion === '' || foldVersion.includes('=')) return null;
  const sapling = parts.find((part) => part.startsWith('sapling='));
  if (sapling === undefined) return null;
  const rule = sapling.slice('sapling='.length);
  if (!(SAPLING_RULES as readonly string[]).includes(rule)) return null;
  return { foldVersion, saplingRule: rule as SaplingRule };
}
