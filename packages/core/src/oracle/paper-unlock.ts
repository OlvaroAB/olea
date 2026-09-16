/**
 * `evaluatePaperUnlock` — F4.11's unlock rule (`[D-250]`/`[D-252]` ruling 4a), as a pure function.
 *
 * **The shape is ruled; the two numbers are not (yet).** Ruling 4a fixes the combinator
 * asymmetric and proximity-first: an unpassed assessment ahead is necessary in every case; far
 * from it, material coverage gates; inside the proximity window, proximity alone unlocks
 * regardless of coverage. `[D-255]` (`ol-egov.141.26`, open) is the concurrent lane deriving the
 * two numbers themselves — a provisional baseline (window 7 days, coverage gate 0.30) is on that
 * bead's notes, but it is NOT yet ratified into this clause. So this function takes both numbers
 * as REQUIRED parameters with no default — a caller cannot accidentally ship an unbaked constant
 * by omission, and the eventual ratified values are a call-site change, never an edit to this
 * file. Mirrors `scripts/harness/paper-unlock-sweep.mjs`'s `unlockFires` (private repo, D-255's
 * own sweep) exactly on the boolean shape; this is the production, typed counterpart operating on
 * real course-scope/calendar inputs rather than a sweep's synthetic grid.
 *
 * **Material coverage reads `OutcomeConceptCoverage.outcomeCoverageShare`
 * (`../outcome/reconcile-coverage.js`), not a per-concept count.** That module's own doc already
 * names this call site: "read by component register row 2.11... its unlock rule's material-
 * coverage input needs to know whether a course's examiner-declared scope has concept coverage
 * behind it." `[D-255]`'s "share of a course's declared scope" is exactly this share — Outcomes
 * are the examiner-DECLARED units (`[ONT-R5]`), so the share of Outcomes carrying at least one
 * attached concept is the honest reading of "declared scope with material behind it," at the
 * grain F4.11's unlock clause actually names (distinct from the blueprint's own per-concept
 * held-source weighting — see `./paper-types.ts`'s module doc).
 *
 * **F4.7: "an assessment whose date has passed unlocks nothing."** Only assessments with
 * `daysUntilDue >= 0` are considered; a course with every assessment already passed reads as "no
 * assessment ahead" and never unlocks, regardless of coverage — ruling 4a's own "necessary in
 * every case" clause.
 */

import type { OutcomeConceptCoverage } from '../outcome/reconcile-coverage.js';
import type { PaperAssessment } from './paper-types.js';

/** `null` on an unparsable ISO date on either side — never a guessed day count (mirrors `playback-paper.mjs`'s `daysUntil`). */
export function daysUntilDue(asOfIso: string, dueIso: string): number | null {
  const asOf = new Date(`${asOfIso}T00:00:00Z`);
  const due = new Date(`${dueIso}T00:00:00Z`);
  if (Number.isNaN(asOf.getTime()) || Number.isNaN(due.getTime())) return null;
  return Math.round((due.getTime() - asOf.getTime()) / 86_400_000);
}

/** The nearest assessment that has not yet passed, or `null` when none exists (every date passed, absent, or unparsable). */
export function nearestUpcomingAssessment(
  asOfIso: string,
  assessments: readonly PaperAssessment[],
): { readonly assessment: PaperAssessment; readonly daysUntilDue: number } | null {
  let best: { readonly assessment: PaperAssessment; readonly daysUntilDue: number } | null = null;
  for (const assessment of assessments) {
    const days = daysUntilDue(asOfIso, assessment.due);
    if (days === null || days < 0) continue;
    if (best === null || days < best.daysUntilDue) best = { assessment, daysUntilDue: days };
  }
  return best;
}

export interface PaperUnlockInput {
  /** The calendar day the rule evaluates from, `YYYY-MM-DD`. Never read from a clock inside this module — same discipline `../oracle/types.ts`'s `RankOracleInput.asOf` documents. */
  readonly asOf: string;
  readonly assessments: readonly PaperAssessment[];
  /** Already-computed coverage evidence — `outcomeConceptCoverage(outcomes, conceptKeys)` (`../outcome/reconcile-coverage.js`). This function does no vault I/O and performs no join of its own. */
  readonly coverage: OutcomeConceptCoverage;
  /**
   * The proximity-window trigger, in days. REQUIRED, no default — `[D-255]`'s provisional
   * baseline is 7; pending ratification into F4.11 itself. A caller with no ratified number yet
   * must say so explicitly at the call site (e.g. by naming the bead its placeholder came from),
   * never by relying on a default this function could silently supply.
   */
  readonly proximityWindowDays: number;
  /**
   * The coverage-gate trigger, a share of declared scope in `[0, 1]`. REQUIRED, no default —
   * `[D-255]`'s provisional baseline is 0.30.
   */
  readonly coverageGateShare: number;
}

export interface PaperUnlockResult {
  readonly fires: boolean;
  readonly nearestAssessment: PaperAssessment | null;
  readonly daysUntilNearest: number | null;
  /** `coverage.outcomeCoverageShare`, restated so a reader of the result does not need the input alongside it. */
  readonly coverageShare: number;
  /** `true` when the nearest upcoming assessment is within `proximityWindowDays` — the leg that unlocks regardless of coverage per ruling 4a. */
  readonly proximityFired: boolean;
  /** `true` when `coverageShare >= coverageGateShare`. Consulted only when `proximityFired` is `false` and an assessment is ahead — ruling 4a's "far from it, material coverage is the gate." */
  readonly coverageFired: boolean;
  readonly proximityWindowDays: number;
  readonly coverageGateShare: number;
}

/**
 * F4.11's unlock rule, ruled shape (asymmetric, proximity-first), unratified numbers (injected,
 * required). See the module doc for the full argument.
 */
export function evaluatePaperUnlock(input: PaperUnlockInput): PaperUnlockResult {
  const nearest = nearestUpcomingAssessment(input.asOf, input.assessments);
  const coverageShare = input.coverage.outcomeCoverageShare;
  const coverageFired = coverageShare >= input.coverageGateShare;

  if (nearest === null) {
    // Ruling 4a: "an unpassed assessment ahead is necessary in every case." No assessment ahead
    // means no unlock, however much material coverage exists.
    return {
      fires: false,
      nearestAssessment: null,
      daysUntilNearest: null,
      coverageShare,
      proximityFired: false,
      coverageFired,
      proximityWindowDays: input.proximityWindowDays,
      coverageGateShare: input.coverageGateShare,
    };
  }

  const proximityFired = nearest.daysUntilDue <= input.proximityWindowDays;
  const fires = proximityFired || coverageFired;

  return {
    fires,
    nearestAssessment: nearest.assessment,
    daysUntilNearest: nearest.daysUntilDue,
    coverageShare,
    proximityFired,
    coverageFired,
    proximityWindowDays: input.proximityWindowDays,
    coverageGateShare: input.coverageGateShare,
  };
}
