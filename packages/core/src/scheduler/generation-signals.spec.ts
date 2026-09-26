// Signal source for D-238's deck-served-out-or-lapsed generation trigger —
// GEN-3.5 (`ol-2zfj.136`).

import { describe, expect, it } from 'vitest';
import { deckServingSignal } from './generation-signals.js';
import type { SchedulerState } from './types.js';

/** A minimal, valid `SchedulerState` — mirrors `mastery/rollup.spec.ts`'s own fixture. */
function state(overrides: Partial<SchedulerState> = {}): SchedulerState {
  return {
    schemaVersion: 1,
    due: '2026-09-01T00:00:00.000Z',
    stability: 1,
    difficulty: 5,
    scheduledDays: 1,
    learningStepIndex: 0,
    reps: 1,
    lapses: 0,
    learningState: 'review',
    lastReview: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('deckServingSignal — deckServedOut', () => {
  it('an empty deck is never served out', () => {
    expect(deckServingSignal({ deck: [] })).toEqual({ deckServedOut: false, lapsed: false });
  });

  it('every instrument served at least once: served out', () => {
    const result = deckServingSignal({
      deck: [
        { instrumentType: 'mcq', state: state() },
        { instrumentType: 'qa', state: state() },
      ],
    });
    expect(result.deckServedOut).toBe(true);
  });

  it('one never-reviewed instrument: not served out', () => {
    const result = deckServingSignal({
      deck: [
        { instrumentType: 'mcq', state: state() },
        { instrumentType: 'qa', state: null },
      ],
    });
    expect(result.deckServedOut).toBe(false);
  });
});

describe('deckServingSignal — lapsed (F2.12 evidence)', () => {
  it('below CONFUSION_ROUTING_LAPSE_THRESHOLD: not lapsed', () => {
    const result = deckServingSignal({
      deck: [{ instrumentType: 'qa', state: state({ lapses: 3 }) }],
    });
    expect(result.lapsed).toBe(false);
  });

  it('at CONFUSION_ROUTING_LAPSE_THRESHOLD, on a recall-tier instrument: lapsed', () => {
    const result = deckServingSignal({
      deck: [{ instrumentType: 'qa', state: state({ lapses: 4 }) }],
    });
    expect(result.lapsed).toBe(true);
  });

  it('cloze is recall-tier too', () => {
    const result = deckServingSignal({
      deck: [{ instrumentType: 'cloze', state: state({ lapses: 10 }) }],
    });
    expect(result.lapsed).toBe(true);
  });

  it('mcq is recognition-tier: never counts toward lapsed, however high', () => {
    const result = deckServingSignal({
      deck: [{ instrumentType: 'mcq', state: state({ lapses: 100 }) }],
    });
    expect(result.lapsed).toBe(false);
  });

  it('a never-reviewed instrument has no lapses to read', () => {
    const result = deckServingSignal({ deck: [{ instrumentType: 'qa', state: null }] });
    expect(result.lapsed).toBe(false);
  });
});
