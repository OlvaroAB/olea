/**
 * The arrivals stage's own behaviour, on hand-built inputs (`ol-egov.141.89.11.4`,
 * vew.md §2.5). These are the F6.9 arrivals scenarios named
 * `@auto:core/today/arrivals.spec` in `features/F6-today.md`; the rhythm
 * detector's own arithmetic is `rhythm.spec.ts`'s.
 */

import { describe, expect, it } from 'vitest';
import {
  detectArrivals,
  detectCourseArrivals,
  type ProcessedRevision,
  toRhythmCourseInput,
} from './arrivals.js';
import type { CalendarDay } from './calendar-day.js';
import { detectRhythm } from './rhythm.js';

const DAY_1: CalendarDay = '2026-09-01';
const DAY_2: CalendarDay = '2026-09-10';
const DAY_3: CalendarDay = '2026-09-20';

function read(firstProcessedDay: CalendarDay): ProcessedRevision {
  return { firstProcessedDay, readState: 'read' };
}
function unreadable(firstProcessedDay: CalendarDay): ProcessedRevision {
  return { firstProcessedDay, readState: 'unreadable' };
}
function pending(firstProcessedDay: CalendarDay): ProcessedRevision {
  return { firstProcessedDay, readState: 'pending' };
}
/** A revision whose first-processed day was lost, found (by rereading) on or before `noLaterThan`. */
function dayUnknown(
  noLaterThan: CalendarDay | undefined,
  readState: ProcessedRevision['readState'] = 'read',
): ProcessedRevision {
  return {
    firstProcessedDay: null,
    ...(noLaterThan === undefined ? {} : { noLaterThan }),
    readState,
  };
}

describe('detectCourseArrivals', () => {
  it("reads 'no-arrivals' for a course with no processed revision ever (not the same as unreachable)", () => {
    const result = detectCourseArrivals({ course: 'C1', revisions: [] });
    expect(result.status).toBe('no-arrivals');
    expect(result.lastArrivalDay).toBeNull();
  });

  it('reads the most recent revision day when the latest revision was read — R3: a new file arrives', () => {
    const result = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_1), read(DAY_3)] });
    expect(result.status).toBe('arrived');
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it('ignores an earlier revision and reads only the most recent day', () => {
    // Older material processed earlier must never win over a genuinely more
    // recent one — the reading is always about the LATEST processed revision.
    const result = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_3), read(DAY_1)] });
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it("R4 — the most recent revision failed reading: 'unreadable', never a quiet course", () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [read(DAY_1), unreadable(DAY_3)],
    });
    expect(result.status).toBe('unreadable');
    // It DID arrive — the day is still known, never null (distinct from
    // 'no-arrivals', which never had one to know).
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it("a still-pending revision reads the same as a failed one — vew.md §2.5's 'failed or is still pending'", () => {
    const result = detectCourseArrivals({ course: 'C1', revisions: [pending(DAY_3)] });
    expect(result.status).toBe('unreadable');
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it("R2 — an unreachable course reads 'unreachable', never a quiet course, even with prior history on record", () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [read(DAY_1), read(DAY_2)],
      unreachable: true,
    });
    expect(result.status).toBe('unreachable');
    expect(result.lastArrivalDay).toBeNull();
    expect(result.status).not.toBe('no-arrivals');
  });

  it('R1 — exam revision with no new notes: unchanged revisions read the same feed fact, never her reviews', () => {
    // This type carries no review-log or materiality field at all: nothing
    // here could read from her practice even if a caller tried to pass one.
    const quiet = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_1)] });
    const stillQuiet = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_1)] });
    expect(quiet).toEqual(stillQuiet);
  });

  it('R5 — a revision with no materiality field still counts: the type structurally cannot gate on a verdict', () => {
    // vew.md §2.5: "independent of the materiality verdict". There is no
    // verdict field on `ProcessedRevision` to gate on — an edit that would
    // have been judged immaterial, or hit a judge outage, is simply a
    // processed revision like any other from this stage's point of view.
    const result = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_3)] });
    expect(result.status).toBe('arrived');
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it('R7 — a burst upload of older material is dated by when it was processed, not by any content date', () => {
    // `ProcessedRevision` carries only `firstProcessedDay`; there is no authored- or
    // content-date field for a caller to have supplied instead.
    const result = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_3)] });
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it('multiple revisions the same day: one readable is enough for the day to read as arrived', () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [unreadable(DAY_3), read(DAY_3)],
    });
    expect(result.status).toBe('arrived');
    expect(result.lastArrivalDay).toBe(DAY_3);
  });
});

describe('detectArrivals', () => {
  it('reads every course independently, in the order supplied', () => {
    const results = detectArrivals([
      { course: 'A', revisions: [read(DAY_1)] },
      { course: 'B', revisions: [] },
      { course: 'C', revisions: [], unreachable: true },
    ]);
    expect(results.map((r) => r.course)).toEqual(['A', 'B', 'C']);
    expect(results.map((r) => r.status)).toEqual(['arrived', 'no-arrivals', 'unreachable']);
  });
});

describe('toRhythmCourseInput', () => {
  it("returns null for 'unreachable' — R2: it must never reach the rhythm reading at all", () => {
    const arrival = detectCourseArrivals({ course: 'C1', revisions: [], unreachable: true });
    expect(toRhythmCourseInput(arrival)).toBeNull();
  });

  it("carries lastArrivalDay through for 'arrived', with unreadable false", () => {
    const arrival = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_2)] });
    expect(toRhythmCourseInput(arrival)).toEqual({
      course: 'C1',
      lastMaterialArrivalDay: DAY_2,
      unreadable: false,
    });
  });

  it("carries the day AND sets unreadable true for 'unreadable'", () => {
    const arrival = detectCourseArrivals({ course: 'C1', revisions: [unreadable(DAY_2)] });
    expect(toRhythmCourseInput(arrival)).toEqual({
      course: 'C1',
      lastMaterialArrivalDay: DAY_2,
      unreadable: true,
    });
  });

  it("carries a null day for 'no-arrivals'", () => {
    const arrival = detectCourseArrivals({ course: 'C1', revisions: [] });
    expect(toRhythmCourseInput(arrival)).toEqual({
      course: 'C1',
      lastMaterialArrivalDay: null,
      unreadable: false,
    });
  });

  it('threads an optional tempoWeight through unchanged', () => {
    const arrival = detectCourseArrivals({ course: 'C1', revisions: [read(DAY_2)] });
    expect(toRhythmCourseInput(arrival, 2)?.tempoWeight).toBe(2);
    expect(toRhythmCourseInput(arrival)?.tempoWeight).toBeUndefined();
  });
});

describe('arrivals feeding detectRhythm end to end', () => {
  const TODAY: CalendarDay = '2026-09-30';

  it("an unreadable course reads 'unreadable' in the rhythm reading, never as observed/not-observed/not-enough-history", () => {
    const arrivals = detectArrivals([
      { course: 'QUIET_BUT_UNREADABLE', revisions: [read(DAY_1), unreadable(DAY_3)] },
      { course: 'BUSY', revisions: [read('2026-09-28')] },
    ]);
    const courses = arrivals
      .map((a) => toRhythmCourseInput(a))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const result = detectRhythm({ today: TODAY, courses });

    const unreadableReading = result.measured?.courses.find(
      (c) => c.course === 'QUIET_BUT_UNREADABLE',
    );
    expect(unreadableReading?.status).toBe('unreadable');
    expect(unreadableReading?.quietDays).toBeNull();
    // Never picked as the quietest course — it has no measurable quiet gap.
    expect(result.measured?.quietestCourse).not.toBe('QUIET_BUT_UNREADABLE');
  });

  it('an unreachable course never reaches the rhythm reading at all — no line, never quiet', () => {
    const arrivals = detectArrivals([
      { course: 'UNREACHABLE', revisions: [read(DAY_1)], unreachable: true },
      { course: 'BUSY', revisions: [read('2026-09-28')] },
    ]);
    const courses = arrivals
      .map((a) => toRhythmCourseInput(a))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    expect(courses.map((c) => c.course)).toEqual(['BUSY']);
    const result = detectRhythm({ today: TODAY, courses });
    expect(result.measured?.courses.find((c) => c.course === 'UNREACHABLE')).toBeUndefined();
  });

  it('an unreadable arrival reaches the ordinary quiet threshold arithmetic for OTHER courses unaffected', () => {
    const arrivals = detectArrivals([
      { course: 'UNREADABLE', revisions: [unreadable(DAY_1)] },
      { course: 'GONE_QUIET', revisions: [read('2026-09-09')] }, // 21 days before TODAY
    ]);
    const courses = arrivals
      .map((a) => toRhythmCourseInput(a))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const result = detectRhythm({ today: TODAY, courses });

    expect(result.status).toBe('observed');
    expect(result.measured?.quietestCourse).toBe('GONE_QUIET');
  });
});

// `ol-egov.141.89.11.24`, `[D-426]` (row 25, 2026-09-29): the day on a processed revision is the day
// Olea first processed it, never an exact arrival time, and after the record is lost it is unknown.
describe('an unknown first-processed day (D-426, ol-egov.141.89.11.24)', () => {
  it("a course whose only revisions have an unknown day reads 'day-unknown': not quiet, not 'no-arrivals', no day", () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [dayUnknown(DAY_2), dayUnknown(DAY_2, 'unreadable')],
    });
    expect(result.status).toBe('day-unknown');
    expect(result.lastArrivalDay).toBeNull();
    // The two states it must never collapse into: nothing ever arrived, and arrived-but-unreadable.
    expect(result.status).not.toBe('no-arrivals');
    expect(result.status).not.toBe('unreadable');
  });

  it("'day-unknown' reaches the rhythm reading as no day plus the unknown flag, never as unreadable or a quiet course", () => {
    const arrival = detectCourseArrivals({ course: 'C1', revisions: [dayUnknown(DAY_2)] });
    expect(toRhythmCourseInput(arrival)).toEqual({
      course: 'C1',
      lastMaterialArrivalDay: null,
      arrivalDayUnknown: true,
      unreadable: false,
    });
  });

  it('an unknown-day revision found no later than the latest known day does not hide it', () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [dayUnknown(DAY_2), read(DAY_3), dayUnknown(DAY_3)],
    });
    expect(result.status).toBe('arrived');
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it('an unknown-day revision found after the latest known day makes the day unknown: it may be the newest', () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [read(DAY_1), dayUnknown(DAY_3)],
    });
    expect(result.status).toBe('day-unknown');
    expect(result.lastArrivalDay).toBeNull();
  });

  it('an unknown-day revision with no bound at all is never assumed old', () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [read(DAY_3), dayUnknown(undefined)],
    });
    expect(result.status).toBe('day-unknown');
  });

  it('an unparseable day is treated as unknown, never skipped into an empty reading', () => {
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [{ firstProcessedDay: 'not-a-day' as CalendarDay, readState: 'read' }],
    });
    expect(result.status).toBe('day-unknown');
    expect(result.status).not.toBe('no-arrivals');
  });

  it('an unknown-day revision found on the latest day does not lift an unreadable latest day to arrived', () => {
    // Its own day could be that day or earlier; nothing here proves it read on the latest day.
    const result = detectCourseArrivals({
      course: 'C1',
      revisions: [unreadable(DAY_3), dayUnknown(DAY_3, 'read')],
    });
    expect(result.status).toBe('unreadable');
    expect(result.lastArrivalDay).toBe(DAY_3);
  });

  it('pending is not empty: a pending revision has a day and reads unreadable, while no revision reads no-arrivals', () => {
    const pendingReading = detectCourseArrivals({ course: 'C1', revisions: [pending(DAY_2)] });
    const emptyReading = detectCourseArrivals({ course: 'C1', revisions: [] });
    expect(pendingReading.status).toBe('unreadable');
    expect(pendingReading.lastArrivalDay).toBe(DAY_2);
    expect(emptyReading.status).toBe('no-arrivals');
    expect(emptyReading.lastArrivalDay).toBeNull();
  });

  it('a course whose day is unknown is never the quietest course, and never blocks the others', () => {
    const TODAY: CalendarDay = '2026-11-30';
    const arrivals = detectArrivals([
      { course: 'LOST_RECORD', revisions: [dayUnknown('2026-08-01')] },
      { course: 'GONE_QUIET', revisions: [read('2026-09-01')] },
    ]);
    const courses = arrivals
      .map((a) => toRhythmCourseInput(a))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const result = detectRhythm({ today: TODAY, courses });

    const lost = result.measured?.courses.find((c) => c.course === 'LOST_RECORD');
    expect(lost?.status).toBe('not-enough-history');
    expect(lost?.quietDays).toBeNull();
    expect(lost?.reason).toMatch(/not known/);
    expect(result.measured?.quietestCourse).toBe('GONE_QUIET');
  });
});
