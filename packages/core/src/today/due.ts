/**
 * Due-today counts, per course and in total (F6.1, P2-T09).
 *
 * **This is counting, not queue composition.** `ol-p2t07` owns *which*
 * instruments a session offers and in what order, with per-session concept
 * dedupe and course/topic filtering. This module owns one question — how many
 * are waiting — and answers it from a list it is handed. Nothing here orders
 * anything, dedupes anything, or decides what a session contains, because a
 * second place deciding what "due" means is how a panel and a session come to
 * disagree in front of her.
 *
 * **Why the caller supplies `dueThrough` instead of a `now`.** "Due today"
 * means "due at any point before her day is over", and where her day ends is a
 * local-calendar fact this package has no business guessing (see
 * `calendar-day.ts` for the same argument on the streak side). The plugin
 * computes the end of her local today and passes the instant; core compares
 * instants and stays deterministic and timezone-free.
 *
 * **An instrument with no scheduling state counts as due.** `SchedulerState`
 * only exists once an instrument has been reviewed at least once (see
 * `scheduler/types.ts`), and a never-reviewed instrument in plain FSRS order is
 * available immediately — the run-4 §8.2 record makes exactly this point while
 * rejecting a design mock's opposite claim, that a new instrument waits until
 * the next day's session. So `due: null` means *now*, not *later*.
 *
 * **One course per instrument here, against `QueueCandidate`'s M:N `courses`
 * — an open question, not an oversight.** `queue/types.ts` (P2-T07) carries
 * `courses: readonly string[]`, because course membership is a *concept*
 * attribute and R1/R2 make it many-to-many. This module takes one
 * `courseCode`, which is what keeps `total === sum(courses.count)` true, and
 * that identity is the only thing about the panel a reader can verify by
 * looking at it. Fanning a multi-course instrument into every one of its rows
 * would make the rows sum to more than the headline, with nothing on screen
 * explaining why. The adapter from `QueueCandidate` to `DueInstrument` is
 * therefore where the decision gets made, and it is not made here: see
 * `ol-9n0b`, which owns that wiring and states the question.
 */

/**
 * One instrument as the panel needs to count it. Deliberately not
 * `SchedulerState` and deliberately not a review-view presentation type: the
 * panel needs an id, a course to group by, and one instant.
 */
export interface DueInstrument {
  /** R3: scheduling state is per instrument, so exclusion is too. */
  readonly instrumentId: string;
  /** The grouping key. Short code as shown in the row (never a real course name — INV-3). */
  readonly courseCode: string;
  /** The longer label beside the code. May be empty when the vault gives no name. */
  readonly courseName: string;
  /**
   * ISO-8601 instant this instrument is next due, or `null` when it has never
   * been reviewed — which counts as due now. See this module's doc.
   */
  readonly due: string | null;
}

/** One row of the panel's per-course list. */
export interface CourseDueCount {
  readonly courseCode: string;
  readonly courseName: string;
  readonly count: number;
}

/**
 * What the panel renders above the list. `total` is always the sum of
 * `courses`' counts — the two are computed from one pass so they cannot
 * disagree, which is the only thing a reader can actually check by looking.
 */
export interface DueSummary {
  readonly total: number;
  /**
   * How many of `total` she has never reviewed before.
   *
   * **A subset of `total`, never an addition to it.** A never-reviewed
   * instrument is an ordinary member of the due set — `isDueThrough` counts it
   * as due *now* (see this module's doc), and the queue offers it with
   * `dueState: 'new'` rather than in a separate stream. So `0 <= newCount <=
   * total` and `total` is still the sum of the per-course counts; nothing about
   * the headline or the rows changes because this field exists.
   *
   * It exists because the headline alone is a number she cannot act on. Forty
   * items she has seen before and forty she has never seen are different
   * mornings, and the queue already draws that line. Reading the same line here
   * is one fewer definition of "new" in the product than inventing a second one
   * later would be.
   *
   * The line itself is `due === null`, which `DueInstrument` documents as "never
   * reviewed" — the same absence `replay.ts` produces for an instrument with no
   * entry in the log, and the same one `composeQueue` turns into `'new'`.
   */
  readonly newCount: number;
  /** Only courses with something due. A course with nothing waiting is absent, not a zero. */
  readonly courses: readonly CourseDueCount[];
}

export interface SummariseDueOptions {
  /**
   * The instant her today ends. An instrument due at or before this is due
   * today; anything later is not.
   */
  readonly dueThrough: Date;
  /**
   * Instruments she has suspended (F2.6). Folded from the log by
   * `review-log/suspension.ts` — this module never derives it, it only
   * excludes what it is told to.
   */
  readonly suspendedInstrumentIds?: ReadonlySet<string>;
}

/** True when this instrument is waiting for her today. */
export function isDueThrough(instrument: DueInstrument, dueThrough: Date): boolean {
  if (instrument.due === null) return true;
  const due = Date.parse(instrument.due);
  // An unparseable due instant is treated as not due. It is a bug upstream,
  // and the panel's failure mode for a bug should be under-counting rather
  // than putting a number on screen that nothing stands behind.
  if (Number.isNaN(due)) return false;
  return due <= dueThrough.getTime();
}

/**
 * Counts what is due today, in total and per course.
 *
 * Course order is by count descending, ties broken by `courseCode` ascending —
 * total order, so the list does not reshuffle between two renders of the same
 * data.
 */
export function summariseDue(
  instruments: readonly DueInstrument[],
  options: SummariseDueOptions,
): DueSummary {
  const suspended = options.suspendedInstrumentIds ?? new Set<string>();
  const counted = new Map<string, { courseName: string; count: number }>();
  const seen = new Set<string>();
  let total = 0;
  let newCount = 0;

  for (const instrument of instruments) {
    if (suspended.has(instrument.instrumentId)) continue;
    // R3 keys scheduling on the instrument id, so the id is the identity here
    // too: the same instrument reaching this function twice is one due item,
    // not two.
    if (seen.has(instrument.instrumentId)) continue;
    seen.add(instrument.instrumentId);
    if (!isDueThrough(instrument, options.dueThrough)) continue;

    total += 1;
    // Counted inside the same guard as `total`, from the same instrument, so
    // `newCount <= total` holds by construction rather than by assertion — a
    // second pass over the list could drift from the exclusions above.
    if (instrument.due === null) newCount += 1;
    const existing = counted.get(instrument.courseCode);
    if (existing === undefined) {
      counted.set(instrument.courseCode, {
        courseName: instrument.courseName,
        count: 1,
      });
    } else {
      existing.count += 1;
    }
  }

  const courses = [...counted.entries()]
    .map(
      ([courseCode, value]): CourseDueCount => ({
        courseCode,
        courseName: value.courseName,
        count: value.count,
      }),
    )
    .sort((a, b) => b.count - a.count || a.courseCode.localeCompare(b.courseCode));

  return { total, newCount, courses };
}
