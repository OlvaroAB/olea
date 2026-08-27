// Floor load as a countable quantity (register row 3.7) — @auto:core/session/floor-load.spec
import { describe, expect, it } from 'vitest';
import type { ObligationSignals } from '../study-session/compose.js';
import { classifyObligation } from '../study-session/compose.js';
import { floorLoadOf } from './floor-load.js';

const ASOF = '2026-06-01';

function signals(overrides: Partial<ObligationSignals>): ObligationSignals {
  return {
    masteryState: 'seed',
    lastRetrievalDay: null,
    recallDueDay: null,
    arrivalDay: null,
    asOf: ASOF,
    ...overrides,
  };
}

describe('floorLoadOf', () => {
  it('reports an honest zero for an empty population, never a caller error', () => {
    expect(floorLoadOf([])).toEqual({
      conceptCount: 0,
      floorLoad: 0,
      byClass: { unmet: 0, 'recall-due': 0, 'baseline-due': 0, elective: 0 },
    });
  });

  it('counts every obligation class, and floorLoad names baseline-due on its own', () => {
    const concepts = [
      // unmet: never retrieved.
      { conceptKey: 'c-unmet', signals: signals({ lastRetrievalDay: null }) },
      // recall-due: FSRS says due today.
      {
        conceptKey: 'c-recall',
        signals: signals({ lastRetrievalDay: '2026-05-01', recallDueDay: ASOF }),
      },
      // baseline-due: a mature ('tree', 21-day rung) concept last seen 30 days ago.
      {
        conceptKey: 'c-baseline',
        signals: signals({ masteryState: 'tree', lastRetrievalDay: '2026-05-02' }),
      },
      // elective: a sprout (5-day rung) retrieved yesterday — comfortably inside its window.
      {
        conceptKey: 'c-elective',
        signals: signals({ masteryState: 'sprout', lastRetrievalDay: '2026-05-31' }),
      },
    ];

    const tally = floorLoadOf(concepts);

    expect(tally.conceptCount).toBe(4);
    expect(tally.floorLoad).toBe(1);
    expect(tally.byClass).toEqual({ unmet: 1, 'recall-due': 1, 'baseline-due': 1, elective: 1 });
  });

  it('never disagrees with classifyObligation — it recovers a discarded fact, not a second opinion', () => {
    const concepts = Array.from({ length: 25 }, (_, i) => ({
      conceptKey: `c-${i}`,
      signals: signals({
        masteryState: i % 3 === 0 ? 'sprout' : i % 3 === 1 ? 'sapling' : 'tree',
        lastRetrievalDay: `2026-05-${String(1 + (i % 28)).padStart(2, '0')}`,
      }),
    }));

    const tally = floorLoadOf(concepts);
    const expectedFloorLoad = concepts.filter(
      (c) => classifyObligation(c.signals).klass === 'baseline-due',
    ).length;

    expect(tally.floorLoad).toBe(expectedFloorLoad);
    expect(tally.conceptCount).toBe(25);
  });
});
