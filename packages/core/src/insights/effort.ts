/**
 * F6.5(b) — effort against the plan's set-aside: where her time went in the recent window, beside
 * what the plans that composed those sessions had set aside for each course.
 *
 * ## The rule (`ol-egov.141.89.11.18`; the standing-views spec, service repo,
 * `docs/dev/intelligence-build/vew.md` section 2.4)
 *
 * ```
 * window       = her last n + 2 sessions (C5.5's clustering; [D-092]'s width, kept by [D-365]),
 *                n = the courses with a floor share in the record that composed her latest session
 * per review in the window:
 *   facts      = the [D-331] composition record that served it (review log v6 `compositionId`,
 *                [D-395] condition 5): its one course and each course's frozen floor share
 *   received   = capped active time (C5.5, [D-091]), counted once, to that one course (F2.18)
 * if any review in the window has no such record -> comparison unavailable
 * set-aside(c) = each review's frozen floor share for c, weighted by its received time
 *                (equals the plan's own floor share when one plan version composed the whole window)
 * gates: 40 timed reviews over the whole log; two or more courses with a frozen floor share;
 *        40 timed reviews inside the window ([D-365] keeps both values)
 * observed when share(c) < 0.5 x set-aside(c) (the shortfall ratio, declared), shown as two facts
 * reading: observed | not observed | not enough history | comparison unavailable
 * ```
 *
 * It replaces three defects the standing-views development run found (`ol-egov.141.89.11.4`):
 *
 * 1. **Raw duration.** A review's `durationMs` was summed as recorded, so one card left open for
 *    an hour out-voted a course's honest work. Received time is now capped per item at
 *    {@link RECEIVED_SECONDS_PER_ITEM_CAP}, imported from its one declared home
 *    (`../session/cluster.ts`, `[D-091]`), never restated here.
 * 2. **Counted twice.** A review whose concepts touch two courses used to put its whole duration
 *    on both. A session has one course (C5.6, F2.18), and the composition record states it, so
 *    each review's received time goes to its record's course, once. The concept-to-course join is
 *    no longer read for attribution at all.
 * 3. **Today's plan for a past window.** The set-aside was the current cached plan's floor share,
 *    whatever plan had composed the sessions being read. The composition record (`[D-331]`,
 *    `[D-395]`; `../study-session/composition-record.ts`) freezes the allocation a session was
 *    composed under, and that frozen allocation is what is read. **The current plan's shares are
 *    never read for a past session**: {@link EffortInput.floorShares} is kept only so existing
 *    callers compile, and nothing here reads it.
 *
 * And it adds the fourth state: when any review in the window has no composition record (a record
 * missing, an id that resolves to no record or to more than one, a pre-v6 review with no link), a
 * record naming no one course, or a record composed with no plan's floor shares in force, the
 * reading is `comparison-unavailable`: withheld, never computed from anything else, and never
 * "not observed". An inactive nudge is never evidence that effort is balanced (`[D-365]`).
 *
 * ## Order of the abstentions
 *
 * The whole-log count comes first, because "is there enough history at all" needs no record to
 * answer and a new student's log should read "not enough history" whether or not her sessions were
 * recorded. Then the records, then the frozen-floor and windowed gates, which need them. The
 * matching rule fixes no order (no development or held-out case meets two abstentions at once);
 * this one is a Class B choice, flagged on the bead.
 *
 * ## What did not change
 *
 * The shortfall ratio {@link SHORTFALL_RATIO_K} (`findings/effort-gap-sweep.md`, service repo) and
 * both sample floors, 40 and 40 (`[D-365]` keeps the values); the never-in-the-negative shape; the
 * course-naming rule (`ol-7j54`, `./index.ts`); and the two honesty properties:
 *
 * 1. **A course with a frozen floor share and no time is included at share zero**, never dropped:
 *    the loudest finding available must not be the one this shape cannot say.
 * 2. **Time on a course with no frozen floor share in the window is left out of both totals** and
 *    named in `coursesWithoutFloorShare`, never folded in at a set-aside of zero.
 *
 * Floor shares are taken as the plan stated them, never renormalised across courses (a floor share
 * is already a fraction of the whole plan's window). The share and the set-aside are both
 * fractions of the same received time, so the two facts share C5.5's unit (vew.md 2.4, "one
 * accounting unit").
 *
 * ## Reachability (`[D-072]` clause 5)
 *
 * Production reaches this through the Today view: `plugin/src/main.ts` builds the view →
 * `loadTodayPanel` → `buildTodayPanel` (`../today/panel.ts`) → `buildInsights` (`./index.ts`) →
 * {@link detectEffortImbalance}. That path does not yet hand in `compositions`, so in production
 * every window with at least 40 timed reviews reads `comparison-unavailable` and the line is
 * withheld until it does: the stated loss vew.md 2.4 names, not a defect of this module. The
 * splice (read `readCompositionLog` in the Today data source and pass the records through
 * `buildTodayPanel` and `buildInsights`) is recorded on `ol-egov.141.89.11.18`.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { clusterReviewSessions, RECEIVED_SECONDS_PER_ITEM_CAP } from '../session/cluster.js';
import { windowWidthSessions } from '../study-session/window.js';
import type { ConceptCourses, InsightId, InsightStatus } from './types.js';

/**
 * No longer the firing threshold (`ol-v7r5.63`, `[DOS-C4]`): kept, unchanged, because
 * `packages/workbench/test/trends-scenarios.spec.ts` imports it for a diagnostic comparison
 * against `widestGap`. {@link SHORTFALL_RATIO_K} decides `status`.
 */
export const MIN_GAP = 0.2;

/**
 * The shortfall ratio: a course fires when its share is under this fraction of its set-aside
 * (`share < SHORTFALL_RATIO_K * setAside`, positive direction only). "The course received under
 * half of what its own floor set aside" — the plain-English pin `findings/effort-gap-sweep.md`
 * (service repo) picks after sweeping two to six courses at the real floor formula. Declared, not
 * fitted; `[D-194]` bucket one; kept by `[D-365]`.
 */
export const SHORTFALL_RATIO_K = 0.5;

/**
 * Below this many timed course reviews over the WHOLE log, a split is noise and the reading
 * declines (`ol-egov.141.89.11.7`; value kept by `[D-365]`). A count, not a duration: sample size
 * is what makes a share trustworthy.
 */
export const MIN_TIMED_REVIEWS = 40;

/**
 * Below this many timed reviews INSIDE the window, on a course with a frozen floor share, the
 * share rests on too little and the reading declines (`ol-egov.141.89.11.7` second pass; value
 * kept by `[D-365]`). `EffortDetectionOptions.minWindowedTimedReviews` overrides it for sweeps and
 * tests only.
 */
export const MIN_WINDOWED_TIMED_REVIEWS = 40;

/** The minimum a comparison needs to exist at all: two courses with a frozen floor share in the window. */
export const MIN_COURSES_WITH_FLOOR_SHARE = 2;

/**
 * The allocation contribution a course's floor share is read from, in a composition record's
 * frozen `planAllocation` (`StudyPlanAllocationEntry.contributions`, the entry the service names
 * `floor`) — the same source the Today data source reads a cached plan's floor from.
 */
export const FLOOR_CONTRIBUTION_NAME = 'floor';

/**
 * A course's floor share as a caller once supplied it from the current cached plan.
 *
 * @deprecated No longer read (`ol-egov.141.89.11.18`): the set-aside comes from the composition
 * records that composed the window, never from today's plan. Kept so existing callers compile
 * until they hand in `compositions` instead.
 */
export interface CourseFloorShare {
  readonly course: string | undefined;
  readonly floorShare: number | undefined;
}

/**
 * The facts this reading takes from one composition record: the structural subset of
 * `CompositionRecord` (`../study-session/composition-record.ts`) it reads, so a record read from
 * `.olea/compositions/` passes as it is and a test or harness need not build the rest.
 */
export interface EffortComposition {
  readonly compositionId: string;
  /** The session's one course (C5.6, F2.18); `null` only under the harness's every-course baseline. */
  readonly course: string | null;
  /** The plan's allocation as the composition read it, frozen; empty when no plan was in force. */
  readonly planAllocation: readonly {
    readonly courseId: string;
    readonly contributions: readonly { readonly name: string; readonly value: number }[];
  }[];
}

export interface CourseEffort {
  readonly course: string;
  /** Capped active time received by this course inside the window, in milliseconds. */
  readonly timeMs: number;
  /** This course's share of the received time, across courses with a frozen floor share. */
  readonly timeShare: number;
  /**
   * The set-aside: each window review's frozen floor share for this course, weighted by that
   * review's received time. Equals the plan's own floor share when one plan version composed the
   * whole window. Never today's plan.
   */
  readonly floorShare: number;
  /** `floorShare - timeShare`. Positive when the course received less than was set aside. */
  readonly gap: number;
}

/** One composition record that served reviews inside the window, and what it received. */
export interface EffortWindowComposition {
  readonly compositionId: string;
  readonly course: string;
  /** Capped active time of the window reviews it served, in milliseconds. */
  readonly receivedMs: number;
}

export interface EffortMeasured {
  /** Every course with a frozen floor share in the window, sorted by `gap` descending. */
  readonly courses: readonly CourseEffort[];
  /** The widest positive gap, or `0` when none is positive. */
  readonly widestGap: number;
  /** The course carrying `widestGap`, or `null` when no gap is positive. */
  readonly widestGapCourse: string | null;
  /** Capped received time inside the window, on courses with a frozen floor share, in milliseconds. */
  readonly totalTimeMs: number;
  /** Timed course reviews over the whole log: the population {@link MIN_TIMED_REVIEWS} reads. */
  readonly timedReviewCount: number;
  /** The same count, kept under its earlier name for callers that read it. */
  readonly weightedReviewCount: number;
  /** Timed reviews inside the window on a course with a frozen floor share: {@link MIN_WINDOWED_TIMED_REVIEWS}'s population. */
  readonly windowedWeightedReviewCount: number;
  /** Courses that received window time but carry no frozen floor share there: in neither total, named so nothing narrows silently. */
  readonly coursesWithoutFloorShare: readonly string[];
  /** The records that served the window, in the order first met, each with what it received. */
  readonly windowCompositions: readonly EffortWindowComposition[];
}

/** The four answers this reading gives: the three every insight gives, and its own withheld comparison. */
export type EffortStatus = InsightStatus | 'comparison-unavailable';

/**
 * `InsightResult<EffortMeasured>` with the fourth status. `measured` is `null` exactly when the
 * reading abstains (`not-enough-history` or `comparison-unavailable`).
 */
export interface EffortInsight {
  readonly id: InsightId;
  readonly status: EffortStatus;
  readonly measured: EffortMeasured | null;
  /** Short, content-free, for tests and the workbench inspector. Never rendered to her, never logged. */
  readonly reason: string;
}

export interface EffortInput {
  readonly entries: readonly ReviewLogEntry[];
  /** Concept to courses. Read only to decide which whole-log reviews are course reviews; never to attribute time. */
  readonly concepts: readonly ConceptCourses[];
  /**
   * Every composition record she has, as read from her composition log (`readCompositionLog`).
   * Absent reads as none: every window then reads `comparison-unavailable`.
   */
  readonly compositions?: readonly EffortComposition[];
  /**
   * @deprecated Not read. The current plan's shares are never used for a past window
   * (`ol-egov.141.89.11.18`); kept so existing callers compile until they pass `compositions`.
   */
  readonly floorShares?: readonly CourseFloorShare[];
}

/** Sweeps and tests only; production reads the declared constants. */
export interface EffortDetectionOptions {
  /** Override {@link MIN_WINDOWED_TIMED_REVIEWS}. */
  readonly minWindowedTimedReviews?: number;
}

/** A review's capped active time in milliseconds (`[D-091]`); `null` duration is unmeasured and receives nothing. */
function receivedMsOf(record: ReviewLogRecord): number {
  if (record.durationMs === null || !Number.isFinite(record.durationMs) || record.durationMs <= 0) {
    return 0;
  }
  return Math.min(record.durationMs, RECEIVED_SECONDS_PER_ITEM_CAP * 1000);
}

/**
 * Id to record, where an id carried by exactly one record resolves (`[D-395]` condition 5) and an
 * id carried by two or more resolves to nothing. The same rule `resolveCompositionRecord` states.
 */
function indexCompositions(
  compositions: readonly EffortComposition[],
): ReadonlyMap<string, EffortComposition | null> {
  const byId = new Map<string, EffortComposition | null>();
  for (const record of compositions) {
    byId.set(record.compositionId, byId.has(record.compositionId) ? null : record);
  }
  return byId;
}

/** The record's frozen floor shares, positive ones only; a later entry for the same course replaces an earlier one. */
function frozenFloorShares(record: EffortComposition): ReadonlyMap<string, number> {
  const shares = new Map<string, number>();
  for (const entry of record.planAllocation) {
    const floor = entry.contributions.find((c) => c.name === FLOOR_CONTRIBUTION_NAME);
    if (floor === undefined || !Number.isFinite(floor.value) || floor.value <= 0) {
      shares.delete(entry.courseId);
      continue;
    }
    shares.set(entry.courseId, floor.value);
  }
  return shares;
}

function abstain(reason: string): EffortInsight {
  return { id: 'effort-balance', status: 'not-enough-history', measured: null, reason };
}

function unavailable(reason: string): EffortInsight {
  return { id: 'effort-balance', status: 'comparison-unavailable', measured: null, reason };
}

/** Pure. Reads no clock and no vault. */
export function detectEffortImbalance(
  input: EffortInput,
  options: EffortDetectionOptions = {},
): EffortInsight {
  const minWindowedTimedReviews = options.minWindowedTimedReviews ?? MIN_WINDOWED_TIMED_REVIEWS;
  const recordById = indexCompositions(input.compositions ?? []);
  const resolve = (review: ReviewLogRecord): EffortComposition | null => {
    const id = review.compositionId;
    return id === undefined ? null : (recordById.get(id) ?? null);
  };

  const coursesOfConcept = new Map<string, readonly string[]>();
  for (const concept of input.concepts) coursesOfConcept.set(concept.conceptId, concept.courses);

  const sessions = clusterReviewSessions(input.entries);

  // 1. Enough history at all, over the whole log. A course review is one its record places on a
  // course, or, with no record, one whose concepts belong to some course. Counted once each.
  let timedReviewCount = 0;
  for (const session of sessions) {
    for (const review of session.reviews) {
      if (receivedMsOf(review) === 0) continue;
      const record = resolve(review);
      const isCourseReview =
        record?.course != null ||
        review.conceptIds.some((id) => (coursesOfConcept.get(id) ?? []).length > 0);
      if (isCourseReview) timedReviewCount += 1;
    }
  }
  if (timedReviewCount < MIN_TIMED_REVIEWS) {
    return abstain(`fewer than ${MIN_TIMED_REVIEWS} timed course reviews over the whole log`);
  }

  // 2. The window, and the record behind every review in it.
  const latestSession = sessions[sessions.length - 1];
  const latestReview = latestSession?.reviews[latestSession.reviews.length - 1];
  const latestRecord = latestReview === undefined ? null : resolve(latestReview);
  if (latestRecord === null) {
    return unavailable('her latest session has no composition record');
  }
  const width = windowWidthSessions(frozenFloorShares(latestRecord).size);
  const windowReviews = sessions
    .slice(Math.max(0, sessions.length - width))
    .flatMap((session) => session.reviews);

  const served: { review: ReviewLogRecord; record: EffortComposition; course: string }[] = [];
  for (const review of windowReviews) {
    const record = resolve(review);
    if (record === null) {
      return unavailable('a session in the window has no composition record');
    }
    if (record.course === null) {
      return unavailable('a session in the window was composed with no one course');
    }
    if (frozenFloorShares(record).size === 0) {
      return unavailable("a session in the window was composed with no plan's floor shares");
    }
    served.push({ review, record, course: record.course });
  }

  // 3. The frozen floor shares the window was composed under.
  const floorCourses = new Set<string>();
  for (const { record } of served) {
    for (const course of frozenFloorShares(record).keys()) floorCourses.add(course);
  }
  if (floorCourses.size < MIN_COURSES_WITH_FLOOR_SHARE) {
    return abstain(
      `fewer than ${MIN_COURSES_WITH_FLOOR_SHARE} courses have a frozen floor share in the window`,
    );
  }

  // 4. Received time, once, to each review's one course; the set-aside weighted by the same time.
  const timeByCourse = new Map<string, number>();
  const setAsideWeighted = new Map<string, number>();
  const outside = new Set<string>();
  const byComposition = new Map<string, { course: string; receivedMs: number }>();
  let windowedWeightedReviewCount = 0;
  let totalTimeMs = 0;
  for (const { review, record, course } of served) {
    const ms = receivedMsOf(review);
    const row = byComposition.get(record.compositionId) ?? { course, receivedMs: 0 };
    row.receivedMs += ms;
    byComposition.set(record.compositionId, row);
    if (ms === 0) continue;
    if (!floorCourses.has(course)) {
      outside.add(course);
      continue;
    }
    windowedWeightedReviewCount += 1;
    totalTimeMs += ms;
    timeByCourse.set(course, (timeByCourse.get(course) ?? 0) + ms);
    const shares = frozenFloorShares(record);
    for (const c of floorCourses) {
      setAsideWeighted.set(c, (setAsideWeighted.get(c) ?? 0) + (shares.get(c) ?? 0) * ms);
    }
  }

  if (windowedWeightedReviewCount < minWindowedTimedReviews || totalTimeMs <= 0) {
    return abstain(
      `fewer than ${minWindowedTimedReviews} timed reviews within the window on a course with a frozen floor share`,
    );
  }

  const courses: CourseEffort[] = [...floorCourses]
    .map((course) => {
      const timeMs = timeByCourse.get(course) ?? 0;
      const timeShare = timeMs / totalTimeMs;
      const floorShare = (setAsideWeighted.get(course) ?? 0) / totalTimeMs;
      return { course, timeMs, timeShare, floorShare, gap: floorShare - timeShare };
    })
    .sort((a, b) => (b.gap !== a.gap ? b.gap - a.gap : a.course < b.course ? -1 : 1));

  const widest = courses[0];
  const widestGap = widest !== undefined && widest.gap > 0 ? widest.gap : 0;
  const widestGapCourse = widest !== undefined && widest.gap > 0 ? widest.course : null;

  const measured: EffortMeasured = {
    courses,
    widestGap,
    widestGapCourse,
    totalTimeMs,
    timedReviewCount,
    weightedReviewCount: timedReviewCount,
    windowedWeightedReviewCount,
    coursesWithoutFloorShare: [...outside].sort(),
    windowCompositions: [...byComposition.entries()].map(([compositionId, row]) => ({
      compositionId,
      course: row.course,
      receivedMs: row.receivedMs,
    })),
  };

  const widestRatio =
    widest !== undefined && widest.floorShare > 0 ? widest.timeShare / widest.floorShare : 1;
  const observed = widestGapCourse !== null && widestRatio < SHORTFALL_RATIO_K;

  return observed
    ? {
        id: 'effort-balance',
        status: 'observed',
        measured,
        reason: `${widestGapCourse}'s share (${widest?.timeShare.toFixed(3)}) is under ${SHORTFALL_RATIO_K} of its set-aside (${widest?.floorShare.toFixed(3)}), ratio ${widestRatio.toFixed(3)}`,
      }
    : {
        id: 'effort-balance',
        status: 'not-observed',
        measured,
        reason:
          widestGapCourse === null
            ? 'no course is below its set-aside'
            : `${widestGapCourse}'s shortfall ratio ${widestRatio.toFixed(3)} does not clear ${SHORTFALL_RATIO_K}`,
      };
}
