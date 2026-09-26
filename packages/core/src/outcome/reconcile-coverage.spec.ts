import { describe, expect, it } from 'vitest';
import { outcomeConceptCoverage } from './reconcile-coverage.js';
import type { OutcomeRecord } from './types.js';

// Scenarios: olea-service/features/F8-concepts-scope.md — "F8.6/F4.1 [OUT-3] — Outcome-to-concept
// containment: exact and alias attach, containment proposes, ONT-R1's bias to splits applies
// across entity types", tagged `@auto:core/outcome/reconcile-coverage.spec`.

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

describe('outcomeConceptCoverage', () => {
  it('computes both shares from attached vs. total counts', () => {
    const outcomes: OutcomeRecord[] = [
      outcome({ id: 'o1', conceptKeys: ['concept-key1:a'] }),
      outcome({ id: 'o2', conceptKeys: [] }),
      outcome({ id: 'o3', conceptKeys: ['concept-key1:b', 'concept-key1:c'] }),
    ];
    const conceptKeys = ['concept-key1:a', 'concept-key1:b', 'concept-key1:c', 'concept-key1:d'];

    const coverage = outcomeConceptCoverage(outcomes, conceptKeys);

    expect(coverage.outcomeCount).toBe(3);
    expect(coverage.attachedOutcomeCount).toBe(2);
    expect(coverage.outcomeCoverageShare).toBeCloseTo(2 / 3);
    expect(coverage.conceptCount).toBe(4);
    expect(coverage.attachedConceptCount).toBe(3);
    expect(coverage.conceptCoverageShare).toBeCloseTo(3 / 4);
  });

  it('excludes retired outcomes from both the numerator and the denominator', () => {
    const outcomes: OutcomeRecord[] = [
      outcome({ id: 'o1', conceptKeys: ['concept-key1:a'] }),
      outcome({ id: 'o2', status: 'retired', conceptKeys: ['concept-key1:b'] }),
    ];

    const coverage = outcomeConceptCoverage(outcomes, ['concept-key1:a', 'concept-key1:b']);

    expect(coverage.outcomeCount).toBe(1);
    expect(coverage.attachedOutcomeCount).toBe(1);
    expect(coverage.outcomeCoverageShare).toBe(1);
    // The retired outcome's attachment does not count concept-key1:b as covered.
    expect(coverage.attachedConceptCount).toBe(1);
    expect(coverage.conceptCoverageShare).toBeCloseTo(1 / 2);
  });

  it('never divides by zero — an empty course reads as 0, not NaN', () => {
    const coverage = outcomeConceptCoverage([], []);
    expect(coverage.outcomeCoverageShare).toBe(0);
    expect(coverage.conceptCoverageShare).toBe(0);
  });

  // Regression, ol-egov.141.89.11.15: a course with no active Outcome declarations at all has
  // UNKNOWN material coverage, not a measured 0% — the previous behaviour (0/0 read as the same
  // 0 share as a course that HAS declared scope with nothing covered) fed F4.11's practice-paper
  // unlock a fabricated measurement rather than an honest "cannot measure yet". The numeric share
  // stays 0 for every existing typed reader (paper-unlock.ts's coverage gate never fires on 0
  // either way), but the new flag lets a reader distinguish the two cases.
  it('flags outcomeCoverageShare as unknown, not a measured zero, when there are no active outcomes to divide by', () => {
    const coverage = outcomeConceptCoverage([], ['concept-key1:a']);
    expect(coverage.outcomeCoverageShare).toBe(0);
    expect(coverage.outcomeCoverageKnown).toBe(false);
  });

  it('flags outcomeCoverageShare as known (even at 0) when active outcomes exist but none are attached', () => {
    const outcomes: OutcomeRecord[] = [outcome({ id: 'o1', conceptKeys: [] })];
    const coverage = outcomeConceptCoverage(outcomes, ['concept-key1:a']);
    expect(coverage.outcomeCoverageShare).toBe(0);
    expect(coverage.outcomeCoverageKnown).toBe(true);
  });

  it('flags conceptCoverageShare as unknown, not a measured zero, when the course has no concepts to divide by', () => {
    const outcomes: OutcomeRecord[] = [outcome({ id: 'o1', conceptKeys: [] })];
    const coverage = outcomeConceptCoverage(outcomes, []);
    expect(coverage.conceptCoverageShare).toBe(0);
    expect(coverage.conceptCoverageKnown).toBe(false);
  });

  it('deduplicates a concept key listed more than once in the registry input', () => {
    const outcomes: OutcomeRecord[] = [outcome({ id: 'o1', conceptKeys: ['concept-key1:a'] })];
    const coverage = outcomeConceptCoverage(outcomes, [
      'concept-key1:a',
      'concept-key1:a',
      'concept-key1:b',
    ]);
    expect(coverage.conceptCount).toBe(2);
    expect(coverage.attachedConceptCount).toBe(1);
  });
});
