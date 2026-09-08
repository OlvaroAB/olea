/**
 * `[FOCUS-3b]` (`ol-ulj7`, discovered from `ol-egov.137.5` [FOCUS-4c]): D-092's
 * session-denominated fairness window, read off her review log, replacing
 * `compose.ts`'s own days-since-last-seen substitute for it (see that
 * module's doc, "C5.6's rolling floor"). `[D-092]` (`ol-egov.16`): the floor
 * is owed over a rolling window whose width is `running courses + slack`
 * (slack 2), denominated in the sessions she SITS (C5.5's clustering), never
 * calendar time. FOCUS-4c found the case the days substitute cannot see: a
 * course starving for 13-14 sessions while the substitute's own reading
 * never exceeded a 2-day deficit.
 *
 * ## What this module is, and is not
 *
 * This is the window ARITHMETIC only — `Σ(entitlement − received)` over a
 * caller-supplied history of already-clustered sessions. It does **not**
 * read the vault or the review log itself, and it does **not** cluster raw
 * review events into sessions: C5.5's clustering rule (`[D-091]`) is
 * contract-grade, but its own declared gap threshold has never been
 * implemented anywhere in this codebase — verified before writing this
 * module: no `sessionsFromReviewLog` or equivalent function exists in
 * `packages/core` or `packages/plugin` today, and the component register's
 * own windows table lists "Session clustering gap" as a named, declared, but
 * still-unset threshold. Inventing that number is a separate, undecided
 * piece of work this module does not do — the same posture
 * `ComposeSessionRowsInput.relatedConceptKeys`/`arrivalDays` already take for
 * their own caller-resolved signals (`compose.ts`'s module doc). A caller —
 * the plugin, reading her review log and clustering it once that rule
 * exists, or a harness replaying its own cycle history — supplies
 * {@link PastSessionRecord}s, oldest first.
 *
 * ## The unit: shares, not seconds
 *
 * `entitlement` and `received` are both read as FRACTIONS of one session
 * (0-1), so the accumulated deficit is directly "sessions-worth of the
 * course's share" — a deficit of 1.5 means the course is owed one and a half
 * sessions at its own full share. `received` is derived here from raw
 * seconds a caller supplies (or any one consistently-used unit — items
 * served works identically), because that is what a review log actually
 * measures (C5.5: "seconds received ... measured, not the plan's modelled
 * forecast"); `entitlement` is supplied as a share directly, because that is
 * what the plan itself carries (A2.5).
 *
 * ## Eligibility: absence from a session's roster is "not owed", not zero
 *
 * `[D-244]` item 2's "a course the ranking refuses ... its deficit does not
 * accrue while refused" — `compose.ts`'s own `composeFocusedSelection` reads
 * this at the row-set level for the CURRENT session (a refused course
 * produces zero `GapRow`s and never enters `byCourse`). This module reads it
 * the identical way for HISTORICAL sessions: {@link
 * PastSessionRecord.eligibleCourses} is the set the ranking would have
 * served that session — a course outside it contributes NOTHING to that
 * session's sum, rather than a zero-entitlement/zero-received pair that
 * would happen to net to zero. The distinction is auditable: a caller can
 * tell "not owed this session" from "owed and unpaid" by reading the
 * eligible-courses list, never by reverse-engineering a coincidental zero.
 */

import type { CalendarDay } from '../today/calendar-day.js';

/**
 * `[D-092]`'s own declared slack term ("running courses + slack, slack
 * initially 2" — `docs/Olea_alpha_functional_scope.md`), restated here
 * rather than as a new number. `compose.ts` declares the identical value
 * independently, as `COURSE_FLOOR_WINDOW_SLACK`, for its OWN days-
 * denominated substitute (see that module's doc). The two declarations are
 * deliberately not imported from one another, so that module's tested,
 * working every-course path changes shape by exactly nothing because of this
 * bead — if D-092's slack value is ever amended, both move together, and
 * each names the other in its own comment.
 */
export const WINDOW_SLACK_SESSIONS = 2;

/** D-092's window width: how many of her most recent sessions the floor is owed over, for a given number of running courses. */
export function windowWidthSessions(runningCourseCount: number): number {
  return runningCourseCount + WINDOW_SLACK_SESSIONS;
}

/**
 * One already-clustered session from her review log (C5.5), as far as the
 * window needs to know about it. A caller builds one of these per session in
 * her history, oldest first.
 */
export interface PastSessionRecord {
  /**
   * For narration/diagnostics only. The window's WIDTH is a session COUNT,
   * never calendar-aligned (`[D-092]` item 3) — nothing in
   * {@link computeWindowDeficit} reads this field.
   */
  readonly asOf: CalendarDay;
  /**
   * The courses the ranking would have served this session — a course
   * outside this set was refused, or was not yet a running course, and this
   * session contributes nothing to its deficit either way. See the module
   * doc's "Eligibility" section.
   */
  readonly eligibleCourses: readonly string[];
  /**
   * Seconds (or any one consistently-used unit — items served works
   * identically) each eligible course actually RECEIVED this session. A
   * course present in {@link eligibleCourses} but absent here (or given `0`)
   * received nothing — exactly the starvation case this module exists to
   * see. C5.5's own "seconds received": measured active time, capped per
   * item, never the plan's modelled forecast.
   */
  readonly received: ReadonlyMap<string, number>;
  /**
   * Each eligible course's ENTITLEMENT share for this session — the plan's
   * own carried share (A2.5) that composed it. Optional per course, and the
   * whole map is optional: a course missing here falls back to
   * {@link computeWindowDeficit}'s own `currentShares` argument, covering
   * this bead's brief — "the plan's share for that session, or the current
   * share where the plan is unchanged" — as one honest degrade rather than
   * two code paths.
   */
  readonly entitlement?: ReadonlyMap<string, number>;
}

/** One running course's window-deficit reading — see the module doc. */
export interface WindowDeficitEntry {
  /**
   * `Σ(entitlement − received)`, share-denominated, over the last
   * {@link windowWidthSessions} sessions in the supplied history where this
   * course was eligible. Positive: owed. Zero or negative: paid in full — a
   * negative reading means the course has been running AHEAD of its share,
   * never clamped to zero, so a course that just caught up does not read
   * identically to one that starved for the whole window.
   */
  readonly deficit: number;
  /**
   * Plain count of sessions, walking back from the most recent, since this
   * course last received anything — counting only sessions where it was
   * eligible (an ineligible session is neither "served" nor "unserved" for
   * this count, the same posture the deficit sum takes: not owed, not
   * counted). `Number.POSITIVE_INFINITY` when it was never served anywhere
   * in the ENTIRE supplied history — not window-truncated, matching
   * `compose.ts`'s own `deficitDaysByCourseFrom`'s "`null` → `+Infinity`"
   * convention for "never retrieved at all".
   */
  readonly sessionsSinceLastServed: number;
}

/**
 * `[FOCUS-3b]`: the session-denominated projection FOCUS-3's own days
 * substitute stood in for (see `compose.ts`'s module doc). `history` is
 * oldest-first; only its last `windowWidthSessions(runningCourses.length)`
 * entries feed {@link WindowDeficitEntry.deficit} (D-092's own rolling
 * window), but `sessionsSinceLastServed` reads the WHOLE supplied history,
 * matching `courseLastSeenDay`'s own unbounded reach.
 *
 * `currentShares` is the fallback entitlement for a session (or a course
 * within one) that carries none of its own — "the current share where the
 * plan is unchanged" (this bead's own brief). A course missing from BOTH a
 * session's own entitlement and `currentShares` reads entitlement `0` for
 * that session: an honest "no signal", never a fabricated share.
 *
 * A course in `runningCourses` that never appears as eligible anywhere in
 * `history` (a brand-new course, or a cold start with no history at all)
 * reads `deficit: 0` (no data means no debt has yet accrued — never a
 * fabricated one) and `sessionsSinceLastServed: Infinity` (it is
 * simultaneously true, and honest, that it has never been served).
 */
export function computeWindowDeficit(
  history: readonly PastSessionRecord[],
  runningCourses: readonly string[],
  currentShares: ReadonlyMap<string, number>,
): ReadonlyMap<string, WindowDeficitEntry> {
  const width = windowWidthSessions(runningCourses.length);
  const windowed = width > 0 ? history.slice(Math.max(0, history.length - width)) : [];

  const result = new Map<string, WindowDeficitEntry>();
  for (const course of runningCourses) {
    let deficit = 0;
    for (const session of windowed) {
      if (!session.eligibleCourses.includes(course)) continue;
      const entitlement = session.entitlement?.get(course) ?? currentShares.get(course) ?? 0;
      const receivedRaw = session.received.get(course) ?? 0;
      const totalReceived = sumOfValues(session.received);
      const receivedShare = totalReceived > 0 ? receivedRaw / totalReceived : 0;
      deficit += entitlement - receivedShare;
    }

    let sessionsSinceLastServed = 0;
    let served = false;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const session = history[i];
      if (session === undefined || !session.eligibleCourses.includes(course)) continue;
      if ((session.received.get(course) ?? 0) > 0) {
        served = true;
        break;
      }
      sessionsSinceLastServed += 1;
    }

    result.set(course, {
      deficit,
      sessionsSinceLastServed: served ? sessionsSinceLastServed : Number.POSITIVE_INFINITY,
    });
  }
  return result;
}

function sumOfValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const v of values.values()) total += v;
  return total;
}
