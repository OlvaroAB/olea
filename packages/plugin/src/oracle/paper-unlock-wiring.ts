/**
 * `evaluatePaperUnlockRatified` — the composition-root call site for `olea-core`'s
 * `evaluatePaperUnlock` (F4.11, `[D-250]`/`[D-252]` ruling 4a), supplying the two `[D-255]`
 * ratified-provisional numbers (private repo `ol-egov.141.26`) from `olea-core`'s own declared
 * constants module (`PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS` / `PAPER_UNLOCK_COVERAGE_GATE_SHARE`,
 * `oracle/paper-unlock-constants.ts`) rather than a literal at this call site or a default inside
 * `evaluatePaperUnlock` itself — `evaluatePaperUnlock`'s own module doc is explicit that both
 * numbers stay REQUIRED, no-default parameters so a caller can never accidentally ship an unbaked
 * constant by omission. The revisit condition (the alpha student's own answer to a timing
 * question — see the constants module's doc) is a call-site value change here, never an edit to
 * the evaluator.
 *
 * **Reachability, stated plainly (`[D-072]` clause 5), same posture as `./paper-item-port.ts`.**
 * NOTHING calls this yet — no course-page affordance, paper view, or steering-dial surface exists
 * for F4.11 today (`docs/dev/surface-register.md`'s F4.11 entry, private repo, stays prose-only).
 * This file exists so the ratified constants have exactly one composition seam to land in once
 * that surface work (DP-7) starts, rather than a future caller re-discovering which constants
 * module to import and threading the two numbers through by hand at an arbitrary call site.
 */

import {
  evaluatePaperUnlock,
  PAPER_UNLOCK_COVERAGE_GATE_SHARE,
  PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS,
  type PaperUnlockInput,
  type PaperUnlockResult,
} from 'olea-core';

/** `PaperUnlockInput` minus the two numbers this composition supplies from the ratified constants. */
export type PaperUnlockRatifiedInput = Omit<
  PaperUnlockInput,
  'proximityWindowDays' | 'coverageGateShare'
>;

/**
 * `evaluatePaperUnlock`, composed with the `[D-255]` ratified-provisional numbers. Callers never
 * pass `proximityWindowDays`/`coverageGateShare` themselves — that is exactly the point of this
 * seam existing separately from the pure evaluator.
 */
export function evaluatePaperUnlockRatified(input: PaperUnlockRatifiedInput): PaperUnlockResult {
  return evaluatePaperUnlock({
    ...input,
    proximityWindowDays: PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS,
    coverageGateShare: PAPER_UNLOCK_COVERAGE_GATE_SHARE,
  });
}
