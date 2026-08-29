/**
 * A narrow scan over one candidate schedule-event line (RHY-3, `ol-4chx` —
 * step 1 of the build chain `ol-4chx` -> `ol-r6s0` -> `ol-hna1` -> `ol-at1a`).
 * Mirrors `../assessment/base-file.ts`'s discipline exactly: this is not a
 * general parser for arbitrary task-list lines, it extracts exactly the
 * fields RHY-3 §9 names from a bounded, recognisable grammar, and a line that
 * does not fit is skipped rather than guessed at.
 *
 * **The grammar, per RHY-3 §9:** a markdown task-list line carrying — the
 * label leading, the date trailing, weekday and time range optional and
 * order-independent between themselves — *(1)* a leading candidate course
 * label (the token before the first other recognised field), *(2)* an
 * optional weekday name, informational only, never authoritative over the
 * date, *(3)* an optional start–end time range, unused for freshness here,
 * retained per §9 for a possible future same-day disambiguation, and *(4)* a
 * dated stamp, the one mandatory field, read from a small tolerant SET of
 * marker shapes rather than only the single emoji marker this vault's own
 * calendar-sync plugin happens to write. That set is deliberately small and
 * non-exhaustive, not a survey of every plugin's export format — the point
 * (RHY-3 §8 Class C stop 3; `[D-068]`'s "never require a particular way of
 * keeping notes") is that *no single* marker shape is required, not that
 * every possible one is anticipated.
 *
 * A line missing the mandatory dated stamp, or with nothing left over for a
 * label once the other recognised fields are removed, is not this grammar —
 * `parseScheduleEventLine` returns `undefined`, never throws. Counting how
 * often that happens over a whole note is `./discover.ts`'s job; this module
 * only ever answers "does this one line fit," in isolation.
 *
 * **Course association is explicitly out of scope here** (`ol-r6s0`):
 * `label` is carried verbatim, uncompared against any course-code roster.
 */

import { type CalendarDay, isCalendarDay } from '../today/calendar-day.js';

const TASK_LIST_LINE_RE = /^\s*[-*]\s+\[[ xX]\]\s+(.*)$/;

/** True when `line` is a markdown task-list item at all — the precondition for even attempting this grammar. Exported so `./discover.ts` can count "attempted the grammar but didn't fit" without duplicating the pattern. */
export function isTaskListLine(line: string): boolean {
  return TASK_LIST_LINE_RE.test(line);
}

/** Where one recognised field matched within a line's body, so the label extractor knows where the label has to end. */
interface FieldSpan {
  readonly index: number;
  readonly length: number;
}

/**
 * Small, deliberately non-exhaustive set of dated-stamp shapes this scan
 * recognises: the Tasks-plugin due-date emoji this vault's own calendar note
 * uses, plus two other conventions in ordinary use, so a different student's
 * calendar-sync plugin is not silently unreadable (RHY-3 §8 stop 3;
 * `[D-068]`). Tried in the order listed; a line is read against at most the
 * first pattern that matches — this recognises tolerant variants, it does
 * not rank a preference among them.
 */
const DATED_STAMP_PATTERNS: readonly RegExp[] = [
  /📅\s*(\d{4}-\d{2}-\d{2})/, // Tasks plugin due-date marker
  /\[due::\s*(\d{4}-\d{2}-\d{2})\]/i, // Dataview inline-field style
  /\bdue:\s*(\d{4}-\d{2}-\d{2})\b/i, // plain "due:" label
];

export interface DatedStampMatch extends FieldSpan {
  readonly date: CalendarDay;
}

/** The first recognised dated stamp in `body`, or `undefined` when none of the recognised shapes appear. */
export function extractDatedStamp(body: string): DatedStampMatch | undefined {
  for (const pattern of DATED_STAMP_PATTERNS) {
    const match = pattern.exec(body);
    if (match === null) continue;
    const date = match[1];
    if (date !== undefined && isCalendarDay(date)) {
      return { date, index: match.index, length: match[0].length };
    }
  }
  return undefined;
}

const WEEKDAY_NAMES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

type WeekdayName = (typeof WEEKDAY_NAMES)[number];

/** Common abbreviations this scan also recognises, mapped to their canonical full name. */
const WEEKDAY_ABBREVIATIONS: Record<string, WeekdayName> = {
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  weds: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

const WEEKDAY_TOKEN_RE = new RegExp(
  `\\b(${[...WEEKDAY_NAMES, ...Object.keys(WEEKDAY_ABBREVIATIONS)].join('|')})\\b`,
  'i',
);

export interface WeekdayMatch extends FieldSpan {
  readonly weekday: WeekdayName;
}

/**
 * The first recognised weekday token in `body` (full name or a common
 * abbreviation), canonicalised to its full lowercase name. Informational
 * only per RHY-3 §9 — never authoritative over the dated stamp.
 */
export function extractWeekday(body: string): WeekdayMatch | undefined {
  const match = WEEKDAY_TOKEN_RE.exec(body);
  if (match === null) return undefined;
  const token = (match[1] ?? '').toLowerCase();
  const weekday = (WEEKDAY_NAMES as readonly string[]).includes(token)
    ? (token as WeekdayName)
    : WEEKDAY_ABBREVIATIONS[token];
  if (weekday === undefined) return undefined;
  return { weekday, index: match.index, length: match[0].length };
}

const TIME_RANGE_RE = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/i;

export interface TimeRangeMatch extends FieldSpan {
  readonly start: string;
  readonly end: string;
}

/**
 * The first start–end time range in `body`, verbatim as written (never
 * normalised to 24-hour form). Per RHY-3 §9, unused for freshness anywhere
 * in this build chain — captured rather than discarded because a future
 * same-day disambiguation may want it.
 */
export function extractTimeRange(body: string): TimeRangeMatch | undefined {
  const match = TIME_RANGE_RE.exec(body);
  if (match === null) return undefined;
  const start = match[1]?.trim();
  const end = match[2]?.trim();
  if (start === undefined || end === undefined) return undefined;
  return { start, end, index: match.index, length: match[0].length };
}

/** Separator punctuation between fields — dash/pipe/comma with or without surrounding whitespace, or a bare run of whitespace. Trimmed off the label's trailing edge; never assumed to be one particular character (RHY-3 §9 says "a separator," not a spec). */
const TRAILING_SEPARATOR_RE = /[\s\-–—|,]+$/;

/**
 * The leading candidate course label: everything in `body` before whichever
 * OTHER recognised field starts earliest, with trailing separator
 * punctuation stripped. `undefined` when nothing is left after trimming, or
 * when no other field's start position exists to bound the label at all (the
 * dated stamp itself sitting at index 0, with no label before it).
 */
function extractLabel(body: string, otherFieldStarts: readonly number[]): string | undefined {
  const positiveStarts = otherFieldStarts.filter((index) => index > 0);
  if (positiveStarts.length === 0) return undefined;
  const cutoff = Math.min(...positiveStarts);
  const label = body.slice(0, cutoff).replace(TRAILING_SEPARATOR_RE, '').trim();
  return label === '' ? undefined : label;
}

export interface ParsedScheduleEventLine {
  /** The candidate course label, verbatim — not yet matched against any course-code roster (`ol-r6s0`'s scope). */
  readonly label: string;
  /** Canonical lowercase weekday name, when one was recognised. Informational only. */
  readonly weekday: WeekdayName | undefined;
  readonly timeRange: { readonly start: string; readonly end: string } | undefined;
  readonly date: CalendarDay;
}

/**
 * Scans one line of vault text against the bounded event grammar (RHY-3 §9).
 * `undefined` — never a thrown error — when `line` is not a task-list item,
 * carries no recognised dated stamp, or has nothing left over for a label
 * once the recognised fields are removed. The caller (`./discover.ts`) is
 * what counts these misses; this function only ever reports fit/no-fit for
 * one line, in isolation.
 */
export function parseScheduleEventLine(line: string): ParsedScheduleEventLine | undefined {
  const taskMatch = TASK_LIST_LINE_RE.exec(line);
  if (taskMatch === null) return undefined;
  const body = taskMatch[1] ?? '';

  const dateMatch = extractDatedStamp(body);
  if (dateMatch === undefined) return undefined;

  const weekdayMatch = extractWeekday(body);
  const timeMatch = extractTimeRange(body);

  const label = extractLabel(
    body,
    [dateMatch.index, weekdayMatch?.index, timeMatch?.index].filter(
      (index): index is number => index !== undefined,
    ),
  );
  if (label === undefined) return undefined;

  return {
    label,
    weekday: weekdayMatch?.weekday,
    timeRange: timeMatch ? { start: timeMatch.start, end: timeMatch.end } : undefined,
    date: dateMatch.date,
  };
}
