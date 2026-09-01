/**
 * A2.5's share-to-seconds conversion, contracted into the study-plan
 * artifact and executed here at session composition (C5.5) —
 * `ol-v7r5.17` [ALLOC-2].
 *
 * The plan carries a **share** per running course, never seconds: A2.5's own
 * text is explicit that "the plan is computed before the budget for any
 * given session is known", so the conversion to seconds cannot live in the
 * plan itself and is instead contracted onto the SAME artifact for THIS
 * module to execute, verbatim (`docs/Olea_alpha_functional_scope.md`, A2.5,
 * ratified alongside `[D-076]` round 4 and `[D-081]`):
 *
 * > multiply each share by the session budget in seconds; drop any course
 * > falling below its `minBlockSeconds` and redistribute its time across the
 * > remainder in proportion; assign whole seconds by largest remainder, ties
 * > broken by the nearer next assessment and then by course id; the
 * > allocated seconds sum exactly to the budget.
 *
 * This module invents nothing beyond that text — every branch below cites
 * the clause fragment it implements.
 *
 * ## Where `examProximityDays` — the tie-break's own input — comes from
 *
 * The clause's tie-break needs "the nearer next assessment" per course, but
 * `StudyPlanAllocationEntry`'s own field list has no dedicated field for it
 * (`packages/contracts/src/study-plan.ts`'s own doc on that entry explains
 * why: A2.5 names exactly five fields, and this signal rides as one more
 * named entry in `contributions` — `examProximityDays` — rather than a
 * sixth field the clause never asks for). `examProximityDaysOf` below reads
 * it back out; its absence means "no known next assessment for this
 * course", which sorts LAST in nearness — never treated as "nearest" by a
 * missing-value default of zero, which would be the opposite lie.
 *
 * ## The one corner the clause's prose does not cover
 *
 * "Drop and redistribute... across the remainder" presumes a remainder to
 * redistribute to. When a session's budget is so small that EVERY course's
 * share falls below its own `minBlockSeconds`, dropping all of them would
 * leave nothing to redistribute to and zero the whole session out — which
 * would break "the allocated seconds sum exactly to the budget", the one
 * invariant the clause states as absolute. This module resolves that corner
 * in the direction the clause's own invariant demands: when dropping would
 * leave no course standing, nothing is dropped, and the raw shares fund the
 * session as thinly as the budget allows. A per-course study-block minimum
 * is a real thing to protect; a promise that every session can afford one is
 * not what A2.5 states.
 *
 * ## Pure, deterministic, no I/O (INV-1 / §7.1)
 *
 * Same discipline as every other module in this directory: no clock, no
 * vault access, no `obsidian` import. `budgetSeconds` and the allocation
 * entries are both caller-supplied.
 */

import type { StudyPlanAllocationEntry } from 'olea-contracts';

/** One converted course's whole-second allocation, plus why. */
export interface AllocationSecondsResult {
  /** Whole seconds per `courseId`. Sums to exactly `budgetSeconds` (or to `0` when `budgetSeconds <= 0` or `allocation` is empty) — see the module doc. */
  readonly secondsByCourseId: ReadonlyMap<string, number>;
  /**
   * Courses whose share fell below their own `minBlockSeconds` and received
   * zero seconds, their time redistributed to the rest — empty whenever the
   * "everyone dropped" corner (see the module doc) fires instead.
   */
  readonly droppedCourseIds: readonly string[];
}

/**
 * The tie-break's own signal — see the module doc's "Where
 * `examProximityDays` comes from" section. `null` means no known next
 * assessment, which the caller (`tieBreak` below) treats as the FARTHEST
 * possible day, never the nearest.
 */
function examProximityDaysOf(entry: StudyPlanAllocationEntry): number | null {
  const found = entry.contributions.find((c) => c.name === 'examProximityDays');
  return found === undefined ? null : found.value;
}

/**
 * A2.5's own tie-break, verbatim: "ties broken by the nearer next
 * assessment and then by course id." Smaller `examProximityDays` sorts
 * first (nearer); `null` (no known assessment) sorts after every known day,
 * never before. `courseId` compares as plain strings — the same opaque,
 * never-case-folded identity R1/R2 uses everywhere else this id appears.
 */
function tieBreak(a: StudyPlanAllocationEntry, b: StudyPlanAllocationEntry): number {
  const aDays = examProximityDaysOf(a);
  const bDays = examProximityDaysOf(b);
  if (aDays !== bDays) {
    if (aDays === null) return 1;
    if (bDays === null) return -1;
    return aDays - bDays;
  }
  return a.courseId < b.courseId ? -1 : a.courseId > b.courseId ? 1 : 0;
}

/**
 * Convert one plan's per-course shares into one session's whole-second
 * budgets, per A2.5's contracted rule — see the module doc.
 */
export function allocationSharesToSeconds(
  allocation: readonly StudyPlanAllocationEntry[],
  budgetSeconds: number,
): AllocationSecondsResult {
  const zeroed = new Map(allocation.map((entry) => [entry.courseId, 0]));
  if (allocation.length === 0 || !Number.isFinite(budgetSeconds) || budgetSeconds <= 0) {
    return { secondsByCourseId: zeroed, droppedCourseIds: [] };
  }

  // "multiply each share by the session budget in seconds; drop any course
  // falling below its minBlockSeconds"
  const rawSeconds = new Map(
    allocation.map((entry) => [entry.courseId, entry.share * budgetSeconds]),
  );
  let kept = allocation.filter(
    (entry) => (rawSeconds.get(entry.courseId) ?? 0) >= entry.minBlockSeconds,
  );
  let dropped = allocation.filter((entry) => !kept.includes(entry));

  // The "everyone dropped" corner — see the module doc.
  if (kept.length === 0) {
    kept = [...allocation];
    dropped = [];
  }

  // "...and redistribute its time across the remainder in proportion" —
  // equivalent to renormalising the kept courses' own shares to sum to 1 and
  // spending the whole budget against that renormalised share, since the
  // dropped courses' shares (summing to `1 - keptShareTotal`) are exactly
  // what redistributes across `kept` in proportion to each course's own
  // existing share.
  const keptShareTotal = kept.reduce((sum, entry) => sum + entry.share, 0);
  const finalRawSeconds = new Map<string, number>();
  for (const entry of kept) {
    const effectiveShare = keptShareTotal > 0 ? entry.share / keptShareTotal : 1 / kept.length;
    finalRawSeconds.set(entry.courseId, effectiveShare * budgetSeconds);
  }
  for (const entry of dropped) finalRawSeconds.set(entry.courseId, 0);

  // "assign whole seconds by largest remainder" — floor every kept course,
  // then hand out the leftover whole seconds one at a time, largest
  // fractional remainder first.
  const wholeSeconds = new Map<string, number>();
  let flooredTotal = 0;
  for (const entry of kept) {
    const floor = Math.floor(finalRawSeconds.get(entry.courseId) ?? 0);
    wholeSeconds.set(entry.courseId, floor);
    flooredTotal += floor;
  }
  for (const entry of dropped) wholeSeconds.set(entry.courseId, 0);

  // "the allocated seconds sum exactly to the budget" — `outstanding` is an
  // exact integer difference between two integers (the caller's own
  // `budgetSeconds` and this module's own floor sum), so distributing it one
  // second at a time below always lands exactly on budget, independent of
  // any floating-point drift upstream in `finalRawSeconds` itself.
  const targetTotal = Math.round(budgetSeconds);
  let outstanding = targetTotal - flooredTotal;

  const byRemainderDesc = [...kept].sort((a, b) => {
    const remainderA = (finalRawSeconds.get(a.courseId) ?? 0) - (wholeSeconds.get(a.courseId) ?? 0);
    const remainderB = (finalRawSeconds.get(b.courseId) ?? 0) - (wholeSeconds.get(b.courseId) ?? 0);
    if (remainderA !== remainderB) return remainderB - remainderA;
    return tieBreak(a, b);
  });

  // The ordinary case gives out at most `kept.length - 1` extra seconds
  // (standard largest-remainder-method bound) — the `%` wraparound below is
  // defence for the invariant, not the expected path, covering any residual
  // float drift that pushed `outstanding` outside that bound.
  if (byRemainderDesc.length > 0) {
    let i = 0;
    while (outstanding > 0) {
      const entry = byRemainderDesc[i % byRemainderDesc.length];
      if (entry === undefined) break;
      wholeSeconds.set(entry.courseId, (wholeSeconds.get(entry.courseId) ?? 0) + 1);
      outstanding -= 1;
      i += 1;
    }
    // Symmetric handling if float drift ever pushed the floor sum OVER
    // budget: claw back a second at a time from the courses least entitled
    // to their rounded-up second (smallest remainder first), never below 0.
    const byRemainderAsc = [...byRemainderDesc].reverse();
    let j = 0;
    let guard = 0;
    while (outstanding < 0 && guard < byRemainderAsc.length * 2) {
      const entry = byRemainderAsc[j % byRemainderAsc.length];
      guard += 1;
      if (entry === undefined) break;
      const current = wholeSeconds.get(entry.courseId) ?? 0;
      if (current > 0) {
        wholeSeconds.set(entry.courseId, current - 1);
        outstanding += 1;
      }
      j += 1;
    }
  }

  return {
    secondsByCourseId: wholeSeconds,
    droppedCourseIds: dropped.map((entry) => entry.courseId),
  };
}
