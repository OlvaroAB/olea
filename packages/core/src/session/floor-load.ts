/**
 * Floor load — a countable quantity over session composition (component
 * register row 3.7, `docs/Olea_component_register.md`; `ol-3ux7.8`,
 * discovered from CHK-1 / `ol-3ux7.1`).
 *
 * ## The gap this closes
 *
 * `composeSessionRows` (`../study-session/compose.js`) sorts every gap row
 * into exactly one {@link ObligationClass} every time it composes a
 * session — `'unmet'`, `'recall-due'`, `'baseline-due'` or `'elective'` — and
 * then discards that classification the instant it builds
 * `ComposeSessionRowsResult.orderedRows`, which carries `GapRow`s and nothing
 * else. A caller downstream of a real composition therefore has the rows a
 * session chose but not what put each one there. Component register row
 * 3.7's own health check needs precisely the fact that gets thrown away:
 * *"total floor load against concept count — it should flatten as concepts
 * mature; if it tracks linearly the frequency rule is not working."*
 * `findings/CHK-1-algorithm-checks.md` (olea-service) names this the one
 * register-3.7 check left "impossible today" because "no code path currently
 * returns 'floor load' as a countable quantity" and asks for exactly this
 * accessor as the first step. `../checks/floor-load-linearity.js` is the
 * check this accessor exists to feed.
 *
 * ## Zero new judgement
 *
 * {@link floorLoadOf} classifies with `classifyObligation`
 * (`../study-session/compose.js`) — the SAME exported pure function
 * `composeSessionRows` itself calls for every row. Re-running it here on the
 * same per-concept {@link ObligationSignals} a caller already derived cannot
 * disagree with what a real composition decided for that concept; this
 * recovers a fact the composition computed and dropped, rather than forming
 * a second opinion about it. No threshold, no score, no corpus-fitted
 * boundary — see `classifyObligation`'s own "zero free parameters" framing
 * in `study-session/compose.ts`'s module doc, which this module inherits by
 * calling it rather than restating it.
 *
 * ## What "floor load" means here, precisely
 *
 * The **numerator** is the count of concepts classified `'baseline-due'` —
 * the retrieval-baseline obligation register row 3.7 calls "the frequency
 * rule," widened by mastery stage on `RETRIEVAL_BASELINE_STAGE_LADDER_DAYS`'s
 * shipped 5/12/21-day ladder. The **denominator** the health check plots it
 * against is simply how many concepts were classified at all —
 * {@link FloorLoadTally.conceptCount}, the length of whatever population the
 * caller handed in. Neither this module nor the check downstream of it
 * decides what that population is (every gap row a composition considered,
 * or only the ones a budget-limited fill actually offered) — that choice is
 * the harness's, exactly as CHK-1's own division of labour puts "drive the
 * algorithm" on the runner and "answer a yes/no question about its output"
 * on the function in this package (`checks/types.ts`'s module doc).
 *
 * ## Pure, and deliberately not a caller of `composeSessionRows`
 *
 * No `VaultSource`, no clock, no import of `../study-session/build.js` or
 * `composeSessionRows` itself. Building the {@link ObligationSignals} this
 * module classifies (from a replay, an instrument index and a calendar day)
 * is the same work `composeSessionRows`'s own private `obligationSignalsFor`
 * already does — deliberately not re-derived a second time here, in a
 * different file, where it could quietly drift from that one. A production
 * caller building this module's input therefore does the same signal
 * resolution it would do to call `composeSessionRows` in the first place;
 * a check's fixture builds {@link ObligationSignals} directly, no replay
 * required.
 */

import type { ObligationClass, ObligationSignals } from '../study-session/compose.js';
import { classifyObligation } from '../study-session/compose.js';

/** One concept `floorLoadOf` classifies, identified so a caller can trace a count back to a concept. */
export interface FloorLoadConcept {
  readonly conceptKey: string;
  readonly signals: ObligationSignals;
}

/** Every {@link ObligationClass}'s count for one population, with floor load named on its own. */
export interface FloorLoadTally {
  /**
   * How many concepts this tally covers — the denominator register row
   * 3.7's health check plots floor load against.
   */
  readonly conceptCount: number;
  /** `byClass['baseline-due']`, named — the numerator the health check plots. */
  readonly floorLoad: number;
  readonly byClass: Readonly<Record<ObligationClass, number>>;
}

const ZERO_COUNTS: Readonly<Record<ObligationClass, number>> = Object.freeze({
  unmet: 0,
  'recall-due': 0,
  'baseline-due': 0,
  elective: 0,
});

/**
 * Classify a population of concepts by obligation class and tally the
 * result — the accessor `ol-3ux7.8` exists to add. Pure and total: `Date`
 * never enters it, since every {@link ObligationSignals.asOf} is already the
 * caller's, exactly as `classifyObligation` itself requires.
 *
 * Order-independent: the tally does not depend on `concepts`' order, and an
 * empty list is an honest zero rather than a caller error — the same
 * "a check that ran nothing cannot report a pass" discipline this module's
 * consumer, `checkFloorLoadLinearity`, applies on the check side.
 */
export function floorLoadOf(concepts: readonly FloorLoadConcept[]): FloorLoadTally {
  const byClass: Record<ObligationClass, number> = { ...ZERO_COUNTS };
  for (const concept of concepts) {
    const { klass } = classifyObligation(concept.signals);
    byClass[klass] += 1;
  }
  return { conceptCount: concepts.length, floorLoad: byClass['baseline-due'], byClass };
}
