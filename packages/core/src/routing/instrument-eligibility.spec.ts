import type {
  ReviewLogEntry,
  ReviewLogRecord,
  SuspendLogRecord,
  VerdictLogRecord,
} from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import {
  hasDifferentEligibleOrdinaryInstrument,
  ORDINARY_INSTRUMENT_TYPES,
} from './instrument-eligibility.js';

function review(overrides: Partial<ReviewLogRecord> = {}): ReviewLogRecord {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId: `r-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-08-10T09:00:00-04:00',
    instrumentId: 'qa:widget-theory:1',
    instrumentType: 'qa',
    conceptIds: ['widget-theory'],
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

function suspend(overrides: Partial<SuspendLogRecord> = {}): SuspendLogRecord {
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId: `s-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-08-11T09:00:00-04:00',
    instrumentId: 'qa:widget-theory:2',
    conceptIds: ['widget-theory'],
    ...overrides,
  };
}

function verdict(overrides: Partial<VerdictLogRecord> = {}): VerdictLogRecord {
  return {
    schemaVersion: 5,
    kind: 'verdict',
    eventId: `v-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-08-11T09:00:00-04:00',
    instrumentId: 'qa:widget-theory:3',
    instrumentType: 'qa',
    conceptIds: ['widget-theory'],
    verdict: 'rejected',
    artifactProvenance: {
      taskId: 'cards.generate.v1',
      promptVersion: '1.0.0',
      modelId: 'test-model',
    },
    ...overrides,
  };
}

describe('ORDINARY_INSTRUMENT_TYPES', () => {
  it('is exactly qa, cloze, mcq — never explain-back', () => {
    expect([...ORDINARY_INSTRUMENT_TYPES].sort()).toEqual(['cloze', 'mcq', 'qa']);
  });
});

describe('hasDifferentEligibleOrdinaryInstrument', () => {
  it('is false when the review log has never seen any instrument for the concept', () => {
    expect(hasDifferentEligibleOrdinaryInstrument([], 'widget-theory', new Set())).toBe(false);
  });

  it('is true when a different, ordinary, untouched instrument exists on the concept', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({ instrumentId: 'cloze:widget-theory:1', instrumentType: 'cloze' }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(true);
  });

  it('is false when the only other instrument is the excluded (disagreeing) one', () => {
    const entries: readonly ReviewLogEntry[] = [review({ instrumentId: 'qa:widget-theory:1' })];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(false);
  });

  it('is false when the only other instrument is currently suspended', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({ instrumentId: 'cloze:widget-theory:1', instrumentType: 'cloze' }),
      suspend({ instrumentId: 'cloze:widget-theory:1' }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(false);
  });

  it('is true again once the suspended instrument is unsuspended', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({ instrumentId: 'cloze:widget-theory:1', instrumentType: 'cloze' }),
      suspend({ instrumentId: 'cloze:widget-theory:1', timestamp: '2026-08-11T09:00:00-04:00' }),
      suspend({
        kind: 'unsuspend',
        instrumentId: 'cloze:widget-theory:1',
        timestamp: '2026-08-12T09:00:00-04:00',
      }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(true);
  });

  it("is false when the only other instrument's latest verdict is rejected", () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({ instrumentId: 'qa:widget-theory:3' }),
      verdict({ instrumentId: 'qa:widget-theory:3', verdict: 'rejected' }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(false);
  });

  it('is true when the only other instrument was accepted, not rejected', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({ instrumentId: 'qa:widget-theory:3' }),
      verdict({ instrumentId: 'qa:widget-theory:3', verdict: 'accepted' }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(true);
  });

  it('ignores an explain-back instrument entirely — never "ordinary"', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({
        instrumentId: 'explain-back:widget-theory:1',
        instrumentType: 'explain-back',
        rating: null,
      }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(false);
  });

  it('never reads an instrument logged against a different concept', () => {
    const entries: readonly ReviewLogEntry[] = [
      review({ instrumentId: 'qa:widget-theory:1' }),
      review({
        instrumentId: 'qa:gadget-theory:1',
        conceptIds: ['gadget-theory'],
      }),
    ];

    expect(
      hasDifferentEligibleOrdinaryInstrument(
        entries,
        'widget-theory',
        new Set(['qa:widget-theory:1']),
      ),
    ).toBe(false);
  });
});
