import { describe, expect, it } from 'vitest';
import { mergeMisconceptionEvents } from './merge.js';
import type { MisconceptionEvent } from './types.js';

function event(overrides: Partial<MisconceptionEvent> = {}): MisconceptionEvent {
  return {
    schemaVersion: 1,
    kind: 'observed',
    eventId: 'e1',
    timestamp: '2026-08-16T09:00:00-04:00',
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: null,
    misconceptionId: 'm-1',
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'X implies Y only under condition Z.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
    ...overrides,
  } as MisconceptionEvent;
}

describe('mergeMisconceptionEvents', () => {
  it('dedupes identical events sharing an eventId across two device sources', () => {
    const a = event({ eventId: 'e1' });
    const b = { ...a };
    const result = mergeMisconceptionEvents([a], [b]);
    expect(result.events).toHaveLength(1);
    expect(result.duplicateEventIds).toEqual(['e1']);
  });

  it('is commutative: merge(a, b) === merge(b, a)', () => {
    const a = event({ eventId: 'e1', timestamp: '2026-08-16T09:00:00-04:00' });
    const b = event({
      eventId: 'e2',
      timestamp: '2026-08-16T10:00:00-04:00',
      misconceptionId: 'm-2',
    });
    const forward = mergeMisconceptionEvents([a], [b]);
    const backward = mergeMisconceptionEvents([b], [a]);
    expect(forward.events).toEqual(backward.events);
  });

  it('is idempotent: merge(a, b, a, b) === merge(a, b)', () => {
    const a = event({ eventId: 'e1' });
    const b = event({ eventId: 'e2', misconceptionId: 'm-2' });
    const once = mergeMisconceptionEvents([a], [b]);
    const repeated = mergeMisconceptionEvents([a], [b], [a], [b]);
    expect(repeated.events).toEqual(once.events);
  });

  it('throws when the same eventId appears with different content — a real collision, not a duplicate', () => {
    const a = event({ eventId: 'e1', statement: 'First wording.' });
    const b = event({ eventId: 'e1', statement: 'Different wording, same id.' });
    expect(() => mergeMisconceptionEvents([a], [b])).toThrow(/eventId/);
  });

  it('sorts merged output by timestamp instant, then eventId as a stable tiebreak', () => {
    const later = event({ eventId: 'e2', timestamp: '2026-08-17T09:00:00-04:00' });
    const earlier = event({ eventId: 'e1', timestamp: '2026-08-16T09:00:00-04:00' });
    const result = mergeMisconceptionEvents([later], [earlier]);
    expect(result.events.map((e) => e.eventId)).toEqual(['e1', 'e2']);
  });

  it('handles zero sources without throwing', () => {
    expect(mergeMisconceptionEvents().events).toEqual([]);
  });
});
