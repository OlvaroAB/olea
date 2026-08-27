/**
 * Component register row 3.9 ("Choose a support level") — shared types.
 *
 * The three-tier ladder itself is not this module's to name: it is already a
 * FROZEN, ratified contract enum — `SupportLevel` (`olea-contracts`'
 * `review-log.ts`, `[D-094]`) — because `supportLevelShown` is a persisted
 * v5 review-log field (`ol-tka5`, `[D-117]`) and a second, locally-invented
 * enum here would be exactly the kind of drift `check:vocabulary` exists to
 * catch. This module re-exports it under this component's own name so a
 * caller working through `support-level/` never has to know the tiers live
 * in the schema package to use them.
 *
 * ## The signal is open by construction — this is where that gets named
 *
 * The register's own words: *"her review evidence for that concept at the
 * granularity of the thing the support is doing — finer than 'she got the
 * card right', and open by construction: designing that signal is part of
 * this item."* `[D-094]`'s own ruling narrows the design space
 * considerably though, and {@link FailureShape} is this module's answer,
 * built directly from what the ruling admits and excludes:
 *
 * - **Admitted:** failure shape and recovery behaviour (`[D-094]`).
 * - **Excluded:** latency ("noise at n=1", `[D-094]`) — there is no
 *   duration field anywhere in this directory.
 * - **Never:** a mastery/growth-stage label, and never elapsed time (the
 *   row's own words, repeated because F2.20 repeats them: "never a stage
 *   label, never elapsed time — that distinction is what separates the
 *   studies where withdrawing support helped from the ones where it hurt").
 *   {@link FailureShape} and {@link SessionSupportOutcome} carry neither.
 *
 * `'blank'` and `'wrong-concept'` are the two failure shapes `[D-094]`
 * names as escalation-triggering ("one session with a blank or
 * wrong-concept failure"). `'minor-slip'` is a real failure that is neither
 * of those two — the register's own failure ranking ("premature withdrawal
 * > visible flapping > lingering drag") puts a small, recoverable slip
 * below the escalation bar, so it breaks a clean streak without itself
 * escalating. `'none'` is success.
 */
import type { SupportLevel as ContractSupportLevel } from 'olea-contracts';

export type SupportLevel = ContractSupportLevel;

/** `[D-094]`'s ladder, weakest scaffold to strongest, matching `olea-contracts`' own enum order. */
export const SUPPORT_LEVEL_ORDER: readonly SupportLevel[] = ['independent', 'prompted', 'guided'];

function levelRank(level: SupportLevel): number {
  return SUPPORT_LEVEL_ORDER.indexOf(level);
}

/** One tier up, capped at the top of the ladder (`'guided'`). */
export function raiseSupportLevel(level: SupportLevel): SupportLevel {
  const next = SUPPORT_LEVEL_ORDER[levelRank(level) + 1];
  return next ?? 'guided';
}

/** One tier down, floored at the bottom of the ladder (`'independent'`). */
export function lowerSupportLevel(level: SupportLevel): SupportLevel {
  const prev = SUPPORT_LEVEL_ORDER[levelRank(level) - 1];
  return prev ?? 'independent';
}

/**
 * `[D-094]`'s scope clause: *"the ladder lives on recall and explanation
 * tiers — recognition has no ladder (its options are its scaffolding)."*
 * Every function in this directory that takes a tier is only ever meaningful
 * for these two; a caller holding a recognition-tier instrument has no
 * business calling into this component at all (component register 3.9,
 * "Scope").
 */
export type SupportLadderTier = 'recall' | 'explanation';

/**
 * Failure shape and recovery behaviour, at session-boundary granularity —
 * `[D-094]`'s admitted signals (see module doc). One value per session, for
 * one concept × instrument-tier cell:
 *
 * - `'none'` — a clean pass: no failure, evidence of real recall/explanation.
 * - `'minor-slip'` — a recoverable failure below the escalation bar (e.g. a
 *   near-miss corrected on reflection) — breaks a clean streak, does not
 *   escalate.
 * - `'blank'` / `'wrong-concept'` — the two escalation-triggering shapes
 *   `[D-094]` names by name.
 *
 * `hintUptake` is independent of failure shape: she can pass cleanly while
 * still having used an offered hint, and `[D-094]`'s ratchet turns on this
 * distinction (see `ladder.ts`'s module doc) — uptake may hold a level,
 * never raise it.
 */
export type FailureShape = 'none' | 'minor-slip' | 'blank' | 'wrong-concept';

export interface SessionSupportOutcome {
  readonly failureShape: FailureShape;
  /** Whether a hint or source expansion offered at the current level was used this session, regardless of the outcome. */
  readonly hintUptake: boolean;
}

/** `[D-094]`'s two escalation-triggering shapes, named once so `ladder.ts` and its tests read off the same list rather than repeating the literal comparison. */
export const ESCALATION_FAILURE_SHAPES: readonly FailureShape[] = ['blank', 'wrong-concept'];

export function isEscalationTrigger(shape: FailureShape): boolean {
  return ESCALATION_FAILURE_SHAPES.includes(shape);
}
