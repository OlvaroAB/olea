import { describe, expect, it } from 'vitest';
import {
  type AcceptedGradingMisconceptionCandidate,
  type AcceptedGradingObservationContext,
  buildObservationEventsFromAcceptedGrading,
} from './accepted-grading-observation.js';
import type { MisconceptionEmbeddingCacheStore } from './embedding-cache.js';
import { MisconceptionEmbeddingCacheEngine } from './embedding-cache.js';
import type { EmbeddingVector, MisconceptionEmbedder, MisconceptionRecord } from './types.js';

function candidate(
  overrides: Partial<AcceptedGradingMisconceptionCandidate> = {},
): AcceptedGradingMisconceptionCandidate {
  return {
    concept: 'newtons-second-law',
    statement: 'Thinks force and acceleration are the same quantity.',
    correction: 'Force equals mass times acceleration — they are related, not identical.',
    correctionSourceBlockIds: ['block-1'],
    ...overrides,
  };
}

function baseContext(
  overrides: Partial<AcceptedGradingObservationContext> = {},
): AcceptedGradingObservationContext {
  return {
    originInstrumentId: 'explain-back:newtons-second-law:1',
    originReviewEventId: 'review-event-1',
    timestamp: '2026-08-29T09:00:00-04:00',
    resolveCitation: (blockId) =>
      blockId === 'block-1' ? { path: 'Courses/Physics/notes.md', blockIndex: 2 } : null,
    resolveConceptId: (concept) => (concept === 'newtons-second-law' ? 'concept-nsl' : null),
    candidateRecordsForConcept: () => [],
    ...overrides,
  };
}

class MemoryStore implements MisconceptionEmbeddingCacheStore {
  private saved: Awaited<ReturnType<MisconceptionEmbeddingCacheStore['load']>> = null;
  async load() {
    return this.saved;
  }
  async save(cache: Awaited<ReturnType<MisconceptionEmbeddingCacheStore['load']>>) {
    this.saved = cache;
  }
}

class ScriptedEmbedder implements MisconceptionEmbedder {
  readonly calls: (readonly string[])[] = [];
  constructor(private readonly vectorByText: ReadonlyMap<string, EmbeddingVector>) {}
  async embed(texts: readonly string[]): Promise<readonly EmbeddingVector[]> {
    this.calls.push(texts);
    return texts.map((text) => this.vectorByText.get(text) ?? [0, 0, 0]);
  }
}

function record(id: string, conceptId: string, statement: string): MisconceptionRecord {
  return {
    id,
    conceptId,
    confusedWithConceptId: null,
    statement,
    correction: 'The source says otherwise.',
    citation: { path: 'Courses/Physics/notes.md', blockIndex: 1 },
    firstSeen: '2026-08-01T00:00:00-04:00',
    lastSeen: '2026-08-01T00:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:concept-nsl:0',
  };
}

describe('buildObservationEventsFromAcceptedGrading — mapping and no-embedder fallback', () => {
  it('maps a resolvable candidate into an observation event, minting fresh with no embedder', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading([candidate()], baseContext(), {
      embedder: null,
      generateMisconceptionId: () => 'fresh-id',
    });

    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0];
    if (!outcome || outcome.skipped) throw new Error('expected a resolved outcome');
    expect(outcome.result.matchedExisting).toBe(false);
    expect(outcome.result.event.misconceptionId).toBe('fresh-id');
    expect(outcome.result.event.conceptId).toBe('concept-nsl');
    expect(outcome.result.event.citation).toEqual({
      path: 'Courses/Physics/notes.md',
      blockIndex: 2,
    });
  });

  it('resolves confusedWith to a second concept id when present', async () => {
    const context = baseContext({
      resolveConceptId: (concept) => {
        if (concept === 'newtons-second-law') return 'concept-nsl';
        if (concept === 'newtons-third-law') return 'concept-ntl';
        return null;
      },
    });
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [candidate({ confusedWith: 'newtons-third-law' })],
      context,
      { embedder: null },
    );
    const outcome = outcomes[0];
    if (!outcome || outcome.skipped) throw new Error('expected a resolved outcome');
    expect(outcome.result.event.confusedWithConceptId).toBe('concept-ntl');
  });

  it('matches an existing record via the real embedder when candidates are supplied for the resolved concept', async () => {
    const existingStatement = 'Thinks force and acceleration are literally the same thing.';
    const vectors = new Map<string, EmbeddingVector>([
      [candidate().statement, [1, 0, 0]],
      [existingStatement, [1, 0, 0.001]],
    ]);
    const embedder = new ScriptedEmbedder(vectors);
    const existing = record('existing-1', 'concept-nsl', existingStatement);
    const context = baseContext({ candidateRecordsForConcept: () => [existing] });

    const outcomes = await buildObservationEventsFromAcceptedGrading([candidate()], context, {
      embedder,
    });

    const outcome = outcomes[0];
    if (!outcome || outcome.skipped) throw new Error('expected a resolved outcome');
    expect(outcome.result.matchedExisting).toBe(true);
    expect(outcome.result.event.misconceptionId).toBe('existing-1');
  });

  it('uses a supplied cache for candidate embeddings, never re-embedding an already-cached statement', async () => {
    const existingStatement = 'Thinks force and acceleration are literally the same thing.';
    const vectors = new Map<string, EmbeddingVector>([
      [candidate().statement, [1, 0, 0]],
      [existingStatement, [1, 0, 0.001]],
    ]);
    const embedder = new ScriptedEmbedder(vectors);
    const cache = await MisconceptionEmbeddingCacheEngine.create({
      store: new MemoryStore(),
      embedder,
      model: 'model-a',
    });
    const existing = record('existing-1', 'concept-nsl', existingStatement);
    await cache.candidatesFor([existing]);
    embedder.calls.length = 0;

    const context = baseContext({ candidateRecordsForConcept: () => [existing] });
    const outcomes = await buildObservationEventsFromAcceptedGrading([candidate()], context, {
      embedder,
      cache,
    });

    const outcome = outcomes[0];
    if (!outcome || outcome.skipped) throw new Error('expected a resolved outcome');
    expect(outcome.result.matchedExisting).toBe(true);
    expect(embedder.calls).toEqual([[candidate().statement]]);
  });
});

describe('buildObservationEventsFromAcceptedGrading — never invents a citation or a concept binding', () => {
  it('skips a candidate whose concept cannot be resolved, rather than inventing an id', async () => {
    const context = baseContext({ resolveConceptId: () => null });
    const outcomes = await buildObservationEventsFromAcceptedGrading([candidate()], context, {
      embedder: null,
    });
    expect(outcomes).toEqual([
      { candidate: candidate(), skipped: true, reason: 'unresolved-concept' },
    ]);
  });

  it('skips a candidate whose citation cannot be resolved, rather than inventing one', async () => {
    const context = baseContext({ resolveCitation: () => null });
    const outcomes = await buildObservationEventsFromAcceptedGrading([candidate()], context, {
      embedder: null,
    });
    expect(outcomes).toEqual([{ candidate: candidate(), skipped: true, reason: 'uncitable' }]);
  });

  it('skips a candidate with no correctionSourceBlockIds at all, rather than crashing', async () => {
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [candidate({ correctionSourceBlockIds: [] })],
      baseContext(),
      { embedder: null },
    );
    expect(outcomes).toEqual([
      {
        candidate: candidate({ correctionSourceBlockIds: [] }),
        skipped: true,
        reason: 'uncitable',
      },
    ]);
  });

  it('processes multiple candidates independently — one skip does not affect another candidate', async () => {
    const resolvable = candidate();
    const unresolvable = candidate({ concept: 'unknown-concept', statement: 'A different claim.' });
    const outcomes = await buildObservationEventsFromAcceptedGrading(
      [resolvable, unresolvable],
      baseContext(),
      { embedder: null, generateMisconceptionId: () => 'fresh-id' },
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.skipped).toBe(false);
    expect(outcomes[1]).toEqual({
      candidate: unresolvable,
      skipped: true,
      reason: 'unresolved-concept',
    });
  });
});
