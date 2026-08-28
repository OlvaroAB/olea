/**
 * The day loop (`ol-opmb.5` [TB-4]): `deriveClosedLoop`, replayed across many
 * days over ONE world, rather than at the single fixed instant every state in
 * `oracle-scenarios.ts` uses.
 *
 * ## Why this is a driver over `derive.ts`, not new machinery
 *
 * Every stage `deriveClosedLoop` calls is already pure and already takes an
 * injected `asOf`/`computedAt` (`derive.ts`'s own module doc). What was
 * missing was a caller that calls it once per simulated day, over a
 * GROWING PREFIX of `world.stream.entries` — "recompute mastery from the
 * events so far" — rather than once over the whole stream. `worldThroughDay`
 * below is the whole of that: it does not regenerate anything, it truncates.
 *
 * ## What "the next day's review events carrying the real plan version" means here
 *
 * `world.stream.entries` is fixed at generation time (`generateStream`'s own
 * module doc: physically consistent, deterministic, independent of any plan —
 * P5/C7.6 postdate it, and every entry's own `selectionContext.planVersion`
 * is `null` by the generator's frozen contract). This driver does not, and
 * must not, rewrite that field on the real records — doing so would fabricate
 * a fact the generator explicitly does not claim.
 *
 * What it CAN do honestly is report the association: for day D's plan (built
 * from everything through day D-1), which of the persona's ACTUAL next-day
 * events would have been selected under it. `TimelineDayResult.nextDayEvents`
 * is exactly that — the real entries dated the day after the cutoff,
 * reported alongside (never written into) the `planVersion` that governed
 * their day. That is what C7.6's field is *for*, shown across many days
 * rather than asserted for one (`ol-v0w4`'s worked example 3, extended).
 *
 * ## The queue's own clock
 *
 * `deriveClosedLoop`'s queue stage composes at `sessionInstant(candidates)` —
 * `WORKBENCH_NOW`, or the persona's latest due date, whichever is later — which
 * is right for `oracle-scenarios.ts`'s single fixed-instant states and wrong
 * here: composing every replayed day's queue at one fixed far-future instant
 * would make every earlier day look uniformly overdue. `derive.ts`'s
 * `OracleDeriveInput.queueNow` (added by this bead) is the seam; this driver
 * always sets it to the day being replayed.
 *
 * ## Anti-degeneracy, across time (Trap 2, extended)
 *
 * `derive.ts`'s `strugglingCourseReadsWorse` is Trap 2's single-instant
 * defence: a closed loop that stopped distinguishing its own inputs would
 * still "run" and still "look done". A snapshot cannot catch a loop that
 * FLATTENED — stopped moving, converged to a fixed point that flatters
 * itself — because a snapshot has nothing to compare against. The functions
 * below are that comparison, over one `OracleTimeline`:
 *
 *  - {@link queueCompositionVaries} — the composed queue is not the same set
 *    of instrument ids on every replayed day. LOAD-BEARING: `false` on the
 *    `empty-history` control (`test/timeline.spec.ts`), `true` for a persona
 *    who actually studies.
 *  - {@link masteryAdvancementOverTime} — the fraction of concepts at an
 *    advanced mastery state does not fall as more evidence accumulates.
 *    LOAD-BEARING for the same reason.
 *  - {@link planVersionChangesOverTime} — the plan's content hash actually
 *    moves. **NOT load-bearing on its own — a finding, not a nicety.**
 *    `rank.ts`'s `examProximityScore = 1/(1+daysUntilDue/halfLife)` is a
 *    continuous function of `asOf` alone, and `buildStudyPlan` hashes the
 *    ranking's own scores, so the plan's version drifts daily purely from
 *    calendar proximity to an assessment — true even for `empty-history`,
 *    who has zero review evidence ever (`test/timeline.spec.ts`'s own
 *    "FINDING" case). A changing `planVersion` therefore does NOT by itself
 *    distinguish a loop that responds to her evidence from one merely
 *    watching a clock tick. Kept because "what a plan version changing over
 *    time actually looks like" is the parent bead's own ask (C7.6) and is
 *    worth showing descriptively — the checks that actually catch a
 *    flattened loop are the two above, both of which hold flat on the SAME
 *    empty-history world where this one is (correctly, but unhelpfully) true.
 *
 * None of these are called from this driver's own render path — same
 * discipline as `strugglingCourseReadsWorse`: an assertion is a test's job,
 * not a pipeline stage's. `test/timeline.spec.ts` calls all four.
 *
 * ## N-015
 *
 * Every number this file produces is `synthetic-provisional`: a fabricated
 * persona replayed through the real scheduler and the real oracle chain.
 * "The plan changes sensibly over time" is a claim about OUR CODE (does the
 * pipeline actually respond to the evidence it is given) and is exactly what
 * this file is for. It is never a claim about how she actually studies, and
 * nothing here may be tuned from what it produces.
 */

import { createFsrsScheduler, type SchedulerState } from 'olea-core';
import type { SyntheticWorld } from '../synthetic-bridge.js';
import { deriveClosedLoop, type OracleDeriveResult, strugglingCourseReadsWorse } from './derive.js';

const DAY_MS = 86_400_000;

/** `addUtcDays('2026-10-17', 1) === '2026-10-18'`. UTC calendar arithmetic only — this package's worlds are always built at `utcOffset: '+00:00'` (see `oracle-scenarios.ts`'s own note on that). */
export function addUtcDays(day: string, delta: number): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * `world`, with `stream.entries` truncated to everything at or before the end
 * of `throughDate` (`YYYY-MM-DD`, inclusive). `curriculum`, `corpus` and
 * `stream.groundTruth` are untouched — the curriculum and corpus are
 * time-invariant constants (`world.ts`'s own module doc), and the ground
 * truth is a claim about the whole persona, independent of how much of her
 * history a given day has revealed (exactly the property
 * `strugglingCourseReadsWorse` already relies on).
 */
export function worldThroughDay(world: SyntheticWorld, throughDate: string): SyntheticWorld {
  const cutoffMs = Date.parse(`${throughDate}T23:59:59.999Z`);
  return {
    ...world,
    stream: {
      ...world.stream,
      entries: world.stream.entries.filter((entry) => Date.parse(entry.timestamp) <= cutoffMs),
    },
  };
}

/** One real review-log entry, restated minimally — never the full record (D-005: no content). */
export interface TimelineEventSummary {
  readonly eventId: string;
  readonly instrumentId: string;
  readonly conceptIds: readonly string[];
  readonly kind: 'review' | 'suspend' | 'unsuspend' | 'verdict';
}

export interface TimelineDayResult {
  /** `0`-based — day `0`'s mastery/rank/plan/gap/queue are built from zero entries. */
  readonly dayIndex: number;
  /** `YYYY-MM-DD`, the last calendar day of events counted into this result. */
  readonly countedThroughDate: string;
  /** `YYYY-MM-DD`, `countedThroughDate` plus one — what `result.plan.asOf` is. */
  readonly asOf: string;
  readonly result: OracleDeriveResult;
  readonly entriesCounted: number;
  /**
   * The persona's REAL entries dated `asOf` — the ones that would happen
   * "tomorrow" relative to this day's derivation. See the module doc's
   * "next day's review events" section: these are read off the fixed stream,
   * never fabricated or written back into it.
   */
  readonly nextDayEvents: readonly TimelineEventSummary[];
}

export interface OracleTimeline {
  readonly world: SyntheticWorld;
  readonly days: readonly TimelineDayResult[];
}

export interface DeriveOracleTimelineInput {
  readonly world: SyntheticWorld;
  /** Defaults to `world.spec.days` — the whole simulated semester. */
  readonly totalDays?: number;
  /** `asOf` (`YYYY-MM-DD`) -> `computedAt` (ISO-8601 with offset). Injected, never `Date.now()` (source lint). */
  readonly computedAtFor: (asOf: string) => string;
}

/**
 * The day loop. `totalDays` closed-loop derivations, sequentially (each
 * `await`s the previous — `buildStudyPlan`'s `SubtleCrypto` hash is async),
 * over growing prefixes of one world's fixed stream.
 *
 * Deterministic: `world`, `totalDays` and `computedAtFor` alone determine
 * every byte of the result (`test/timeline.spec.ts` asserts this by running
 * twice and comparing).
 */
export async function deriveOracleTimeline(
  input: DeriveOracleTimelineInput,
): Promise<OracleTimeline> {
  const { world } = input;
  const totalDays = input.totalDays ?? world.spec.days;
  const days: TimelineDayResult[] = [];

  for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
    const countedThroughDate = addUtcDays(world.spec.startDate, dayIndex - 1);
    const asOf = addUtcDays(world.spec.startDate, dayIndex);
    const dayWorld = worldThroughDay(world, countedThroughDate);
    const computedAt = input.computedAtFor(asOf);
    const queueNow = `${asOf}T00:00:00.000Z`;

    // Sequential and awaited on purpose: each day's plan is built from the
    // previous day's counted entries, so this cannot be parallelised without
    // breaking the replay it is doing.
    const result = await deriveClosedLoop({ world: dayWorld, asOf, computedAt, queueNow });

    const nextDayLowerMs = Date.parse(`${asOf}T00:00:00.000Z`);
    const nextDayUpperMs = Date.parse(`${asOf}T23:59:59.999Z`);
    const nextDayEvents: TimelineEventSummary[] = world.stream.entries
      // No persona stream emits a `[D-133]` `succession` line — narrowed away
      // only so `.instrumentId`/`.conceptIds`, absent from that one kind,
      // still type-check against the full current-version union.
      .filter(
        (entry): entry is Exclude<typeof entry, { kind: 'succession' }> =>
          entry.kind !== 'succession',
      )
      .filter((entry) => {
        const ms = Date.parse(entry.timestamp);
        return ms >= nextDayLowerMs && ms <= nextDayUpperMs;
      })
      .map((entry) => ({
        eventId: entry.eventId,
        instrumentId: entry.instrumentId,
        conceptIds: entry.conceptIds,
        kind: entry.kind,
      }));

    days.push({
      dayIndex,
      countedThroughDate,
      asOf,
      result,
      entriesCounted: dayWorld.stream.entries.length,
      nextDayEvents,
    });
  }

  return { world, days };
}

// ---------------------------------------------------------------------------
// Anti-degeneracy, across time. See the module doc's "Anti-degeneracy" section.
// Pure functions over an already-derived `OracleTimeline`; none are called
// from `deriveOracleTimeline` itself. `test/timeline.spec.ts` is the caller.
// ---------------------------------------------------------------------------

/** Every distinct `plan.policyVersion` seen across the timeline, in day order (consecutive repeats collapsed). */
export function planVersionSeries(timeline: OracleTimeline): readonly string[] {
  const series: string[] = [];
  for (const day of timeline.days) {
    const version = day.result.plan.policyVersion;
    if (series.length === 0 || series[series.length - 1] !== version) series.push(version);
  }
  return series;
}

/**
 * `false` exactly when the loop has flattened in the specific sense the
 * module doc names: the SAME plan, unmoved, across the entire replayed
 * window despite the evidence changing under it. A plan that never moves at
 * all is not "stable" here — nothing this generator produces should leave a
 * plan permanently unaffected by ninety days of review evidence.
 */
export function planVersionChangesOverTime(timeline: OracleTimeline): boolean {
  return planVersionSeries(timeline).length > 1;
}

/** The set of instrument ids `deriveClosedLoop`'s queue actually offered on one day. */
function offeredInstrumentIds(day: TimelineDayResult): ReadonlySet<string> {
  return new Set(day.result.queue.composed.items.map((item) => item.instrumentId));
}

/**
 * `false` when the composed queue is the identical set of instrument ids on
 * every single replayed day — the queue-level face of the same flattening
 * `planVersionChangesOverTime` checks at the plan level. A live loop
 * reshuffles what it offers as items get reviewed, come due, and go overdue;
 * a frozen one offers the same items regardless of what has happened.
 */
export function queueCompositionVaries(timeline: OracleTimeline): boolean {
  const sets = timeline.days.map(offeredInstrumentIds);
  const first = sets[0];
  if (first === undefined) return false;
  return sets.some((set) => set.size !== first.size || [...set].some((id) => !first.has(id)));
}

export interface MasteryAdvancement {
  /** Fraction of world concepts at `solid` or `yours` on the first day with at least one counted entry. */
  readonly firstFraction: number;
  /** Same fraction on the timeline's final day. */
  readonly lastFraction: number;
  /** `lastFraction >= firstFraction` — advancing evidence must never make the read-off state look worse in aggregate. */
  readonly nonDecreasing: boolean;
  /** `lastFraction > firstFraction` — the stronger claim: mastery genuinely rose somewhere. */
  readonly rose: boolean;
}

const ADVANCED_STATES: ReadonlySet<string> = new Set(['sapling', 'tree']);

function advancedFraction(day: TimelineDayResult): number {
  const values = [...day.result.mastery.values()];
  if (values.length === 0) return 0;
  const advanced = values.filter((v) => ADVANCED_STATES.has(v.state)).length;
  return advanced / values.length;
}

/**
 * Whether concept mastery, read off the SAME chain that ranks and plans from
 * it, actually rises as more of a persona's practice is counted — "does
 * mastery rise where she practises" (the parent bead's first named question).
 * Compares the first day with any counted entry against the final day, so a
 * long stretch of empty early days (before her first session) does not
 * dilute the comparison with a trivial `0/0`.
 */
export function masteryAdvancementOverTime(timeline: OracleTimeline): MasteryAdvancement {
  const withEntries = timeline.days.filter((d) => d.entriesCounted > 0);
  const first = withEntries[0];
  const last = timeline.days[timeline.days.length - 1];
  const firstFraction = first === undefined ? 0 : advancedFraction(first);
  const lastFraction = last === undefined ? 0 : advancedFraction(last);
  return {
    firstFraction,
    lastFraction,
    nonDecreasing: lastFraction >= firstFraction,
    rose: lastFraction > firstFraction,
  };
}

/**
 * Trap 2's defence (`derive.ts`'s `strugglingCourseReadsWorse`), evaluated on
 * the timeline's FINAL day — where the most evidence has accumulated. Early
 * days are not meaningful here: with little or no evidence for either side,
 * `strugglingCourseReadsWorse` returns `true` on its own "nothing to compare"
 * branch (documented on that function), which would make a check across every
 * day mostly measure emptiness rather than the claim. Read against the last
 * day, where the struggler's declared course has had the whole semester to
 * read worse, the check is doing real work.
 */
export function strugglingCourseReadsWorseByFinalDay(timeline: OracleTimeline): boolean {
  const last = timeline.days[timeline.days.length - 1];
  if (last === undefined) return true;
  const worldSoFar = worldThroughDay(timeline.world, last.countedThroughDate);
  return strugglingCourseReadsWorse(worldSoFar, last.result.mastery);
}

/**
 * Replays `entries` (a prefix of `world.stream.entries`, exactly as
 * `derive.ts`'s own `buildWorldCandidates` does) through a fresh FSRS
 * scheduler and reports which of `world`'s instruments are, as of `entries`'
 * end, in a state FSRS would call "advanced" (stability high enough that the
 * next due date is not imminent). Exposed for
 * `masteryAdvancementOverTime`'s sibling checks in the response-function
 * suite (`test/response-function.spec.ts`), which need per-instrument FSRS
 * state directly rather than the mastery rollup's coarser bands.
 */
export function schedulerStatesThroughDay(
  world: SyntheticWorld,
  throughDate: string,
): ReadonlyMap<string, SchedulerState> {
  const scheduler = createFsrsScheduler();
  const states = new Map<string, SchedulerState>();
  const cutoffMs = Date.parse(`${throughDate}T23:59:59.999Z`);
  for (const entry of world.stream.entries) {
    if (Date.parse(entry.timestamp) > cutoffMs) break;
    if (entry.kind !== 'review' || entry.rating === null) continue;
    const output = scheduler.schedule({
      instrumentId: entry.instrumentId,
      state: states.get(entry.instrumentId) ?? null,
      rating: entry.rating,
      now: new Date(Date.parse(entry.timestamp)),
    });
    states.set(entry.instrumentId, output.state);
  }
  // An instrument never reviewed by `throughDate` is simply absent from the
  // map — callers that need "every world instrument" iterate their own list
  // (e.g. `synthetic-bridge.js`'s `INSTRUMENTS`) and treat a missing key as
  // `null` state, rather than this function inventing a default.
  return states;
}
