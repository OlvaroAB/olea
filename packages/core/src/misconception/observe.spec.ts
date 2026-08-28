import { describe, expect, it } from 'vitest';
import type {
  MisconceptionEmbeddingCacheStore,
  PersistedMisconceptionEmbeddingCache,
} from './embedding-cache.js';
import { MisconceptionEmbeddingCacheEngine } from './embedding-cache.js';
import type { ObservationInput } from './events.js';
import { buildObservationEventWithEmbedding } from './observe.js';
import type { EmbeddingVector, MisconceptionEmbedder, MisconceptionRecord } from './types.js';

class MemoryStore implements MisconceptionEmbeddingCacheStore {
  private saved: PersistedMisconceptionEmbeddingCache | null = null;
  async load() {
    return this.saved;
  }
  async save(cache: PersistedMisconceptionEmbeddingCache) {
    this.saved = cache;
  }
}

/**
 * A fake whose vectors are handed in explicitly per text, so tests can
 * script "these two statements are the same misconception" (near-identical
 * vectors) versus "these are different" (orthogonal vectors) without
 * depending on any real embedding model.
 */
class ScriptedEmbedder implements MisconceptionEmbedder {
  readonly calls: (readonly string[])[] = [];
  constructor(private readonly vectorByText: ReadonlyMap<string, EmbeddingVector>) {}

  async embed(texts: readonly string[]): Promise<readonly EmbeddingVector[]> {
    this.calls.push(texts);
    return texts.map((text) => this.vectorByText.get(text) ?? [0, 0, 0]);
  }
}

function record(id: string, statement: string): MisconceptionRecord {
  return {
    id,
    conceptId: 'concept-alpha',
    confusedWithConceptId: null,
    statement,
    correction: 'The source says otherwise.',
    citation: { path: 'Courses/Sample/notes.md', blockIndex: 1 },
    firstSeen: '2026-08-01T00:00:00-04:00',
    lastSeen: '2026-08-01T00:00:00-04:00',
    occurrenceCount: 1,
    status: 'active',
    originInstrumentId: 'explain-back:concept-alpha:1',
  };
}

const baseInput: ObservationInput = {
  conceptId: 'concept-alpha',
  confusedWithConceptId: null,
  statement: 'Thinks X always causes Y.',
  correction: 'X causes Y only under condition Z.',
  citation: { path: 'Courses/Sample/notes.md', blockIndex: 3 },
  originInstrumentId: 'explain-back:concept-alpha:2',
  originReviewEventId: 'review-event-2',
  timestamp: '2026-08-20T09:00:00-04:00',
};

describe('buildObservationEventWithEmbedding — no-embedder fallback', () => {
  it('always mints a fresh id when embedder is null, regardless of candidates', async () => {
    const existing = record('existing-1', 'Thinks X always causes Y.');
    const result = await buildObservationEventWithEmbedding(baseInput, {
      embedder: null,
      candidateRecords: [existing],
      generateMisconceptionId: () => 'fresh-id',
    });

    expect(result.matchedExisting).toBe(false);
    expect(result.event.misconceptionId).toBe('fresh-id');
  });
});

describe('buildObservationEventWithEmbedding — real similarity when the embedder is present', () => {
  it('matches an existing record when the embedder reports near-identical vectors (uncached path)', async () => {
    const existingStatement = 'Thinks X always causes Y, no exceptions.';
    const vectors = new Map<string, EmbeddingVector>([
      [baseInput.statement, [1, 0, 0]],
      [existingStatement, [1, 0, 0.001]], // effectively parallel -> cosine ~1
    ]);
    const embedder = new ScriptedEmbedder(vectors);
    const existing = record('existing-1', existingStatement);

    const result = await buildObservationEventWithEmbedding(baseInput, {
      embedder,
      candidateRecords: [existing],
    });

    expect(result.matchedExisting).toBe(true);
    expect(result.event.misconceptionId).toBe('existing-1');
    // One batched call: [new statement, ...candidate statements] — no cache wired.
    expect(embedder.calls).toEqual([[baseInput.statement, existingStatement]]);
  });

  it('mints fresh when the embedder reports an orthogonal vector for the candidate (genuinely different misconception)', async () => {
    const differentStatement = 'Confuses velocity with acceleration entirely.';
    const vectors = new Map<string, EmbeddingVector>([
      [baseInput.statement, [1, 0, 0]],
      [differentStatement, [0, 1, 0]],
    ]);
    const embedder = new ScriptedEmbedder(vectors);
    const existing = record('existing-1', differentStatement);

    const result = await buildObservationEventWithEmbedding(baseInput, {
      embedder,
      candidateRecords: [existing],
      generateMisconceptionId: () => 'fresh-id',
    });

    expect(result.matchedExisting).toBe(false);
    expect(result.event.misconceptionId).toBe('fresh-id');
  });

  it('uses the cache for candidates when one is supplied, embedding the new statement separately and never re-embedding an already-cached candidate', async () => {
    const existingStatement = 'Thinks X always causes Y, no exceptions.';
    const vectors = new Map<string, EmbeddingVector>([
      [baseInput.statement, [1, 0, 0]],
      [existingStatement, [1, 0, 0.001]],
    ]);
    const embedder = new ScriptedEmbedder(vectors);
    const cache = await MisconceptionEmbeddingCacheEngine.create({
      store: new MemoryStore(),
      embedder,
      model: 'model-a',
    });
    const existing = record('existing-1', existingStatement);

    // Prime the cache for the candidate ahead of time, as a caller running
    // repeated observations against the same concept would.
    await cache.candidatesFor([existing]);
    embedder.calls.length = 0;

    const result = await buildObservationEventWithEmbedding(baseInput, {
      embedder,
      cache,
      candidateRecords: [existing],
    });

    expect(result.matchedExisting).toBe(true);
    expect(result.event.misconceptionId).toBe('existing-1');
    // Only the NEW statement was sent — the candidate came from cache.
    expect(embedder.calls).toEqual([[baseInput.statement]]);
  });
});
