// Scenario: features/F6-today.md's F6.2 Today mastery overview
// (features/F6-today.md:297, which names this rollup as its blocker).
// Concept ids are structural placeholders, never fixture vocabulary — INV-3.
// (`conceptSprig`, once covered here for F2.3, was deleted per `ol-sp9v` —
// see docs/dev/wiring-register.md's sprig section.)
import type { ReviewLogRecord } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { Scheduler } from '../scheduler/types.js';
import { MASTERY_ORDER } from './display.js';
import { masteryDistribution, masteryVitalityByStage } from './sprig.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-10T09:00:00-04:00',
    instrumentId: 'qa:concept-a:1',
    instrumentType: 'qa',
    conceptIds: ['concept-a'],
    rating: 'good',
    wasUnsure: false,
    durationMs: 1200,
    selectionContext: {
      dueState: 'due',
      examProximity: null,
      yieldRank: null,
      instrumentTypesOffered: ['qa'],
      planVersion: null,
    },
    ...overrides,
  };
}

describe('masteryDistribution — the Today mastery overview (F6.2)', () => {
  it('an empty set of concepts is an all-zero distribution', () => {
    const dist = masteryDistribution([], []);
    expect(dist.total).toBe(0);
    expect(Object.values(dist.counts).every((n) => n === 0)).toBe(true);
    expect(Object.keys(dist.counts)).toEqual([...MASTERY_ORDER]);
  });

  it('a concept named in the requested set but absent from the log counts as seed, not omitted', () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      review({
        eventId: `a${i}`,
        timestamp: `2026-01-0${i + 1}T09:00:00-04:00`,
        conceptIds: ['concept-a'],
        rating: 'good',
      }),
    );
    const dist = masteryDistribution(entries, ['concept-a', 'concept-never-studied']);
    expect(dist.total).toBe(2);
    expect(dist.counts.seed).toBe(1);
    expect(dist.counts.tree).toBe(1);
  });

  it('buckets each concept independently — never an aggregate mastery number', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) =>
        review({
          eventId: `a${i}`,
          timestamp: `2026-01-0${i + 1}T09:00:00-04:00`,
          conceptIds: ['concept-a'],
          rating: 'good',
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        review({
          eventId: `b${i}`,
          timestamp: `2026-02-0${i + 1}T09:00:00-04:00`,
          conceptIds: ['concept-b'],
          rating: 'again',
        }),
      ),
      review({ eventId: 'c0', conceptIds: ['concept-c'], instrumentType: 'mcq', rating: 'good' }),
    ];
    const dist = masteryDistribution(entries, ['concept-a', 'concept-b', 'concept-c']);
    expect(dist.total).toBe(3);
    expect(dist.counts.tree).toBe(1); // concept-a: spaced recall success
    // concept-b (all misses) and concept-c (one successful MCQ, one
    // session — high recent rate, but the spacing gate holds it below
    // `sapling`) both read `sprout`: the ratified vocabulary has one word
    // for "practised, not holding yet" where the retired ordinal split it
    // into `shaky` and `coming` (D-049; see rollup.ts's module doc).
    expect(dist.counts.sprout).toBe(2);
  });

  it('defaults to every concept the log names when no set is given', () => {
    const entries = [
      review({ conceptIds: ['concept-a'] }),
      review({ eventId: 'x', conceptIds: ['concept-x'] }),
    ];
    const dist = masteryDistribution(entries);
    expect(dist.total).toBe(2);
  });
});

const NOW = new Date('2026-03-01T09:00:00.000Z');

/** Same stub technique `mastery/rollup.spec.ts` uses — see that file for why `schedule` must still return a real-shaped state. */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
    schedule({ instrumentId, now }) {
      return {
        instrumentId,
        state: {
          schemaVersion: 1,
          due: now.toISOString(),
          stability: 1,
          difficulty: 5,
          scheduledDays: 1,
          learningStepIndex: 0,
          reps: 1,
          lapses: 0,
          learningState: 'review',
          lastReview: now.toISOString(),
        },
        intervalDays: 1,
      };
    },
    retrievability({ instrumentId }) {
      const recallProbability = byInstrument[instrumentId];
      if (recallProbability === undefined) {
        throw new Error(`stubScheduler: no probability configured for ${instrumentId}`);
      }
      return { instrumentId, recallProbability };
    },
  };
}

describe('masteryVitalityByStage — `[VIT-2]` (`ol-a3hv`)', () => {
  it('buckets every concept under the ONE stage it actually sits at, never a stage-blind global tally', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) =>
        review({
          eventId: `a${i}`,
          timestamp: `2026-01-0${i + 1}T09:00:00-04:00`,
          conceptIds: ['concept-a'],
          instrumentId: 'qa:concept-a:1',
          rating: 'good',
        }),
      ),
      review({
        eventId: 'b0',
        conceptIds: ['concept-b'],
        instrumentId: 'qa:concept-b:1',
        rating: 'again',
      }),
    ];
    // concept-a reaches `tree`; concept-b (a single miss) reads `sprout`.
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.2, 'qa:concept-b:1': 0.99 });
    const result = masteryVitalityByStage(entries, ['concept-a', 'concept-b'], {
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });

    expect(result.byStage.tree).toEqual({ holding: 0, tending: 1, early: 0 });
    expect(result.byStage.sprout).toEqual({ holding: 1, tending: 0, early: 0 });
    // Every other stage's bucket is present and all-zero — never a sparse map.
    expect(result.byStage.seed).toEqual({ holding: 0, tending: 0, early: 0 });
    expect(result.byStage.sapling).toEqual({ holding: 0, tending: 0, early: 0 });
    expect(result.tending).toEqual([
      { conceptId: 'concept-a', state: 'tree', weakestInstrumentId: 'qa:concept-a:1' },
    ]);
  });

  it('a concept absent from the log entirely reads seed and too-early-to-say, never holding', () => {
    const scheduler = stubScheduler({});
    const result = masteryVitalityByStage([], ['concept-never-studied'], {
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(result.byStage.seed).toEqual({ holding: 0, tending: 0, early: 1 });
    expect(result.tending).toEqual([]);
  });

  it('carries no retrievability figure anywhere in its shape — only the derived vitality value and ids', () => {
    const scheduler = stubScheduler({ 'qa:concept-a:1': 0.5 });
    const result = masteryVitalityByStage(
      [review({ eventId: 'a0', conceptIds: ['concept-a'], instrumentId: 'qa:concept-a:1' })],
      ['concept-a'],
      { scheduler, now: NOW, holdingCut: 0.9 },
    );
    for (const concept of result.tending) {
      expect(Object.keys(concept).sort()).toEqual(['conceptId', 'state', 'weakestInstrumentId']);
    }
  });
});
