import { describe, expect, it } from 'vitest';
import {
  buildObservationEvent,
  buildResolutionEvidenceEvent,
  type ObservationInput,
  type ResolutionEvidenceInput,
} from './events.js';

// Synthetic study material only (INV-3) — invented concept/citation ids and
// wording, never real vault content.

function baseObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement: 'Believes X always implies Y.',
    correction: 'The source states X implies Y only under condition Z.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 3 },
    originInstrumentId: 'explain-back:concept-alpha:1',
    originReviewEventId: 'review-event-1',
    timestamp: '2026-08-16T09:00:00-04:00',
    ...overrides,
  };
}

describe('buildObservationEvent', () => {
  it('mints a fresh misconceptionId when no candidate matches', () => {
    const result = buildObservationEvent(baseObservationInput(), {
      statementEmbedding: [1, 0, 0, 0],
      candidates: [],
      generateEventId: () => 'event-1',
      generateMisconceptionId: () => 'misconception-fresh-1',
    });

    expect(result.matchedExisting).toBe(false);
    expect(result.event.kind).toBe('observed');
    expect(result.event.eventId).toBe('event-1');
    expect(result.event.misconceptionId).toBe('misconception-fresh-1');
    expect(result.event.schemaVersion).toBe(1);
  });

  it('reuses an existing misconceptionId when M1 matches, and never calls the id generator for it', () => {
    let generateMisconceptionIdCalls = 0;
    const result = buildObservationEvent(baseObservationInput(), {
      statementEmbedding: [1, 0, 0, 0],
      candidates: [{ id: 'misconception-existing', embedding: [2, 0, 0, 0] }], // same direction, cosine 1
      generateEventId: () => 'event-2',
      generateMisconceptionId: () => {
        generateMisconceptionIdCalls += 1;
        return 'should-not-be-used';
      },
    });

    expect(result.matchedExisting).toBe(true);
    expect(result.event.misconceptionId).toBe('misconception-existing');
    expect(generateMisconceptionIdCalls).toBe(0);
  });

  it('defaults to crypto.randomUUID() for both generators when none are supplied', () => {
    const result = buildObservationEvent(baseObservationInput(), {
      statementEmbedding: [1, 0, 0, 0],
      candidates: [],
    });
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(result.event.eventId).toMatch(uuidPattern);
    expect(result.event.misconceptionId).toMatch(uuidPattern);
  });

  it('carries confusedWithConceptId through as an explicit null when absent, never omitted', () => {
    const result = buildObservationEvent(baseObservationInput({ confusedWithConceptId: null }), {
      statementEmbedding: [1, 0, 0, 0],
      candidates: [],
    });
    expect(Object.hasOwn(result.event, 'confusedWithConceptId')).toBe(true);
    expect(result.event.confusedWithConceptId).toBeNull();
  });

  it('carries a populated confusedWithConceptId through unchanged', () => {
    const result = buildObservationEvent(
      baseObservationInput({ confusedWithConceptId: 'concept-beta' }),
      { statementEmbedding: [1, 0, 0, 0], candidates: [] },
    );
    expect(result.event.confusedWithConceptId).toBe('concept-beta');
  });

  describe('no-embedder fallback (ol-nagi)', () => {
    it('mints a fresh id and skips M1 entirely when statementEmbedding is omitted, even with a candidate that would otherwise match', () => {
      const result = buildObservationEvent(baseObservationInput(), {
        // No `statementEmbedding` at all — the F7.8 grey-out case: no
        // MisconceptionEmbedder was available to the caller.
        candidates: [{ id: 'misconception-existing', embedding: [1, 0, 0, 0] }],
        generateEventId: () => 'event-no-embedder',
        generateMisconceptionId: () => 'misconception-fresh-no-embedder',
      });

      expect(result.matchedExisting).toBe(false);
      expect(result.event.misconceptionId).toBe('misconception-fresh-no-embedder');
    });

    it('still stamps every other field correctly with no embedding available', () => {
      const result = buildObservationEvent(baseObservationInput(), { candidates: [] });
      expect(result.event.kind).toBe('observed');
      expect(result.event.conceptId).toBe('concept-alpha');
      expect(result.event.schemaVersion).toBe(1);
    });
  });
});

function baseResolutionInput(
  overrides: Partial<ResolutionEvidenceInput> = {},
): ResolutionEvidenceInput {
  return {
    conceptId: 'concept-alpha',
    evidenceKind: 'explanation',
    originInstrumentId: 'explain-back:concept-alpha:2',
    originReviewEventId: 'review-event-2',
    timestamp: '2026-08-16T09:05:00-04:00',
    ...overrides,
  };
}

describe('buildResolutionEvidenceEvent', () => {
  it('builds a resolution-evidence event with no misconceptionId field at all', () => {
    const event = buildResolutionEvidenceEvent(baseResolutionInput(), {
      generateEventId: () => 'event-3',
    });
    expect(event.kind).toBe('resolution-evidence');
    expect(event.eventId).toBe('event-3');
    expect('misconceptionId' in event).toBe(false);
  });

  it('carries the evidenceKind through unchanged and restricts to recall/explanation by type', () => {
    const recall = buildResolutionEvidenceEvent(baseResolutionInput({ evidenceKind: 'recall' }));
    expect(recall.evidenceKind).toBe('recall');
  });
});
