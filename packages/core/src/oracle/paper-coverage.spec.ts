import { describe, expect, it } from 'vitest';
import { projectPaperDemandCoverage } from './paper-coverage.js';
import type { PaperDemand, PaperEmptySlotReasonCode } from './paper-types.js';

// Scenarios: olea-service/features/F4-oracle.md, F4.11 (`[D-438]`), tagged
// `@auto:core/oracle/paper-coverage.spec` (T16).

const item = (intendedDemand: PaperDemand = 'recall-a-fact') => ({ intendedDemand });
const empty = (reasonCode: PaperEmptySlotReasonCode, intendedDemand?: PaperDemand) => ({
  reasonCode,
  ...(intendedDemand !== undefined ? { intendedDemand } : {}),
});

describe('T16 coverage against the original structure', () => {
  it('one filled of eight reads one eighth, the attempted figure only beside it', () => {
    const c = projectPaperDemandCoverage({
      structureSlotCount: 8,
      compositionDemand: 'recall-a-fact',
      intendedDemandBasis: 'default-no-reading',
      items: [item()],
      emptySlots: [
        empty('source-support-refused'),
        empty('source-support-refused'),
        empty('generator-refused'),
      ],
    });
    expect(c.structureSlots).toBe(8);
    expect(c.filled).toBe(1);
    expect(c.yieldAgainstStructure).toBe(1 / 8);
    expect(c.yieldOverAttempted).toBe(1 / 2);
    expect(c.unreachedSlots).toBe(4);
  });

  it('unreached template slots stay in the denominator; rank-excluded are extent and are not counted', () => {
    const c = projectPaperDemandCoverage({
      structureSlotCount: 8,
      compositionDemand: 'recall-a-fact',
      intendedDemandBasis: 'default-no-reading',
      items: [item(), item()],
      emptySlots: [empty('rank-excluded'), empty('rank-excluded')],
    });
    expect(c.yieldAgainstStructure).toBe(2 / 8);
    expect(c.unreachedSlots).toBe(6);
    expect(c.byDemand[0]?.intendedSlots).toBe(2);
    expect(c.byDemand[0]?.emptyByReason).toEqual({});
  });

  it('keeps the reasons apart per demand, and a pre-P2 empty slot reads the composition demand', () => {
    const c = projectPaperDemandCoverage({
      structureSlotCount: 4,
      compositionDemand: 'recall-a-fact',
      intendedDemandBasis: 'read',
      demandShares: new Map<PaperDemand, number>([
        ['recall-a-fact', 0.7],
        ['calculate', 0.3],
      ]),
      items: [item()],
      emptySlots: [
        empty('source-support-refused', 'calculate'),
        empty('demand-unsupported'),
        empty('source-support-refused', 'calculate'),
      ],
    });
    expect(c.byDemand).toEqual([
      {
        demand: 'recall-a-fact',
        structureShare: 0.7,
        intendedSlots: 2,
        filled: 1,
        emptyByReason: { 'demand-unsupported': 1 },
      },
      {
        demand: 'calculate',
        structureShare: 0.3,
        intendedSlots: 2,
        filled: 0,
        emptyByReason: { 'source-support-refused': 2 },
      },
    ]);
  });

  it('a minority demand with no slot still shows its share with zero filled', () => {
    const c = projectPaperDemandCoverage({
      structureSlotCount: 2,
      compositionDemand: 'recall-a-fact',
      intendedDemandBasis: 'read',
      demandShares: new Map<PaperDemand, number>([
        ['recall-a-fact', 0.75],
        ['calculate', 0.25],
      ]),
      items: [item()],
      emptySlots: [],
    });
    expect(c.byDemand.find((r) => r.demand === 'calculate')).toMatchObject({
      structureShare: 0.25,
      intendedSlots: 0,
      filled: 0,
    });
  });

  it('a default basis has no share, and no structure slots reads null, never a good figure', () => {
    const c = projectPaperDemandCoverage({
      structureSlotCount: 0,
      compositionDemand: 'recall-a-fact',
      intendedDemandBasis: 'default-no-reading',
      demandShares: new Map<PaperDemand, number>([['recall-a-fact', 1]]),
      items: [],
      emptySlots: [],
    });
    expect(c.yieldAgainstStructure).toBeNull();
    expect(c.yieldOverAttempted).toBeNull();
    expect(c.byDemand).toEqual([]);
  });

  it('the empty-package branch: a nothing-retrieved slot is intended, unfilled and never "attempted"', () => {
    const c = projectPaperDemandCoverage({
      structureSlotCount: 3,
      compositionDemand: 'calculate',
      intendedDemandBasis: 'default-no-reading',
      items: [],
      emptySlots: [empty('source-support-refused', 'calculate')],
    });
    expect(c.yieldOverAttempted).toBeNull();
    expect(c.yieldAgainstStructure).toBe(0);
    expect(c.byDemand[0]).toMatchObject({ demand: 'calculate', intendedSlots: 1, filled: 0 });
  });
});
