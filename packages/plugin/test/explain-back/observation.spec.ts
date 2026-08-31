import type { MisconceptionRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { buildExplainBackObservationContext } from '../../src/explain-back/observation.js';

function record(overrides: Partial<MisconceptionRecord> = {}): MisconceptionRecord {
  return {
    id: 'mc-1',
    conceptId: 'concept-a',
    confusedWithConceptId: null,
    statement: 'stated wrong belief',
    correction: 'the actual fact',
    citation: { path: 'note.md', blockIndex: 0 },
    status: 'active',
    occurrenceCount: 1,
    firstSeen: '2026-01-01T00:00:00Z',
    lastSeen: '2026-01-01T00:00:00Z',
    originInstrumentId: 'inst-1',
    ...overrides,
  };
}

const fixedNow = () => new Date('2026-08-31T00:00:00Z');

describe('buildExplainBackObservationContext', () => {
  it('resolveCitation maps a minted blockId back to the {path, blockIndex} it was retrieved from', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [{ block: { blockId: 'blk-1', text: 'x' }, path: 'note.md', blockIndex: 3 }],
      records: [],
      now: fixedNow,
    });

    expect(context.resolveCitation('blk-1')).toEqual({ path: 'note.md', blockIndex: 3 });
  });

  it('resolveCitation returns null for a blockId never supplied — never invented', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [],
      now: fixedNow,
    });

    expect(context.resolveCitation('unknown-block')).toBeNull();
  });

  it('resolveConceptId matches the exact subject concept id string, and only that', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [],
      now: fixedNow,
    });

    expect(context.resolveConceptId('concept-a')).toBe('concept-a');
    expect(context.resolveConceptId('concept-b')).toBeNull();
    expect(context.resolveConceptId('a free-text label the model invented')).toBeNull();
  });

  it('resolveConceptId always returns null when no subject concept is known (the free-form entry point)', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: null,
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [],
      now: fixedNow,
    });

    expect(context.resolveConceptId('concept-a')).toBeNull();
  });

  it('candidateRecordsForConcept filters the loaded records to the resolved concept id', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [record({ conceptId: 'concept-a' }), record({ id: 'mc-2', conceptId: 'concept-b' })],
      now: fixedNow,
    });

    const eligible = context.candidateRecordsForConcept('concept-a');
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.id).toBe('mc-1');
  });

  it('carries originInstrumentId, a null originReviewEventId, and a real ISO timestamp through', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-42',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [],
      now: fixedNow,
    });

    expect(context.originInstrumentId).toBe('inst-42');
    expect(context.originReviewEventId).toBeNull();
    expect(context.timestamp).toBe('2026-08-31T00:00:00.000Z');
  });
});
