// CHK-2 (`ol-3ux7.15`). Every fixture below is inline and structural — no
// vault content, no concept ids, no course codes (INV-3).
//
// HOW TO CHECK THIS CHECK CAN FAIL (N-013 — a check that cannot fail reports
// green forever): each function below is exercised once on a fixture built
// to return `ok: false`, and once on a fixture built to pass.
import { describe, expect, it } from 'vitest';
import {
  checkMasteryMonotonicity,
  checkMasteryStageDistribution,
  type MasteryStage,
} from './mastery-stage-health.js';

describe('checkMasteryStageDistribution', () => {
  it('fails when a stage is entirely empty', () => {
    const stages: MasteryStage[] = ['seed', 'seed', 'sprout', 'sapling', 'sapling'];
    const verdict = checkMasteryStageDistribution(stages, 0.9);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.emptyStages).toEqual(['tree']);
  });

  it('fails when one stage covers the ceiling or more', () => {
    // 9 of 12 seed (0.75), ceiling 0.7 — every other stage still represented once.
    const stages: MasteryStage[] = [...Array(9).fill('seed' as const), 'sprout', 'sapling', 'tree'];
    const verdict = checkMasteryStageDistribution(stages, 0.7);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.modalStage).toBe('seed');
    expect(verdict.measured.modalShare).toBeGreaterThanOrEqual(0.7);
  });

  it('passes an even spread with every stage represented', () => {
    const stages: MasteryStage[] = ['seed', 'seed', 'sprout', 'sprout', 'sapling', 'tree', 'tree'];
    const verdict = checkMasteryStageDistribution(stages, 0.9);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.emptyStages).toEqual([]);
  });

  it('reports zero concepts as a failure — a check that ran nothing cannot pass (N-013)', () => {
    const verdict = checkMasteryStageDistribution([], 0.9);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.total).toBe(0);
  });
});

describe('checkMasteryMonotonicity', () => {
  it('fails on a real regression — stage drops between successive prefixes', () => {
    const sequence: MasteryStage[] = ['seed', 'sprout', 'sapling', 'tree', 'sprout'];
    const verdict = checkMasteryMonotonicity(sequence);
    expect(verdict.ok).toBe(false);
    expect(verdict.measured.firstRegressionAtStep).toBe(5);
    expect(verdict.measured.regressionFrom).toBe('tree');
    expect(verdict.measured.regressionTo).toBe('sprout');
  });

  it('passes a plateau — equal is not a regression', () => {
    const sequence: MasteryStage[] = ['seed', 'seed', 'sprout', 'sprout', 'sprout', 'sapling'];
    const verdict = checkMasteryMonotonicity(sequence);
    expect(verdict.ok).toBe(true);
    expect(verdict.measured.firstRegressionAtStep).toBeNull();
  });

  it('reports zero prefixes as a failure — a check that ran nothing cannot pass (N-013)', () => {
    const verdict = checkMasteryMonotonicity([]);
    expect(verdict.ok).toBe(false);
  });
});
