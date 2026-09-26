/**
 * `draftCardsForConcept` tests (`ol-0r92.116`).
 *
 * A lighter mirror of `../retrieval/draft-quiz-cards.spec.ts` — the shared
 * grounding mechanics (`retrieve()`, the band, the composite veto, the real
 * `WorkerGroundingJudge`) are already proven exhaustively there and in
 * `groundedContext.spec.ts`/`compositeSignals.spec.ts` (`olea-core`); this
 * file only needs to prove the two properties specific to THIS call site:
 *
 * 1. **The load-bearing line**: a refused retrieval never reaches
 *    `transport.send` — proven with the same "completely empty index"
 *    fixture `draft-quiz-cards.spec.ts` uses for the identical assertion.
 * 2. **The payload this call site actually builds** names the right task id
 *    (`cards.generate.v1`, not `quiz.generate.v1`) and forwards
 *    `purpose`/`registerHint` on the same terms `DraftQuizCardsRequest`
 *    documents.
 *
 * Reuses `draft-quiz-cards.spec.ts`'s exact filler count (100, 101 chunks
 * total) rather than a smaller one — not an arbitrary match. `marginP99` is
 * `top1` minus the corpus's own 99th cosine percentile, computed over EVERY
 * chunk including the target; with too few total chunks, the 99th
 * percentile's own rank lands ON the target (the single highest value)
 * rather than excluding it, collapsing the margin to zero regardless of how
 * well-grounded the target is (confirmed empirically while writing this
 * file — a 20-filler version of this fixture refuses
 * `below-composite-threshold` even at cosine 1.0, for exactly this reason).
 * 100 fillers is the smallest round number this fixture's own author
 * measured to keep the percentile off the target.
 */
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import { type DraftCardsDeps, draftCardsForConcept } from '../../src/generation/draft-cards.js';

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

/** Same fixed-vector-by-text fake `draft-quiz-cards.spec.ts` uses. */
class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();

  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (!vector) {
          throw new Error(
            `LookupEmbeddingProvider: no vector registered for ${JSON.stringify(text)}`,
          );
        }
        return vector;
      }),
    };
  }
}

function index(
  docs: readonly { path: string; blocks: readonly string[] }[],
): PersistedKeywordIndex {
  return {
    version: 1,
    documents: docs.map((doc) => ({
      path: doc.path,
      courses: [],
      contentHash: 'unused',
      blocks: doc.blocks.map((text, blockIndex) => ({
        blockIndex,
        kind: 'paragraph' as const,
        text,
      })),
    })),
  };
}

function fakeTransport(cardsResponse?: () => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      if (request.taskId === 'grounding.judge.v1') {
        return {
          ok: true,
          stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
          result: { supported: true, reason: 'the passages answer the query' },
        };
      }
      return (cardsResponse ?? defaultCardsResponse)();
    },
    calls,
  };
}

function defaultCardsResponse(): unknown {
  return {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
    result: { cards: [{ front: 'front text', back: 'back text', subject: 'mitochondria' }] },
  };
}

// ---- the orthogonal fixture (see `draft-quiz-cards.spec.ts` for the argument) ----

const FILLER_COUNT = 100;
const DIM = 2 + FILLER_COUNT;
const QUERY_TEXT = 'mitochondria';
const TARGET_TEXT = 'Mitochondria is the powerhouse of the cell and drives cellular respiration.';
const TARGET_PATH = 'course/mitochondria-lecture.md';

function unitVector(i: number): number[] {
  const v = new Array(DIM).fill(0);
  v[i] = 1;
  return v;
}

function buildFixture(targetCosine: number): {
  readonly keywordIndex: PersistedKeywordIndex;
  readonly provider: LookupEmbeddingProvider;
} {
  const provider = new LookupEmbeddingProvider();
  const targetVector = unitVector(0);
  const residual = Math.sqrt(Math.max(0, 1 - targetCosine * targetCosine));
  const queryVector = unitVector(0).map(
    (component, i) => component * targetCosine + (i === 1 ? residual : 0),
  );
  provider.register(TARGET_TEXT, targetVector);
  provider.register(QUERY_TEXT, queryVector);

  const fillerDocs: { path: string; blocks: readonly string[] }[] = [];
  for (let i = 0; i < FILLER_COUNT; i++) {
    const text = `unrelated filler passage number ${i} about an unrelated topic`;
    provider.register(text, unitVector(2 + i));
    fillerDocs.push({ path: `filler/${i}.md`, blocks: [text] });
  }

  const keywordIndex = index([{ path: TARGET_PATH, blocks: [TARGET_TEXT] }, ...fillerDocs]);
  return { keywordIndex, provider };
}

async function makeRetrieveDeps(
  keywordIndex: PersistedKeywordIndex,
  provider: LookupEmbeddingProvider,
) {
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider: provider };
}

const REQUEST = { courseCode: 'COGS214', conceptName: QUERY_TEXT };
const ABOVE_BAND_COSINE = 1.0; // clears the band's upper bar (0.8) and the composite — auto-grounds, no judge escalation

describe('draftCardsForConcept (ol-0r92.116)', () => {
  it('a completely empty index refuses and NEVER calls transport.send — the load-bearing property, per draft-quiz-cards.spec.ts', async () => {
    const provider = new LookupEmbeddingProvider();
    provider.register(QUERY_TEXT, unitVector(0));
    const transport = fakeTransport();
    const deps: DraftCardsDeps = {
      retrieve: await makeRetrieveDeps(index([]), provider),
      transport,
    };

    const result = await draftCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'no-hits' });
    expect(transport.calls).toHaveLength(0);
  });

  it('a well-grounded concept drafts through cards.generate.v1, not quiz.generate.v1, with the request payload this call site built', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport();
    const deps: DraftCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('cards.generate.v1');
    if (result.status === 'drafted') {
      expect(result.request.courseCode).toBe('COGS214');
      expect(result.request.conceptName).toBe(QUERY_TEXT);
      expect(result.request.sourceChunks).toEqual([TARGET_TEXT]);
      expect(result.request.personalization).toEqual({
        voiceExemplars: { phrasing: [], terminology: [] },
      });
      expect(result.request.purpose).toBeUndefined();
      expect(result.request.registerHint).toBeUndefined();
    }
  });

  it('forwards purpose and registerHint verbatim, same as draftQuizCardsForConcept', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport();
    const deps: DraftCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftCardsForConcept(deps, {
      ...REQUEST,
      purpose: 'readiness',
      registerHint: { terminology: ['mitosis'] },
    });

    expect(result.status).toBe('drafted');
    if (result.status === 'drafted') {
      expect(result.request.purpose).toBe('readiness');
      expect(result.request.registerHint).toEqual({ terminology: ['mitosis'] });
    }
  });
});
