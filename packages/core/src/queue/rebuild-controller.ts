/**
 * `RBLD-1` (`ol-o7hr`) — component register row 3.6's controller: the queue
 * (and study-session) rebuild trigger set, which had no owner anywhere in the
 * codebase (`plan/refresh.ts`'s own module doc explicitly declines it: "that
 * is a scheduling policy belonging to whatever owns the reconnection event,
 * and core has no clock. This function refreshes when it is called.").
 *
 * ## What is already ruled, and what this module is
 *
 * The shape below is not a new design — it is `[D-076]`, round 4, "When does
 * the queue rebuild?" (`docs/archive/foundation/round-4-the-machinery.html`,
 * ratified by the umbrella decision; index row "When the queue rebuilds"),
 * made executable:
 *
 * - **Recompute on entry to a sitting; hold steady for its duration.** A
 *   queue that re-ranks after every answer cannot be planned against — she
 *   finishes one thing and the next changes for reasons she cannot see.
 * - **Between sittings, recompute only on a named trigger**: new material
 *   landing, an assessment date passing, a day boundary. **Never on a
 *   timer** — a timer fires when nothing has changed and misses the moment
 *   something did.
 * - **Two health checks**: a recompute producing an identical ranking is
 *   wasted work (counted, never silently passed); a sitting whose
 *   composition changes mid-session is a bug.
 *
 * `[D-076]` left the hold-cap **value** and what happens once a sitting goes
 * stale genuinely open (the bead's own "UNDECIDED" section said so
 * explicitly). Both are now ruled by `[D-162]` (`ol-cidn`), replacing this
 * module's original fixed-duration hold cap: staleness is a **material
 * change to the sitting's own composition** — never elapsed time — gated by
 * one declared minutes-scale idle threshold that decides only *when*
 * staleness is evaluated, never *whether* it is stale. When the condition
 * fires, this module surfaces `'sitting-stale'` and the caller **ends the
 * sitting** (completed reviews keep their outcomes; the remainder competes
 * again in a fresh composition — recomposing the tail in place is ruled
 * out). See {@link SittingStalenessReason}, {@link evaluateSittingStaleness}
 * and {@link DEFAULT_SITTING_IDLE_THRESHOLD_MINUTES}'s own docs.
 *
 * ## Why this is a controller and not a composer
 *
 * Every other module in `study-session/` and `queue/` is a pure function of
 * `(candidates, now, ...)` with no memory between calls — `queue/compose.ts`'s
 * own doc: "reads no clock, opens no file and holds no state between
 * sessions." This module is the deliberate exception the register calls for:
 * component 3.6 sits *above* that chain as "a controller over purely local
 * events... carrying no policy beyond the idle threshold it is handed," and
 * a controller's whole job is remembering what happened last time.
 *
 * It is still pure in the sense every other module here is pure: no clock
 * read internally (`now` is always the caller's), no I/O, no import of
 * `obsidian` (INV-1) — every "event" (material landing, an assessment date
 * passing, a day boundary, elapsed time) arrives as a caller-supplied fact,
 * because only the client has the vault change stream, the review log and a
 * clock to read them from. This module is the seam those facts are handed
 * to, not the thing that watches for them.
 *
 * ## The material-landing trigger needs no debounce of its own
 *
 * The register's row flags "possibly a debounce on material landing" as an
 * open constant. It needs none: `TRG-1` (`ol-84my`) already ratified a
 * 3-minute enqueue debounce upstream of "material landing" itself (before
 * concept extraction even runs), per
 * `docs/Olea_ai_workload_and_cost_model.md`. This module's
 * `materialLandedSinceLastRebuild` input is downstream of that — it observes
 * whether material has *finished* landing, already debounced — so adding a
 * second debounce here would be re-litigating a ratified number rather than
 * declaring a new one. There is exactly one number in this module:
 * {@link DEFAULT_SITTING_IDLE_THRESHOLD_MINUTES}.
 *
 * ## No production caller yet (`[D-072]` clause 5)
 *
 * `packages/plugin/src/session-builder/view.ts` calls `refresh()` →
 * `deps.load()` on every render with no freeze at all today — every
 * `SessionBuilderView.refresh()` recomputes from scratch — and
 * `packages/plugin/src/review/queue-adapter.ts` (owned by a different lane's
 * `queue/`-consuming surface) composes the review queue the same way. Wiring
 * either caller to hold a `SittingState` across renders, and to source the
 * three trigger facts from the vault change stream / review log / local
 * clock, is client-surface work outside this lane's owned paths
 * (`packages/core/src/study-session/`, `packages/core/src/queue/`) — filed
 * as a follow-up (see `ol-o7hr`'s notes) rather than built here silently.
 */

import type { CalendarDay } from '../today/calendar-day.js';
import { isCalendarDay } from '../today/calendar-day.js';

// ---------------------------------------------------------------------------
// The freeze contract: hold steady for the duration of a sitting.
// ---------------------------------------------------------------------------

/**
 * Whether a rebuild controller currently has a sitting open. `'idle'` is
 * "between sittings" — the state {@link decideRebuild} evaluates trigger
 * facts in; `'active'` is a sitting in progress — frozen, by construction,
 * to whatever `items` it was entered with.
 *
 * `T` is deliberately generic: this module fronts both `queue/compose.ts`'s
 * `ComposedQueue` and `study-session/build.ts`'s `StudySessionModel` (or
 * `study-session/compose.ts`'s `ComposedStudySession`) — 3.6 is one
 * controller above both chains (component register's diagram), not a
 * second copy per consumer.
 */
export type SittingState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'active'; readonly enteredAt: Date; readonly items: T };

/** The shared "no sitting open" value — every controller starts here. */
export const IDLE_SITTING: SittingState<never> = Object.freeze({ status: 'idle' });

/**
 * Recompute on entry to a sitting (`[D-076]`, round 4): the caller has
 * already built `items` (by calling `composeQueue`, `buildStudySession` or
 * `buildComposedStudySession`); this just starts the freeze clock over it.
 *
 * Always transitions to `'active'`, even from an already-active state — a
 * caller re-entering mid-sitting (e.g. resuming after the app was closed and
 * reopened without an explicit exit) is choosing to start a new sitting, and
 * this module has no way to tell that apart from "she finished and started
 * another" without a fact it is not handed. Distinguishing those is exactly
 * the "UNDECIDED: whether a mid-session rebuild is ever permitted" question
 * the register leaves open — the caller decides whether to call this at all,
 * not this function.
 */
export function enterSitting<T>(now: Date, items: T): SittingState<T> {
  return { status: 'active', enteredAt: now, items };
}

/** She finished. Releases the freeze — the next {@link decideRebuild} call evaluates triggers again rather than holding. */
export function exitSitting<T>(): SittingState<T> {
  return { status: 'idle' };
}

// ---------------------------------------------------------------------------
// Sitting staleness: an event about the material, never a clock.
// [D-162] (`ol-cidn`) replaces the interim fixed-duration hold cap with
// this — C5.8's "One limit on holding still, and it is an event, never a
// clock."
// ---------------------------------------------------------------------------

/**
 * Every material-change kind C5.8 (as amended by `[D-162]`) names as capable
 * of expiring a frozen sitting, scoped to **that sitting's own composition**
 * — never a fact about the world in general. A rebuild decision carrying one
 * or more of these must be able to truthfully finish the sentence "your list
 * changed because..."; a duration never could, which is the whole reason the
 * fixed hold cap this replaces is gone.
 */
export type SittingStalenessReason =
  | 'items-due-in-scope'
  | 'material-arrived-in-scope'
  | 'assessment-proximity-band-crossed-in-scope';

/**
 * The three material-change facts {@link evaluateSittingStaleness} consults,
 * every one scoped to the frozen sitting's own composition (its courses, its
 * concepts) rather than to the vault at large — a change outside that scope
 * is not a change to the promise this sitting made her. There is deliberately
 * no elapsed-duration field here for the same reason {@link RebuildTriggerInput}
 * has none: `[D-162]` rules a plan-version tick that produced no materially
 * different answer for this sitting's scope is not a trigger either, so a
 * caller must resolve "did this recompute actually change my scope" before
 * setting these fields, not hand this function a version counter to guess
 * from.
 */
export interface SittingStalenessInput {
  /** New items came due in one of the sitting's own courses since it was entered. */
  readonly itemsDueInScope: boolean;
  /** New material arrived in the sitting's own scope since it was entered. */
  readonly materialArrivedInScope: boolean;
  /** An assessment the sitting's composition cares about crossed a proximity band since it was entered. */
  readonly assessmentProximityBandCrossedInScope: boolean;
}

/** {@link evaluateSittingStaleness}'s result. `reasons` is empty exactly when `stale` is `false`. */
export interface SittingStalenessResult {
  readonly stale: boolean;
  /** Every material-change kind that fired, in the fixed order {@link SittingStalenessReason} declares them — enough to finish "your list changed because...". */
  readonly reasons: readonly SittingStalenessReason[];
}

/**
 * Whether a frozen sitting's own composition has materially changed. Pure
 * and total — no clock read here at all; that is {@link decideRebuild}'s
 * idle-threshold gate, which decides only *when* this function may be
 * consulted, never folds into *what* it answers.
 */
export function evaluateSittingStaleness(input: SittingStalenessInput): SittingStalenessResult {
  const reasons: SittingStalenessReason[] = [];
  if (input.itemsDueInScope) reasons.push('items-due-in-scope');
  if (input.materialArrivedInScope) reasons.push('material-arrived-in-scope');
  if (input.assessmentProximityBandCrossedInScope)
    reasons.push('assessment-proximity-band-crossed-in-scope');
  return { stale: reasons.length > 0, reasons };
}

/**
 * DECLARED (never fitted) — the residual clock `[D-162]` admits rather than
 * smuggles. It gates **when** a frozen sitting's staleness may be evaluated
 * (at her next interaction, or the tool's own periodic recompute, once this
 * much time has passed since she last touched the sitting) and **never
 * whether** it is stale — {@link evaluateSittingStaleness}'s material-change
 * condition does all of that work.
 *
 * **Plain-English defence** (the ruling's own words, `ol-cidn`'s close
 * reason): "long enough that coming back is a return, not a continuation."
 * Fifteen minutes is short enough to still be "she paused to think" — a
 * pause well inside any ordinary read-then-answer rhythm this product asks
 * of her — and long enough that resuming past it reads as coming back to the
 * sitting rather than continuing an unbroken train of thought. It needs no
 * fitting and no corpus: any value a reasonable person would call "she
 * stepped away" satisfies the ruling, because the material-change condition
 * — not this number — is what actually decides staleness.
 */
export const DEFAULT_SITTING_IDLE_THRESHOLD_MINUTES = 15;

const MS_PER_MINUTE = 60_000;

/** {@link DEFAULT_SITTING_IDLE_THRESHOLD_MINUTES} in milliseconds, since every clock comparison here works in `Date` instants. */
export const DEFAULT_SITTING_IDLE_THRESHOLD_MS =
  DEFAULT_SITTING_IDLE_THRESHOLD_MINUTES * MS_PER_MINUTE;

// ---------------------------------------------------------------------------
// Between sittings: named triggers, never a timer.
// ---------------------------------------------------------------------------

/** Why a between-sittings rebuild fired (`[D-076]`, round 4's named trigger set — never a timer). */
export type RebuildTriggerReason = 'material-landed' | 'assessment-date-passed' | 'day-boundary';

/**
 * The three named facts {@link evaluateRebuildTrigger} consults — every one
 * a caller-observed fact about the world, never a duration or an interval.
 * There is deliberately no "milliseconds since last rebuild" field: that
 * would be exactly the timer the ruling forbids ("a timer fires when nothing
 * has changed and misses the moment something did").
 */
export interface RebuildTriggerInput {
  /** The calendar day `items` was last (re)built for. */
  readonly lastRebuiltDay: CalendarDay;
  /** Today, from the caller's own local clock (F6.1's local-day discipline — `today/calendar-day.ts`). */
  readonly today: CalendarDay;
  /**
   * Whether material has landed, in scope, since the last rebuild —
   * already debounced upstream by `TRG-1` (`ol-84my`'s 3-minute enqueue
   * debounce). This module does not re-debounce it; see the module doc.
   */
  readonly materialLandedSinceLastRebuild: boolean;
  /** Whether an assessment date this queue/session's scope cares about has passed since the last rebuild. */
  readonly assessmentDatePassedSinceLastRebuild: boolean;
}

/** {@link evaluateRebuildTrigger}'s result. `reasons` is empty exactly when `shouldRebuild` is `false`. */
export interface RebuildTriggerResult {
  readonly shouldRebuild: boolean;
  /** Every named trigger that fired, in the fixed order {@link RebuildTriggerReason} declares them — for the wasted-rebuild health check to attribute a rebuild to. */
  readonly reasons: readonly RebuildTriggerReason[];
}

/**
 * Whether a between-sittings rebuild is due, and why. Pure and total over
 * well-formed input; throws on a `lastRebuiltDay`/`today` that is not a
 * `YYYY-MM-DD` day, the same caller-error discipline `buildStudySession`
 * uses for its own `asOf`.
 *
 * **This function is the whole of "never on a timer."** It has no clock
 * parameter at all beyond the two calendar-day labels a day-boundary check
 * needs — there is no elapsed-duration input anywhere in this signature for
 * a future edit to accidentally wire into a periodic poll.
 */
export function evaluateRebuildTrigger(input: RebuildTriggerInput): RebuildTriggerResult {
  if (!isCalendarDay(input.lastRebuiltDay)) {
    throw new Error(
      `evaluateRebuildTrigger: lastRebuiltDay must be a YYYY-MM-DD day, got ${JSON.stringify(input.lastRebuiltDay)}`,
    );
  }
  if (!isCalendarDay(input.today)) {
    throw new Error(
      `evaluateRebuildTrigger: today must be a YYYY-MM-DD day, got ${JSON.stringify(input.today)}`,
    );
  }
  const reasons: RebuildTriggerReason[] = [];
  if (input.materialLandedSinceLastRebuild) reasons.push('material-landed');
  if (input.assessmentDatePassedSinceLastRebuild) reasons.push('assessment-date-passed');
  if (input.today !== input.lastRebuiltDay) reasons.push('day-boundary');
  return { shouldRebuild: reasons.length > 0, reasons };
}

/**
 * Whether any date in `dueDays` counts as "an assessment date passing since
 * the last rebuild" — strictly after `lastRebuiltDay` and on or before
 * `today`. Lexical comparison, not `daysBetween`: `CalendarDay` strings sort
 * chronologically by construction (`today/calendar-day.ts`'s own doc), and a
 * caller already has plain `YYYY-MM-DD` due dates (`AssessmentRecord.due`) —
 * no `Date` round-trip needed for a same-shape comparison.
 *
 * A date already past at the last rebuild fired this trigger then, not now
 * (`day <= lastRebuiltDay` is excluded); a date still in the future past
 * `today` has not happened yet (`day > today` is excluded). Both read as
 * "no" on purpose — this answers "did one pass since we last looked", not
 * "is one due soon" (F4.7's countdown, computed elsewhere and unrelated to
 * this trigger).
 */
export function assessmentDatePassedSince(
  dueDays: readonly CalendarDay[],
  lastRebuiltDay: CalendarDay,
  today: CalendarDay,
): boolean {
  return dueDays.some((day) => day > lastRebuiltDay && day <= today);
}

// ---------------------------------------------------------------------------
// The one decision: hold, rebuild, or end the stale sitting.
// ---------------------------------------------------------------------------

/**
 * What {@link decideRebuild} decided. A caller acts on this and nothing
 * else — it never calls `composeQueue`/`buildStudySession` itself, the same
 * "this module does not rank/compose" discipline every other file in these
 * two directories holds.
 */
export type RebuildDecision =
  | { readonly action: 'hold' }
  | {
      /**
       * The frozen sitting's own composition has materially changed
       * (`[D-162]`) — `reasons` names which of {@link SittingStalenessReason}
       * fired, enough for a caller to truthfully finish "your list changed
       * because...". **The sitting ENDS on this decision** — completed
       * reviews keep their outcomes, the caller must not recompose the
       * unreviewed remainder in place (recompose-the-tail is ruled out); the
       * ordinary "build a fresh sitting" path takes over instead.
       */
      readonly action: 'sitting-stale';
      readonly reasons: readonly SittingStalenessReason[];
    }
  | { readonly action: 'rebuild'; readonly reasons: readonly RebuildTriggerReason[] }
  | { readonly action: 'no-rebuild' };

export interface DecideRebuildInput {
  /** The caller's own clock reading — never read internally (INV-1/§7.1 discipline: no clock inside `packages/core`). */
  readonly now: Date;
  /**
   * How long a sitting may sit idle before its own composition is even
   * checked for staleness. Defaults to
   * {@link DEFAULT_SITTING_IDLE_THRESHOLD_MS} — see that constant's doc.
   * Gates **when** {@link evaluateSittingStaleness} runs, never **whether**
   * its answer is stale.
   */
  readonly idleThresholdMs?: number;
  /** Consulted only when `state.status === 'idle'` — an active sitting never evaluates the between-sittings trigger set, by the freeze contract. */
  readonly trigger: RebuildTriggerInput;
  /**
   * Consulted only when `state.status === 'active'` AND `now` has run past
   * `idleThresholdMs` since `state.enteredAt` — the freeze holds
   * unconditionally before that, regardless of what this carries.
   */
  readonly staleness: SittingStalenessInput;
}

/**
 * The whole controller. `state.status === 'active'` holds steady
 * unconditionally — the freeze contract — until `now` has run past the idle
 * threshold since `state.enteredAt`, at which point (and only then) it
 * checks whether the sitting's own composition has materially changed via
 * {@link evaluateSittingStaleness}; a genuinely unchanged sitting keeps
 * holding regardless of how long it has sat idle. `state.status === 'idle'`
 * evaluates the three named between-sittings triggers via
 * {@link evaluateRebuildTrigger} and nothing else.
 *
 * Throws if `now` precedes `state.enteredAt` — a caller's clock going
 * backwards is a bug this function should not paper over by reporting a
 * negative elapsed time as "not yet idle."
 */
export function decideRebuild<T>(
  state: SittingState<T>,
  input: DecideRebuildInput,
): RebuildDecision {
  if (state.status === 'active') {
    const elapsedMs = input.now.getTime() - state.enteredAt.getTime();
    if (elapsedMs < 0) {
      throw new Error(
        `decideRebuild: now (${input.now.toISOString()}) precedes the sitting's own entry time (${state.enteredAt.toISOString()})`,
      );
    }
    const idleThresholdMs = input.idleThresholdMs ?? DEFAULT_SITTING_IDLE_THRESHOLD_MS;
    if (elapsedMs < idleThresholdMs) return { action: 'hold' };
    const staleness = evaluateSittingStaleness(input.staleness);
    return staleness.stale
      ? { action: 'sitting-stale', reasons: staleness.reasons }
      : { action: 'hold' };
  }
  const result = evaluateRebuildTrigger(input.trigger);
  return result.shouldRebuild
    ? { action: 'rebuild', reasons: result.reasons }
    : { action: 'no-rebuild' };
}

// ---------------------------------------------------------------------------
// Health check 1: a recompute producing an identical ranking is wasted work.
// ---------------------------------------------------------------------------

/**
 * One already-run rebuild: the ordered instrument ids the previous sitting
 * ended with, and what a trigger-justified recompute produced. Ids only,
 * never content (INV-3) — same discipline `checks/reentry-equality.ts`
 * states for the identical shape of comparison.
 */
export interface RebuildOutcomeCase {
  /** Opaque case id — never a real course code, concept name or note title (INV-3). */
  readonly id: string;
  readonly previousOrderedInstrumentIds: readonly string[];
  readonly nextOrderedInstrumentIds: readonly string[];
}

export interface RebuildWasteMeasured {
  readonly n: number;
  readonly wastedCount: number;
  readonly wastedRate: number;
  /** Case ids where the recompute reproduced the exact ranking it replaced. */
  readonly wasted: readonly string[];
}

/**
 * `CheckVerdict`'s own shape (`checks/types.ts`), reproduced rather than
 * imported as a value: this module lives inside this lane's owned paths
 * (`packages/core/src/queue/`), and `checks/index.ts` — the directory's
 * registration point — is a shared file this bead does not own. The shape
 * itself is a two-line interface with no logic to duplicate incorrectly;
 * wiring this into `checks/index.ts` alongside the others is filed as a
 * follow-up (`ol-o7hr`'s notes) rather than done here across an ownership
 * boundary.
 */
export interface RebuildWasteVerdict {
  readonly ok: boolean;
  readonly measured: RebuildWasteMeasured;
  readonly detail: string;
}

/**
 * Below this many already-run rebuilds, a rate is a handful of points, not a
 * distribution — the same floor `checks/knowledge-kind-distribution.ts`
 * declares as `MIN_SAMPLE_FOR_DISTRIBUTION_CHECK` for an identical shape of
 * question, reused here rather than re-derived.
 */
export const MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK = 20;

/**
 * DECLARED (never fitted). If the overwhelming majority of trigger-justified
 * rebuilds reproduce the exact ranking they replaced, the trigger set is
 * firing on changes that do not move the answer — the same "overwhelming
 * majority is presumed silent failure" bar `checks/knowledge-kind-distribution.ts`'s
 * `DOMINANT_KIND_SHARE_CEILING` already uses for the identical shape of
 * question (a batch collapsing onto one outcome). Nine in ten is that bar,
 * reused rather than re-derived for a second corpus.
 */
export const WASTED_REBUILD_RATE_CEILING = 0.9;

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Register row 3.6's first named health check: "a rebuild producing an
 * identical ranking is wasted work, so count and report them against a
 * declared rate rather than passing silently." Fails if the wasted rate is
 * at or above {@link WASTED_REBUILD_RATE_CEILING}, or if fewer than
 * {@link MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK} cases were supplied (N-013 — a
 * sweep that ran too little to be a distribution cannot report a clean
 * bill, the same rule every check in `checks/` already applies to its own
 * batch).
 *
 * Pure: takes the ALREADY-COMPUTED outcome of real rebuilds (a caller —
 * eventually the client wiring this controller drives, or a test) and
 * answers a yes/no question about the batch. Calls nothing in `queue/` or
 * `study-session/` itself.
 */
export function checkRebuildWasteRate(cases: readonly RebuildOutcomeCase[]): RebuildWasteVerdict {
  const wasted = cases
    .filter((c) => sameOrder(c.previousOrderedInstrumentIds, c.nextOrderedInstrumentIds))
    .map((c) => c.id);
  const wastedRate = cases.length === 0 ? 0 : wasted.length / cases.length;
  const measured: RebuildWasteMeasured = {
    n: cases.length,
    wastedCount: wasted.length,
    wastedRate,
    wasted,
  };

  if (cases.length < MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK) {
    return {
      ok: false,
      measured,
      detail: `${cases.length} case(s) supplied, below the ${MIN_REBUILD_SAMPLE_FOR_WASTE_CHECK}-case floor — a rate this small is a handful of points, not a distribution`,
    };
  }
  if (wastedRate >= WASTED_REBUILD_RATE_CEILING) {
    return {
      ok: false,
      measured,
      detail: `${wasted.length} of ${cases.length} rebuild(s) (${(wastedRate * 100).toFixed(1)}%) reproduced the exact ranking they replaced, at or above the ${(WASTED_REBUILD_RATE_CEILING * 100).toFixed(0)}% ceiling`,
    };
  }
  return {
    ok: true,
    measured,
    detail: `${wasted.length} of ${cases.length} rebuild(s) (${(wastedRate * 100).toFixed(1)}%) reproduced the exact ranking they replaced — below the ${(WASTED_REBUILD_RATE_CEILING * 100).toFixed(0)}% ceiling`,
  };
}
