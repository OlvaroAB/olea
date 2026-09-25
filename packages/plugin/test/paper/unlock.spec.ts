/**
 * `unlock.ts` tests — the practice-paper unlock rule's real Outcome-coverage input (F4.11 ruling
 * 4a, `ol-2zfj.172`).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 pipeline — blueprint, generation, the
 * vault object, the unlock rule [PAPER-3]" already covers `evaluatePaperUnlock` itself (core
 * package, `oracle/paper-unlock.spec.ts`) against an injected `OutcomeConceptCoverage`; these
 * scenarios are this plugin's own complement — they show `evaluatePracticePaperUnlockForCourse`
 * (the composition seam `provider.ts`'s `loadCourseState` actually calls) really can fire the
 * coverage leg once a caller hands it a real, nonzero share, and that a zero share (no Outcomes
 * attached) reproduces the pre-wiring policy-zero behaviour exactly.
 */
import {
  type OutcomeRecord,
  outcomeConceptCoverage,
  PAPER_UNLOCK_COVERAGE_GATE_SHARE,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { evaluatePracticePaperUnlockForCourse } from '../../src/paper/unlock.js';

function outcome(overrides: Partial<OutcomeRecord> & { id: string }): OutcomeRecord {
  return {
    courses: ['COURSEA'],
    source: { path: 'Objectives.md', blockIndex: 0 },
    label: 'x',
    conceptKeys: [],
    status: 'active',
    provenance: { promptVersion: 'v1', modelVersion: 'model-a' },
    mintedAt: '2026-09-16',
    schemaVersion: 1,
    ...overrides,
  };
}

/** Ten active outcomes, `attachedCount` of them attached to concept keys — a plain, readable way to land exactly on a target `outcomeCoverageShare` in tenths. */
function tenOutcomesWith(attachedCount: number): readonly OutcomeRecord[] {
  return Array.from({ length: 10 }, (_, i) =>
    outcome({ id: `o${i}`, conceptKeys: i < attachedCount ? [`k${i}`] : [] }),
  );
}

const FAR_ASSESSMENT = [{ type: 'exam', due: '2026-12-01' }];
const ASOF = '2026-09-19';

describe('evaluatePracticePaperUnlockForCourse — real coverage', () => {
  it('never fires far from an assessment when the course has no active Outcomes (unchanged from the old policy zero)', () => {
    const coverage = outcomeConceptCoverage([], ['k1', 'k2', 'k3']);
    const unlock = evaluatePracticePaperUnlockForCourse(ASOF, FAR_ASSESSMENT, coverage);
    expect(coverage.outcomeCoverageShare).toBe(0);
    expect(unlock.fires).toBe(false);
  });

  it('fires the coverage leg far from an assessment once real attached-Outcome coverage reaches the ratified gate share', () => {
    // 3 of 10 active Outcomes attached — 0.3 outcomeCoverageShare, exactly the ratified gate.
    const coverage = outcomeConceptCoverage(tenOutcomesWith(3), ['k0', 'k1', 'k2']);
    expect(coverage.outcomeCoverageShare).toBe(PAPER_UNLOCK_COVERAGE_GATE_SHARE);

    const unlock = evaluatePracticePaperUnlockForCourse(ASOF, FAR_ASSESSMENT, coverage);
    expect(unlock.fires).toBe(true);
    expect(unlock.coverageFired).toBe(true);
    expect(unlock.proximityFired).toBe(false);
  });

  it('below the gate share, far from an assessment, still does not fire — real coverage, honestly insufficient', () => {
    // 1 of 10 attached — 0.1 outcomeCoverageShare, below the 0.3 gate.
    const coverage = outcomeConceptCoverage(tenOutcomesWith(1), ['k0', 'k1', 'k2']);
    expect(coverage.outcomeCoverageShare).toBeLessThan(PAPER_UNLOCK_COVERAGE_GATE_SHARE);

    const unlock = evaluatePracticePaperUnlockForCourse(ASOF, FAR_ASSESSMENT, coverage);
    expect(unlock.fires).toBe(false);
  });
});
