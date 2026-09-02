/**
 * Measurements over an emitted stream — the language the persona assertions are
 * written in.
 *
 * **None of these is a detector, and none carries a threshold.** They are
 * descriptive statistics with no cut-off baked in: `topDayShare` returns a
 * fraction, it does not decide whether that fraction is "cramming". Where a
 * test needs to say a persona is extreme, it says so *relative to the
 * `steady-reviewer` control* rather than against a number somebody picked while
 * looking at this data — which is N-015's bar against fitting any threshold to
 * fabricated data, applied to our own test suite rather than only to the
 * product.
 *
 * The functions here are also what F6.5's insights and the second early-warning
 * signal will need to be golden-tested against these personas: (a) spacing vs.
 * cramming reads `topDayShare` / `earlyPullShare` / `examProximityAtReview`,
 * (b) effort imbalance reads `reviewCountByCourse` and `timeSpentMsByCourse`,
 * and the early-warning signal reads `instrumentShareWhenBothOffered`.
 */

import type {
  DisputeLogRecord,
  ExplainBackOfferLogRecord,
  ReviewLogEntry,
  ReviewLogRecord,
} from 'olea-contracts';
import { CARD_TYPES, courseOfConcept, type ScheduledType } from './vocabulary.js';

/** Review events only — suspend/unsuspend entries are facts about the deck, not reviews. */
export function reviewsOf(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return entries.filter((e): e is ReviewLogRecord => e.kind === 'review');
}

/**
 * The local calendar day an entry happened on, read straight off the
 * timestamp's first ten characters — the same substring `olea-core`'s writer
 * uses to pick the day's file, and correct precisely because D7.1 requires an
 * explicit offset on every timestamp.
 */
export function localDayOf(entry: ReviewLogEntry): string {
  return entry.timestamp.slice(0, 10);
}

/** Distinct local days carrying at least one entry, ascending. */
export function eventDays(entries: readonly ReviewLogEntry[]): readonly string[] {
  return [...new Set(entries.map(localDayOf))].sort();
}

/** Entry counts per local day, descending by count then ascending by day. */
export function dayCounts(
  entries: readonly ReviewLogEntry[],
): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(localDayOf(entry), (counts.get(localDayOf(entry)) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1));
}

/**
 * The share of all reviews that fall on the `k` busiest days.
 *
 * The cramming shape in one number: a steady reviewer spreads her work, so her
 * busiest few days hold roughly `k / studyDays` of it; a crammer's busiest few
 * days hold most of it. `k` is a *parameter of the question*, not a threshold —
 * the assertions pass the same `k` to the crammer and to the control and
 * compare the two answers.
 */
export function topDayShare(entries: readonly ReviewLogEntry[], k: number): number {
  const reviews = reviewsOf(entries);
  if (reviews.length === 0) return 0;
  const counts = dayCounts(reviews);
  const top = counts.slice(0, k).reduce((sum, [, n]) => sum + n, 0);
  return top / reviews.length;
}

/**
 * Reviews per day she actually studied — the density half of the cramming
 * shape, and the sharper half. Two students can log the same number of reviews
 * over a semester; the crammer logs them on a fifth of the days.
 */
export function reviewsPerActiveDay(entries: readonly ReviewLogEntry[]): number {
  const reviews = reviewsOf(entries);
  const days = eventDays(reviews).length;
  return days === 0 ? 0 : reviews.length / days;
}

/** Longest run, in days, between two consecutive event days. `0` for a stream with fewer than two event days. */
export function maxGapDays(entries: readonly ReviewLogEntry[]): number {
  const days = eventDays(entries);
  let max = 0;
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1];
    const current = days[i];
    if (previous === undefined || current === undefined) continue;
    const gap = Math.round(
      (Date.parse(`${current}T00:00:00.000Z`) - Date.parse(`${previous}T00:00:00.000Z`)) /
        86_400_000,
    );
    if (gap > max) max = gap;
  }
  return max;
}

function isCard(type: string): boolean {
  return (CARD_TYPES as readonly string[]).includes(type);
}

export interface BothOfferedShare {
  /** Reviews where the queue offered both a card type and an MCQ for the concept. */
  readonly total: number;
  /** How many of those she answered as an MCQ. */
  readonly mcq: number;
  /** `mcq / total`; `0` when `total` is 0. */
  readonly mcqShare: number;
}

/**
 * The second early-warning signal, computed exactly as the spec amendment
 * defines it: a persistent skip of one instrument type, counted **only over the
 * reviews where both types were on offer**. The conditioning is the whole
 * measurement — an unconditional MCQ share confounds avoidance with what the
 * queue happened to have due.
 */
export function instrumentShareWhenBothOffered(
  entries: readonly ReviewLogEntry[],
): BothOfferedShare {
  let total = 0;
  let mcq = 0;
  for (const record of reviewsOf(entries)) {
    const offered: readonly ScheduledType[] = record.selectionContext
      .instrumentTypesOffered as readonly ScheduledType[];
    const bothOffered = offered.includes('mcq') && offered.some(isCard);
    if (!bothOffered) continue;
    total += 1;
    if (record.instrumentType === 'mcq') mcq += 1;
  }
  return { total, mcq, mcqShare: total === 0 ? 0 : mcq / total };
}

/** Share of reviews drawn before their FSRS due date — the crammer's other tell. */
export function earlyPullShare(entries: readonly ReviewLogEntry[]): number {
  const reviews = reviewsOf(entries).filter((r) => r.instrumentType !== 'explain-back');
  if (reviews.length === 0) return 0;
  const early = reviews.filter((r) => r.selectionContext.dueState === 'early').length;
  return early / reviews.length;
}

/** Counts per `dueState`, so a coherence check can say what shape a stream actually has. */
export function dueStateCounts(
  entries: readonly ReviewLogEntry[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const record of reviewsOf(entries)) {
    const key = record.selectionContext.dueState;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Median days-to-next-assessment at the moment of review; `null` when nothing is measurable. */
export function medianExamProximity(entries: readonly ReviewLogEntry[]): number | null {
  const values = reviewsOf(entries)
    .map((r) => r.selectionContext.examProximity)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const middle = values[Math.floor(values.length / 2)];
  return middle ?? null;
}

export interface CourseLapseRate {
  readonly reviews: number;
  readonly again: number;
  /** `again / reviews`; `0` when `reviews` is 0. */
  readonly rate: number;
}

/**
 * The distinct course ids among a record's `conceptIds` — v3's many-to-many
 * evidence resolved into the set of courses that record actually touches.
 * `Set` semantics matter here: two of a record's concepts sharing a course
 * must not double-count that course for this one record.
 */
function distinctCoursesOf(record: ReviewLogRecord): ReadonlySet<string> {
  const courseIds = new Set<string>();
  for (const conceptId of record.conceptIds) {
    const courseId = courseOfConcept(conceptId);
    if (courseId !== undefined) courseIds.add(courseId);
  }
  return courseIds;
}

/**
 * `again` rate per course, over FSRS-rated reviews only — explain-back produces
 * no rating (F2.16) and counting it as a non-lapse would dilute exactly the
 * course the routing fires on.
 *
 * A record's evidence is many-to-many (v3, D-020/`ol-t3sd`): one instrument can
 * be evidence for concepts in more than one course, and it is counted once for
 * each *distinct* course among them — never twice for the same course because
 * two of its concepts happen to share it. So `reviews` totalled across courses
 * no longer necessarily sums to the record count: a review naming concepts in
 * two courses is a review for each of those courses.
 */
export function lapseRateByCourse(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, CourseLapseRate> {
  const totals = new Map<string, { reviews: number; again: number }>();
  for (const record of reviewsOf(entries)) {
    if (record.rating === null) continue;
    for (const courseId of distinctCoursesOf(record)) {
      const entry = totals.get(courseId) ?? { reviews: 0, again: 0 };
      entry.reviews += 1;
      if (record.rating === 'again') entry.again += 1;
      totals.set(courseId, entry);
    }
  }
  return new Map(
    [...totals.entries()].map(([courseId, t]) => [
      courseId,
      { reviews: t.reviews, again: t.again, rate: t.reviews === 0 ? 0 : t.again / t.reviews },
    ]),
  );
}

/**
 * Reviews per course — the counting half of F6.5(b), effort imbalance.
 *
 * As with `lapseRateByCourse`, a record is counted once per *distinct* course
 * among its `conceptIds` (v3's many-to-many evidence), so the per-course totals
 * no longer necessarily sum to the review count: a review whose instrument is
 * evidence for concepts in two courses counts toward both.
 */
export function reviewCountByCourse(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const record of reviewsOf(entries)) {
    for (const courseId of distinctCoursesOf(record)) {
      counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Milliseconds spent per course — the time half of F6.5(b).
 *
 * Same many-to-many rule as `reviewCountByCourse`: the record's full
 * `durationMs` is attributed to every distinct course among its `conceptIds`,
 * not split between them — the time really was spent, and it really is
 * evidence for each of those courses. So the per-course totals no longer
 * necessarily sum to a figure derivable from the review count alone.
 */
export function timeSpentMsByCourse(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const record of reviewsOf(entries)) {
    if (record.durationMs === null) continue;
    for (const courseId of distinctCoursesOf(record)) {
      totals.set(courseId, (totals.get(courseId) ?? 0) + record.durationMs);
    }
  }
  return totals;
}

/**
 * Each course's share of the total attributed review time — `timeSpentMsByCourse`
 * normalised, and the form F6.5(b)'s claims are actually written in.
 *
 * A share rather than a magnitude for the reason this module's header gives:
 * a magnitude taken from fabricated data is exactly the number N-015 forbids
 * anyone to reuse, whereas a share is a statement about the *split*, which is
 * what "effort imbalance" means and what survives a change of stream length.
 *
 * Note the denominator is the sum of the per-course totals, which (v3's
 * many-to-many evidence) is not the same as the total time in the log: a record
 * naming concepts in two courses contributes its duration to both. So these
 * shares are shares of *attributed* time and sum to 1 by construction.
 */
export function timeShareByCourse(entries: readonly ReviewLogEntry[]): ReadonlyMap<string, number> {
  const totals = timeSpentMsByCourse(entries);
  const sum = [...totals.values()].reduce((acc, ms) => acc + ms, 0);
  if (sum === 0) return new Map();
  return new Map([...totals.entries()].map(([courseId, ms]) => [courseId, ms / sum]));
}

/** Every explain-back attempt (F2.12's routing history). */
export function explainBackRecords(entries: readonly ReviewLogEntry[]): readonly ReviewLogRecord[] {
  return reviewsOf(entries).filter((r) => r.instrumentType === 'explain-back');
}

/**
 * Every explain-back-offered event (`[D-178 / LOG-3]` item 2) — the routing
 * moment itself, whether or not it was ever taken.
 */
export function explainBackOfferEvents(
  entries: readonly ReviewLogEntry[],
): readonly ExplainBackOfferLogRecord[] {
  return entries.filter((e): e is ExplainBackOfferLogRecord => e.kind === 'explain-back-offered');
}

/**
 * Every explain-back-declined event — an offer that left the surface
 * unaccepted (F2.14a: declining changes nothing and is not itself a state).
 */
export function explainBackDeclineEvents(
  entries: readonly ReviewLogEntry[],
): readonly ExplainBackOfferLogRecord[] {
  return entries.filter((e): e is ExplainBackOfferLogRecord => e.kind === 'explain-back-declined');
}

/**
 * Every dispute record (`[D-095]`, `disputeLogRecordV5`) — the contest
 * mechanism's own event, planted by `contestChance` (`ol-3ux7.5.32`). This
 * generator only ever emits opening, `claimKind: 'reading'` disputes, so
 * every record this returns carries `effect: 'held'` and neither `resolves`
 * nor `outcome` — but the filter is on `kind`, not on those fields, so a
 * future trigger that emits a different claim kind or a resolution is
 * measured by the same function rather than needing a second one.
 */
export function disputeEvents(entries: readonly ReviewLogEntry[]): readonly DisputeLogRecord[] {
  return entries.filter((e): e is DisputeLogRecord => e.kind === 'dispute');
}

/**
 * Concepts failed more than once — the misconception-recurrence signal (M1–M4)
 * in the only form a review log can carry it: the same concept rated `again`
 * repeatedly.
 *
 * An `again` on an instrument that is evidence for several concepts
 * (`conceptIds`, v3) is a failure signal for *each* of them, so the counter
 * increments once per entry in `conceptIds` rather than once per record — the
 * same many-to-many rule the v2→v3 schema change established for review-log
 * evidence generally.
 */
export function recurringFailureConceptIds(
  entries: readonly ReviewLogEntry[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const record of reviewsOf(entries)) {
    if (record.rating !== 'again') continue;
    for (const conceptId of record.conceptIds) {
      counts.set(conceptId, (counts.get(conceptId) ?? 0) + 1);
    }
  }
  return new Map([...counts.entries()].filter(([, n]) => n > 1));
}
