/**
 * The practice-paper unlock check for one course, composed over
 * `../oracle/paper-unlock-wiring.js`'s `evaluatePaperUnlockRatified` (the `[D-255]` ratified
 * proximity/coverage numbers, already composed there — this module supplies only the two real
 * inputs that seam needs).
 *
 * **`coverage` is a policy zero, never a measured one.** F4.11's material-coverage leg reads
 * `OutcomeConceptCoverage.outcomeCoverageShare` — real Outcome-based scope coverage, which has no
 * production reader anywhere in this plugin (see `assemble.ts`'s module doc for the same gap,
 * confirmed by search). Passing an honest `0` rather than a fabricated share means this composition
 * can only ever unlock through the proximity leg (an unpassed assessment inside the ratified
 * window) — never through coverage — until a real Outcome-coverage reader exists. This is the
 * SAFE direction to degrade in: ruling 4a's own text says "far from it, material coverage is the
 * gate," and a policy zero can never fire that gate wrongly — it can only under-unlock, which
 * `docs/dev/paper-blueprint-design.md`'s own §3.1 already names as the correct default direction
 * for an unripe input ("An unruled gate should under-unlock rather than over-unlock").
 */

import type { PaperAssessment, PaperUnlockResult } from 'olea-core';
import { evaluatePaperUnlockRatified } from '../oracle/paper-unlock-wiring.js';

/** `OutcomeConceptCoverage`'s full shape, all zeros — see the module doc for why this is a policy value, never a measured one. */
const ZERO_OUTCOME_COVERAGE = Object.freeze({
  outcomeCount: 0,
  attachedOutcomeCount: 0,
  outcomeCoverageShare: 0,
  conceptCount: 0,
  attachedConceptCount: 0,
  conceptCoverageShare: 0,
});

export function evaluatePracticePaperUnlockForCourse(
  asOf: string,
  assessments: readonly PaperAssessment[],
): PaperUnlockResult {
  return evaluatePaperUnlockRatified({
    asOf,
    assessments,
    coverage: ZERO_OUTCOME_COVERAGE,
  });
}
