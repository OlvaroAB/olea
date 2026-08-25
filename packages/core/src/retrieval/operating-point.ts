/**
 * `D112_GROUNDING_BAND` — `[D-089]`'s two-threshold band, at the operating
 * point `[D-112]` (`ol-oqip`) ratified. Wired into production by `[WIRE-5]`
 * (`ol-i0y6`) — see `packages/plugin/src/retrieval/draft-quiz-cards.ts`.
 *
 * **These are DERIVED constants** (the component register's declared/derived
 * rule, `docs/Olea_component_register.md` in the private repo): both values
 * are fitted against a labelled measurement set, so only the numbers travel
 * here. The derivation — the full sweep, the held-out and perturbation
 * analysis, the exposure and cost argument — lives in the private repo's
 * findings (`findings/L18-band-operating-point.md`,
 * `.olea-harness/band-curve/`) and is cited by decision id, never restated in
 * this public module.
 *
 * **Status: PROVISIONAL, not a settled number.** `[D-112]`'s ruling adopts
 * this pair as a measured baseline together with a revisit condition, which
 * is a different thing from picking a number that stands until someone
 * objects — see that decision's close reason for the full argument. This
 * module states only the three conditions that reopen it, one line each:
 *
 * 1. A labelled unanswerable item is observed with `top1` above 0.7115 (one
 *    item suffices — the margin the upper bar rests on is exactly that wide).
 * 2. The labelled answerable set reaches roughly 120 items (~180 total,
 *    keeping the current 40/20 ratio) — below that, band-versus-judge on
 *    false refusals cannot be settled in either direction.
 * 3. `grounding.judge.v1`'s prompt version changes — both bars were measured
 *    against one prompt version's verdicts, and a rewrite has already moved
 *    5 of 60 recorded verdicts once.
 *
 * None of these fire automatically; each is a data event a human notices and
 * acts on by opening a new decision bead, not a check this module runs.
 */

import type { GroundingBandThresholds } from './groundedContext.js';

export const D112_GROUNDING_BAND: GroundingBandThresholds = {
  lower: 0.555,
  upper: 0.8,
};
