import { buildObservationEventsFromAcceptedGrading, type MisconceptionRecord } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildExplainBackObservationContext,
  hasExplainBackSourceRevisionChanged,
} from '../../src/explain-back/observation.js';
import type { ExplainBackSourceBlock } from '../../src/explain-back/request.js';

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

  // `ol-gavc`: this function only threads the caller's own verdict through —
  // it never re-derives it — since a fresh retrieval needs a `VaultSource`
  // this pure module has no access to.
  it('threads sourceRevisionStale through unchanged when the caller supplies true', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [],
      now: fixedNow,
      sourceRevisionStale: true,
    });

    expect(context.sourceRevisionStale).toBe(true);
  });

  it('leaves sourceRevisionStale undefined when the caller omits it — never a false claim of freshness', () => {
    const context = buildExplainBackObservationContext({
      subjectConceptId: 'concept-a',
      originInstrumentId: 'inst-1',
      originReviewEventId: null,
      sourceBlocks: [],
      records: [],
      now: fixedNow,
    });

    expect(context.sourceRevisionStale).toBeUndefined();
  });
});

function sourceBlock(overrides: Partial<ExplainBackSourceBlock> = {}): ExplainBackSourceBlock {
  return {
    block: { blockId: 'note.md#0#0', text: 'original passage text' },
    path: 'note.md',
    blockIndex: 0,
    ...overrides,
  };
}

describe('hasExplainBackSourceRevisionChanged — ol-0r92.89', () => {
  it('is false when a fresh retrieval returns the identical set of passages', () => {
    const graded = [sourceBlock()];
    const fresh = [sourceBlock()];
    expect(hasExplainBackSourceRevisionChanged(graded, fresh)).toBe(false);
  });

  it('is true when the text at the same path/blockIndex has changed', () => {
    const graded = [
      sourceBlock({ block: { blockId: 'note.md#0#0', text: 'original passage text' } }),
    ];
    const fresh = [sourceBlock({ block: { blockId: 'note.md#0#0', text: 'edited passage text' } })];
    expect(hasExplainBackSourceRevisionChanged(graded, fresh)).toBe(true);
  });

  it('is true when a passage disappears from a fresh retrieval', () => {
    const graded = [sourceBlock(), sourceBlock({ path: 'note2.md', blockIndex: 1 })];
    const fresh = [sourceBlock()];
    expect(hasExplainBackSourceRevisionChanged(graded, fresh)).toBe(true);
  });

  it('is true when a passage is added on a fresh retrieval', () => {
    const graded = [sourceBlock()];
    const fresh = [sourceBlock(), sourceBlock({ path: 'note2.md', blockIndex: 1 })];
    expect(hasExplainBackSourceRevisionChanged(graded, fresh)).toBe(true);
  });

  it('is false when only blockId shifts (re-embed reordering) but path/blockIndex/text are unchanged', () => {
    // `blockId` is minted from the retrieved list's position (`request.ts`'s
    // `path#blockIndex#index`) — a re-embed that returns the same two
    // passages in the opposite order mints different blockIds for both
    // without the underlying source having changed at all.
    const passageA = {
      block: { blockId: 'a.md#0#0', text: 'passage a' },
      path: 'a.md',
      blockIndex: 0,
    };
    const passageB = {
      block: { blockId: 'b.md#0#1', text: 'passage b' },
      path: 'b.md',
      blockIndex: 0,
    };
    const graded = [passageA, passageB];
    const fresh = [
      { block: { blockId: 'b.md#0#0', text: 'passage b' }, path: 'b.md', blockIndex: 0 },
      { block: { blockId: 'a.md#0#1', text: 'passage a' }, path: 'a.md', blockIndex: 0 },
    ];
    expect(hasExplainBackSourceRevisionChanged(graded, fresh)).toBe(false);
  });
});

describe('buildExplainBackObservationContext: the permitted list is the only binding ([D-482])', () => {
  const baseParams = {
    originInstrumentId: 'inst-1',
    originReviewEventId: null,
    sourceBlocks: [
      { block: { blockId: 'blk-1', text: 'x' }, path: 'note.md', blockIndex: 0 },
    ] as readonly ExplainBackSourceBlock[],
    now: fixedNow,
  };
  const candidate = (concept: string, confusedWith?: string) => ({
    concept,
    statement: 'an invented wrong belief',
    correction: 'the invented fact',
    correctionSourceBlockIds: ['blk-1'],
    // `[D-490]`, ol-egov.141.89.6.91: absent authorship is refused; the wiring marks her typed answer hers.
    statementAuthorship: 'hers' as const,
    ...(confusedWith !== undefined ? { confusedWith } : {}),
  });

  // @auto:plugin/explain-back/observation.spec
  it('refuses a candidate whose concept label is not among the permitted ids', async () => {
    const context = buildExplainBackObservationContext({
      ...baseParams,
      subjectConceptId: 'concept-a',
      permittedConceptIds: ['concept-a'],
      records: [],
    });
    expect(context.resolveConceptId('a free label the model invented')).toBeNull();
    const [outcome] = await buildObservationEventsFromAcceptedGrading(
      [candidate('a free label the model invented')],
      context,
      { embedder: null },
    );
    if (!outcome?.skipped) throw new Error('expected a skip');
    expect(outcome.reason).toBe('unresolved-concept');
  });

  // @auto:plugin/explain-back/observation.spec
  it('binds a first-ever misconception on the known subject to the subject id', async () => {
    const context = buildExplainBackObservationContext({
      ...baseParams,
      subjectConceptId: 'concept-a',
      permittedConceptIds: ['concept-a'],
      records: [],
    });
    const [outcome] = await buildObservationEventsFromAcceptedGrading(
      [candidate('concept-a')],
      context,
      { embedder: null },
    );
    if (!outcome || outcome.skipped) throw new Error('expected a recorded outcome');
    expect(outcome.result.event.conceptId).toBe('concept-a');
  });

  it('binds both ids for a confusion with the resolved neighbour', async () => {
    const context = buildExplainBackObservationContext({
      ...baseParams,
      subjectConceptId: 'concept-a',
      permittedConceptIds: ['concept-a', 'concept-b'],
      records: [],
    });
    const [outcome] = await buildObservationEventsFromAcceptedGrading(
      [candidate('concept-a', 'concept-b')],
      context,
      { embedder: null },
    );
    if (!outcome || outcome.skipped) throw new Error('expected a recorded outcome');
    expect(outcome.result.event.conceptId).toBe('concept-a');
    expect(outcome.result.event.confusedWithConceptId).toBe('concept-b');
  });

  it('does not record a subject confused with itself', async () => {
    const context = buildExplainBackObservationContext({
      ...baseParams,
      subjectConceptId: 'concept-a',
      permittedConceptIds: ['concept-a'],
      records: [],
    });
    const [outcome] = await buildObservationEventsFromAcceptedGrading(
      [candidate('concept-a', 'concept-a')],
      context,
      { embedder: null },
    );
    expect(outcome?.skipped).toBe(true);
  });

  it('a free topic permits nothing: no candidate binds', async () => {
    const context = buildExplainBackObservationContext({
      ...baseParams,
      subjectConceptId: null,
      permittedConceptIds: [],
      records: [],
    });
    expect(context.resolveConceptId('concept-a')).toBeNull();
  });

  // @auto:plugin/explain-back/observation.spec
  it('a stale Worker that ignored the list still cannot bind a free label: the client refuses it', async () => {
    // No permittedConceptIds given: falls back to the subject alone, so a label the stale Worker
    // produced for lack of the rule is refused exactly the same way.
    const context = buildExplainBackObservationContext({
      ...baseParams,
      subjectConceptId: 'concept-a',
      records: [],
    });
    expect(context.resolveConceptId('Concept A, in the model’s own words')).toBeNull();
    expect(context.resolveConceptId('concept-a')).toBe('concept-a');
  });
});
