/**
 * F6.5(a) — spacing versus cramming, computed from D7.1 and nothing else.
 *
 * ## What it measures, and why this statistic rather than a simpler one
 *
 * The obvious cramming measure is "her busiest few days hold most of her work"
 * (`olea-synthetic`'s `topDayShare`). It is a bad *detector*, for a reason worth
 * writing down: it needs a control to be read against. A person who studies
 * three evenings a week has a high top-day share and is not cramming; the
 * synthetic suite gets away with it only because it always has a
 * `steady-reviewer` stream to compare against, and a real student's panel has
 * no such twin.
 *
 * So this detector uses a statistic that **carries its own control**: her rate
 * of work in the days before an assessment, divided by her rate of work the
 * rest of the time. An irregular reviewer with no assessment pull scores about
 * 1 whatever her volume, whatever her weekday habits, and whatever her deck
 * size — the denominator moves with the numerator. There is no baseline to
 * calibrate, which is exactly the property N-015 wants: nothing here was fitted
 * to any distribution, synthetic or real.
 *
 * ## Where the assessment dates come from
 *
 * From the log. Every v4 review record carries
 * `selectionContext.examProximity` — days from that review to the next
 * assessment, or `null` when none remained — so `reviewDay + examProximity` is
 * an assessment day the system saw at the time. Deriving them this way rather
 * than taking an assessment list as input is deliberate:
 *
 * - It keeps the detector a pure function of D7.1, which is what `ol-p6t04`
 *   asks for.
 * - It cannot disagree with the log. An assessment note edited or deleted after
 *   the fact would silently change what "the week before the exam" meant for
 *   reviews taken months ago; the log's own `examProximity` is what was true
 *   when she sat down.
 *
 * The cost is stated rather than hidden: an assessment that was never visible
 * to the selection context is invisible here too, and a log with
 * `examProximity: null` throughout (pre-F1.1 history, or a vault with no
 * assignment notes) produces `not-enough-history` rather than a wrong answer.
 *
 * ## Two conditions, four constants, and none of them swept
 *
 * `PRE_ASSESSMENT_WINDOW_DAYS`, `CONCENTRATION_RATIO`, `ATTENDANCE_RATIO` and
 * the sufficiency floors below are **declared constants with a plain-English
 * reading** — "the week before", "more than twice as much per day", "half again
 * as many of those days", "at least three weeks and thirty reviews". That
 * reading is the whole of their justification. **Not one of them was moved to
 * make a measurement come out**: a threshold tuned on fabricated data measures
 * our own assumptions (N-015), and a result that survives only a narrow window
 * of parameter values is fragile whatever it says (the run charter's plateau
 * rule).
 *
 * `ATTENDANCE_RATIO` is a *second condition* rather than a raised first one,
 * and that distinction is the point — its own doc records the false positive
 * that prompted it and why raising `CONCENTRATION_RATIO` instead would have
 * been the forbidden move.
 *
 * ## What this detector actually achieves, measured
 *
 * `packages/workbench/test/trends-scenarios.spec.ts` runs it over forty seeded
 * streams per persona. It fires on **40/40 crammers**, on **0/40 of every other
 * persona** — and on **8/40 of the crammer's own neutralised twin**, which is
 * the honest ceiling on it at this operating point and is asserted there as an
 * exact count rather than smoothed away. The twin studies on roughly a seventh
 * of days, so ninety days leave about ten pre-assessment calendar days and the
 * rate over ten days is noisy. Separating cleanly on that corpus wants a
 * concentration threshold near 5; it has not been moved there, for the reason
 * above.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import {
  type CalendarDay,
  calendarDayOfTimestamp,
  shiftCalendarDay,
} from '../today/calendar-day.js';
import type { InsightResult } from './types.js';

/**
 * "The days before an assessment". Seven, because a week is the unit a student
 * plans in, not because seven separated anything.
 */
export const PRE_ASSESSMENT_WINDOW_DAYS = 7;

/**
 * How much denser the pre-assessment days have to be before this is a pattern
 * rather than noise. Two — "more than twice as much work per day" — is a claim
 * that reads the same in English as it does in arithmetic.
 */
export const CONCENTRATION_RATIO = 2;

/**
 * How much more often she has to turn up at all in the days before an
 * assessment. One and a half — "she opens the app on half again as many of
 * those days".
 *
 * ## Why there is a second condition, and how it came to exist
 *
 * The density ratio alone is not enough, and this was **found rather than
 * anticipated**: on the workbench's crammer-with-the-pattern-removed stream —
 * the neutralised twin, which is a hard negative by construction — the density
 * ratio came out at 2.6 and the detector fired. It should not have. The cause
 * is not a bad threshold, it is a small denominator: a sparse reviewer with a
 * ninety-day history has roughly ten calendar days inside a pre-assessment
 * window, so one busy evening that happens to land in one of them moves the
 * ratio a long way. Raising `CONCENTRATION_RATIO` until the false positive
 * disappeared would have been fitting a threshold to fabricated data (N-015),
 * and would have bought a number nobody could defend in English.
 *
 * The second condition is instead an argument about what cramming *is*:
 * **cramming is a scheduling behaviour, not a volume accident.** A burst that
 * happens to fall near an exam is a coincidence; cramming means the exam is
 * what brought her to the desk. "She showed up on a larger fraction of those
 * days" is the direct evidence for that, and it is a share of days rather than
 * a count of reviews, so one enormous session cannot move it at all. The
 * neutralised twin's attendance ratio is ~1 — she turns up at the same rate
 * either side of an assessment, which is exactly what "the pattern was removed"
 * means — while the crammer's is several times that.
 *
 * Both conditions must hold. That is deliberately conservative: a student who
 * studies daily and merely does more before an exam will not be reported, and
 * the honest reading of that miss is that the log cannot distinguish her from
 * a student whose deck simply has more due that week.
 */
export const ATTENDANCE_RATIO = 1.5;

/** Below these, the detector declines rather than guesses. A fortnight of scraps is not a semester. */
export const MIN_REVIEWS = 30;
export const MIN_SPAN_DAYS = 21;

export interface SpacingMeasured {
  /** Reviews per calendar day inside `PRE_ASSESSMENT_WINDOW_DAYS` of an assessment. */
  readonly nearReviewsPerDay: number;
  /** Reviews per calendar day everywhere else in the span. */
  readonly farReviewsPerDay: number;
  /** `nearReviewsPerDay / farReviewsPerDay`. `Infinity` when she did no work at all outside the windows. */
  readonly concentration: number;
  /** Fraction of pre-assessment calendar days carrying at least one review. */
  readonly nearStudyDayShare: number;
  /** Fraction of every other calendar day carrying at least one review. */
  readonly farStudyDayShare: number;
  /** `nearStudyDayShare / farStudyDayShare` — did the assessment bring her to the desk? */
  readonly attendanceRatio: number;
  /** Share of scheduled reviews drawn before their own due date (`dueState: 'early'`). */
  readonly earlyShare: number;
  readonly windowDays: number;
  readonly nearDayCount: number;
  readonly farDayCount: number;
  readonly reviewCount: number;
  readonly spanDays: number;
  /** Assessment days the log itself implies. Dates only — no title, no course. */
  readonly assessmentDays: readonly CalendarDay[];
}

export type SpacingInsight = InsightResult<SpacingMeasured>;

function reviewsOf(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return entries.filter((entry): entry is ReviewLogRecord => entry.kind === 'review');
}

function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/**
 * Every assessment day the log implies, ascending.
 *
 * Exported because it is the one derivation in this module a reader is likely
 * to want to check on its own, and because the effort insight's scope note and
 * the workbench inspector both surface it.
 */
export function impliedAssessmentDays(entries: readonly ReviewLogEntry[]): readonly CalendarDay[] {
  const days = new Set<CalendarDay>();
  for (const record of reviewsOf(entries)) {
    const proximity = record.selectionContext.examProximity;
    if (proximity === null || !Number.isFinite(proximity) || proximity < 0) continue;
    const day = calendarDayOfTimestamp(record.timestamp);
    if (day === null) continue;
    days.add(shiftCalendarDay(day, proximity));
  }
  return [...days].sort();
}

/**
 * `numerator / denominator`, with the two degenerate cases named rather than
 * left to IEEE-754: nothing anywhere is `0`, and something-over-nothing is
 * `Infinity` — which is a real answer here (she worked only in the windows),
 * not an error.
 */
function ratioOf(numerator: number, denominator: number): number {
  if (denominator !== 0) return numerator / denominator;
  return numerator === 0 ? 0 : Number.POSITIVE_INFINITY;
}

function abstain(reason: string): SpacingInsight {
  return { id: 'spacing', status: 'not-enough-history', measured: null, reason };
}

/**
 * Pure. Reads no clock — "today" plays no part, because the question is about
 * a history, not about a moment.
 */
export function detectSpacing(entries: readonly ReviewLogEntry[]): SpacingInsight {
  const reviews = reviewsOf(entries);
  if (reviews.length < MIN_REVIEWS) {
    return abstain(`fewer than ${MIN_REVIEWS} reviews`);
  }

  const dayOfReview: CalendarDay[] = [];
  for (const record of reviews) {
    const day = calendarDayOfTimestamp(record.timestamp);
    if (day !== null) dayOfReview.push(day);
  }
  if (dayOfReview.length < MIN_REVIEWS) {
    return abstain('too few reviews carry a parseable timestamp');
  }

  const sortedDays = [...dayOfReview].sort();
  const first = sortedDays[0];
  const last = sortedDays[sortedDays.length - 1];
  if (first === undefined || last === undefined) return abstain('no dated reviews');
  const spanDays = daysBetween(first, last) + 1;
  if (spanDays < MIN_SPAN_DAYS) {
    return abstain(`history spans fewer than ${MIN_SPAN_DAYS} days`);
  }

  const assessmentDays = impliedAssessmentDays(entries);
  if (assessmentDays.length === 0) {
    return abstain('no assessment was visible to any review in the log');
  }

  // Proximity for a day with no reviews cannot be read off a record, so it is
  // recomputed for every day of the span from the implied assessment dates —
  // the same "days to the next assessment on or after this one" rule the
  // selection context itself uses. This is what makes the denominator a rate
  // over CALENDAR days rather than over study days: a week she did not open the
  // app is a week of low density, and pretending otherwise would let anyone who
  // studies rarely look spaced.
  const assessmentOffsets = assessmentDays
    .map((day) => daysBetween(first, day))
    .sort((a, b) => a - b);
  const nearOffsets = new Set<number>();
  for (const offset of assessmentOffsets) {
    for (let back = 0; back < PRE_ASSESSMENT_WINDOW_DAYS; back += 1) {
      const at = offset - back;
      if (at >= 0 && at < spanDays) nearOffsets.add(at);
    }
  }

  const nearDayCount = nearOffsets.size;
  const farDayCount = spanDays - nearDayCount;
  if (nearDayCount === 0)
    return abstain('no day of the history falls inside a pre-assessment window');
  if (farDayCount === 0) {
    return abstain(
      'the whole history sits inside a pre-assessment window — nothing to compare it to',
    );
  }

  let nearReviews = 0;
  const nearStudyOffsets = new Set<number>();
  const farStudyOffsets = new Set<number>();
  for (const day of dayOfReview) {
    const offset = daysBetween(first, day);
    if (nearOffsets.has(offset)) {
      nearReviews += 1;
      nearStudyOffsets.add(offset);
    } else {
      farStudyOffsets.add(offset);
    }
  }
  const farReviews = dayOfReview.length - nearReviews;

  const nearReviewsPerDay = nearReviews / nearDayCount;
  const farReviewsPerDay = farReviews / farDayCount;
  const concentration = ratioOf(nearReviewsPerDay, farReviewsPerDay);

  const nearStudyDayShare = nearStudyOffsets.size / nearDayCount;
  const farStudyDayShare = farStudyOffsets.size / farDayCount;
  const attendanceRatio = ratioOf(nearStudyDayShare, farStudyDayShare);

  // Explain-back is never FSRS-scheduled and has no due date, so it cannot be
  // early or late (`packages/synthetic`'s `earlyPullShare` excludes it for the
  // same reason). Counting it would dilute the share with items that had no
  // schedule to be pulled forward from.
  const scheduled = reviews.filter((record) => record.instrumentType !== 'explain-back');
  const early = scheduled.filter((record) => record.selectionContext.dueState === 'early').length;
  const earlyShare = scheduled.length === 0 ? 0 : early / scheduled.length;

  const measured: SpacingMeasured = {
    nearReviewsPerDay,
    farReviewsPerDay,
    concentration,
    nearStudyDayShare,
    farStudyDayShare,
    attendanceRatio,
    earlyShare,
    windowDays: PRE_ASSESSMENT_WINDOW_DAYS,
    nearDayCount,
    farDayCount,
    reviewCount: dayOfReview.length,
    spanDays,
    assessmentDays,
  };

  // Both conditions, and the reason string says which one failed — a detector
  // that reports only its verdict is a detector nobody can debug from a
  // workbench inspector.
  const denseEnough = concentration >= CONCENTRATION_RATIO;
  const attendedEnough = attendanceRatio >= ATTENDANCE_RATIO;
  if (denseEnough && attendedEnough) {
    return {
      id: 'spacing',
      status: 'observed',
      measured,
      reason:
        `pre-assessment days carry ${concentration.toFixed(2)}x the daily rate of the rest, ` +
        `and she studied on ${attendanceRatio.toFixed(2)}x as many of them`,
    };
  }
  return {
    id: 'spacing',
    status: 'not-observed',
    measured,
    reason: denseEnough
      ? `attendance ratio ${attendanceRatio.toFixed(2)} is below ${ATTENDANCE_RATIO} — a burst near an assessment, not a pull toward one`
      : `pre-assessment concentration ${concentration.toFixed(2)} is below ${CONCENTRATION_RATIO}`,
  };
}
