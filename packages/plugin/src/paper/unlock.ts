/**
 * The practice-paper unlock check for one course, composed over
 * `../oracle/paper-unlock-wiring.js`'s `evaluatePaperUnlockRatified` (the `[D-255]` ratified
 * proximity/coverage numbers, already composed there — this module supplies only the two real
 * inputs that seam needs).
 *
 * **`coverage` is now a real measured share, wired 2026-09-25 (`ol-2zfj.172`).** F4.11's
 * material-coverage leg reads `OutcomeConceptCoverage.outcomeCoverageShare`
 * (`olea-core`'s `outcomeConceptCoverage`, `outcome/reconcile-coverage.ts`) — the course's active
 * `OutcomeRecord`s (`listOutcomeRecords`) reconciled against its concept-key registry. The caller
 * (`provider.ts`'s `loadCourseState`) now reads both real and passes the result here; this
 * function itself does no vault I/O and performs no join of its own (mirrors
 * `PaperUnlockInput.coverage`'s own doc). **A course with no active Outcomes attached is
 * unchanged from before this wiring**: `outcomeConceptCoverage` returns `outcomeCoverageShare: 0`
 * whenever `activeOutcomes.length === 0` (its own division-by-zero guard), the exact value the
 * previous `ZERO_OUTCOME_COVERAGE` policy stub always supplied — so the coverage leg still cannot
 * fire for such a course, honestly, not by a fabricated share. Ruling 4a's own text ("far from it,
 * material coverage is the gate") is the leg this unblocks: before this wiring the leg was
 * structurally unreachable for every course, Outcomes or not.
 */

import type { OutcomeConceptCoverage, PaperAssessment, PaperUnlockResult } from 'olea-core';
import { evaluatePaperUnlockRatified } from '../oracle/paper-unlock-wiring.js';

export function evaluatePracticePaperUnlockForCourse(
  asOf: string,
  assessments: readonly PaperAssessment[],
  coverage: OutcomeConceptCoverage,
): PaperUnlockResult {
  return evaluatePaperUnlockRatified({
    asOf,
    assessments,
    coverage,
  });
}
