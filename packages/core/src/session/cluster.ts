/**
 * C5.5's session clustering, and the `PastSessionRecord` projection built on
 * it (`[SESS-13]`, `ol-egov.132.14`, discovered from `[FOCUS-3b]`/`ol-ulj7`).
 *
 * `[D-091]`: *a session is a reading over the review events — a maximal
 * cluster of reviews separated by gaps below a declared threshold.* The rule
 * is **contract-grade**: declared, stable, and computed only from event
 * timestamps, so it replays deterministically and two devices count the same
 * sessions. `[D-092]` denominates the fairness window in exactly these
 * sessions, which is why the rule cannot be an implementation detail.
 *
 * Before this module the rule had no implementation anywhere in
 * `packages/core` or `packages/plugin` — `study-session/window.ts`'s own
 * module doc says so, and declines to invent it. This is that function, and
 * `window.ts` is deliberately untouched by it: this module produces the
 * {@link PastSessionRecord}s that module consumes, and imports its type
 * rather than reimplementing any of its arithmetic.
 *
 * ## Pure, over entries someone else read
 *
 * No `VaultSource`, no path, no clock — `./history.ts` is the one piece of
 * I/O, one function away, exactly as `./replay.ts` is arranged and for the
 * same reasons. A caller that already holds the log (the plugin's composer
 * assembly, the workbench, a test) does not read it twice.
 *
 * ## Only reviews open or extend a session
 *
 * `[D-091]`: "an opened-but-unreviewed queue accrues nothing: the window owes
 * a division of *practice*". So suspend, verdict, succession, dispute, offer
 * and observation records are skipped outright — not "applied as a no-op" —
 * the same posture `./replay.ts` takes for suspension events. A review whose
 * `rating` is `null` (an explain-back attempt, F2.14) still *is* practice and
 * still received her attention, so it clusters and it contributes seconds; it
 * is only the *scheduler* that must not see it.
 *
 * ## Order is (timestamp, eventId), never array order
 *
 * `compareByInstantThenEventId`, imported from `../review-log/merge.ts` — the
 * same ruled total order (`ol-egov.20`) `./replay.ts` reads for the same
 * reason. Entries reach a caller from several devices' files in whatever
 * order it read them; a clustering that depended on array order would count
 * different sessions on the phone and the laptop, which is the one thing
 * `[D-091]` says the rule must never do.
 */

import type { ReviewLogEntry, ReviewLogRecord } from 'olea-contracts';
import { compareByInstantThenEventId } from '../review-log/merge.js';
import type { PastSessionRecord } from '../study-session/window.js';
import type { CalendarDay } from '../today/calendar-day.js';
import { calendarDayOfTimestamp } from '../today/calendar-day.js';

/**
 * C5.5's clustering gap: the silence, in seconds, above which two reviews
 * belong to two sessions. **45 minutes.**
 *
 * ## A DECLARED constant, and it must stay one
 *
 * `[D-091]` rules the clustering rule "declared, stable, computed only from
 * event timestamps", and `docs/Olea_component_register.md`'s windows table
 * already records this row as a *declared* threshold. Declared means
 * defensible in plain English and **never fitted to an outcome** — so no
 * sweep, on any corpus, may be allowed to choose it. The sensitivity sweep
 * below is a robustness check on a number argued independently, never its
 * derivation.
 *
 * ## The argument
 *
 * The register names both failure modes: too small and "one coffee break
 * splits an honest session in two"; too large and "two separate sessions
 * merge and the count under-reads". 45 minutes clears both with margin.
 *
 * - **Above every pause that is still the same sitting.** Making tea,
 *   answering the door, reading one message — a student stays *at the work*
 *   through interruptions of this shape, and they run to tens of minutes at
 *   the very worst. It is also more than twice
 *   `DEFAULT_SESSION_BUDGET_MINUTES` (20), so an interruption would have to
 *   outlast two whole sessions before it could split one.
 * - **Below every return that is honestly a new decision.** Coming back after
 *   dinner, after a lecture, or the next morning is a fresh sitting-down —
 *   she decided again — and those are separated by hours, not by
 *   three-quarters of one.
 *
 * Nothing between 30 and 60 minutes is indefensible on that argument; 45 is
 * the pin inside it, chosen for the margin on both sides rather than for any
 * measured effect.
 *
 * ## The sweep, and why it decided nothing (`[SESS-13]` close evidence)
 *
 * Session counts were swept across 1, 5, 10, 15, 20, 30, 45, 60, 90, 120,
 * 180, 360, 720 and 1439 minutes over all 57 loop-harness review corpora
 * available locally (39,763 consecutive-review intervals). **The count is
 * identical at every threshold on every corpus**, because those corpora
 * record exactly two interval values — 0 minutes and 1440 minutes — and
 * nothing in between: each simulated cycle stamps one timestamp on all of its
 * reviews. The plateau is therefore an artifact of the corpus, not evidence
 * about the pin, and is reported as such rather than cited as support. The
 * one honest reading it does give: **no current downstream reading changes**
 * anywhere in that range, so the pin is safe to adopt now and cheap to move.
 *
 * **Class B, provisional.** Revisit on the first term of real review
 * timestamps carrying genuine intra-session intervals — the named data event,
 * not a date. Moving it is a one-line change here with no persisted
 * consequence: nothing stores a session id, because a session is a *reading*.
 */
export const SESSION_CLUSTERING_GAP_SECONDS = 45 * 60;

/**
 * `[D-091]`'s per-item cap on received time: "received time is per-item active
 * time (item shown → answer committed), **capped per item** (the cap a
 * declared constant with its argued sentence), summed." **Five minutes.**
 *
 * The argued sentence: an item left open while she walks away records an hour
 * of "active time" that was never practice, and the floor arithmetic reads
 * only the measured side — so one abandoned card must not be able to out-vote
 * a whole course's honest work. Five minutes is longer than any single answer
 * to any instrument Olea composes (the longest, an explain-back, is priced at
 * `EXPLAIN_BACK_ASSUMED_SECONDS` = 90) and shorter than any absence that would
 * make the number a lie.
 *
 * Declared, not fitted, and its blast radius is small by construction:
 * `computeWindowDeficit` normalises `received` to a *share of the session*, so
 * the cap changes a reading only where one item's outlier would otherwise
 * dominate its own session — which is exactly the case it exists for.
 */
export const RECEIVED_SECONDS_PER_ITEM_CAP = 300;

/** One maximal cluster of reviews — C5.5's session, as a reading over the log. */
export interface ClusteredSession {
  /** `timestamp` of the first review in the cluster (ISO-8601 with offset). */
  readonly startedAt: string;
  /** `timestamp` of the last review in the cluster (ISO-8601 with offset). */
  readonly endedAt: string;
  /** Her local day at the cluster's START — narration and diagnostics only; nothing in the window arithmetic reads it (`[D-092]` item 3). */
  readonly day: CalendarDay;
  /** The reviews, in `(timestamp, eventId)` order. Never empty. */
  readonly reviews: readonly ReviewLogRecord[];
}

export interface ClusterReviewSessionsOptions {
  /** Override the declared gap. For sweeps and tests ONLY — production reads {@link SESSION_CLUSTERING_GAP_SECONDS}, which is the contract-grade value. */
  readonly gapSeconds?: number;
}

/**
 * C5.5's clustering rule: every review event in `entries`, ordered by the
 * ruled total order and cut wherever the silence between two consecutive
 * reviews exceeds the gap.
 *
 * Oldest first. An entry with an unparseable timestamp is dropped rather than
 * guessed at — one bad line costs that line and nothing else, the same
 * tolerance `../review-log/parse.ts` already guarantees upstream.
 */
export function clusterReviewSessions(
  entries: readonly ReviewLogEntry[],
  options: ClusterReviewSessionsOptions = {},
): readonly ClusteredSession[] {
  const gapSeconds = options.gapSeconds ?? SESSION_CLUSTERING_GAP_SECONDS;
  const reviews = [...entries]
    .filter((entry): entry is ReviewLogRecord => entry.kind === 'review')
    .filter((entry) => Number.isFinite(Date.parse(entry.timestamp)))
    .sort(compareByInstantThenEventId);

  const sessions: ClusteredSession[] = [];
  let current: ReviewLogRecord[] = [];
  let previousInstant: number | undefined;

  for (const review of reviews) {
    const instant = Date.parse(review.timestamp);
    if (previousInstant !== undefined && (instant - previousInstant) / 1000 > gapSeconds) {
      sessions.push(sessionOf(current));
      current = [];
    }
    current.push(review);
    previousInstant = instant;
  }
  if (current.length > 0) sessions.push(sessionOf(current));
  return sessions;
}

function sessionOf(reviews: readonly ReviewLogRecord[]): ClusteredSession {
  const first = reviews[0];
  const last = reviews[reviews.length - 1];
  // Unreachable: `sessionOf` is only ever called with a non-empty array.
  if (first === undefined || last === undefined) {
    throw new Error('clusterReviewSessions: empty cluster');
  }
  return {
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    day: calendarDayOfTimestamp(first.timestamp) ?? first.timestamp.slice(0, 10),
    reviews,
  };
}

export interface PastSessionsFromReviewLogInput {
  /**
   * Concept key → the courses that concept belongs to (`ConceptRecord.key` →
   * `ConceptRecord.courses`, R1/R2, M:N). The review log names concepts, never
   * courses, so this join is the caller's to supply — it comes free from the
   * instrument/concept walk a composer already does.
   */
  readonly coursesOfConcept: ReadonlyMap<string, readonly string[]>;
  /**
   * The courses running now. Only these can appear in
   * {@link PastSessionRecord.eligibleCourses} — see "Eligibility", below.
   */
  readonly runningCourses: readonly string[];
  /**
   * `planVersion` (`selectionContext.planVersion`) → that plan's own carried
   * allocation shares per course (A2.5). Optional, and usually holds exactly
   * one entry: the plan currently cached.
   *
   * **Entitlement is the PLAN's share — the allocation — never the share that
   * was served.** Reading the served split as entitlement makes every unserved
   * course owed nothing and every served course over-paid, so the deficit can
   * never go positive and the second-course door never opens; that was found
   * and corrected on the loop harness's own first focus arms
   * (`scripts/harness/frontier-loop.mjs`, `pastSessionRecordFromCycle`), and
   * this module inherits the lesson rather than rediscovering it.
   *
   * A session whose `planVersion` is absent from this map (or `null` on the
   * record) carries **no** `entitlement`, and `computeWindowDeficit` falls
   * back to its own `currentShares` argument — the honest degrade that
   * function already documents, never a fabricated share.
   */
  readonly sharesByPlanVersion?: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** See {@link ClusterReviewSessionsOptions.gapSeconds}. Sweeps and tests only. */
  readonly gapSeconds?: number;
}

/**
 * C5.5's clustering, read as the history `[D-092]`'s fairness window needs —
 * `study-session/window.ts`'s `computeWindowDeficit` takes exactly this,
 * oldest first.
 *
 * ## `received`: measured seconds, capped, split across an item's courses
 *
 * `[D-091]`: per-item active time (`durationMs`), capped at
 * {@link RECEIVED_SECONDS_PER_ITEM_CAP}, summed. A review with
 * `durationMs: null` — not measured — contributes **nothing**, never an
 * assumed duration: "the accounting reads measured seconds", and
 * `study-session/duration.ts`'s assumed prices are for *composing* a forecast,
 * which is the side the clause explicitly allows to disagree.
 *
 * An instrument whose concepts span several courses has its seconds **divided
 * equally** among those courses, so a session's total received time is the
 * time she actually spent and not a multiple of it. `computeWindowDeficit`
 * normalises `received` to a share of the session, so any attribution that
 * inflated the total would deflate every course's share alike.
 *
 * ## Eligibility: an approximation, named rather than invented
 *
 * `PastSessionRecord.eligibleCourses` is meant to be "the set the ranking
 * would have served that session". **The review log cannot recover that**: it
 * records what was served, never what was refused or what was running. Two
 * readings were available and only one preserves the signal:
 *
 * - *Courses served in that session* — which would mean a starved course was
 *   never eligible anywhere, so its deficit could never accrue, and the exact
 *   starvation `[FOCUS-3b]` exists to see would be structurally invisible.
 *   Rejected.
 * - **Every running course, from the first session in which it appears
 *   anywhere in the history** — its first appearance is the log's own honest
 *   evidence that it had started. Adopted.
 *
 * What this approximation gets wrong, stated rather than papered over: a
 * course the ranking legitimately **refused** that session (nothing due, no
 * material) reads as eligible-and-unserved, so it accrues deficit it is not
 * owed. Fixing it needs a refusal signal in the log, which does not exist and
 * which this module does **not** invent. It is a named gap on `[SESS-13]`.
 */
export function pastSessionsFromReviewLog(
  entries: readonly ReviewLogEntry[],
  input: PastSessionsFromReviewLogInput,
): readonly PastSessionRecord[] {
  const sessions = clusterReviewSessions(
    entries,
    input.gapSeconds === undefined ? {} : { gapSeconds: input.gapSeconds },
  );
  const running = new Set(input.runningCourses);
  const seen = new Set<string>();
  const records: PastSessionRecord[] = [];

  for (const session of sessions) {
    const received = new Map<string, number>();
    const planVersions = new Set<string>();

    for (const review of session.reviews) {
      const planVersion = review.selectionContext.planVersion;
      if (planVersion !== null) planVersions.add(planVersion);

      const courses = coursesOf(review, input.coursesOfConcept, running);
      for (const course of courses) seen.add(course);
      if (review.durationMs === null || courses.length === 0) continue;
      const seconds = Math.min(review.durationMs / 1000, RECEIVED_SECONDS_PER_ITEM_CAP);
      const perCourse = seconds / courses.length;
      for (const course of courses) received.set(course, (received.get(course) ?? 0) + perCourse);
    }

    const eligibleCourses = input.runningCourses.filter((course) => seen.has(course));
    const entitlement = entitlementFor(planVersions, input.sharesByPlanVersion, eligibleCourses);

    records.push({
      asOf: session.day,
      eligibleCourses,
      received,
      ...(entitlement === undefined ? {} : { entitlement }),
    });
  }
  return records;
}

/** The running courses a review is evidence for — its concepts' courses, deduplicated, restricted to what is running now. */
function coursesOf(
  review: ReviewLogRecord,
  coursesOfConcept: ReadonlyMap<string, readonly string[]>,
  running: ReadonlySet<string>,
): readonly string[] {
  const courses = new Set<string>();
  for (const conceptId of review.conceptIds) {
    for (const course of coursesOfConcept.get(conceptId) ?? []) {
      if (running.has(course)) courses.add(course);
    }
  }
  return [...courses];
}

/**
 * The plan's shares for a session, when exactly one plan version composed it
 * and the caller holds that version's allocation.
 *
 * **Exactly one.** A session whose reviews name two plan versions had its
 * policy change under it, and no single share map is the honest answer for it
 * — `undefined` (falling back to `computeWindowDeficit`'s `currentShares`) is,
 * and it is the same degrade an unknown version already takes.
 */
function entitlementFor(
  planVersions: ReadonlySet<string>,
  sharesByPlanVersion: ReadonlyMap<string, ReadonlyMap<string, number>> | undefined,
  eligibleCourses: readonly string[],
): ReadonlyMap<string, number> | undefined {
  if (sharesByPlanVersion === undefined || planVersions.size !== 1) return undefined;
  const [planVersion] = [...planVersions];
  if (planVersion === undefined) return undefined;
  const shares = sharesByPlanVersion.get(planVersion);
  if (shares === undefined) return undefined;
  const entitlement = new Map<string, number>();
  for (const course of eligibleCourses) {
    const share = shares.get(course);
    if (share !== undefined) entitlement.set(course, share);
  }
  return entitlement.size > 0 ? entitlement : undefined;
}
