/**
 * Session composition (SESS-1/`ol-xd1v`, SESS-2/`ol-4a78`; F2.18, F2.22, F4.6,
 * F6.6, C5.6, C5.9). Ratified baseline: `[D-113]` (`ol-egov.31`), canonical
 * text `findings/SESS-1-session-composition-model.md` §7 (olea-service).
 *
 * `./build.ts` already turns an ORDERED list of gap rows into a time-bounded
 * list of instruments — it decides nothing about which concepts deserve a
 * slot or in what proportion. This module is the layer SESS-1 designed above
 * it: it decides **which concepts are eligible and in what order**, and hands
 * the result to `buildStudySession` (with `order: 'given'`) to fill.
 *
 * ## The central move: two obligations, not one queue
 *
 * Every concept lands in exactly one **obligation class** each day —
 * `'unmet'`, `'recall-due'`, `'baseline-due'`, `'elective'` — where the class
 * decides which clock is being read and "how overdue" deliberately means a
 * different thing in each ({@link classifyObligation}). The recall obligation
 * (FSRS due) and the reading obligation (the retrieval baseline, C5.9) are
 * near-complements: FSRS intervals grow without bound as an item is held, so
 * recall abandons exactly the mature tail the baseline exists to keep
 * visible.
 *
 * **Baseline obligation is a SET, not a queue** (`[D-113]` item 4): an
 * unserved obligation is still exactly one obligation today, computed fresh
 * from `lastRetrievalDay` — nothing here accrues a debt of retrievals.
 *
 * **The ordering rule is `overdue-first`** (`[D-113]` item 3): one key —
 * days waiting, whatever the reason — defined for every obligation class,
 * zero free parameters. SESS-1 measured it beating a reserved-slice
 * allocator (three free parameters) at every tested operating point; the
 * reserved slice is not implemented here because it was not adopted.
 *
 * ## The retrieval baseline is keyed on mastery STAGE, never the interval
 *
 * `[D-113]` items 1 and 2: keying the widening gap on the mastery stage
 * (rather than the scheduler's own interval) makes the obligation bounded by
 * construction — three rungs, ceiling is the top rung — and makes the bound
 * behavioural, so a self-rating cannot push it out. See
 * {@link RETRIEVAL_BASELINE_STAGE_LADDER_DAYS}.
 *
 * ## Re-entry needs no special case (`[D-113]` item 5)
 *
 * F6.6 rules a re-entry session is the ordinary rule at fewer slots, never a
 * second selection mechanism. A single total order has no per-class share
 * for a second policy to act on, so under `overdue-first` a smaller budget
 * *is* the whole re-entry rule — there is no absence-detection branch in this
 * module to diverge from it. `compose.spec.ts`'s equality-of-rule test
 * asserts this holds by construction, per the component register's health
 * check (3.8).
 *
 * ## Two-level allocation, and what stands in for the missing first level
 *
 * Allocation is strictly two-level because `XCRS-1` (`ol-dq1c`, open) says
 * the pre-existing builder compared `gapScore` across courses, which the
 * contract forbids. Across courses, by **attention share** — an *input* this
 * module never computes (`ALLOC-1`/component-register 3.5, not built yet:
 * no `attention share`/course-share code exists anywhere in `packages/core`
 * today). Within a course, by `overdue-first`, over that course's own
 * concepts only — no `gapScore` or `overdueDays` is ever compared across a
 * course boundary.
 *
 * **Until ALLOC-1 lands, each course's share is proportional to how much of
 * her ranked material lives in that course** ({@link proportionalCourseShares}) —
 * SESS-1's own headline configuration (equal shares over the vault's uneven
 * course sizes was measured to starve the larger course; proportional avoids
 * that confound). This is a declared, reversible interim policy, not a
 * ratified constant: it is replaced wholesale the day `ALLOC-1` produces a
 * real share, and nothing here needs to change when it does — the seam is
 * exactly the `courseShares` computation.
 *
 * C5.6's rolling floor is enforced ({@link forcedCourseFloorDays}): a course
 * that has gone at least `runningCourses + slack` days without a concept from
 * it being retrieved is forced a guaranteed slice, where `slack` is C5.6's own
 * declared constant ("running courses + slack, slack initially 2" —
 * `docs/Olea_alpha_functional_scope.md`), reused directly rather than
 * `builder.mjs`'s own unfitted sweep default. **Days, not sessions** — C5.6's
 * window is denominated in her sessions and this substitutes days, the
 * available, honest proxy (the product assumes a daily cadence elsewhere,
 * `fsrs-scheduler.ts`'s module doc); nothing here claims to count sessions.
 *
 * ## F2.18 — course blocks, applied after selection
 *
 * Selection above is course-partitioned by budget; block coherence
 * ({@link blockByCoursePresentation}) is applied *afterwards*, so it
 * constrains what she meets in what order and never what gets chosen, and
 * therefore cannot starve anything. Blocks are ordered by the most urgent
 * obligation class present. Interleaving concepts *within* a block needs no
 * code here: `buildStudySession`'s own breadth-first fill already visits
 * rows in the order it is handed, once per pass, so a course-blocked row
 * order interleaves concepts within the block for free.
 *
 * ## Overflow is not a student-visible surface (C5.9, F6.7)
 *
 * {@link ComposeSessionRowsResult.overflow} is a count per obligation class
 * plus the worst case in each — surfaced on the result for inspection and
 * telemetry, never threaded into `StudySessionModel` or rendered by
 * `session-builder/copy.ts`. F6.7 forbids a standing counter of unmet
 * material; whether any of this ever reaches a screen is a contract question
 * this module does not answer.
 *
 * ## The known data gap: no arrival-day source exists yet (`ARRIVE-1`)
 *
 * The model's `classify()` computes an `unmet` concept's `overdueDays` from
 * `day - concept.arrivalDay`. No production data source records when a
 * concept first became reachable — `ConceptRecord` carries no date field,
 * no vault-stat accessor exists on `VaultSource`, and review-log entries only
 * exist for concepts that HAVE been retrieved, which by definition excludes
 * `unmet` ones. Treating an unknown wait as unbounded (`Infinity`) would make
 * `unmet` dominate every other class whenever any unmet concept exists,
 * reproducing the *opposite* starvation the design fought — recall-due and
 * baseline-due material would never win against a standing pool of new
 * material. So `overdueDays: 0` is the honest, conservative choice for
 * `unmet`: it defers entirely to `gapScore`, i.e. exactly today's production
 * behaviour, until a real "day this concept arrived" signal exists to widen
 * on. Filed as a follow-up rather than guessed at.
 *
 * ## INV-1 / §7.1
 *
 * Pure. No `obsidian`, no vault I/O, no clock (`asOf` is an argument),
 * nothing stored. `Scheduler` implementations are pure functions of their
 * input (`scheduler/types.ts`), so `ReplayResult` — itself a pure fold over
 * entries the caller already read — is the only "history" this module needs.
 */

import { daysBetween } from '../dates.js';
import type { GapRow } from '../gap/build.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { ReplayResult } from '../session/replay.js';
import {
  type CalendarDay,
  calendarDayOfTimestamp,
  isCalendarDay,
  shiftCalendarDay,
} from '../today/calendar-day.js';
import {
  type BuildStudySessionInput,
  buildStudySession,
  CONCEPT_SIZE_SECONDS_MULTIPLIER,
  type StudySessionModel,
} from './build.js';
import type { DurationModel } from './duration.js';
import type { ConceptInstrumentIndex } from './instrument-index.js';

const SECONDS_PER_MINUTE = 60;

/** Which obligation put a concept in front of her today. Exactly one per concept. See the module doc. */
export type ObligationClass = 'unmet' | 'recall-due' | 'baseline-due' | 'elective';

/** Presentation precedence — lower sorts first. `[D-113]`'s ordering rule uses `overdueDays`, not this; this is only for {@link blockByCoursePresentation}'s "most urgent class present" tiebreak. */
const CLASS_PRECEDENCE: Readonly<Record<ObligationClass, number>> = Object.freeze({
  unmet: 0,
  'recall-due': 1,
  'baseline-due': 2,
  elective: 3,
});

/**
 * The widening ladder, keyed on mastery stage (`[D-113]` items 1/2; findings
 * §7, plateau measured over rungs 10–25 days, 21 chosen as the largest value
 * with margin on both sides).
 *
 * `seed` has no rung: a concept with no scored evidence has never been
 * retrieved, so it is `'unmet'`, and the baseline has nothing to be relative
 * to. `'unknown'` (`OracleMasteryState`'s extra value — no mastery join at
 * all) is treated the same way, for the same reason.
 *
 * *Revisit when* real review-log history exists to check the rungs against
 * how they felt to her — see `[D-113]`'s revisit condition.
 */
export const RETRIEVAL_BASELINE_STAGE_LADDER_DAYS: Readonly<
  Record<'sprout' | 'sapling' | 'tree', number>
> = Object.freeze({
  sprout: 5,
  sapling: 12,
  tree: 21,
});

/**
 * C5.6's own declared constant: "Width: running courses + slack, slack
 * initially 2" (`docs/Olea_alpha_functional_scope.md`) — not `builder.mjs`'s
 * `courseFloorWindowSessions` default of 6, which was an unfitted sweep
 * parameter for the simulation rather than the ratified contract number.
 * This module reuses C5.6's own slack directly, in days rather than sessions
 * — see the module doc's note on that substitution.
 */
const COURSE_FLOOR_WINDOW_SLACK = 2;

function baselineGapDaysFor(masteryState: OracleMasteryState): number | null {
  if (masteryState === 'sprout' || masteryState === 'sapling' || masteryState === 'tree') {
    return RETRIEVAL_BASELINE_STAGE_LADDER_DAYS[masteryState];
  }
  return null;
}

function daysBetweenCalendarDays(from: CalendarDay, to: CalendarDay): number {
  return daysBetween(new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`));
}

/** One concept's obligation today, and how overdue it is *within that class* — a different clock per class, by design. See the module doc. */
export interface ObligationClassification {
  readonly klass: ObligationClass;
  readonly overdueDays: number;
}

/** {@link classifyObligation}'s input — one concept's obligation-relevant facts, already resolved to calendar days. */
export interface ObligationSignals {
  readonly masteryState: OracleMasteryState;
  /** The latest calendar day any of this concept's instruments were reviewed, or `null` if none ever were (→ `'unmet'`). */
  readonly lastRetrievalDay: CalendarDay | null;
  /** The soonest FSRS due day among this concept's reviewed instruments, or `null` if none has scheduling state. */
  readonly recallDueDay: CalendarDay | null;
  readonly asOf: CalendarDay;
}

/**
 * Sort one concept into exactly one obligation class, and say how overdue it
 * is within that class. Mirrors `scripts/modeling/lib/builder.mjs`'s
 * `classify()` — see that file for the design's own account of why
 * `overdueDays` means a different thing per class.
 */
export function classifyObligation(input: ObligationSignals): ObligationClassification {
  const { masteryState, lastRetrievalDay, recallDueDay, asOf } = input;

  if (lastRetrievalDay === null) {
    // See the module doc's "known data gap" section — no arrival-day source
    // exists in production yet, so this defers entirely to gapScore (ARRIVE-1).
    return { klass: 'unmet', overdueDays: 0 };
  }
  if (recallDueDay !== null && recallDueDay <= asOf) {
    return { klass: 'recall-due', overdueDays: daysBetweenCalendarDays(recallDueDay, asOf) };
  }
  const gap = baselineGapDaysFor(masteryState);
  if (gap === null) return { klass: 'elective', overdueDays: 0 };
  const baselineDueDay = shiftCalendarDay(lastRetrievalDay, gap);
  if (baselineDueDay <= asOf) {
    return { klass: 'baseline-due', overdueDays: daysBetweenCalendarDays(baselineDueDay, asOf) };
  }
  return { klass: 'elective', overdueDays: 0 };
}

/**
 * {@link ObligationSignals.lastRetrievalDay}/`recallDueDay` for one concept,
 * aggregated over every instrument {@link ConceptInstrumentIndex} knows for
 * it: the latest reviewed day across all of them (any of its cards checked
 * counts as the concept being checked), and the soonest FSRS due day among
 * the ones that have scheduling state (the most urgent card drives the
 * concept's recall obligation).
 */
function obligationSignalsFor(
  conceptKey: string,
  instruments: ConceptInstrumentIndex,
  replay: ReplayResult,
): { readonly lastRetrievalDay: CalendarDay | null; readonly recallDueDay: CalendarDay | null } {
  let lastRetrievalDay: CalendarDay | null = null;
  let recallDueDay: CalendarDay | null = null;
  for (const record of instruments.instrumentsFor(conceptKey)) {
    const replayed = replay.states.get(record.instrumentId);
    if (replayed === undefined) continue;
    const reviewedDay = calendarDayOfTimestamp(replayed.lastReviewedAt);
    if (reviewedDay !== null && (lastRetrievalDay === null || reviewedDay > lastRetrievalDay)) {
      lastRetrievalDay = reviewedDay;
    }
    const dueDay = calendarDayOfTimestamp(replayed.state.due);
    if (dueDay !== null && (recallDueDay === null || dueDay < recallDueDay)) {
      recallDueDay = dueDay;
    }
  }
  return { lastRetrievalDay, recallDueDay };
}

/**
 * The cheapest of a concept's instruments — the estimate used for
 * cross-course budget accounting (never the real fill, which
 * `buildStudySession` still does per-instrument, exactly, including its own
 * `[D-066]`/`ol-urvq` size pricing). Zero for a concept with no instruments
 * (F4.5/F4.10 gaps): it cannot be scheduled either way.
 *
 * Applies `CONCEPT_SIZE_SECONDS_MULTIPLIER` here too — `build.ts`'s own
 * price for a `'coarse'` row — so a coarse concept's larger true cost is
 * reflected in which course's cap it is weighed against, not just in the
 * final per-instrument fill.
 */
function representativeSecondsFor(
  row: GapRow,
  instruments: ConceptInstrumentIndex,
  durations: DurationModel,
): number {
  const records = instruments.instrumentsFor(row.conceptKey);
  if (records.length === 0) return 0;
  const sizeBand = row.conceptSize?.band ?? 'fine';
  const cheapest = Math.min(
    ...records.map((record) => durations.secondsFor(record.instrumentType)),
  );
  return cheapest * CONCEPT_SIZE_SECONDS_MULTIPLIER[sizeBand];
}

interface ClassifiedRow {
  readonly row: GapRow;
  readonly klass: ObligationClass;
  readonly overdueDays: number;
  readonly lastRetrievalDay: CalendarDay | null;
  readonly cost: number;
}

/** `[D-113]` item 3: one key, defined for every class, comparing the same thing — days waiting, whatever the reason. Zero free parameters. */
function overdueFirst(a: ClassifiedRow, b: ClassifiedRow): number {
  if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
  if (a.row.gapScore !== b.row.gapScore) return b.row.gapScore - a.row.gapScore;
  return a.row.conceptKey < b.row.conceptKey ? -1 : a.row.conceptKey > b.row.conceptKey ? 1 : 0;
}

function groupByCourse(rows: readonly ClassifiedRow[]): ReadonlyMap<string, ClassifiedRow[]> {
  const byCourse = new Map<string, ClassifiedRow[]>();
  for (const c of rows) {
    const bucket = byCourse.get(c.row.course);
    if (bucket === undefined) byCourse.set(c.row.course, [c]);
    else bucket.push(c);
  }
  return byCourse;
}

/** Interim cross-course allocation until `ALLOC-1` exists — see the module doc. */
function proportionalCourseShares(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
): ReadonlyMap<string, number> {
  const total = [...byCourse.values()].reduce((n, rows) => n + rows.length, 0);
  const shares = new Map<string, number>();
  for (const [course, rows] of byCourse) shares.set(course, total === 0 ? 0 : rows.length / total);
  return shares;
}

/** C5.6's rolling floor, in days rather than sessions — see the module doc. */
function forcedCourseFloorDays(runningCourseCount: number): number {
  return runningCourseCount + COURSE_FLOOR_WINDOW_SLACK;
}

function courseLastSeenDay(rows: readonly ClassifiedRow[]): CalendarDay | null {
  let latest: CalendarDay | null = null;
  for (const c of rows) {
    if (c.lastRetrievalDay !== null && (latest === null || c.lastRetrievalDay > latest)) {
      latest = c.lastRetrievalDay;
    }
  }
  return latest;
}

function forcedCoursesFor(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  asOf: CalendarDay,
  runningCourseCount: number,
): readonly string[] {
  const windowDays = forcedCourseFloorDays(runningCourseCount);
  const forced: string[] = [];
  for (const [course, rows] of byCourse) {
    const lastSeen = courseLastSeenDay(rows);
    const daysSince =
      lastSeen === null ? Number.POSITIVE_INFINITY : daysBetweenCalendarDays(lastSeen, asOf);
    if (daysSince >= windowDays) forced.push(course);
  }
  return forced;
}

/** Seconds per course, attention shares plus C5.6's floor forcing a guaranteed slice for a long-absent course — mirrors `builder.mjs`'s `courseBudgets`. */
function courseBudgetsFor(
  courses: readonly string[],
  budgetSeconds: number,
  shares: ReadonlyMap<string, number>,
  forced: readonly string[],
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const c of courses) out.set(c, budgetSeconds * (shares.get(c) ?? 0));
  if (forced.length === 0 || courses.length === 0) return out;
  const guaranteed = budgetSeconds / courses.length;
  let borrowed = 0;
  for (const c of forced) {
    const cur = out.get(c) ?? 0;
    borrowed += Math.max(0, guaranteed - cur);
    out.set(c, Math.max(cur, guaranteed));
  }
  const donors = courses.filter((c) => !forced.includes(c));
  const donorTotal = donors.reduce((n, c) => n + (out.get(c) ?? 0), 0);
  if (donorTotal > 0) {
    for (const c of donors) {
      const cur = out.get(c) ?? 0;
      out.set(c, Math.max(0, cur - borrowed * (cur / donorTotal)));
    }
  }
  return out;
}

/** F2.18: course blocks, ordered by the most urgent obligation class present; concepts within a block kept in `overdue-first` order. See the module doc. */
function blockByCoursePresentation(chosen: readonly ClassifiedRow[]): readonly ClassifiedRow[] {
  const byCourse = groupByCourse(chosen);
  for (const bucket of byCourse.values()) bucket.sort(overdueFirst);
  const blocks = [...byCourse.entries()].sort((a, b) => {
    const best = (items: readonly ClassifiedRow[]) =>
      items.reduce((m, c) => Math.min(m, CLASS_PRECEDENCE[c.klass]), Number.POSITIVE_INFINITY);
    const diff = best(a[1]) - best(b[1]);
    return diff !== 0 ? diff : a[0] < b[0] ? -1 : 1;
  });
  return blocks.flatMap(([, items]) => items);
}

/** A count per obligation class plus the worst case in each — C5.9's surface-rather-than-truncate clause. NOT a student-visible surface; see the module doc. */
export interface ObligationOverflowEntry {
  readonly klass: ObligationClass;
  readonly count: number;
  readonly worstOverdueDays: number;
}

function buildOverflow(
  classified: readonly ClassifiedRow[],
  chosenKeys: ReadonlySet<string>,
): readonly ObligationOverflowEntry[] {
  const classes: readonly ObligationClass[] = ['unmet', 'recall-due', 'baseline-due', 'elective'];
  return classes.map((klass) => {
    const left = classified.filter((c) => c.klass === klass && !chosenKeys.has(c.row.conceptKey));
    return {
      klass,
      count: left.length,
      worstOverdueDays: left.reduce((m, c) => Math.max(m, c.overdueDays), 0),
    };
  });
}

export interface ComposeSessionRowsInput {
  readonly rows: readonly GapRow[];
  readonly instruments: ConceptInstrumentIndex;
  /** `replaySchedulerStates(entries, scheduler)` — the same replay the caller's `Scheduler` produces elsewhere. */
  readonly replay: ReplayResult;
  readonly durations: DurationModel;
  readonly asOf: CalendarDay;
  readonly budgetSeconds: number;
}

export interface ComposeSessionRowsResult {
  /** Course-blocked, obligation-ordered — feed straight to `buildStudySession` with `order: 'given'`. */
  readonly orderedRows: readonly GapRow[];
  readonly overflow: readonly ObligationOverflowEntry[];
  readonly courseShares: ReadonlyMap<string, number>;
  readonly forcedCourses: readonly string[];
}

/**
 * Decide which concepts are eligible for today's session and in what order —
 * the layer SESS-1 designed. See the module doc for the full algorithm.
 *
 * The selection pass uses {@link representativeSecondsFor}'s cheap-instrument
 * estimate for cross-course budget accounting only; `buildStudySession` still
 * does the real, per-instrument accounting downstream, so an estimate that
 * runs a little high or low here costs at most a slightly generous or
 * slightly tight candidate set — never a wrong final session.
 */
export function composeSessionRows(input: ComposeSessionRowsInput): ComposeSessionRowsResult {
  const { rows, instruments, replay, durations, asOf, budgetSeconds } = input;

  const classified: ClassifiedRow[] = rows.map((row) => {
    const { lastRetrievalDay, recallDueDay } = obligationSignalsFor(
      row.conceptKey,
      instruments,
      replay,
    );
    const { klass, overdueDays } = classifyObligation({
      masteryState: row.masteryState,
      lastRetrievalDay,
      recallDueDay,
      asOf,
    });
    return {
      row,
      klass,
      overdueDays,
      lastRetrievalDay,
      cost: representativeSecondsFor(row, instruments, durations),
    };
  });

  const byCourse = groupByCourse(classified);
  const courses = [...byCourse.keys()];
  const shares = proportionalCourseShares(byCourse);
  const forced = forcedCoursesFor(byCourse, asOf, courses.length);
  const budgets = courseBudgetsFor(courses, budgetSeconds, shares, forced);

  const chosen: ClassifiedRow[] = [];
  const chosenKeys = new Set<string>();
  let spent = 0;

  // Pass 1: course by course (alphabetical — never by score, XCRS-1), each
  // capped at its own budget.
  for (const course of [...courses].sort()) {
    const cap = spent + (budgets.get(course) ?? 0);
    for (const c of [...(byCourse.get(course) ?? [])].sort(overdueFirst)) {
      if (spent + c.cost > cap) continue;
      chosen.push(c);
      chosenKeys.add(c.row.conceptKey);
      spent += c.cost;
    }
  }
  // Pass 2: whatever a course's own budget could not absorb, in the same
  // order, against whatever of the session budget remains.
  for (const c of classified.filter((c) => !chosenKeys.has(c.row.conceptKey)).sort(overdueFirst)) {
    if (spent + c.cost > budgetSeconds) continue;
    chosen.push(c);
    chosenKeys.add(c.row.conceptKey);
    spent += c.cost;
  }

  const orderedRows = blockByCoursePresentation(chosen).map((c) => c.row);
  const overflow = buildOverflow(classified, chosenKeys);

  return { orderedRows, overflow, courseShares: shares, forcedCourses: forced };
}

export interface BuildComposedStudySessionInput
  extends Omit<BuildStudySessionInput, 'order' | 'rows'> {
  readonly rows: readonly GapRow[];
  /** `replaySchedulerStates(entries, scheduler)` — see `ComposeSessionRowsInput.replay`. */
  readonly replay: ReplayResult;
}

export interface ComposedStudySession {
  readonly model: StudySessionModel;
  /** NOT a student-visible surface — see the module doc's F6.7 section. */
  readonly overflow: readonly ObligationOverflowEntry[];
  readonly courseShares: ReadonlyMap<string, number>;
  readonly forcedCourses: readonly string[];
}

/**
 * `composeSessionRows` + `buildStudySession(order: 'given')` — the whole
 * SESS-1 layer, end to end. This is what a production caller wants; the two
 * halves stay separately exported for testing and for a caller that needs
 * the composed order without the instrument-level fill.
 *
 * Validates `budgetMinutes`/`asOf` itself, with the same rule
 * `buildStudySession` applies, so an invalid budget fails before any
 * composition work runs rather than after.
 */
export function buildComposedStudySession(
  input: BuildComposedStudySessionInput,
): ComposedStudySession {
  if (!Number.isFinite(input.budgetMinutes) || input.budgetMinutes <= 0) {
    throw new Error(
      `buildComposedStudySession: budgetMinutes must be a finite number greater than 0, got ${input.budgetMinutes}`,
    );
  }
  if (!isCalendarDay(input.asOf)) {
    throw new Error(
      `buildComposedStudySession: asOf must be a YYYY-MM-DD day, got ${JSON.stringify(input.asOf)}`,
    );
  }

  const budgetSeconds = input.budgetMinutes * SECONDS_PER_MINUTE;
  const composed = composeSessionRows({
    rows: input.rows,
    instruments: input.instruments,
    replay: input.replay,
    durations: input.durations,
    asOf: input.asOf,
    budgetSeconds,
  });

  const model = buildStudySession({
    ...input,
    rows: composed.orderedRows,
    order: 'given',
  });

  return {
    model,
    overflow: composed.overflow,
    courseShares: composed.courseShares,
    forcedCourses: composed.forcedCourses,
  };
}
