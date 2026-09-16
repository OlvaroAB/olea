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
