/**
 * `evaluatePaperUnlockRatified` tests — the composition-root call site supplying `[D-255]`'s
 * ratified-provisional numbers into `olea-core`'s `evaluatePaperUnlock` (F4.11).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
 * unlock-asymmetry block, tagged `@auto:plugin/oracle/paper-unlock-wiring.spec`.
 */
import {
  type OutcomeConceptCoverage,
  PAPER_UNLOCK_COVERAGE_GATE_SHARE,
  PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS,
  type PaperAssessment,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { evaluatePaperUnlockRatified } from '../../src/oracle/paper-unlock-wiring.js';

function coverage(outcomeCoverageShare: number): OutcomeConceptCoverage {
  return {
    outcomeCount: 10,
    attachedOutcomeCount: Math.round(outcomeCoverageShare * 10),
    outcomeCoverageShare,
    conceptCount: 10,
    attachedConceptCount: Math.round(outcomeCoverageShare * 10),
    conceptCoverageShare: outcomeCoverageShare,
  };
}

describe('evaluatePaperUnlockRatified', () => {
  it('never requires the caller to name proximityWindowDays/coverageGateShare, and restates the [D-255] constants on the result', () => {
    const assessments: PaperAssessment[] = [{ type: 'exam', due: '2026-12-01' }];
    const result = evaluatePaperUnlockRatified({
      asOf: '2026-09-16',
      assessments,
      coverage: coverage(0),
    });
    expect(result.proximityWindowDays).toBe(PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS);
    expect(result.coverageGateShare).toBe(PAPER_UNLOCK_COVERAGE_GATE_SHARE);
  });

  it('fires on proximity alone inside the ratified window, even with zero coverage', () => {
    const asOf = new Date('2026-09-16T00:00:00Z');
    const due = new Date(asOf.getTime() + (PAPER_UNLOCK_PROXIMITY_WINDOW_DAYS - 1) * 86_400_000);
    const result = evaluatePaperUnlockRatified({
      asOf: asOf.toISOString().slice(0, 10),
      assessments: [{ type: 'exam', due: due.toISOString().slice(0, 10) }],
      coverage: coverage(0),
    });
    expect(result.fires).toBe(true);
    expect(result.proximityFired).toBe(true);
    expect(result.coverageFired).toBe(false);
  });

  it('far from an assessment, fires only once coverage clears the ratified gate', () => {
    const farAssessment: PaperAssessment = { type: 'exam', due: '2026-12-01' };
    const belowGate = evaluatePaperUnlockRatified({
      asOf: '2026-09-16',
      assessments: [farAssessment],
      coverage: coverage(PAPER_UNLOCK_COVERAGE_GATE_SHARE - 0.1),
    });
    expect(belowGate.fires).toBe(false);

    const aboveGate = evaluatePaperUnlockRatified({
      asOf: '2026-09-16',
      assessments: [farAssessment],
      coverage: coverage(PAPER_UNLOCK_COVERAGE_GATE_SHARE + 0.1),
    });
    expect(aboveGate.fires).toBe(true);
    expect(aboveGate.coverageFired).toBe(true);
  });
});
