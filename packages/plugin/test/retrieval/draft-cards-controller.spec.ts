/**
 * `runDraftCards` tests (`ol-odb0`, the modal's controller).
 *
 * Reuses the same orthogonal-fixture technique
 * `test/retrieval/draft-quiz-cards.spec.ts` documents and justifies at
 * length (101 chunks — see that file's module doc for why fewer than that
 * makes `marginP99` unsatisfiable regardless of match quality, `ol-3h2f`).
 * This file does not re-derive `draftQuizCardsForConcept`'s own refusal/
 * transport-count proofs — those stay exactly where they are — it only
 * proves the one extra step this module adds: turning that result, plus a
 * raw Worker envelope, into the four outcome kinds the modal renders.
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
import { runDraftCards } from '../../src/retrieval/draft-cards-controller.js';
import type { DraftQuizCardsDeps } from '../../src/retrieval/draft-quiz-cards.js';

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();
  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return {
      vectors: request.texts.map((text) => {
        const vector = this.vectors.get(text);
        if (!vector) throw new Error(`no vector registered for ${JSON.stringify(text)}`);
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

function fakeTransport(respond: (request: WorkerTaskRequest) => unknown) {
  const calls: WorkerTaskRequest[] = [];
  return {
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      return respond(request);
    },
    calls,
  };
}

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

/** A 101-chunk corpus whose target chunk clears every composite clause — see the module doc. */
function buildGroundedFixture(): {
  readonly keywordIndex: PersistedKeywordIndex;
  readonly provider: LookupEmbeddingProvider;
} {
  const provider = new LookupEmbeddingProvider();
  provider.register(TARGET_TEXT, unitVector(0));
  provider.register(QUERY_TEXT, unitVector(0));
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

describe('runDraftCards', () => {
  it('an empty vault comes back as a refused outcome with non-transient copy', async () => {
    const provider = new LookupEmbeddingProvider();
    provider.register(QUERY_TEXT, unitVector(0));
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(index([]), provider),
      transport: fakeTransport(() => {
        throw new Error('must never be called on a refused retrieval');
      }),
    };

    const outcome = await runDraftCards(deps, REQUEST);

    expect(outcome.kind).toBe('refused');
    if (outcome.kind === 'refused') expect(outcome.copy.transient).toBe(false);
  });

  it('a grounded concept with a well-formed success envelope comes back as drafted questions', async () => {
    const { keywordIndex, provider } = buildGroundedFixture();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport: fakeTransport(() => ({
        ok: true,
        stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
        result: {
          questions: [
            { stem: 'stem', correctAnswer: 'a', distractors: ['b', 'c', 'd'], feedback: 'why' },
          ],
        },
      })),
    };

    const outcome = await runDraftCards(deps, REQUEST);

    expect(outcome).toEqual({
      kind: 'drafted',
      questions: [
        { stem: 'stem', correctAnswer: 'a', distractors: ['b', 'c', 'd'], feedback: 'why' },
      ],
    });
  });

  it('a grounded concept whose Worker call fails comes back as a worker-error, not a silent empty draft', async () => {
    const { keywordIndex, provider } = buildGroundedFixture();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport: fakeTransport(() => ({
        ok: false,
        code: 'upstream-error',
        message: 'The model did not answer.',
      })),
    };

    const outcome = await runDraftCards(deps, REQUEST);

    expect(outcome).toEqual({ kind: 'worker-error', message: 'The model did not answer.' });
  });

  it('a grounded concept whose response body is not the expected shape comes back as unparseable', async () => {
    const { keywordIndex, provider } = buildGroundedFixture();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport: fakeTransport(() => ({ ok: true, stamp: {}, result: 'not an object' })),
    };

    const outcome = await runDraftCards(deps, REQUEST);

    expect(outcome).toEqual({ kind: 'unparseable' });
  });
});
