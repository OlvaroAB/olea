/**
 * Standing proof for R3's four promises about the vitality reading: the fold
 * is a minimum, tier is a filter and not a weight, the sufficiency floor is
 * evidential, and the holding cut is handed in rather than defaulted.
 *
 * Most tests drive a stub `Scheduler` whose recall probability is dictated per
 * instrument, because the properties under test are properties of the *fold*
 * and a real forgetting curve only makes them harder to state. The last block
 * runs the real `ts-fsrs`-backed port end to end, so the two halves are known
 * to fit together.
 */

import { describe, expect, it } from 'vitest';
import { createFsrsScheduler } from '../scheduler/fsrs-scheduler.js';
import type { Scheduler, SchedulerState } from '../scheduler/types.js';
import { isRecallTier, readVitality, type VitalityInstrument } from './vitality.js';

const NOW = new Date('2026-03-01T09:00:00.000Z');

function stateAt(lastReview: string, stability = 10): SchedulerState {
  return {
    schemaVersion: 1,
    due: '2026-03-11T09:00:00.000Z',
    stability,
    difficulty: 5,
    scheduledDays: 10,
    learningStepIndex: 0,
    reps: 3,
    lapses: 0,
    learningState: 'review',
    lastReview,
  };
}

const REVIEWED = stateAt('2026-02-19T09:00:00.000Z');

/**
 * A `Scheduler` whose recall probability is looked up per instrument id, so a
 * test can say "this instrument is faded and that one is fresh" without
 * reverse-engineering a stability that produces it. `schedule` throws: the
 * fold must never call it, and a stub that silently tolerated the call would
 * hide that.
 */
function stubScheduler(byInstrument: Readonly<Record<string, number>>): Scheduler {
  return {
    schedule() {
      throw new Error('readVitality must never schedule anything');
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

function recall(instrumentId: string, state: SchedulerState | null = REVIEWED): VitalityInstrument {
  return { instrumentId, instrumentType: 'qa', state };
}

describe('isRecallTier', () => {
  it('admits the two scheduled recall types and excludes the other two, for two different reasons', () => {
    expect(isRecallTier('qa')).toBe(true);
    expect(isRecallTier('cloze')).toBe(true);
    // Recognition-tier: R3's filter.
    expect(isRecallTier('mcq')).toBe(false);
    // Never FSRS-scheduled at all, so it has no retrievability to contribute.
    expect(isRecallTier('explain-back')).toBe(false);
  });
});

describe('readVitality — the sufficiency floor (R3)', () => {
  const scheduler = stubScheduler({ 'inst-1': 0.99, 'inst-mcq': 1 });

  it('reads early when the concept has no instruments at all', () => {
    const reading = readVitality({ instruments: [], scheduler, now: NOW, holdingCut: 0.9 });
    expect(reading).toStrictEqual({ value: 'early', weakest: null, instrumentsRead: 0 });
  });

  it('reads early when every recall-tier instrument is unreviewed', () => {
    const reading = readVitality({
      instruments: [recall('inst-1', null)],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('early');
    expect(reading.instrumentsRead).toBe(0);
  });

  it('reads early when the concept is recognition-only, however well the MCQ is doing', () => {
    // The MCQ is configured at a perfect 1.0. If tier were a weight rather
    // than a filter, this would read `holding` — the exact confusion R3's
    // "filter, never a weight" sentence exists to prevent.
    const reading = readVitality({
      instruments: [{ instrumentId: 'inst-mcq', instrumentType: 'mcq', state: REVIEWED }],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('early');
  });

  it('reads early for an explain-back that somehow carries scheduling state', () => {
    const reading = readVitality({
      instruments: [
        { instrumentId: 'inst-explain', instrumentType: 'explain-back', state: REVIEWED },
      ],
      scheduler: stubScheduler({ 'inst-explain': 1 }),
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('early');
  });

  it('leaves the floor on the FIRST completed recall review, however it went', () => {
    // R3: the floor is evidential, not temporal, and "a concept practised a
    // little with unreliable recall is one the tool has real evidence about" —
    // the honest reading is `tending`, never still `early`.
    const reading = readVitality({
      instruments: [recall('inst-1')],
      scheduler: stubScheduler({ 'inst-1': 0.2 }),
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('tending');
    expect(reading.instrumentsRead).toBe(1);
  });

  it('never returns null or undefined in place of a reading', () => {
    const reading = readVitality({ instruments: [], scheduler, now: NOW, holdingCut: 0.9 });
    // F2.11: `early` is a first-class state, not an absence. A caller must
    // never have to infer "unknown" from a null.
    expect(reading.value).toBe('early');
    expect(reading.value).not.toBeNull();
  });
});

describe('readVitality — the fold is a MINIMUM (R3)', () => {
  it('one faded instrument pulls the whole concept to tending, however fresh the rest are', () => {
    const scheduler = stubScheduler({ fresh: 0.99, alsoFresh: 0.98, faded: 0.4 });
    const reading = readVitality({
      instruments: [recall('fresh'), recall('alsoFresh'), recall('faded')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    // Max would say holding (0.99). Mean would say holding (0.79 -> still
    // below, but 0.99/0.98/0.85 would not). Minimum cannot hide the faded one,
    // which is the entire reason R3 picked it.
    expect(reading.value).toBe('tending');
    expect(reading.weakest).toStrictEqual({ instrumentId: 'faded', recallProbability: 0.4 });
  });

  it('is not a mean: three instruments averaging above the cut still read tending if one is below', () => {
    const scheduler = stubScheduler({ a: 1, b: 1, c: 0.8 });
    // mean = 0.933, comfortably above the cut; minimum = 0.8, below it.
    const reading = readVitality({
      instruments: [recall('a'), recall('b'), recall('c')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('tending');
  });

  it('names the weakest instrument on a holding reading too, not only on a tending one', () => {
    const scheduler = stubScheduler({ a: 0.99, b: 0.93 });
    const reading = readVitality({
      instruments: [recall('a'), recall('b')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('holding');
    expect(reading.weakest).toStrictEqual({ instrumentId: 'b', recallProbability: 0.93 });
  });

  it('names the first instrument at the minimum when two are tied, so reordering the input cannot change the explanation', () => {
    const scheduler = stubScheduler({ a: 0.5, b: 0.5 });
    const forwards = readVitality({
      instruments: [recall('a'), recall('b')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    const backwards = readVitality({
      instruments: [recall('b'), recall('a')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(forwards.weakest?.instrumentId).toBe('a');
    expect(backwards.weakest?.instrumentId).toBe('b');
    // The *value* is what must not move; which of two identical instruments is
    // named is presentation, and both readings agree on the number.
    expect(forwards.value).toBe(backwards.value);
    expect(forwards.weakest?.recallProbability).toBe(backwards.weakest?.recallProbability);
  });
});

describe('readVitality — tier is a filter, never a weight (R3)', () => {
  it('adding a perfect MCQ to a faded concept changes nothing', () => {
    const scheduler = stubScheduler({ faded: 0.4, 'inst-mcq': 1 });
    const withoutMcq = readVitality({
      instruments: [recall('faded')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    const withMcq = readVitality({
      instruments: [
        recall('faded'),
        { instrumentId: 'inst-mcq', instrumentType: 'mcq', state: REVIEWED },
      ],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(withMcq).toStrictEqual(withoutMcq);
  });

  it('a faded MCQ cannot drag a holding concept down either — absent means absent in both directions', () => {
    const scheduler = stubScheduler({ good: 0.99, 'inst-mcq': 0.01 });
    const reading = readVitality({
      instruments: [
        recall('good'),
        { instrumentId: 'inst-mcq', instrumentType: 'mcq', state: REVIEWED },
      ],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    });
    expect(reading.value).toBe('holding');
    expect(reading.instrumentsRead).toBe(1);
  });
});

describe('readVitality — the holding cut is handed in, never defaulted', () => {
  const scheduler = stubScheduler({ a: 0.92 });
  const instruments = [recall('a')];

  it('reads holding exactly at the cut, and tending a hair below it', () => {
    expect(readVitality({ instruments, scheduler, now: NOW, holdingCut: 0.92 }).value).toBe(
      'holding',
    );
    expect(readVitality({ instruments, scheduler, now: NOW, holdingCut: 0.9200001 }).value).toBe(
      'tending',
    );
  });

  it('the SAME evidence reads differently under different cuts — which is why the constant is undecided, not cosmetic', () => {
    expect(readVitality({ instruments, scheduler, now: NOW, holdingCut: 0.8 }).value).toBe(
      'holding',
    );
    expect(readVitality({ instruments, scheduler, now: NOW, holdingCut: 0.95 }).value).toBe(
      'tending',
    );
  });

  it('throws rather than guessing when the cut could not be a probability', () => {
    for (const holdingCut of [0, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => readVitality({ instruments, scheduler, now: NOW, holdingCut })).toThrow(
        RangeError,
      );
    }
    // A cut of exactly 1 is degenerate but representable — "only a perfect
    // reading counts as holding" is a coherent (if useless) position, and
    // rejecting it would be this module inventing policy.
    expect(() => readVitality({ instruments, scheduler, now: NOW, holdingCut: 1 })).not.toThrow();
  });

  it('exports no cut of its own for a caller to pick up by accident', async () => {
    const module = await import('./vitality.js');
    for (const [name, value] of Object.entries(module)) {
      expect(
        typeof value === 'number',
        `vitality.ts exports a number named ${name}; the holding cut is a derived constant and must not live in this file`,
      ).toBe(false);
    }
  });
});

describe('readVitality — purity', () => {
  it('never schedules, and returns the same reading for the same input twice', () => {
    const scheduler = stubScheduler({ a: 0.95, b: 0.7 });
    const input = {
      instruments: [recall('a'), recall('b')],
      scheduler,
      now: NOW,
      holdingCut: 0.9,
    };
    expect(readVitality(input)).toStrictEqual(readVitality(input));
  });
});

describe('readVitality — against the real ts-fsrs port', () => {
  const scheduler = createFsrsScheduler();

  function reviewedAt(instrumentId: string, at: Date): VitalityInstrument {
    const { state } = scheduler.schedule({ instrumentId, state: null, rating: 'good', now: at });
    return { instrumentId, instrumentType: 'qa', state };
  }

  it('reads holding immediately after a review and decays to tending as the concept is left alone', () => {
    const reviewedOn = new Date('2026-03-01T09:00:00.000Z');
    const instruments = [reviewedAt('inst-1', reviewedOn)];
    const holdingCut = 0.9;

    const sameDay = readVitality({ instruments, scheduler, now: reviewedOn, holdingCut });
    expect(sameDay.value).toBe('holding');

    // A long absence. The stage would not have moved — the rollup reads no
    // wall clock — and this axis is the one that carries the decay.
    const muchLater = readVitality({
      instruments,
      scheduler,
      now: new Date('2026-06-01T09:00:00.000Z'),
      holdingCut,
    });
    expect(muchLater.value).toBe('tending');
    expect(muchLater.weakest?.recallProbability).toBeLessThan(
      sameDay.weakest?.recallProbability ?? 1,
    );
  });

  it('the reading never improves while the concept is left alone', () => {
    const instruments = [reviewedAt('inst-1', new Date('2026-03-01T09:00:00.000Z'))];
    const probabilities = [0, 1, 3, 7, 14, 30, 90, 365].map(
      (days) =>
        readVitality({
          instruments,
          scheduler,
          now: new Date(Date.UTC(2026, 2, 1, 9) + days * 86_400_000),
          holdingCut: 0.9,
        }).weakest?.recallProbability ?? Number.NaN,
    );
    for (let i = 1; i < probabilities.length; i += 1) {
      expect(probabilities[i]).toBeLessThanOrEqual(probabilities[i - 1] as number);
    }
  });

  it('a concept whose weakest instrument is stale reads tending even when another was reviewed today', () => {
    const today = new Date('2026-06-01T09:00:00.000Z');
    const instruments = [
      reviewedAt('stale', new Date('2026-03-01T09:00:00.000Z')),
      reviewedAt('fresh', today),
    ];
    const reading = readVitality({ instruments, scheduler, now: today, holdingCut: 0.9 });
    expect(reading.value).toBe('tending');
    expect(reading.weakest?.instrumentId).toBe('stale');
    expect(reading.instrumentsRead).toBe(2);
  });
});
