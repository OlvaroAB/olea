/**
 * Calendar days as she experienced them (F6.1, P2-T09).
 *
 * **Why this is not `dates.ts`.** `dates.ts` normalises to UTC midnight on
 * purpose — for FSRS intervals and queue ordering, "two days apart" must not
 * depend on which machine asks. A streak is the opposite kind of question. It
 * asks *"did she study on Tuesday"*, and Tuesday is a fact about her evening,
 * not about UTC. A review logged at 23:30 on a UTC+2 evening is a UTC
 * Wednesday, and counting it as Wednesday would break a streak she did not
 * break — silently, and only for people east of Greenwich. `dates.ts`'s module
 * doc lists "streak calculation" among its users; after this bead it should
 * not, and that correction is filed rather than made here (see the P2-T09
 * report) because changing that file's doc is not this bead's to do.
 *
 * **How the local day is recovered, and why it is this cheap.** The review-log
 * contract stores `timestamp` as `z.string().datetime({ offset: true })` and
 * says outright why: *"The offset matters: 'when did she study' is local."* An
 * ISO-8601 string with an offset already expresses local wall-clock time — the
 * `2026-08-10` in `2026-08-10T23:30:00+02:00` **is** her Tuesday. So the local
 * calendar day is the first ten characters, with no timezone database, no
 * `Date` round-trip, and no assumption about the machine reading it. A `Z`
 * timestamp yields the UTC day, which is the honest answer for a record whose
 * writer chose to record no offset.
 *
 * Days are plain `YYYY-MM-DD` strings because that is the format they are
 * already stored in (`review-log/path.ts`'s file names) and because lexical
 * order on that format is chronological order, which is what every comparison
 * below needs.
 */

/** A local calendar day, `YYYY-MM-DD`. Lexically ordered means chronologically ordered. */
export type CalendarDay = string;

const CALENDAR_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `value` is a syntactically well-formed `YYYY-MM-DD` day. */
export function isCalendarDay(value: string): boolean {
  return CALENDAR_DAY_RE.test(value);
}

/**
 * The local calendar day an ISO-8601 timestamp with offset fell on, or `null`
 * when the string is not one. Returns `null` rather than throwing: this runs
 * over review-log records that a crash or a future schema version can make
 * odd, and one unreadable timestamp must never cost the streak around it —
 * the same discipline `parse.ts` applies line by line.
 */
export function calendarDayOfTimestamp(timestamp: string): CalendarDay | null {
  const day = timestamp.slice(0, 10);
  return isCalendarDay(day) ? day : null;
}

/**
 * The calendar day a `Date` falls on **in the host machine's local zone** —
 * the plugin's "today". Uses the local getters deliberately: this is the one
 * place a local zone is the right question, because the panel is being drawn
 * on the device she is sitting at.
 */
export function calendarDayFromLocalDate(date: Date): CalendarDay {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `day` shifted by `delta` whole calendar days. Computed through `Date.UTC`
 * because calendar arithmetic on a bare `YYYY-MM-DD` is where month lengths,
 * leap years and DST all go wrong — but the value is only ever a label here,
 * never an instant, so no offset enters the result.
 */
export function shiftCalendarDay(day: CalendarDay, delta: number): CalendarDay {
  if (!isCalendarDay(day)) {
    throw new Error(`shiftCalendarDay: not a calendar day (YYYY-MM-DD): ${JSON.stringify(day)}`);
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const shifted = new Date(Date.UTC(year, month - 1, date + delta));
  return shifted.toISOString().slice(0, 10);
}

/**
 * The `length` consecutive days ending on `day`, oldest first — the week strip
 * the panel draws, generalised to any window length.
 */
export function calendarDaysEndingOn(day: CalendarDay, length: number): readonly CalendarDay[] {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error(`calendarDaysEndingOn: length must be a non-negative integer, got ${length}`);
  }
  const days: CalendarDay[] = [];
  for (let offset = length - 1; offset >= 0; offset -= 1) {
    days.push(shiftCalendarDay(day, -offset));
  }
  return days;
}
