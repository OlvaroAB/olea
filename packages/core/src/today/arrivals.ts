/**
 * F6.9's arrivals stage (component register row 4.4; vew.md §2.5;
 * `ol-egov.141.89.11.4`) — the input `detectRhythm` (`./rhythm.js`) needs and
 * does not itself compute: is material arriving for a course, read from
 * PROCESSED revisions, never from an edit's materiality verdict and never
 * from her reviews.
 *
 * ## What's wrong today, and what this module is for
 *
 * Today (`packages/plugin/src/main.ts`'s `recordMaterialArrivalIfObserved`,
 * gated by `observedMaterialChange`) an arrival is recorded only when an
 * EXISTING file is EDITED and the materiality judge's free gates pass: a
 * brand-new file never counts, an edit the judge rules "not material" drops
 * the arrival, and a judge outage (read as material) manufactures one — this
 * chain's own trace, vew.md item 9. This module is the pure-logic stage the
 * reading needs instead: given, per course, every PROCESSED revision (a new
 * source processed, or an existing one's new revision processed past the
 * free gates — "CHG's revision record", dated by when it reached her vault),
 * it reports whether material is arriving, independent of any materiality
 * verdict, and never reads her review log.
 *
 * **No wired producer exists yet for `ProcessedRevision`.** Exactly like
 * `rhythm.ts`'s own `tempoWeight` and `termWindow` inputs, this module takes
 * its input as already resolved and says so rather than inventing a producer
 * here: no "CHG revision record" type is built anywhere in this codebase yet
 * (`UnitManifest` carries a `revisionDigest`, a content hash, not a date;
 * `Source` carries `course` but no date). Replacing `main.ts`'s
 * materiality-gated call site with one that also fires on a new file and
 * dates by processing time rather than edit-observation time is
 * `ol-egov.141.89.11.5`'s — this bead's own "left undone".
 *
 * ## The two operational states, kept apart per vew.md §2.5
 *
 * `'unreadable'` — the course's most recent processed revision's reading
 * failed or is still pending (`[D-196]`'s three reasons, or an unsettled
 * manifest — `../source/unreadable.js`, `../gap/coverage.js#readRecordOf`).
 * It DID arrive — the day is known — but Olea could not read it. Rendered
 * "arrived, could not be read", **never** folded into a quiet verdict
 * (failure class R4: "harm if quiet").
 *
 * `'unreachable'` — the course's own source LOCATION could not be listed or
 * read this pass: an operational failure that says nothing about her
 * material or her practice (failure class R2). Per vew.md §2.5 this draws
 * "no line" at all: `detectCourseArrivals` still reports it, so a caller or
 * a harness can assert the invariant, but `toRhythmCourseInput` below
 * returns `null` for it — a course in this state must never reach
 * `detectRhythm`'s per-course input, and so never be read as quiet.
 *
 * ## What this module never reads
 *
 * No materiality verdict, no review-log entry, no assessment date — the
 * invariant behind failure classes R1 and R5 is structural: `ProcessedRevision`
 * and `CourseArrivalsInput` simply have no field either could come from.
 */

import { type CalendarDay, isCalendarDay } from './calendar-day.js';
import type { RhythmCourseInput } from './rhythm.js';

/**
 * Whether one processed revision's own reading succeeded. `'pending'` and
 * `'unreadable'` both fold to the course-level `'unreadable'` outcome in
 * `detectCourseArrivals` — vew.md §2.5's "failed or is still pending".
 */
export type ProcessedRevisionReadState = 'read' | 'unreadable' | 'pending';

/**
 * One processed revision: a new source processed, or a new revision of an
 * existing one processed past CHG's free gates (vew.md §2.5). `arrivedDay`
 * is the day it reached her vault, never a content or authored date —
 * failure class R7: a burst upload of older material is an arrival on the
 * day it arrived, not on whatever date its content claims. This type has no
 * materiality field and no review-log field, on purpose: there is nothing
 * for a caller to gate arrival recognition on (failure class R5) or to read
 * from her practice (failure class R1).
 */
export interface ProcessedRevision {
  readonly arrivedDay: CalendarDay;
  readonly readState: ProcessedRevisionReadState;
}

export type CourseArrivalStatus = 'arrived' | 'unreadable' | 'unreachable' | 'no-arrivals';

export interface CourseArrivalsInput {
  readonly course: string;
  /**
   * Every processed revision recorded for this course so far, independent of
   * any materiality verdict. Empty when nothing has ever been processed for
   * this course — NOT the same as `unreachable` below: an empty list is an
   * honest "nothing yet" from a location this pass COULD read.
   */
  readonly revisions: readonly ProcessedRevision[];
  /**
   * True when the course's own source location itself could not be listed
   * or read this pass (failure class R2) — an operational failure, checked
   * before `revisions` is consulted at all. Defaults to `false`.
   */
  readonly unreachable?: boolean;
}

export interface CourseArrivalsReading {
  readonly course: string;
  readonly status: CourseArrivalStatus;
  /**
   * The most recent processed revision's arrival day. Populated for
   * `'arrived'` and `'unreadable'` alike — an unreadable revision still
   * arrived, and the day it did is known. `null` only for `'no-arrivals'`
   * and `'unreachable'`.
   */
  readonly lastArrivalDay: CalendarDay | null;
  /** Short, content-free — for tests and a workbench inspector. Never rendered to her, never logged. */
  readonly reason: string;
}

/**
 * The most recent calendar day among `revisions`, and whether at least one
 * revision arriving on that day itself reads (Class A default: when several
 * revisions land the same day, one readable revision is enough for the day
 * to count as "arrived" rather than "could not be read" — a tie-break that
 * only matters once more than one source per course is processed on the
 * same day, unreachable in the reference vault today). `null` when
 * `revisions` is empty or every entry's `arrivedDay` fails to parse.
 */
function latestRevisionOn(
  revisions: readonly ProcessedRevision[],
): { day: CalendarDay; readableArrived: boolean } | null {
  let latestDay: CalendarDay | null = null;
  for (const revision of revisions) {
    if (!isCalendarDay(revision.arrivedDay)) continue;
    if (latestDay === null || revision.arrivedDay > latestDay) latestDay = revision.arrivedDay;
  }
  if (latestDay === null) return null;
  const readableArrived = revisions.some(
    (revision) => revision.arrivedDay === latestDay && revision.readState === 'read',
  );
  return { day: latestDay, readableArrived };
}

/**
 * Pure. One course's arrivals reading — see the module doc for the four
 * states. `unreachable` is checked first: an operational failure this pass
 * takes priority over whatever history is on record (vew.md §2.5: "no
 * line", never a claim built from possibly-stale revisions).
 */
export function detectCourseArrivals(input: CourseArrivalsInput): CourseArrivalsReading {
  if (input.unreachable === true) {
    return {
      course: input.course,
      status: 'unreachable',
      lastArrivalDay: null,
      reason: "the course's source location could not be listed or read this pass",
    };
  }

  const latest = latestRevisionOn(input.revisions);
  if (latest === null) {
    return {
      course: input.course,
      status: 'no-arrivals',
      lastArrivalDay: null,
      reason: 'no processed revision has ever been recorded for this course',
    };
  }

  if (!latest.readableArrived) {
    return {
      course: input.course,
      status: 'unreadable',
      lastArrivalDay: latest.day,
      reason: "the most recent processed revision's reading failed or is still pending",
    };
  }

  return {
    course: input.course,
    status: 'arrived',
    lastArrivalDay: latest.day,
    reason: `the most recently processed revision reached the vault on ${latest.day}`,
  };
}

/** `detectCourseArrivals` over every course, in the order supplied. */
export function detectArrivals(
  inputs: readonly CourseArrivalsInput[],
): readonly CourseArrivalsReading[] {
  return inputs.map(detectCourseArrivals);
}

/**
 * Adapts one course's arrivals reading into `detectRhythm`'s per-course
 * input. Returns `null` for `'unreachable'` — vew.md §2.5's "no line": an
 * unreachable course must never reach the rhythm reading at all (failure
 * class R2), so a caller assembling `RhythmInput.courses` filters this
 * function's `null`s out rather than rendering anything for them:
 *
 * ```ts
 * const courses = arrivalsReadings
 *   .map((a) => toRhythmCourseInput(a, tempoWeights.get(a.course)))
 *   .filter((c): c is RhythmCourseInput => c !== null);
 * ```
 */
export function toRhythmCourseInput(
  arrival: CourseArrivalsReading,
  tempoWeight?: number,
): RhythmCourseInput | null {
  if (arrival.status === 'unreachable') return null;
  return {
    course: arrival.course,
    lastMaterialArrivalDay: arrival.status === 'no-arrivals' ? null : arrival.lastArrivalDay,
    unreadable: arrival.status === 'unreadable',
    ...(tempoWeight === undefined ? {} : { tempoWeight }),
  };
}
