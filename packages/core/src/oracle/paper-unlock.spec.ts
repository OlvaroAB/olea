import { describe, expect, it } from 'vitest';
import type { OutcomeConceptCoverage } from '../outcome/reconcile-coverage.js';
import type { PaperAssessment } from './paper-types.js';
import { daysUntilDue, evaluatePaperUnlock, nearestUpcomingAssessment } from './paper-unlock.js';

// Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
// unlock-asymmetry block, tagged `@auto:core/oracle/paper-unlock.spec`.

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

describe('daysUntilDue', () => {
  it('is null on an unparsable date', () => {
    expect(daysUntilDue('2026-09-16', 'not-a-date')).toBeNull();
    expect(daysUntilDue('not-a-date', '2026-09-16')).toBeNull();
  });

  it('counts whole days forward', () => {
    expect(daysUntilDue('2026-09-16', '2026-09-23')).toBe(7);
  });
});

describe('nearestUpcomingAssessment', () => {
  it('ignores a passed assessment (F4.7)', () => {
    const assessments: PaperAssessment[] = [{ type: 'exam', due: '2026-09-01' }];
    expect(nearestUpcomingAssessment('2026-09-16', assessments)).toBeNull();
  });

  it('picks the soonest of several upcoming', () => {
    const assessments: PaperAssessment[] = [
      { type: 'exam', due: '2026-10-01' },
      { type: 'quiz', due: '2026-09-20' },
    ];
    const nearest = nearestUpcomingAssessment('2026-09-16', assessments);
    expect(nearest?.assessment.type).toBe('quiz');
    expect(nearest?.daysUntilDue).toBe(4);
  });
});

describe('evaluatePaperUnlock', () => {
  it('never fires with no assessment ahead, regardless of coverage (ruling 4a)', () => {
    const result = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments: [{ type: 'exam', due: '2026-08-01' }],
      coverage: coverage(1),
      proximityWindowDays: 7,
      coverageGateShare: 0.3,
    });
    expect(result.fires).toBe(false);
    expect(result.nearestAssessment).toBeNull();
  });

  it('fires on proximity alone inside the window, even with zero coverage', () => {
    const result = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments: [{ type: 'exam', due: '2026-09-20' }],
      coverage: coverage(0),
      proximityWindowDays: 7,
      coverageGateShare: 0.3,
    });
    expect(result.fires).toBe(true);
    expect(result.proximityFired).toBe(true);
    expect(result.coverageFired).toBe(false);
  });

  it('far from an assessment, coverage is the gate', () => {
    const farAssessment: PaperAssessment = { type: 'exam', due: '2026-12-01' };
    const belowGate = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments: [farAssessment],
      coverage: coverage(0.2),
      proximityWindowDays: 7,
      coverageGateShare: 0.3,
    });
    expect(belowGate.fires).toBe(false);
    expect(belowGate.proximityFired).toBe(false);

    const aboveGate = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments: [farAssessment],
      coverage: coverage(0.4),
      proximityWindowDays: 7,
      coverageGateShare: 0.3,
    });
    expect(aboveGate.fires).toBe(true);
    expect(aboveGate.coverageFired).toBe(true);
  });

  it('a coverage share exactly at the gate fires (>=)', () => {
    const result = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments: [{ type: 'exam', due: '2026-12-01' }],
      coverage: coverage(0.3),
      proximityWindowDays: 7,
      coverageGateShare: 0.3,
    });
    expect(result.fires).toBe(true);
  });

  it('restates the two injected numbers on the result, never a baked default', () => {
    const result = evaluatePaperUnlock({
      asOf: '2026-09-16',
      assessments: [],
      coverage: coverage(0),
      proximityWindowDays: 11,
      coverageGateShare: 0.55,
    });
    expect(result.proximityWindowDays).toBe(11);
    expect(result.coverageGateShare).toBe(0.55);
  });
});
