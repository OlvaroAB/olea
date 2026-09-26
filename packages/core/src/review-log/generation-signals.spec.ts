// Signal source for D-238's format-ask generation trigger — GEN-3.5 (`ol-2zfj.136`).

import type { InstrumentType, Rating, ReviewLogEntry, SelectionContextV4 } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import { observedInstrumentTypeOrder, requestedKindFor } from './generation-signals.js';

const CONTEXT: SelectionContextV4 = {
  dueState: 'due',
  examProximity: null,
  yieldRank: null,
  instrumentTypesOffered: ['qa'],
  planVersion: null,
};

/** Mirrors `session/replay.spec.ts`'s own fixture — a minimal `'review'`-kind entry. */
function review(
  eventId: string,
  instrumentId: string,
  instrumentType: InstrumentType,
  rating: Rating | null = 'good',
): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'review',
    eventId,
    timestamp: '2026-08-10T09:00:00+00:00',
    instrumentId,
    instrumentType,
    conceptIds: ['concept-a'],
    rating,
    wasUnsure: false,
    durationMs: null,
    selectionContext: CONTEXT,
  };
}

function suspend(eventId: string, instrumentId: string): ReviewLogEntry {
  return {
    schemaVersion: 5,
    kind: 'suspend',
    eventId,
    timestamp: '2026-08-10T09:00:00+00:00',
    instrumentId,
    conceptIds: ['concept-a'],
  };
}

describe('observedInstrumentTypeOrder', () => {
  it('nothing observed yet reads as empty, never a guessed order', () => {
    expect(observedInstrumentTypeOrder([])).toEqual([]);
  });

  it('one kind reviewed is the whole order', () => {
    expect(observedInstrumentTypeOrder([review('e1', 'i1', 'mcq')])).toEqual(['mcq']);
  });

  it('most-frequent first', () => {
    const entries = [
      review('e1', 'i1', 'mcq'),
      review('e2', 'i2', 'mcq'),
      review('e3', 'i3', 'qa'),
    ];
    expect(observedInstrumentTypeOrder(entries)).toEqual(['mcq', 'qa']);
  });

  it("a tie breaks by F2.14's own listed order (qa, cloze, mcq)", () => {
    const entries = [review('e1', 'i1', 'mcq'), review('e2', 'i2', 'qa')];
    expect(observedInstrumentTypeOrder(entries)).toEqual(['qa', 'mcq']);
  });

  it('explain-back attempts are never counted — F2.14 is not FSRS-scheduled', () => {
    const entries = [
      review('e1', 'i1', 'explain-back', null),
      review('e2', 'i2', 'explain-back', null),
      review('e3', 'i3', 'qa'),
    ];
    expect(observedInstrumentTypeOrder(entries)).toEqual(['qa']);
  });

  it('a suspension event is never counted', () => {
    const entries = [suspend('e1', 'i1'), review('e2', 'i2', 'mcq')];
    expect(observedInstrumentTypeOrder(entries)).toEqual(['mcq']);
  });
});

describe('requestedKindFor', () => {
  it('a known format match wins outright', () => {
    expect(requestedKindFor('qa', ['mcq'])).toBe('qa');
  });

  it('absent a format match, falls back to the observed order', () => {
    expect(requestedKindFor(null, ['mcq', 'qa'])).toBe('mcq');
  });

  it('neither names a kind: null, never a floored default (unlike the arrival call)', () => {
    expect(requestedKindFor(null, [])).toBeNull();
  });
});
