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
 * ## Two-level allocation, and what stood in for the missing first level
 *
 * Allocation is strictly two-level because `XCRS-1` (`ol-dq1c`, open) says
 * the pre-existing builder compared `gapScore` across courses, which the
 * contract forbids. Across courses, by **attention share**. Within a course,
 * by `overdue-first`, over that course's own concepts only — no `gapScore`
 * or `overdueDays` is ever compared across a course boundary.
 *
 * **`ol-v7r5.17` [ALLOC-2] wires the real share in**, via
 * {@link ComposeSessionRowsInput.allocation} and this module's own
 * `./allocation-seconds.js` (A2.5's contracted share-to-seconds conversion).
 * When it is supplied, it REPLACES both {@link proportionalCourseShares}'s
 * interim policy AND this module's local C5.6 floor-forcing
 * ({@link forcedCoursesFor}) wholesale, in one seam
 * ({@link composeSessionRows}'s own `allocation`-branch) — the two floor
 * mechanisms must never compound, because `computeAttentionShares`
 * (`olea-service`'s component 3.5) already resolves C5.6's windowed floor at
 * the point the share was computed, using her real sitting history rather
 * than this module's days-since-last-seen proxy.
 *
 * **Until a caller has a real allocation to pass, each course's share stays
 * proportional to how much of her ranked material lives in that course**
 * ({@link proportionalCourseShares}) — SESS-1's own headline configuration
 * (equal shares over the vault's uneven course sizes was measured to starve
 * the larger course; proportional avoids that confound), with this module's
 * own local floor-forcing still applying on that path exactly as before.
 * `allocation` is optional and an empty array reads the same as omitted —
 * both fall back to the interim path, so a caller with a stale or absent
 * plan degrades to today's behaviour rather than starving every course.
 *
 * **This interim path IS the composer's plan-less degraded mode**
 * (`docs/dev/one-assembly-path.md` §6 row 1, olea-service; `[SESS-11]`,
 * `ol-egov.132.12`) — a first-run student with no cached study plan at all
 * still gets a composed session, on these interim shares, exactly as she
 * always has. `[SESS-11]` considered and rejected building a SECOND
 * plan-less path here: this module has never required `allocation` to
 * produce a session, so there is nothing new to add. What that bead names
 * instead is a real but separate dependency, upstream of this module —
 * `rows` (`GapRow[]`) comes from the oracle chain (`gap/build.ts`'s
 * `buildGapView`), which needs an assignments base path to rank anything at
 * all, the same `isStudyPlanConfigured` gate Home and the session builder
 * already apply. A vault with no plan configured cannot produce `rows` in
 * the first place, regardless of `allocation` — no change this module could
 * make closes that gap, because it is a fact about what feeds this
 * function, not about what this function does with `allocation` once fed.
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
 * ## F2.19 — within-block grouping, layered strictly inside a tie
 *
 * F2.19 asks for a *further* grouping inside one course's block: absent a
 * near assessment, adjacent placement favours concept relatedness (C7.10);
 * as a dated assessment approaches, placement shifts toward that
 * assessment's own scope (F1.7); both continuous, never a stored phase.
 * `[D-113]` item 3's `overdue-first` rule stays the block's PRIMARY order —
 * F2.19 is a refinement among concepts already **exactly tied on
 * `overdueDays`** ("comparably due", with no invented fuzziness-window: two
 * concepts either share the same days-waiting number or they don't), never
 * a second axis competing with urgency. See {@link withinBlockOrder}.
 *
 * **The data path, and where it stops.** Both signals are caller-resolved,
 * matching the `arrivalDays` pattern above exactly, because this module
 * stays pure (INV-1) and neither signal lives in a `GapRow`:
 *
 * - **Relatedness** ({@link ComposeSessionRowsInput.relatedConceptKeys}) —
 *   `concept/relation.ts`'s `ConceptRelation.from`/`.to` are concept
 *   **names**; this module partitions and joins on `conceptKey`
 *   (`ol-63e1`), so a caller resolving names to keys is required either way,
 *   the same resolution `retrospective/build.ts`'s `conceptCourses` already
 *   performs for a different join. **No production caller does that
 *   resolution yet** — same shape of gap as `ARRIVE-1`'s `arrivalDays`
 *   before it was wired: this module is ready for the signal the day a
 *   caller supplies it, and degrades identically (see below) until then.
 *   Deliberately type-agnostic over C7.10's six relation types — the clause
 *   says "concepts that connect to each other", not one type, so which
 *   edges count as "connected" is the caller's call.
 * - **Assessment scope** ({@link ComposeSessionRowsInput.assessmentContext})
 *   — keyed by the exact `VaultPath` a row's own {@link GapRow.targetAssessmentPath}
 *   already names (the oracle's own strongest-contributing assessment for
 *   that concept, F4.2/F4.7 weight-and-yield already blended into which
 *   assessment that is — this module does not re-derive assessment
 *   `weight`, only reads that assessment's `dueDay` and F1.7's resolved
 *   `scopeConceptKeys`). Building this map means resolving `AssessmentScope.text`
 *   (`assessment/scope.ts`) to concept keys — free text, no code path exists
 *   for that resolution yet — so this is a second, separate reachability
 *   gap from relatedness's, left to the production caller for the same
 *   reason.
 *
 * **Both maps are optional, and their absence is a no-op, provably.** With
 * either or both omitted, {@link withinBlockGroupingScore} reads 0 for
 * every row (no relation entry, no assessment context), so every row in a
 * tie band scores equal and the stable sort falls through to
 * {@link overdueFirst}'s own `gapScore`/`conceptKey` tiebreak — byte-for-byte
 * today's behaviour. `compose.spec.ts` pins this equivalence explicitly.
 *
 * **The proximity weight is continuous, never a "near" threshold.** A
 * concept's own target assessment contributes a weight that decays smoothly
 * with `daysUntilDue` (half-life {@link WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS}),
 * the same declared-fallback shape `../oracle/rank.ts`'s
 * `DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS` already uses for the same
 * F4.7 arithmetic (`[D-110]`) — reused here, not re-derived, because it is
 * the same "how fast does an approaching date start to matter" judgement
 * applied to a second consumer. **F4.7's stop-at-the-assessment rule is
 * enforced by construction**: a `dueDay` that has passed (or is unknown)
 * reads as weight 0, which hands the row's placement entirely to
 * relatedness — never a negative or inverted push from a sat exam.
 *
 * ## F2.19 — the material-arrival cohort (`[D-149]`, `ol-v7r5.12`)
 *
 * A third signal, ruled onto this same blend rather than beside it as a
 * fourth grouping key. **Grain**: exact {@link GapRow.notePaths} overlap —
 * that field already *is* `ConceptRecord.sourcePaths` verbatim
 * (`../gap/build.ts`'s own doc), so "one cohort per source note" costs no
 * new extraction and no caller-resolved map, unlike relatedness/assessment
 * scope above ({@link withinBlockCohortAffinity}: the fraction of a tie
 * band's peers sharing at least one of a concept's own source notes — the
 * identical adjacency-fraction shape {@link withinBlockRelatedness} already
 * uses, over a different edge). **Precedence and decay**: the cohort BLENDS
 * INTO relatedness, continuously, keyed on how long ago the concept's
 * material arrived ({@link ComposeSessionRowsInput.arrivalDays}, `ARRIVE-1`)
 * — {@link withinBlockCohortDecayWeight} reads `1` the day it arrives and
 * decays smoothly toward `0` as `asOf` recedes from it (half-life
 * {@link MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS}), so material read as
 * "just arrived" leans placement toward the concepts it shares a source note
 * with, and that lean fades back to plain C7.10 relatedness as the material
 * ages — never a threshold, never a stored flag, never a phase. This is
 * `[D-149]`'s ruling verbatim: input (days since arrival) and output (a
 * blend weight) are shapes F2.19 already uses, so the continuous-never-a-
 * phase guarantee holds by construction rather than by a new check. The
 * proximity term above still has final say: an approaching assessment
 * overrides the whole relatedness-plus-cohort blend exactly as it did before
 * this bead, because the cohort is folded into what proximity blends
 * *against*, never around it.
 *
 * **No-op, provably, absent `arrivalDays`** — the same posture `arrivalDays`
 * already has for `ObligationSignals.arrivalDay` above: an omitted map, or a
 * concept missing from it, reads `arrivalDay: null`,
 * {@link withinBlockCohortDecayWeight} returns `0`, and the blend collapses
 * to relatedness alone — byte-for-byte what this module computed before this
 * bead. `compose.spec.ts` pins this equivalence explicitly, matching the
 * relatedness/assessment-context no-op proof already established above.
 *
 * **The review-queue path** (`../queue/block-order.ts`, `ol-ua0i`) reuses
 * {@link withinBlockRelatedness}/{@link withinBlockAssessmentProximity}
 * rather than duplicating them; {@link withinBlockCohortAffinity} and
 * {@link withinBlockCohortDecayWeight} are exported here for that same reuse
 * once that path threads `arrivalDays` and per-item source notes through —
 * `[D-149]` rules the cohort onto BOTH surfaces, the same reason F2.18/F2.19
 * name both. Wiring the queue side needs two shapes that path does not carry
 * today (`QueueCandidate` has no source-note field by design — see that
 * type's own "note the absences" doc — and `ComposeQueueInput` has no
 * `arrivalDays`), which is outside this module's boundary; filed as a
 * follow-up rather than guessed at here (see the bead for its id).
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
 * ## Per-item obligation class IS meant to reach a screen (F6.7, `ol-y237`)
 *
 * {@link ComposeSessionRowsResult.obligationClasses} is the opposite shape
 * from `overflow` on purpose. F6.7 asks the suggested session to name new
 * (unmet) material **by its source** ("includes new material from Tuesday's
 * lecture"), never by a count — and this module already computes exactly the
 * classification a caller needs to write that sentence, then used to discard
 * it the instant `orderedRows` dropped down to `GapRow[]`. The map is keyed
 * by `conceptKey`, over exactly the rows `orderedRows` names (the chosen set,
 * never the classified-but-not-chosen remainder `overflow` counts), and its
 * value is one `ObligationClass` — nothing shaped like a total, a
 * per-class count, or a list of names. A caller pairs
 * `obligationClasses.get(row.conceptKey) === 'unmet'` with that SAME
 * concept's own instrument `notePath`/`noteTitle` (already on
 * `StudySessionItem`, carried through unrelated to this map) to name the
 * source — the class plus the existing source field is everything F6.7's
 * sentence needs, and there is no field here a renderer could sum to recover
 * the count the contract forbids. `buildComposedStudySession` folds the same
 * map onto {@link StudySessionModel.items} as each item's own
 * `obligationClass` so a caller working at the instrument level never has to
 * rejoin by `conceptKey` itself.
 *
 * ## The arrival-day signal (`ARRIVE-1`, `ol-4pue`) and its own honest gap
 *
 * The model's `classify()` computes an `unmet` concept's `overdueDays` from
 * `day - concept.arrivalDay`. `ObligationSignals.arrivalDay` is that signal
 * in production types: the caller resolves it (typically via
 * `VaultSource.firstSeen` over a concept's `notePaths` — a vault-host
 * file-creation/first-seen accessor, non-persisted and reversible, Class B)
 * and passes it in, either per call via {@link classifyObligation} or as a
 * `ComposeSessionRowsInput.arrivalDays` map keyed by `conceptKey`. When
 * present, `unmet` widens on real days-since-arrival exactly like every other
 * class — the SESS-1 §1.1 fix this bead exists for. `ConceptRecord` still
 * carries no date field and review-log entries still only exist for concepts
 * that HAVE been retrieved (excluding `unmet` by definition), so
 * `VaultSource.firstSeen` is the only production-shaped source; see that
 * interface's doc.
 *
 * **The gap this module cannot close alone:** `arrivalDay` is `null`
 * whenever the caller has none to offer — no map entry, no `firstSeen`
 * implementation on the host, or a file whose creation time the host itself
 * cannot report (`FolderSource`'s doc has a concrete example: checked-out git
 * files on this project's own dev platform). `overdueDays: 0` remains the
 * fallback for exactly that case: it defers to `gapScore`, i.e. today's
 * pre-`ARRIVE-1` production behaviour, rather than to `Number.POSITIVE_INFINITY`,
 * which would make `unmet` dominate every other class whenever any unmet
 * concept exists — the *opposite* starvation the design fought, where
 * recall-due and baseline-due material would never win against a standing
 * pool of new material. This module stays pure (see "INV-1 / §7.1" below), so
 * it cannot call `VaultSource` itself to close its own gap — resolving
 * `firstSeen` into a real `arrivalDays` map for the production caller
 * (`session-builder/provider.ts`) is deliberately left to a follow-up
 * (`ol-4pue`'s notes name it), not guessed at here.
 *
 * ## INV-1 / §7.1
 *
 * Pure. No `obsidian`, no vault I/O, no clock (`asOf` is an argument),
 * nothing stored. `Scheduler` implementations are pure functions of their
 * input (`scheduler/types.ts`), so `ReplayResult` — itself a pure fold over
 * entries the caller already read — is the only "history" this module needs.
 */

import type { StudyPlanAllocationEntry } from 'olea-contracts';
import type { ConceptRelation } from '../concept/relation.js';
import { daysBetween } from '../dates.js';
import type { GapRow } from '../gap/build.js';
import type { OracleMasteryState } from '../oracle/types.js';
import type { SchedulerState } from '../scheduler/types.js';
import { containerConceptKeysToDrop } from '../session/containment.js';
import type { ReplayResult } from '../session/replay.js';
import {
  type CalendarDay,
  calendarDayOfTimestamp,
  isCalendarDay,
  shiftCalendarDay,
} from '../today/calendar-day.js';
import type { VaultPath } from '../vault/types.js';
import { allocationSharesToSeconds } from './allocation-seconds.js';
import {
  type BuildStudySessionInput,
  buildStudySession,
  CONCEPT_SIZE_SECONDS_MULTIPLIER,
  type StudySessionItem,
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
  /**
   * ARRIVE-1 (`ol-4pue`): the day this concept first became reachable to
   * her, or `null` when the caller has no signal for it (see the module
   * doc's "arrival-day signal" section). Only read when `lastRetrievalDay`
   * is `null` — an already-retrieved concept never needs it, since it is not
   * in the `unmet` class this exists to widen.
   */
  readonly arrivalDay: CalendarDay | null;
  readonly asOf: CalendarDay;
}

/**
 * Sort one concept into exactly one obligation class, and say how overdue it
 * is within that class. Mirrors `scripts/modeling/lib/builder.mjs`'s
 * `classify()` — see that file for the design's own account of why
 * `overdueDays` means a different thing per class.
 */
export function classifyObligation(input: ObligationSignals): ObligationClassification {
  const { masteryState, lastRetrievalDay, recallDueDay, arrivalDay, asOf } = input;

  if (lastRetrievalDay === null) {
    // ARRIVE-1: widen on real days-since-arrival when the caller has a
    // signal for it, so `unmet` competes on the same "days waiting" key as
    // every other class (SESS-1 §1.1) instead of sorting purely on gapScore.
    // Clamped at 0 rather than allowed negative — a signal reporting an
    // arrival "after" asOf (clock skew, a caller passing a future day) must
    // never make a concept read as having a negative wait.
    //
    // No signal (`arrivalDay === null`) falls back to the module doc's
    // conservative `overdueDays: 0` — see "The arrival-day signal" section
    // for why 0, never `Number.POSITIVE_INFINITY`, is the honest choice for
    // an unknown wait.
    const overdueDays =
      arrivalDay === null ? 0 : Math.max(0, daysBetweenCalendarDays(arrivalDay, asOf));
    return { klass: 'unmet', overdueDays };
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

/**
 * F1.7's per-assessment date and resolved scope, keyed by the same
 * `VaultPath` a row's own `GapRow.targetAssessmentPath` names. See the
 * module doc's "F2.19 — within-block grouping" section for the data path
 * and why `weight` is deliberately not re-modelled here.
 */
export interface AssessmentGroupingContext {
  /** F4.7's dated arithmetic input. `null` reads as "no known deadline" — the same honest-unknown posture `daysUntilDue: null` gets in `../oracle/rank.ts`, never a fabricated date. */
  readonly dueDay: CalendarDay | null;
  /** F1.7's resolved scope (`../assessment/scope.ts`'s `AssessmentScope.text`), already turned into concept keys by the caller — the same shape `../retrospective/build.ts`'s `RetrospectiveConceptCoverage` already is for a different consumer. */
  readonly scopeConceptKeys: ReadonlySet<string>;
}

/**
 * The half-life (days) an assessment's continuous placement-shift weight
 * decays over as its due date recedes — see the module doc. **Declared, not
 * derived**: reused verbatim from `../oracle/rank.ts`'s
 * `DECLARED_FALLBACK_PROXIMITY_HALF_LIFE_DAYS` (`[D-110]`), which is itself
 * argued there as a client-side default rather than a fitted number. This
 * module applies the identical argument to a second, structurally identical
 * question ("how fast does an approaching date start to matter") rather than
 * inventing a second constant for the same judgement.
 */
export const WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS = 14;

/**
 * F4.7's continuous countdown, applied to ONE row's own target assessment.
 * `0` for "no known deadline" and, by construction, for a **passed**
 * assessment (`daysUntilDue < 0`) — F4.7's "exerts no weight" enforced as a
 * value rather than a branch a caller could forget. Never negative, never
 * above 1.
 *
 * Exported for `queue/block-order.ts` (`ol-ua0i`) — the plain review-queue
 * path reuses this exact formula for its own F2.19 layer rather than
 * restating the decay curve a second time. No behaviour change: still the
 * same pure `dueDay`/`asOf` arithmetic.
 */
export function withinBlockAssessmentProximity(
  dueDay: CalendarDay | null,
  asOf: CalendarDay,
): number {
  if (dueDay === null) return 0;
  const daysUntilDue = daysBetweenCalendarDays(asOf, dueDay);
  if (daysUntilDue < 0) return 0;
  return 1 / (1 + daysUntilDue / WITHIN_BLOCK_PROXIMITY_HALF_LIFE_DAYS);
}

/**
 * How connected `conceptKey` is to its `peers` (the rest of its tie band,
 * same course) — the fraction of peers it shares a C7.10 edge with, `0` when
 * `related` is absent/empty or there are no peers to compare against. This is
 * the "adjacent placement favours relatedness" half of F2.19: a concept
 * connected to more of its comparably-due neighbours scores higher and sorts
 * toward the rest of that cluster, without this module ever building a
 * clustering structure of its own.
 *
 * Exported for `queue/block-order.ts` (`ol-ua0i`) — see
 * `withinBlockAssessmentProximity`'s doc above. No behaviour change.
 */
export function withinBlockRelatedness(
  conceptKey: string,
  peers: readonly string[],
  related: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): number {
  if (related === undefined || peers.length === 0) return 0;
  const own = related.get(conceptKey);
  if (own === undefined || own.size === 0) return 0;
  const connected = peers.filter((peer) => own.has(peer)).length;
  return connected / peers.length;
}

/**
 * `[D-149]`'s cohort GRAIN: the fraction of `peers` this concept shares at
 * least one EXACT source note with — `notePaths` is `GapRow.notePaths`
 * (`ConceptRecord.sourcePaths` verbatim), so "one cohort per source note"
 * needs no new extraction and no caller-resolved map, unlike
 * {@link withinBlockRelatedness}'s C7.10 adjacency above. Same
 * connected-over-peers shape as that function, over a different edge. `0`
 * when `notePaths` or `peers` is empty, or no peer's own notes overlap at
 * all.
 *
 * Exported for `../queue/block-order.ts` reuse once that path carries a
 * source-note field on `QueueCandidate` — see the module doc's "material-
 * arrival cohort" section for why that wiring is a follow-up rather than
 * done here.
 */
export function withinBlockCohortAffinity(
  notePaths: readonly VaultPath[],
  peers: readonly string[],
  peerNotePaths: ReadonlyMap<string, readonly VaultPath[]>,
): number {
  if (notePaths.length === 0 || peers.length === 0) return 0;
  const own = new Set(notePaths);
  const connected = peers.filter((peer) =>
    (peerNotePaths.get(peer) ?? []).some((path) => own.has(path)),
  ).length;
  return connected / peers.length;
}

/**
 * How many days a material-arrival cohort's pull on placement takes to fade
 * to half strength — `[D-149]`'s "continuous decay weight". **Declared, not
 * derived**: production callers resolve `arrivalDays` on both session
 * surfaces (session-builder/provider.ts since ARRIVE-2; session/build.ts for
 * the review-queue path, ol-4e7o), but no arrival *history* exists yet to
 * fit this against. One week is defensible on its own terms without a corpus: it is
 * the plain reading of "a lecture's worth of material reads as freshly
 * arrived until roughly the next one lands" — a course-cadence fact, not a
 * fitted number, and the same kind of one-sentence defence the register asks
 * of a declared constant. *Revisit* once `ARRIVE-1` has a real caller and
 * enough arrival history exists to check whether a week is too short
 * (cohorts scatter before she has revisited the material once) or too long
 * (a stale lecture's cohort still outweighs plain concept relatedness weeks
 * later).
 */
export const MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS = 7;

/**
 * `[D-149]`'s continuous decay weight: how strongly a concept's own
 * material-arrival cohort should still pull its placement, purely as a
 * function of how long ago that material arrived. `1` the day it arrives,
 * decaying smoothly toward `0` as `asOf` moves away from `arrivalDay` — the
 * same reciprocal shape {@link withinBlockAssessmentProximity} uses for a
 * date still to come, mirrored here for one already past. `0` when there is
 * no arrival signal at all (never an unbounded pull) and, by construction,
 * for an arrival day `asOf` has not reached yet (clock skew, a caller
 * passing a future day) — never a negative wait, the same clamp
 * {@link classifyObligation} applies to `arrivalDay`.
 *
 * Exported for `../queue/block-order.ts` reuse — see
 * {@link withinBlockCohortAffinity}'s doc.
 */
export function withinBlockCohortDecayWeight(
  arrivalDay: CalendarDay | null,
  asOf: CalendarDay,
): number {
  if (arrivalDay === null) return 0;
  const daysSinceArrival = daysBetweenCalendarDays(arrivalDay, asOf);
  if (daysSinceArrival < 0) return 0;
  return 1 / (1 + daysSinceArrival / MATERIAL_ARRIVAL_COHORT_HALF_LIFE_DAYS);
}

/**
 * One row's F2.19 placement-affinity score within its tie band — higher
 * sorts earlier. `(1 - proximity) * blendedRelatedness + proximity *
 * scopeMembership`, where `blendedRelatedness` is itself `(1 - cohortWeight)
 * * relatedness + cohortWeight * cohortAffinity` (`[D-149]`, see the module
 * doc's "material-arrival cohort" section) — every step a continuous blend,
 * never a staged switch, so "no assessment near favours relatedness", "just-
 * arrived material favours its own cohort" and "an approaching assessment
 * favours its own scope" are the SAME formula read at different points on
 * two continuous weights, exactly as F2.19 requires. `0` for every row when
 * none of the optional signals are supplied — see the module doc's no-op
 * proof.
 */
function withinBlockGroupingScore(
  c: ClassifiedRow,
  peers: readonly string[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  peerNotePaths: ReadonlyMap<string, readonly VaultPath[]>,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
): number {
  const relatedness = withinBlockRelatedness(c.row.conceptKey, peers, relatedConceptKeys);
  const cohortWeight = withinBlockCohortDecayWeight(
    arrivalDays?.get(c.row.conceptKey) ?? null,
    asOf,
  );
  const cohortAffinity = withinBlockCohortAffinity(c.row.notePaths, peers, peerNotePaths);
  const blendedRelatedness = (1 - cohortWeight) * relatedness + cohortWeight * cohortAffinity;
  const context =
    c.row.targetAssessmentPath !== null
      ? assessmentContext?.get(c.row.targetAssessmentPath)
      : undefined;
  if (context === undefined) return blendedRelatedness;
  const proximity = withinBlockAssessmentProximity(context.dueDay, asOf);
  const scopeMembership = context.scopeConceptKeys.has(c.row.conceptKey) ? 1 : 0;
  return (1 - proximity) * blendedRelatedness + proximity * scopeMembership;
}

/**
 * F2.19: reorders each course-block's `overdue-first` bucket WITHIN its own
 * exact-`overdueDays` tie bands only — see the module doc for why equality is
 * the tie-band boundary (zero invented fuzziness) and why this cannot move a
 * row across bands (urgency is never overridden). Bands are scored
 * independently and concatenated back in `overdueFirst`'s own band order;
 * ties within a band fall back to `overdueFirst` itself (`gapScore`, then
 * `conceptKey`), so with no relatedness/assessment-context/arrival signal
 * this is `overdueFirst` unchanged.
 */
function withinBlockOrder(
  bucket: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
): readonly ClassifiedRow[] {
  const sorted = [...bucket].sort(overdueFirst);
  const result: ClassifiedRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i];
    if (first === undefined) break;
    let j = i + 1;
    while (j < sorted.length && sorted[j]?.overdueDays === first.overdueDays) j += 1;
    const band = sorted.slice(i, j);
    const keys = band.map((c) => c.row.conceptKey);
    // `[D-149]`'s cohort grain reads straight off each row's own
    // `notePaths` — no caller-resolved map needed, unlike relatedness and
    // assessment context above (see the module doc).
    const notePathsByKey = new Map<string, readonly VaultPath[]>(
      band.map((c) => [c.row.conceptKey, c.row.notePaths]),
    );
    const scored = band.map((c) => ({
      c,
      // Exclude self from its own peer set.
      score: withinBlockGroupingScore(
        c,
        keys.filter((k) => k !== c.row.conceptKey),
        relatedConceptKeys,
        assessmentContext,
        notePathsByKey,
        arrivalDays,
        asOf,
      ),
    }));
    scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : overdueFirst(a.c, b.c)));
    result.push(...scored.map((s) => s.c));
    i = j;
  }
  return result;
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

/**
 * F2.18: course blocks, ordered by the most urgent obligation class present;
 * concepts within a block kept in `overdue-first` order, refined by F2.19's
 * within-tie-band grouping (see {@link withinBlockOrder} and the module
 * doc) when `relatedConceptKeys`/`assessmentContext`/`arrivalDays` are
 * supplied.
 */
function blockByCoursePresentation(
  chosen: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
  asOf: CalendarDay,
): readonly ClassifiedRow[] {
  const byCourse = groupByCourse(chosen);
  const ordered = new Map<string, readonly ClassifiedRow[]>();
  for (const [course, bucket] of byCourse) {
    ordered.set(
      course,
      withinBlockOrder(bucket, relatedConceptKeys, assessmentContext, arrivalDays, asOf),
    );
  }
  const blocks = [...ordered.entries()].sort((a, b) => {
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

/**
 * `[D-244]` (`ol-egov.137` / FOCUS-1), item 6's implementation (`[FOCUS-3]`,
 * `ol-egov.137.2`). `'every-course'` is today's behaviour, byte-identical
 * when the field is omitted — see {@link ComposeSessionRowsInput.focusPolicy}.
 * `'focused'` admits a dominant course plus at most one second course under
 * the admission rule below; `'single'` never admits a second course. The
 * default flips only under `[FOCUS-5]` (`ol-egov.137.4`).
 */
export type FocusPolicy = 'every-course' | 'focused' | 'single';

/**
 * Which of `[D-244]` item 2's three tests chose the dominant course this
 * session — `'filter'` (her course-or-topic steering named it), `'urgency'`
 * (its assessment risk crossed {@link URGENCY_OVERRIDE_THRESHOLD}), or
 * `'deficit'` (it holds the largest accumulated window deficit among the
 * eligible courses). Travels on {@link ComposeSessionRowsResult} so the
 * `[FOCUS-4]` sweep can count sessions per branch, and is what item 5's
 * sentence names (see {@link FOCUS_BRANCH_SENTENCE}).
 */
export type FocusBranch = 'filter' | 'urgency' | 'deficit';

/**
 * `[D-244]` item 6 / `findings/precommitment-focus-urgency.md` (`[FOCUS-2]`,
 * `ol-egov.137.1`): the assessment-urgency override this composer reads under
 * `focusPolicy !== 'every-course'`. **Declared** (`[BND-4]`/`[D-191]`), never
 * fitted: `1 × 1/7 × 0.5` — the urgency of a full-weight assessment seven
 * days away with half its assessed scope still weak. Higher is stricter (the
 * calendar rarely overrides the rotation); lower is more permissive
 * (assessments dominate more of the term). Moves only per the pre-commitment's
 * own moved-enough rule, one step at a time (halve or double), never off a
 * value read from her log.
 */
export const URGENCY_OVERRIDE_THRESHOLD = 1 / 14;

/**
 * `[D-244]` item 6 / `findings/precommitment-focus-second-course.md`: the
 * guard beneath F2.19's group primitive — a completed group priced under this
 * many seconds does not admit a second course (the leftover goes to the
 * dominant course instead). **Declared**, mirroring
 * `src/plan/allocation.ts:152`'s `MIN_BLOCK_SECONDS` (the service-side guard
 * beneath A2.5's own redistribution rule) at the same value and the same
 * plain-English defence — "the shortest fundable retrieval block" — argued
 * once and reused, not re-derived. Duplicated client-side because this
 * admission check runs at composition time, which is client (`[D-069]`); the
 * pre-commitment leaves "which side holds it" to this bead and this is that
 * answer. Retirement condition: the pre-commitment's (a) table, checked by
 * `[FOCUS-4]`'s sweep, not by this file.
 */
export const MIN_BLOCK_SECONDS = 180;

/**
 * `[D-244]` item 5's sentence, verbatim from the ruling and worded through
 * `docs/Olea_vocabulary_registry.md` at ratification time — this module does
 * not compose prose (see the module doc's "Framing" note two files over,
 * `build.ts`), it carries the one ratified fragment per branch so a caller
 * assembling the rendered sentence (naming the course) has the exact wording
 * `[D-244]` approved rather than inventing a paraphrase.
 */
export const FOCUS_BRANCH_SENTENCE: Readonly<Record<FocusBranch, string>> = Object.freeze({
  filter: 'mostly this course because you asked for it',
  urgency: 'because its assessment is close and the assessed material still needs work',
  deficit: 'because it is behind its share from your recent sessions',
});

/**
 * `urgency(course)` read off the plan's OWN inputs, never re-derived
 * (`findings/precommitment-focus-urgency.md` (a): "not new machinery").
 * `StudyPlanAllocationEntry.contributions` mirrors `src/plan/allocation.ts`'s
 * `CourseAllocationContribution` field for field, and its `'risk'` entry IS
 * `assessmentWorth × proximityUrgency(daysToNextAssessment) ×
 * effectiveReadinessMultiplier(readiness, evidenceVolume)` — exactly C5.6's
 * ramped proximity-times-readiness term the pre-commitment names. Absent
 * `allocation` (the interim/no-allocation path, which has no risk computation
 * at all — see the module doc's "Two-level allocation" section), this reads
 * empty and the urgency branch never fires; the composer still runs on filter
 * and deficit alone, an honest degrade rather than a fabricated number.
 */
function urgencyByCourseFrom(
  allocation: readonly StudyPlanAllocationEntry[] | undefined,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const entry of allocation ?? []) {
    const risk = entry.contributions.find((c) => c.name === 'risk');
    if (risk !== undefined) out.set(entry.courseId, risk.value);
  }
  return out;
}

/**
 * The window-deficit ordering key FOCUS-3 reads for its deficit branch and
 * door: days since a course's material was last retrieved, `+Infinity` for a
 * course never seen — the SAME days-denominated proxy this module's own
 * {@link forcedCourseFloorDays}/{@link forcedCoursesFor} already substitute
 * for C5.6's session-denominated window (see the module doc's "C5.6's rolling
 * floor" note). Real per-session window bookkeeping
 * (`sittingsSinceFloorMet`) is service-side only — `src/plan/allocation.ts`,
 * per the component register's own "boundary: service" line on that row, and
 * `packages/core/src/allocation/resolve-inputs.ts` documents that no
 * client-side producer for it exists. This reuses this module's own existing
 * client-side substitute rather than inventing a second one or reaching into
 * a file this bead does not own.
 */
function deficitDaysByCourseFrom(
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  asOf: CalendarDay,
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [course, rows] of byCourse) {
    const lastSeen = courseLastSeenDay(rows);
    out.set(
      course,
      lastSeen === null ? Number.POSITIVE_INFINITY : daysBetweenCalendarDays(lastSeen, asOf),
    );
  }
  return out;
}

/** Total representative-seconds cost of a concept group — see {@link groupConceptRows}. */
function groupCost(group: readonly ClassifiedRow[]): number {
  return group.reduce((n, c) => n + c.cost, 0);
}

/**
 * `[D-244]` item 4 / F2.19's group primitive
 * (`findings/precommitment-focus-second-course.md` (a)): partitions one
 * course's already-{@link withinBlockOrder}ed rows into maximal runs of
 * DIRECTLY connected concepts — F2.19's relatedness (C7.10) or material-
 * arrival cohort (a shared source note) between two ADJACENT rows in that
 * order. **Absent both signals — today's only production shape; see the
 * module doc's "F2.19" section: no production caller resolves
 * `relatedConceptKeys` yet — every row is its own singleton group**, the same
 * no-op-when-absent posture every optional F2.19 signal already takes on this
 * path, never a fabricated cluster. A singleton group can never be "cut", so
 * the group primitive's "never cut a group" guarantee holds by construction
 * on today's only wired inputs, exactly as it will once a caller supplies
 * relatedness.
 */
function groupConceptRows(
  orderedCourseRows: readonly ClassifiedRow[],
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): readonly (readonly ClassifiedRow[])[] {
  const groups: ClassifiedRow[][] = [];
  for (const c of orderedCourseRows) {
    const current = groups[groups.length - 1];
    const prev = current === undefined ? undefined : current[current.length - 1];
    const connected =
      current !== undefined &&
      prev !== undefined &&
      (withinBlockRelatedness(c.row.conceptKey, [prev.row.conceptKey], relatedConceptKeys) > 0 ||
        withinBlockCohortAffinity(
          c.row.notePaths,
          [prev.row.conceptKey],
          new Map([[prev.row.conceptKey, prev.row.notePaths]]),
        ) > 0);
    if (connected && current !== undefined) current.push(c);
    else groups.push([c]);
  }
  return groups;
}

/**
 * Greedily takes WHOLE groups (never a partial one, `[D-244]` items 1/4) from
 * `groups` in priority order, up to `budgetSeconds`. A group that does not
 * fit is skipped rather than a hard stop — the same skip-and-continue reading
 * Pass 1's existing `if (spent + c.cost > cap) continue` already gives a
 * single concept, generalised here to a group.
 */
function fillWholeGroups(
  groups: readonly (readonly ClassifiedRow[])[],
  budgetSeconds: number,
): { readonly chosen: readonly ClassifiedRow[]; readonly spent: number } {
  const chosen: ClassifiedRow[] = [];
  let spent = 0;
  for (const group of groups) {
    const cost = groupCost(group);
    if (spent + cost > budgetSeconds) continue;
    chosen.push(...group);
    spent += cost;
  }
  return { chosen, spent };
}

/**
 * `[D-244]` item 2: her course-or-topic filter (F4.6) first, then an
 * eligible course whose urgency crosses {@link URGENCY_OVERRIDE_THRESHOLD},
 * then the eligible course with the largest window deficit.
 * `eligibleCourses` is always the eligible set — see the module doc's
 * eligibility note above {@link composeFocusedSelection}: a refused course
 * never appears in `byCourse`/`courses` at all, so no explicit refusal check
 * is needed here.
 *
 * The filter branch fires only when she named exactly ONE course and that
 * course is eligible — a multi-course filter narrows the roster (STEER-1,
 * applied upstream, before classification) without itself settling
 * dominance, so the hierarchy continues to urgency/deficit over just the
 * named courses.
 */
function selectDominantCourse(
  eligibleCourses: readonly string[],
  courseFilter: readonly string[] | undefined,
  urgencyByCourse: ReadonlyMap<string, number>,
  deficitDaysByCourse: ReadonlyMap<string, number>,
): { readonly course: string; readonly branch: FocusBranch } | undefined {
  if (eligibleCourses.length === 0) return undefined;

  if (courseFilter !== undefined && courseFilter.length === 1) {
    const named = courseFilter[0];
    if (named !== undefined && eligibleCourses.includes(named)) {
      return { course: named, branch: 'filter' };
    }
  }

  let byUrgency: { readonly course: string; readonly value: number } | undefined;
  for (const course of eligibleCourses) {
    const urgency = urgencyByCourse.get(course);
    if (urgency === undefined || urgency < URGENCY_OVERRIDE_THRESHOLD) continue;
    if (
      byUrgency === undefined ||
      urgency > byUrgency.value ||
      (urgency === byUrgency.value && course < byUrgency.course)
    ) {
      byUrgency = { course, value: urgency };
    }
  }
  if (byUrgency !== undefined) return { course: byUrgency.course, branch: 'urgency' };

  let byDeficit: { readonly course: string; readonly value: number } | undefined;
  for (const course of eligibleCourses) {
    const deficit = deficitDaysByCourse.get(course) ?? 0;
    if (
      byDeficit === undefined ||
      deficit > byDeficit.value ||
      (deficit === byDeficit.value && course < byDeficit.course)
    ) {
      byDeficit = { course, value: deficit };
    }
  }
  return byDeficit === undefined ? undefined : { course: byDeficit.course, branch: 'deficit' };
}

/**
 * `[D-244]` item 1 / `findings/precommitment-focus-second-course.md` (a): the
 * four admission clauses, read together. `candidates` already excludes the
 * dominant course and any ineligible (refused) course — see the module doc's
 * eligibility note. Prefers an urgency-door candidate (the calendar) over a
 * deficit-door one when both qualify, since the urgency door exists
 * specifically to notice a date the rotation would otherwise miss; ties break
 * on `courseId` for determinism. Returns `undefined` when no candidate's
 * first group is both affordable and warranted — "at most one second
 * course", never a forced admission.
 */
function selectSecondCourse(
  candidates: readonly string[],
  groupsByCourse: ReadonlyMap<string, readonly (readonly ClassifiedRow[])[]>,
  remainingSeconds: number,
  urgencyByCourse: ReadonlyMap<string, number>,
  forcedSet: ReadonlySet<string>,
):
  | {
      readonly course: string;
      readonly group: readonly ClassifiedRow[];
      readonly door: 'deficit' | 'urgency';
    }
  | undefined {
  const urgent: {
    readonly course: string;
    readonly group: readonly ClassifiedRow[];
    readonly value: number;
  }[] = [];
  const owed: { readonly course: string; readonly group: readonly ClassifiedRow[] }[] = [];
  for (const course of candidates) {
    const firstGroup = (groupsByCourse.get(course) ?? [])[0];
    if (firstGroup === undefined) continue; // clause 1 (eligible, has material) / clause 2 (a group to offer)
    const cost = groupCost(firstGroup);
    // Clause 2: the whole group must fit — never a partial block.
    if (cost > remainingSeconds) continue;
    // The declared guard beneath the group primitive (`MIN_BLOCK_SECONDS`).
    if (cost < MIN_BLOCK_SECONDS) continue;
    const urgency = urgencyByCourse.get(course);
    if (urgency !== undefined && urgency >= URGENCY_OVERRIDE_THRESHOLD) {
      urgent.push({ course, group: firstGroup, value: urgency });
    } else if (forcedSet.has(course)) {
      // Clause 3, deficit door: the window can no longer pay this course's
      // floor later — reusing `forcedCoursesFor`'s own threshold (this
      // module's existing C5.6 substitute), never a new constant.
      owed.push({ course, group: firstGroup });
    }
    // Neither door open: clause 3 fails and the candidate is not warranted.
  }
  if (urgent.length > 0) {
    urgent.sort((a, b) => (b.value !== a.value ? b.value - a.value : a.course < b.course ? -1 : 1));
    const top = urgent[0];
    return top === undefined
      ? undefined
      : { course: top.course, group: top.group, door: 'urgency' };
  }
  if (owed.length > 0) {
    owed.sort((a, b) => (a.course < b.course ? -1 : 1));
    const top = owed[0];
    return top === undefined
      ? undefined
      : { course: top.course, group: top.group, door: 'deficit' };
  }
  return undefined;
}

/** {@link composeFocusedSelection}'s result — see that function's doc. */
interface FocusedSelectionResult {
  readonly chosen: readonly ClassifiedRow[];
  readonly shares: ReadonlyMap<string, number>;
  readonly budgets: ReadonlyMap<string, number>;
  readonly dominantCourse: string;
  readonly secondCourse: string | undefined;
  readonly focusBranch: FocusBranch;
  readonly focusReason: string;
  readonly secondCourseDoor: 'deficit' | 'urgency' | undefined;
}

/**
 * `[D-244]` items 1-5 (`[FOCUS-3]`, `ol-egov.137.2`), the whole focus rule,
 * run when `focusPolicy !== 'every-course'`. Replaces `composeSessionRows`'s
 * ordinary course-by-course budgeted passes entirely for this branch — see
 * the call site — rather than composing with them, because the two rules
 * answer the same question ("how much of the session does each course get")
 * differently and must never both answer it at once.
 *
 * **Eligibility (item 1's "the ranking will serve it").** `courses` here is
 * always `[...byCourse.keys()]` — a course the ranking refuses (P5-T03's
 * `status: 'abstained'`/`'no-evidence'`) produces zero `GapRow`s and so never
 * enters `byCourse` at all. There is deliberately no separate refusal check:
 * the pre-commitment's own distinction ("a course whose ranking returns rows
 * but whose block comes out empty is a composer defect, not a refusal")
 * means eligibility has to be read at the ROW-SET level, before selection —
 * exactly what `byCourse` already is — never inferred from an empty block
 * after the fact.
 *
 * **Item 5, the floor is not paid per session.** A non-selected eligible
 * course's `share`/seconds this session are `0` (see the return below); its
 * window deficit is carried by the service-side accounting
 * (`src/plan/allocation.ts`) rather than by anything this module tracks
 * per-session, which is exactly D-244 item 5's "the window accounting
 * carries what is owed."
 *
 * **Item 1/(d), the sequencing.** The dominant course fills first, from its
 * OWN whole groups, up to the full session budget. Only the LEFTOVER (if
 * `'focused'` and a candidate is warranted) funds one second-course group;
 * whatever is left after THAT returns to the dominant course's own remaining
 * groups. `'single'` never runs the second-course step at all. The exact
 * INTERNAL order of `chosen` does not matter: `composeSessionRows`'s caller
 * re-derives F2.19/F2.18 order and course-blocking over whatever set this
 * function returns, identically to every other path.
 *
 * Returns `undefined` only when there is no eligible course at all
 * (`eligibleCourses.length === 0`) — `composeSessionRows`'s caller falls back
 * to the ordinary (empty either way) path in that one degenerate case; see
 * the call site's comment for why the two are provably equivalent there.
 */
function composeFocusedSelection(
  policy: 'focused' | 'single',
  byCourse: ReadonlyMap<string, readonly ClassifiedRow[]>,
  courses: readonly string[],
  courseFilter: readonly string[] | undefined,
  allocation: readonly StudyPlanAllocationEntry[] | undefined,
  budgetSeconds: number,
  asOf: CalendarDay,
  relatedConceptKeys: ReadonlyMap<string, ReadonlySet<string>> | undefined,
  assessmentContext: ReadonlyMap<VaultPath, AssessmentGroupingContext> | undefined,
  arrivalDays: ReadonlyMap<string, CalendarDay> | undefined,
): FocusedSelectionResult | undefined {
  const urgencyByCourse = urgencyByCourseFrom(allocation);
  const deficitDaysByCourse = deficitDaysByCourseFrom(byCourse, asOf);
  const dominantPick = selectDominantCourse(
    courses,
    courseFilter,
    urgencyByCourse,
    deficitDaysByCourse,
  );
  if (dominantPick === undefined) return undefined;
  const { course: dominantCourse, branch } = dominantPick;

  const groupsByCourse = new Map<string, readonly (readonly ClassifiedRow[])[]>();
  for (const course of courses) {
    const ordered = withinBlockOrder(
      byCourse.get(course) ?? [],
      relatedConceptKeys,
      assessmentContext,
      arrivalDays,
      asOf,
    );
    groupsByCourse.set(course, groupConceptRows(ordered, relatedConceptKeys));
  }

  const dominantGroups = groupsByCourse.get(dominantCourse) ?? [];
  const dominantFill1 = fillWholeGroups(dominantGroups, budgetSeconds);
  let dominantChosen: ClassifiedRow[] = [...dominantFill1.chosen];
  let dominantSpent = dominantFill1.spent;
  let secondCourse: string | undefined;
  let secondCourseDoor: 'deficit' | 'urgency' | undefined;
  let secondSpent = 0;

  if (policy === 'focused') {
    const remaining = budgetSeconds - dominantSpent;
    if (remaining > 0) {
      const forcedSet = new Set(forcedCoursesFor(byCourse, asOf, courses.length));
      const candidates = courses.filter((c) => c !== dominantCourse);
      const pick = selectSecondCourse(
        candidates,
        groupsByCourse,
        remaining,
        urgencyByCourse,
        forcedSet,
      );
      if (pick !== undefined) {
        secondCourse = pick.course;
        secondCourseDoor = pick.door;
        secondSpent = groupCost(pick.group);
        // Item 1/(d): whatever is left after the second course's one group
        // returns to the dominant course's own remaining groups.
        const takenKeys = new Set(dominantChosen.map((c) => c.row.conceptKey));
        const leftoverDominantGroups = dominantGroups.filter(
          (group) => !group.some((c) => takenKeys.has(c.row.conceptKey)),
        );
        const dominantFill2 = fillWholeGroups(leftoverDominantGroups, remaining - secondSpent);
        dominantChosen = [...dominantChosen, ...dominantFill2.chosen];
        dominantSpent += dominantFill2.spent;
      }
    }
  }

  const chosen: ClassifiedRow[] = [...dominantChosen];
  if (secondCourse !== undefined) {
    const secondGroup = groupsByCourse.get(secondCourse)?.[0];
    if (secondGroup !== undefined) chosen.push(...secondGroup);
  }

  const shares = new Map<string, number>();
  const budgets = new Map<string, number>();
  for (const course of courses) {
    if (course === dominantCourse) {
      shares.set(course, budgetSeconds > 0 ? dominantSpent / budgetSeconds : 0);
      budgets.set(course, dominantSpent);
    } else if (course === secondCourse) {
      shares.set(course, budgetSeconds > 0 ? secondSpent / budgetSeconds : 0);
      budgets.set(course, secondSpent);
    } else {
      // Item 5: not selected this session — zero, never a fragment.
      shares.set(course, 0);
      budgets.set(course, 0);
    }
  }

  return {
    chosen,
    shares,
    budgets,
    dominantCourse,
    secondCourse,
    focusBranch: branch,
    focusReason: FOCUS_BRANCH_SENTENCE[branch],
    secondCourseDoor,
  };
}

/**
 * C7.9 containment co-presence (register row 3.7; `../session/containment.js`;
 * `[SESS-11]`, `ol-egov.132.12`) — a broad-area concept and one of its own
 * parts are never composed into the same session. `session/build.ts` already
 * applies this rule to `composeQueue`'s instrument-level candidate pool
 * before that composer runs; this composer's own candidate pool is
 * concept-level (`GapRow`, one row per concept), so this applies the
 * identical rule — `containerConceptKeysToDrop`, the same shared primitive,
 * same `part-of` edges, same "the part is kept, the container yields"
 * asymmetry — to `rows` instead, over the SAME candidate pool `composeQueue`
 * would have seen: every row this composition was handed, before
 * [STEER-1]'s course/topic filter narrows it (mirroring `session/build.ts`'s
 * own ordering, containment before `composeQueue`'s `filter`).
 *
 * **No second concept lookup.** `containerConceptKeysToDrop` needs a name ->
 * key resolver to read `ConceptRelation.from`/`.to` (concept **names**)
 * against `GapRow.conceptKey` (the opaque join key) — this module has no
 * `ConceptRecord[]` to build one from, so it builds the map from `rows`
 * itself: every row already carries both `conceptName` and `conceptKey`
 * (`ol-63e1`), the exact pair `session/containment.ts`'s own `nameToKey`
 * resolves from `ConceptRecord[]`. First occurrence wins, the same
 * convention that module uses.
 *
 * A no-op whenever `edges` is empty — which is every real caller today,
 * exactly `session/build.ts`'s own `relations` posture (that module's doc:
 * "a real filter with a real caller ... not yet reachable with a live edge
 * set in production"). Wiring a live edge set through is a separate,
 * pre-existing plumbing gap (`build.ts`'s own module doc names it), not
 * reopened here.
 */
function nameToKeyFromRows(rows: readonly GapRow[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.conceptName)) map.set(row.conceptName, row.conceptKey);
  }
  return map;
}

/**
 * `rows` with every C7.9 co-present container concept's row dropped — see
 * this section's doc above {@link nameToKeyFromRows}. Returns `rows`
 * unchanged by reference whenever nothing is dropped (the no-op case), the
 * same "no new array on the common path" discipline
 * `session/containment.ts`'s own `filterContainmentCoPresence` follows.
 */
function applyContainmentCoPresence(
  rows: readonly GapRow[],
  edges: readonly ConceptRelation[],
): { readonly kept: readonly GapRow[]; readonly dropped: readonly GapRow[] } {
  if (edges.length === 0 || rows.length === 0) return { kept: rows, dropped: [] };
  const present = new Set(rows.map((row) => row.conceptKey));
  const drop = containerConceptKeysToDrop(edges, nameToKeyFromRows(rows), present);
  if (drop.size === 0) return { kept: rows, dropped: [] };
  const kept: GapRow[] = [];
  const dropped: GapRow[] = [];
  for (const row of rows) (drop.has(row.conceptKey) ? dropped : kept).push(row);
  return { kept, dropped };
}

export interface ComposeSessionRowsInput {
  readonly rows: readonly GapRow[];
  readonly instruments: ConceptInstrumentIndex;
  /** `replaySchedulerStates(entries, scheduler)` — the same replay the caller's `Scheduler` produces elsewhere. */
  readonly replay: ReplayResult;
  readonly durations: DurationModel;
  readonly asOf: CalendarDay;
  readonly budgetSeconds: number;
  /**
   * ARRIVE-1 (`ol-4pue`): per-concept arrival day, keyed by `conceptKey` —
   * precomputed pure data, exactly like `instruments`/`replay`/`durations`
   * are, so this module stays synchronous and does no `VaultSource` I/O
   * itself (see the module doc's "INV-1 / §7.1" section). Typically built by
   * resolving `VaultSource.firstSeen` over each concept's `GapRow.notePaths`
   * and converting the earliest result with `calendarDayOfTimestamp`.
   * **Optional, and safe to omit entirely**: a missing map, or a concept
   * absent from it, both read as "no signal" and fall back to
   * {@link classifyObligation}'s conservative `overdueDays: 0` for `unmet` —
   * never to an unbounded wait. See the module doc's "arrival-day signal"
   * section for why 0 is the honest fallback.
   */
  readonly arrivalDays?: ReadonlyMap<string, CalendarDay>;
  /**
   * F2.19: C7.10 relation adjacency, keyed by `conceptKey`, each value the
   * set of OTHER `conceptKey`s it connects to. **Optional and safe to omit
   * entirely** — see the module doc's "F2.19" section for the data path and
   * the no-op proof when this is absent.
   */
  readonly relatedConceptKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * F2.19: F1.7's per-assessment date and resolved scope, keyed by the exact
   * `VaultPath` a row's own `targetAssessmentPath` names. **Optional and
   * safe to omit entirely** — see {@link AssessmentGroupingContext} and the
   * module doc's "F2.19" section.
   */
  readonly assessmentContext?: ReadonlyMap<VaultPath, AssessmentGroupingContext>;
  /**
   * [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): the
   * "course or topic" steering input, one of the three the ruling makes
   * first-class on this one path (alongside {@link ComposeSessionRowsInput.budgetSeconds}
   * and `buildStudySession`'s `focusConceptName`). Matches {@link GapRow.course}
   * verbatim — R1/R2, never case-folded. `undefined` means no restriction;
   * combined with {@link conceptIds} by AND, mirroring `../queue/types.ts`'s
   * `QueueFilter`. Applied before `groupByCourse` and everything downstream
   * of it, so cross-course allocation runs only over the courses she actually
   * asked about — XCRS-1 (`ol-dq1c`) never compares a `gapScore` across a
   * boundary this filter already removed, it just sees fewer courses.
   */
  readonly courses?: readonly string[];
  /**
   * [STEER-1]'s "topic" half of the same input: restrict to one or more
   * concepts by {@link GapRow.conceptKey} — the opaque join key, never
   * `conceptName` (R2). `undefined` means no restriction; combined with
   * {@link courses} by AND.
   */
  readonly conceptIds?: readonly string[];
  /**
   * A2.5's real cross-course allocation (component 3.5), read off the
   * caller's cached study-plan artifact (`StudyPlanBody.allocation`,
   * `packages/contracts/src/artifact-envelope.ts`) — `ol-v7r5.17` [ALLOC-2].
   * **Optional, and an empty array reads the same as omitted**: both mean
   * "no real allocation yet" and fall back to
   * {@link proportionalCourseShares}'s interim policy, this module's
   * behaviour before this field existed. See the module doc's "Two-level
   * allocation" section for why supplying it also disables this module's own
   * local C5.6 floor-forcing rather than compounding with it.
   */
  readonly allocation?: readonly StudyPlanAllocationEntry[];
  /**
   * `[D-244]` (`ol-egov.137` / FOCUS-1), item 6 (`[FOCUS-3]`,
   * `ol-egov.137.2`). **Defaults to `'every-course'`, today's behaviour, and
   * is byte-identical when omitted** — this field's whole branch
   * ({@link composeFocusedSelection}) never runs unless a caller opts in.
   * See {@link FocusPolicy}'s doc for what `'focused'`/`'single'` change.
   */
  readonly focusPolicy?: FocusPolicy;
  /**
   * C7.9 containment co-presence (register row 3.7; `[SESS-11]`,
   * `ol-egov.132.12`) — `part-of` edges available at composition time,
   * applied to `rows` before anything else runs. **Omitted means none, which
   * is a real no-op, not a degraded mode** — the identical posture
   * `session/build.ts`'s own `BuildReviewSessionInput.relations` documents
   * for `composeQueue`'s candidate pool. See the doc above
   * {@link nameToKeyFromRows} for why this module resolves names to keys from
   * `rows` itself rather than taking a second `ConceptRecord[]` input.
   */
  readonly relations?: readonly ConceptRelation[];
}

export interface ComposeSessionRowsResult {
  /** Course-blocked, obligation-ordered — feed straight to `buildStudySession` with `order: 'given'`. */
  readonly orderedRows: readonly GapRow[];
  readonly overflow: readonly ObligationOverflowEntry[];
  readonly courseShares: ReadonlyMap<string, number>;
  readonly forcedCourses: readonly string[];
  /**
   * Rows the C7.9 containment co-presence filter dropped before anything
   * else ran (`[SESS-11]`) — empty whenever `input.relations` is omitted,
   * which is every real caller today. Reported rather than folded silently
   * into `orderedRows`'s absence, the same posture
   * `ReviewSession.containmentDropped` already takes on the retiring queue
   * path. Optional only so a hand-built fixture predating this bead remains
   * valid — the same "optional on the result, always set by the real
   * builder" pattern `StudySessionModel.explainBackItems` and
   * `ComposeSessionRowsResult.focusPolicy` already use; `composeSessionRows`
   * itself always sets it.
   */
  readonly containmentDropped?: readonly GapRow[];
  /**
   * Each chosen concept's own {@link ObligationClass}, keyed by `conceptKey`
   * — a student-visible signal, unlike {@link overflow}. See the module
   * doc's "Per-item obligation class" section for why this shape (one class
   * per concept, no count, no total) is exactly what F6.7 needs and nothing
   * it forbids. Covers precisely the concepts named in {@link orderedRows};
   * a `conceptKey` classified-but-not-chosen lives only in `overflow`'s
   * aggregate, never here.
   */
  readonly obligationClasses: ReadonlyMap<string, ObligationClass>;
  /**
   * [SESS-9] (`ol-2zfj.77`, C5.5/C5.6): the seconds each course's share
   * converts to against this composition's own budget — A2.5's conversion
   * where a real `allocation` was supplied, this module's interim
   * proportional policy plus its local floor-forcing where it was not, in
   * both cases the exact map the selection above was capped by. Returned so
   * `buildStudySession`'s fill can honour the same seconds the selection did,
   * rather than the share stopping at concept selection and the instrument
   * fill spending one flat session-wide total — see `./build.ts`'s module doc,
   * "Allocation's share is honoured before the cross-course fill".
   */
  readonly courseSeconds: ReadonlyMap<string, number>;
  /**
   * Echoes {@link ComposeSessionRowsInput.focusPolicy}, defaulted to
   * `'every-course'` — so a caller (or the `[FOCUS-4]` harness) can tell
   * which arm ran without also threading the input through. Optional only so
   * a hand-built fixture predating `[FOCUS-3]` remains valid — the same
   * "optional on the result, always set by the real builder" pattern
   * `StudySessionModel.explainBackItems` already uses; `composeSessionRows`
   * itself always sets it.
   */
  readonly focusPolicy?: FocusPolicy;
  /**
   * `[D-244]` item 2's chosen dominant course this session. `undefined` under
   * `'every-course'` (no dominant course is chosen — every eligible course
   * may be served) and in the degenerate case of no eligible course at all.
   */
  readonly dominantCourse?: string;
  /**
   * `[D-244]` item 1's admitted second course, when `'focused'` admitted one.
   * Always `undefined` under `'every-course'` and `'single'`.
   */
  readonly secondCourse?: string;
  /** Which of item 2's three tests chose {@link dominantCourse} — see {@link FocusBranch}. `undefined` exactly when {@link dominantCourse} is. */
  readonly focusBranch?: FocusBranch;
  /** Item 5's ratified sentence fragment for {@link focusBranch} — see {@link FOCUS_BRANCH_SENTENCE}. `undefined` exactly when {@link focusBranch} is. */
  readonly focusReason?: string;
  /** Which of the second-course admission rule's two doors opened {@link secondCourse} — see `findings/precommitment-focus-second-course.md` (a). `undefined` unless a second course was admitted. */
  readonly secondCourseDoor?: 'deficit' | 'urgency';
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
  const {
    rows: allRows,
    instruments,
    replay,
    durations,
    asOf,
    budgetSeconds,
    arrivalDays,
    relatedConceptKeys,
    assessmentContext,
    courses: courseFilter,
    conceptIds: conceptIdFilter,
    allocation,
  } = input;
  const focusPolicy = input.focusPolicy ?? 'every-course';

  // C7.9 containment co-presence (`[SESS-11]`), over the WHOLE candidate
  // pool and before [STEER-1]'s course/topic filter — see the doc above
  // `applyContainmentCoPresence` for why this mirrors `session/build.ts`'s
  // own ordering (containment before `composeQueue`'s `filter`).
  const containment = applyContainmentCoPresence(allRows, input.relations ?? []);

  // [STEER-1]: the course-or-topic input, applied before any allocation
  // work so shares/forced-courses/obligation classes are all computed over
  // exactly the scope she asked about — see the field docs above.
  const rows =
    courseFilter === undefined && conceptIdFilter === undefined
      ? containment.kept
      : containment.kept.filter(
          (row) =>
            (courseFilter === undefined || courseFilter.includes(row.course)) &&
            (conceptIdFilter === undefined || conceptIdFilter.includes(row.conceptKey)),
        );

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
      // ARRIVE-1: `undefined` map or missing entry both collapse to `null` —
      // "no signal", not "arrived at epoch 0" — see `ComposeSessionRowsInput`.
      arrivalDay: arrivalDays?.get(row.conceptKey) ?? null,
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

  // `[D-244]` (`[FOCUS-3]`, `ol-egov.137.2`): `focusPolicy !== 'every-course'`
  // replaces the ordinary course-by-course budgeted passes below entirely —
  // see `composeFocusedSelection`'s own doc for why the two rules must never
  // both run. `focusResult` is `undefined` only when there is no eligible
  // course at all (`courses.length === 0`), in which case the ordinary path
  // below is taken instead — it produces the identical empty result in that
  // one degenerate case (every helper it calls is a no-op over an empty
  // `byCourse`), so this is not a silent fallback to different behaviour.
  const focusResult: FocusedSelectionResult | undefined =
    focusPolicy === 'every-course'
      ? undefined
      : composeFocusedSelection(
          focusPolicy,
          byCourse,
          courses,
          courseFilter,
          allocation,
          budgetSeconds,
          asOf,
          relatedConceptKeys,
          assessmentContext,
          arrivalDays,
        );

  let shares: ReadonlyMap<string, number>;
  let forced: readonly string[];
  let budgets: ReadonlyMap<string, number>;
  let chosen: ClassifiedRow[];
  let chosenKeys: ReadonlySet<string>;

  if (focusResult !== undefined) {
    shares = focusResult.shares;
    // Item 5: the floor is not paid per session, so nothing is "forced" a
    // guaranteed slice THIS session under a focus policy — the window
    // accounting (service-side) carries what is owed instead. See
    // `composeFocusedSelection`'s doc.
    forced = [];
    budgets = focusResult.budgets;
    chosen = [...focusResult.chosen];
    chosenKeys = new Set(chosen.map((c) => c.row.conceptKey));
  } else {
    // `ol-v7r5.17` [ALLOC-2]: a real allocation (non-empty) replaces both the
    // interim proportional share AND this module's own local C5.6
    // floor-forcing, wholesale — see the module doc's "Two-level allocation"
    // section for why the two floor mechanisms must never compound. Absent or
    // empty falls back to today's pre-ALLOC-2 behaviour unchanged.
    if (allocation !== undefined && allocation.length > 0) {
      shares = new Map(allocation.map((entry) => [entry.courseId, entry.share]));
      forced = [];
      budgets = allocationSharesToSeconds(allocation, budgetSeconds).secondsByCourseId;
    } else {
      shares = proportionalCourseShares(byCourse);
      forced = forcedCoursesFor(byCourse, asOf, courses.length);
      budgets = courseBudgetsFor(courses, budgetSeconds, shares, forced);
    }

    const chosenRows: ClassifiedRow[] = [];
    const chosenKeySet = new Set<string>();
    let spent = 0;

    // Pass 1: course by course (alphabetical — never by score, XCRS-1), each
    // capped at its own budget.
    for (const course of [...courses].sort()) {
      const cap = spent + (budgets.get(course) ?? 0);
      for (const c of [...(byCourse.get(course) ?? [])].sort(overdueFirst)) {
        if (spent + c.cost > cap) continue;
        chosenRows.push(c);
        chosenKeySet.add(c.row.conceptKey);
        spent += c.cost;
      }
    }
    // Pass 2: whatever a course's own budget could not absorb, in the same
    // order, against whatever of the session budget remains.
    for (const c of classified
      .filter((c) => !chosenKeySet.has(c.row.conceptKey))
      .sort(overdueFirst)) {
      if (spent + c.cost > budgetSeconds) continue;
      chosenRows.push(c);
      chosenKeySet.add(c.row.conceptKey);
      spent += c.cost;
    }
    chosen = chosenRows;
    chosenKeys = chosenKeySet;
  }

  const orderedBlocks = blockByCoursePresentation(
    chosen,
    relatedConceptKeys,
    assessmentContext,
    arrivalDays,
    asOf,
  );
  const orderedRows = orderedBlocks.map((c) => c.row);
  const overflow = buildOverflow(classified, chosenKeys);
  // Keyed over the CHOSEN set only (`orderedBlocks`, same rows as
  // `orderedRows`) — see `ComposeSessionRowsResult.obligationClasses`'s doc.
  const obligationClasses = new Map<string, ObligationClass>(
    orderedBlocks.map((c) => [c.row.conceptKey, c.klass]),
  );

  return {
    orderedRows,
    overflow,
    courseShares: shares,
    forcedCourses: forced,
    obligationClasses,
    courseSeconds: budgets,
    containmentDropped: containment.dropped,
    // `[FOCUS-3]`: byte-identical to before this bead when the caller omits
    // `focusPolicy` entirely — the field is echoed only when the caller
    // explicitly supplied one (even `'every-course'` explicitly), never
    // synthesised from the default, so a caller reading
    // `Object.keys(result)` sees no new field unless it opted in.
    ...(input.focusPolicy !== undefined ? { focusPolicy } : {}),
    ...(focusResult !== undefined
      ? {
          dominantCourse: focusResult.dominantCourse,
          ...(focusResult.secondCourse !== undefined
            ? { secondCourse: focusResult.secondCourse }
            : {}),
          focusBranch: focusResult.focusBranch,
          focusReason: focusResult.focusReason,
          ...(focusResult.secondCourseDoor !== undefined
            ? { secondCourseDoor: focusResult.secondCourseDoor }
            : {}),
        }
      : {}),
  };
}

export interface BuildComposedStudySessionInput
  // `obligationClasses` is omitted for the same reason `order`/`rows` are:
  // it is derived from `composeSessionRows` below, never a caller input —
  // see `buildComposedStudySession`'s own override of it. `schedulerStates`
  // ([SESS-7], `[D-240]` item 2) is omitted for exactly that reason too: this
  // input already carries `replay`, and the fill's map is that replay folded
  // to its states, so a caller able to pass a second, possibly-disagreeing one
  // is a defect surface rather than a feature. `courseBudgetSeconds`
  // ([SESS-9], `ol-2zfj.77`) joins them on the same argument: this input
  // already carries `allocation`, and the fill's per-course seconds are that
  // allocation converted by A2.5's rule, so a caller able to pass a second,
  // possibly-disagreeing set of seconds could silently compose against a share
  // the selection above never used.
  extends Omit<
    BuildStudySessionInput,
    'order' | 'rows' | 'obligationClasses' | 'schedulerStates' | 'courseBudgetSeconds'
  > {
  readonly rows: readonly GapRow[];
  /** `replaySchedulerStates(entries, scheduler)` — see `ComposeSessionRowsInput.replay`. */
  readonly replay: ReplayResult;
  /** ARRIVE-1 — see `ComposeSessionRowsInput.arrivalDays`, passed straight through. */
  readonly arrivalDays?: ReadonlyMap<string, CalendarDay>;
  /** F2.19 — see `ComposeSessionRowsInput.relatedConceptKeys`, passed straight through. */
  readonly relatedConceptKeys?: ReadonlyMap<string, ReadonlySet<string>>;
  /** F2.19 — see `ComposeSessionRowsInput.assessmentContext`, passed straight through. */
  readonly assessmentContext?: ReadonlyMap<VaultPath, AssessmentGroupingContext>;
  /** [STEER-1] — see `ComposeSessionRowsInput.courses`, passed straight through. */
  readonly courses?: readonly string[];
  /** [STEER-1] — see `ComposeSessionRowsInput.conceptIds`, passed straight through. */
  readonly conceptIds?: readonly string[];
  /** `ol-v7r5.17` [ALLOC-2] — see `ComposeSessionRowsInput.allocation`, passed straight through. */
  readonly allocation?: readonly StudyPlanAllocationEntry[];
  /** `[D-244]` (`[FOCUS-3]`) — see `ComposeSessionRowsInput.focusPolicy`, passed straight through. Defaults to `'every-course'`. */
  readonly focusPolicy?: FocusPolicy;
  /** C7.9 (`[SESS-11]`) — see `ComposeSessionRowsInput.relations`, passed straight through. */
  readonly relations?: readonly ConceptRelation[];
}

/**
 * [STEER-1] (`ol-imqy`, `[D-076]` round 2 "Can she steer it?"): the single
 * request shape carrying all three steering inputs the ruling makes
 * first-class on ONE path — the time she has, a course or topic, and a
 * stated interest (today's only proxy: front-lifting one named concept,
 * `focusConceptName`). A caller builds ONE object of this shape and hands it
 * to {@link buildComposedStudySession} unmodified.
 *
 * It is ALSO, unmodified, a valid `filter` for `composeQueue`
 * (`../queue/compose.js`): `QueueFilter`'s `courses`/`conceptIds` are a
 * structural subset of this type, and `../queue/types.ts` documents that
 * compatibility explicitly rather than leaving it to be discovered. This is
 * deliberately plain data with no row-shape coupling (unlike `ClassifiedRow`
 * or `QueueItem` — see `../queue/block-order.ts`'s module doc for why THOSE
 * restate rather than share a type across this exact boundary); a type with
 * no row-shape to restate has nothing that convention protects, so it is
 * shared once instead.
 */
export type SessionSteeringRequest = Pick<
  BuildComposedStudySessionInput,
  'budgetMinutes' | 'courses' | 'conceptIds' | 'focusConceptName'
>;

export interface ComposedStudySession {
  /**
   * Carries the same per-concept classification as {@link obligationClasses}
   * below, already folded onto each item as its own `obligationClass` — see
   * `StudySessionItem.obligationClass`'s doc.
   */
  readonly model: StudySessionModel;
  /** NOT a student-visible surface — see the module doc's F6.7 section. */
  readonly overflow: readonly ObligationOverflowEntry[];
  readonly courseShares: ReadonlyMap<string, number>;
  readonly forcedCourses: readonly string[];
  /**
   * IS a student-visible signal, unlike {@link overflow} — see
   * `ComposeSessionRowsResult.obligationClasses`'s doc and the module doc's
   * "Per-item obligation class" section. Surfaced here too (not only on
   * `model.items`) for a caller that wants the composition-level map without
   * walking every item.
   */
  readonly obligationClasses: ReadonlyMap<string, ObligationClass>;
  /**
   * C7.9 containment co-presence (`[SESS-11]`) — see
   * `ComposeSessionRowsResult.containmentDropped`. Empty whenever no
   * `relations` were supplied, which is every real caller today. Optional
   * for the same fixture-compatibility reason as that field;
   * `buildComposedStudySession` always sets it.
   */
  readonly containmentDropped?: readonly GapRow[];
  /** `[D-244]` (`[FOCUS-3]`) — see `ComposeSessionRowsResult.focusPolicy`; optional for the same fixture-compatibility reason. `buildComposedStudySession` always sets it. */
  readonly focusPolicy?: FocusPolicy;
  /** See `ComposeSessionRowsResult.dominantCourse`. */
  readonly dominantCourse?: string;
  /** See `ComposeSessionRowsResult.secondCourse`. */
  readonly secondCourse?: string;
  /** See `ComposeSessionRowsResult.focusBranch`. */
  readonly focusBranch?: FocusBranch;
  /** See `ComposeSessionRowsResult.focusReason`. */
  readonly focusReason?: string;
  /** See `ComposeSessionRowsResult.secondCourseDoor`. */
  readonly secondCourseDoor?: 'deficit' | 'urgency';
}

/**
 * `ReplayResult.states` folded to the `instrumentId -> SchedulerState` map
 * `buildStudySession`'s serving rule takes ([SESS-7], `[D-240]` item 2).
 * Absence stays absence: an instrument never rated is missing from `replay`
 * and stays missing here, which the rule reads as "never reviewed".
 */
function schedulerStatesOf(replay: ReplayResult): ReadonlyMap<string, SchedulerState> {
  const states = new Map<string, SchedulerState>();
  for (const [instrumentId, replayed] of replay.states) {
    states.set(instrumentId, replayed.state);
  }
  return states;
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
    ...(input.arrivalDays !== undefined ? { arrivalDays: input.arrivalDays } : {}),
    ...(input.relatedConceptKeys !== undefined
      ? { relatedConceptKeys: input.relatedConceptKeys }
      : {}),
    ...(input.assessmentContext !== undefined
      ? { assessmentContext: input.assessmentContext }
      : {}),
    ...(input.courses !== undefined ? { courses: input.courses } : {}),
    ...(input.allocation !== undefined ? { allocation: input.allocation } : {}),
    ...(input.conceptIds !== undefined ? { conceptIds: input.conceptIds } : {}),
    ...(input.focusPolicy !== undefined ? { focusPolicy: input.focusPolicy } : {}),
    ...(input.relations !== undefined ? { relations: input.relations } : {}),
  });

  const model = buildStudySession({
    ...input,
    rows: composed.orderedRows,
    order: 'given',
    // Derived from the composition just run, not a caller input — see
    // `BuildComposedStudySessionInput`'s Omit and its comment above.
    obligationClasses: composed.obligationClasses,
    // [SESS-7] (`[D-240]` item 2): the same `replay` this composition already
    // classified obligations from, folded to the per-instrument states the
    // fill's serving rule reads — never a second read of the log, and never a
    // second scheduler.
    schedulerStates: schedulerStatesOf(input.replay),
    // [SESS-9] (`ol-2zfj.77`): the seconds the selection above was capped by,
    // handed to the fill so C5.5's "fills each course's seconds from that
    // course's own ranking" is true of the instruments served and not only of
    // the concepts selected. Derived from the composition just run, never a
    // caller input — the same reason `obligationClasses` and `schedulerStates`
    // are omitted from `BuildComposedStudySessionInput`.
    courseBudgetSeconds: composed.courseSeconds,
  });

  return {
    model,
    overflow: composed.overflow,
    courseShares: composed.courseShares,
    forcedCourses: composed.forcedCourses,
    obligationClasses: composed.obligationClasses,
    ...(composed.containmentDropped !== undefined
      ? { containmentDropped: composed.containmentDropped }
      : {}),
    ...(composed.focusPolicy !== undefined ? { focusPolicy: composed.focusPolicy } : {}),
    ...(composed.dominantCourse !== undefined ? { dominantCourse: composed.dominantCourse } : {}),
    ...(composed.secondCourse !== undefined ? { secondCourse: composed.secondCourse } : {}),
    ...(composed.focusBranch !== undefined ? { focusBranch: composed.focusBranch } : {}),
    ...(composed.focusReason !== undefined ? { focusReason: composed.focusReason } : {}),
    ...(composed.secondCourseDoor !== undefined
      ? { secondCourseDoor: composed.secondCourseDoor }
      : {}),
  };
}

/**
 * F2.17/C5.8's "outran the target" extension
 * (`docs/dev/one-assembly-path.md` §3b, olea-service; `[SESS-11]`,
 * `ol-egov.132.12`).
 *
 * C5.8's own text: "the list changes only by her own action (finishing,
 * leaving, or outrunning the target under the same plan's shares), never by
 * the tool." A frozen `ComposedStudySession` has no way to grow itself — this
 * is the missing move. It calls {@link buildComposedStudySession} again, with
 * `input` unmodified apart from `budgetMinutes` (the caller's own wider
 * number — how far she wants to keep going is a product judgement this
 * function does not make, the same posture `./reentry.js`'s
 * `composeReentrySession` already takes for "how much smaller"), so any
 * caller that hands over the SAME `courses`/`conceptIds`/`allocation`/
 * `focusPolicy` it used to build `previous` gets "the same plan's shares"
 * (C5.5) by construction — identity, not a re-derivation — rather than this
 * function inventing a pinned-shares mechanism of its own. This is the same
 * discipline `composeReentrySession` already states for its own variant call
 * ("this module contains no second selection mechanism of its own"), applied
 * to growth instead of shrinkage.
 *
 * **Never reorders, never drops, never duplicates** — the same three-word
 * contract `packages/plugin/src/review/queue-adapter.ts`'s
 * `FrozenReviewQueue.extend` already states for the queue path (`extend`'s
 * own doc: "grow, never replace, never reorder, never duplicate"). `previous`'s
 * own items are returned byte-identical and in their existing positions;
 * only items the wider composition offers that are not already among them
 * (matched by `instrumentId`, the same key `extend` matches on) are appended,
 * in the order the wider fill produced them, with `position` renumbered to
 * continue the sequence.
 *
 * **The gap this closes.** `ComposedStudySession.model.leftOut`/`.overflow`
 * are per-CONCEPT (`StudySessionOmission`/`ObligationOverflowEntry`) — there
 * was nothing per-instrument to thread through `extend`'s
 * `instrument.instrumentId` matching, which is exactly why re-running the
 * same budget found nothing new (`ol-egov.132.12`'s own bead, confirmed
 * empirically against `packages/plugin/test/review/open-session.spec.ts`'s
 * "continue extends" scenario). Recomposing at a wider budget and diffing by
 * `instrumentId` produces the missing per-instrument view without inventing
 * a second per-instrument bookkeeping structure inside this module.
 *
 * **Reachability.** `packages/plugin/src/review/open-session.ts` and
 * `packages/plugin/src/main.ts` (row 6/`ol-egov.132.6`'s owned paths) are the
 * production callers this needs — wiring `FrozenReviewQueue`-shaped growth
 * for the composed session's holder onto this function is filed as a note on
 * that bead rather than built here, across this lane's file-ownership
 * boundary (see `[SESS-11]`'s own close evidence).
 */
export function extendComposedStudySession(
  input: BuildComposedStudySessionInput,
  previous: ComposedStudySession,
): readonly StudySessionItem[] {
  const widened = buildComposedStudySession(input);
  const alreadyServed = new Set(previous.model.items.map((item) => item.instrumentId));
  const appended = widened.model.items.filter((item) => !alreadyServed.has(item.instrumentId));
  if (appended.length === 0) return previous.model.items;
  return [
    ...previous.model.items,
    ...appended.map((item, index) => ({
      ...item,
      position: previous.model.items.length + index + 1,
    })),
  ];
}
