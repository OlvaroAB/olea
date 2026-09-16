import { describe, expect, it } from 'vitest';
import type { OutcomeConceptCoverage } from '../outcome/reconcile-coverage.js';
import type { PaperAssessment } from './paper-types.js';
import { evaluatePaperUnlock } from './paper-unlock.js';
import {
  PAPER_UNLOCK_COVERAGE_GATE_SHARE,
  PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS,
} from './paper-unlock-constants.js';

// [D-255] ratified this module's two values as a provisional baseline (window 7 days, gate 0.30).
// This file asserts the SHAPE any future revisit must keep (a non-negative day count, a share in
// [0, 1]) and that the constants actually plug into `evaluatePaperUnlock` unchanged — it never
// re-asserts the specific numbers as behaviour, since `paper-unlock.spec.ts` already covers the
// evaluator's own logic with its own literals.

describe('PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS / PAPER_UNLOCK_COVERAGE_GATE_SHARE — [D-255]', () => {
  it('the proximity window is a non-negative whole number of days', () => {
    expect(Number.isInteger(PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS)).toBe(true);
    expect(PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS).toBeGreaterThanOrEqual(0);
  });

  it('the coverage gate is a share in [0, 1]', () => {
    expect(PAPER_UNLOCK_COVERAGE_GATE_SHARE).toBeGreaterThanOrEqual(0);
    expect(PAPER_UNLOCK_COVERAGE_GATE_SHARE).toBeLessThanOrEqual(1);
  });

  it('plug directly into evaluatePaperUnlock and are restated on the result unchanged', () => {
    const coverage: OutcomeConceptCoverage = {
      outcomeCount: 10,
      attachedOutcomeCount: 3,
      outcomeCoverageShare: 0.3,
      conceptCount: 10,
      attachedConceptCount: 3,
      conceptCoverageShare: 0.3,
    };
    const assessments: PaperAssessment[] = [{ type: 'exam', due: '2026-12-01' }];
    const result = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments,
      coverage,
      proximityWindowDays: PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS,
      coverageGateShare: PAPER_UNLOCK_COVERAGE_GATE_SHARE,
    });
    expect(result.proximityWindowDays).toBe(PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS);
    expect(result.coverageGateShare).toBe(PAPER_UNLOCK_COVERAGE_GATE_SHARE);
  });
});
