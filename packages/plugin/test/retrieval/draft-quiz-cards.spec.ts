/**
 * `draftQuizCardsForConcept` tests (`ol-odb0.2`, `ol-odb0.3`).
 *
 * Three things this file has to prove, per the beads' own acceptance
 * criteria, and each gets its own `describe` block below:
 *
 * 1. **INV-5 against the WIRED path, not the pure function** (`ol-odb0.3`).
 *    A completely empty index refuses, and — the property that actually
 *    matters, per `ol-odb0`'s own diagnosis — `transport.send` is never
 *    called when that happens. Counting the transport calls, not inspecting
 *    the shape of the result, is what tells "refused before ever asking"
 *    apart from "asked, and the model said zero" (see block 2 below): an
 *    empty question list is reachable BOTH ways, and only a transport-call
 *    count can tell them apart.
 * 2. **The two ways to get "no cards" are not the same fact.** A refused
 *    retrieval and a grounded call whose model legitimately drafted zero
 *    questions both leave a caller with nothing to show her — but only one
 *    of them ever reached the Worker.
 * 3. **N-013 on the wiring itself** (`ol-odb0.2`): this call site passes
 *    `requireComposite: true` and `RECOMMENDED_COMPOSITE_THRESHOLDS`
 *    EXPLICITLY. A near-miss fixture — cosine 0.4, which clears
 *    `assembleGroundedContext`'s own default relevance bar (0.25) but not
 *    `RECOMMENDED_COMPOSITE_THRESHOLDS.top1` (0.545) — refuses through this
 *    call site and would GROUND if `requireComposite` were ever silently
 *    dropped from it. That contrast is pinned directly against `retrieve()`
 *    itself (same deps, `requireComposite: false`) rather than asserted by
 *    prose, so removing the flag from `draft-quiz-cards.ts` turns the first
 *    assertion in that test red.
 *
 * **Why the embedding space here is orthogonal, unlike `engine.spec.ts`'s.**
 * `engine.spec.ts`'s realistic overlapping-bands fixture exists to prove
 * `ol-cmpl`'s calibration claim (does a THRESHOLD separate related from
 * unrelated on real embeddings) — not this file's job. This file needs
 * exact, reproducible control over `top1`/`marginP99` to hit specific
 * points relative to `RECOMMENDED_COMPOSITE_THRESHOLDS`, which an
 * orthogonal basis gives directly: one dedicated axis per filler chunk,
 * cosine exactly 0 to everything else, and one shared axis whose weight
 * against the query is chosen per test.
 *
 * **Why the corpus is 101 chunks, not a handful.** `ol-3h2f` (open, David's
 * call, not fixed here): `cosinePercentile`'s `p99` is provably the
 * corpus maximum for any n <= 100, which makes `marginP99` exactly 0 and
 * `RECOMMENDED_COMPOSITE_THRESHOLDS.marginP99` (0.055) UNSATISFIABLE at any
 * smaller size, however well-matched the query is. A "grounds" test with
 * ten chunks would refuse for a reason that has nothing to do with the
 * property under test. 101 is the smallest corpus where that degeneracy
 * stops applying at all.
 */
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedRequest,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  retrieve,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type DraftQuizCardsDeps,
  draftQuizCardsForConcept,
} from '../../src/retrieval/draft-quiz-cards.js';

// ---- shared fakes -----------------------------------------------------

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

/** Looks vectors up by exact text — deterministic and exact, unlike a hash-derived direction, which is what lets the tests below hit precise `top1`/`marginP99` values. Throws on an unregistered text so a fixture gap is a loud test failure, not a silent wrong vector. */
class LookupEmbeddingProvider implements EmbeddingProvider {
  private readonly vectors = new Map<string, readonly number[]>();
  readonly requests: EmbedRequest[] = [];

  register(text: string, vector: readonly number[]): void {
    this.vectors.set(text, vector);
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    this.requests.push(request);
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

/** A `WorkerTaskTransport` fake that records every call and answers with whatever `respond` returns for it — same shape `test/retrieval/wiring.spec.ts` already uses. */
function fakeTransport(respond: (request: WorkerTaskRequest) => unknown = defaultQuizResponse) {
  const calls: WorkerTaskRequest[] = [];
  return {
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      return respond(request);
    },
    calls,
  };
}

function defaultQuizResponse(): unknown {
  return {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
    result: {
      questions: [
        { stem: 'stem', correctAnswer: 'a', distractors: ['b', 'c', 'd', 'e'], feedback: 'why' },
      ],
    },
  };
}

function zeroQuestionsResponse(): unknown {
  return {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
    result: { questions: [] },
  };
}

// ---- the orthogonal fixture --------------------------------------------

const FILLER_COUNT = 100;
/** dim 0: the shared "concept" axis the target chunk sits on. dim 1: the query's own private axis, used only to keep the query vector unit length when its cosine to the target is less than 1. dims 2..: one exclusive axis per filler chunk. */
const DIM = 2 + FILLER_COUNT;
const QUERY_TEXT = 'mitochondria';
const TARGET_TEXT = 'Mitochondria is the powerhouse of the cell and drives cellular respiration.';
const TARGET_PATH = 'course/mitochondria-lecture.md';

function unitVector(index: number): number[] {
  const v = new Array(DIM).fill(0);
  v[index] = 1;
  return v;
}

/**
 * Builds a 101-chunk corpus (1 target + 100 orthogonal filler chunks) whose
 * cosine to `QUERY_TEXT` is exactly `targetCosine` for the target chunk and
 * exactly 0 for every filler — see the module doc for why this needs to be
 * exact rather than realistic.
 */
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

const REQUEST = { courseCode: 'PSYCH305', conceptName: QUERY_TEXT };

// -------------------------------------------------------------------------

describe('draftQuizCardsForConcept — INV-5 zero-transport-sends on refusal (ol-odb0.3)', () => {
  it('a completely empty index refuses (no-hits) and NEVER calls transport.send', async () => {
    const provider = new LookupEmbeddingProvider();
    provider.register(QUERY_TEXT, unitVector(0)); // registered so embedQuery doesn't need to fall through its own catch
    const transport = fakeTransport();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(index([]), provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'no-hits' });
    expect(transport.calls).toHaveLength(0);
  });

  it('a near-miss concept (composite fails, but per-hit relevance alone would have passed) refuses and NEVER calls transport.send', async () => {
    const { keywordIndex, provider } = buildFixture(0.4);
    const transport = fakeTransport();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'below-composite-threshold' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('draftQuizCardsForConcept — a grounded, composite-passing concept', () => {
  it('sends exactly one transport call, carrying the retrieved chunk text and the frozen task id', async () => {
    const { keywordIndex, provider } = buildFixture(1.0);
    const transport = fakeTransport();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('quiz.generate.v1');
    const payload = transport.calls[0]?.payload as {
      courseCode: string;
      conceptName: string;
      sourceChunks: readonly string[];
    };
    expect(payload.courseCode).toBe('PSYCH305');
    expect(payload.conceptName).toBe(QUERY_TEXT);
    expect(payload.sourceChunks).toContain(TARGET_TEXT);
  });
});

describe('draftQuizCardsForConcept — refusal and "grounded but zero cards" are NOT the same fact (ol-odb0)', () => {
  it('a refused retrieval and a grounded call whose model drafted zero questions both leave nothing to show her, but only one of them touched the Worker', async () => {
    // Refused: no-hits, zero transport sends.
    const emptyProvider = new LookupEmbeddingProvider();
    emptyProvider.register(QUERY_TEXT, unitVector(0));
    const refusedTransport = fakeTransport();
    const refused = await draftQuizCardsForConcept(
      { retrieve: await makeRetrieveDeps(index([]), emptyProvider), transport: refusedTransport },
      REQUEST,
    );
    expect(refused.status).toBe('refused');
    expect(refusedTransport.calls).toHaveLength(0);

    // Grounded, but the model legitimately produced zero questions: one
    // transport send DID happen, even though the end result also has zero
    // cards to show her.
    const { keywordIndex, provider } = buildFixture(1.0);
    const groundedTransport = fakeTransport(zeroQuestionsResponse);
    const grounded = await draftQuizCardsForConcept(
      { retrieve: await makeRetrieveDeps(keywordIndex, provider), transport: groundedTransport },
      REQUEST,
    );
    expect(grounded.status).toBe('drafted');
    expect(groundedTransport.calls).toHaveLength(1);
    if (grounded.status === 'drafted') {
      const response = grounded.response as { result: { questions: readonly unknown[] } };
      expect(response.result.questions).toHaveLength(0);
    }
  });
});

describe('draftQuizCardsForConcept — N-013: requireComposite is load-bearing (ol-odb0.2)', () => {
  it('the same near-miss input this call site refuses would GROUND if requireComposite were ever dropped from it', async () => {
    const { keywordIndex, provider } = buildFixture(0.4);
    const retrieveDeps = await makeRetrieveDeps(keywordIndex, provider);
    const transport = fakeTransport();

    // Through the real call site: refuses, zero transport sends. If
    // `draft-quiz-cards.ts` ever stops passing `requireComposite: true`
    // explicitly, THIS assertion is what goes red.
    const result = await draftQuizCardsForConcept({ retrieve: retrieveDeps, transport }, REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'below-composite-threshold' });
    expect(transport.calls).toHaveLength(0);

    // The counterfactual, proved directly against `retrieve()` itself with
    // the IDENTICAL deps and query: without the composite gate, the same
    // input grounds. This is what makes the assertion above a genuine pin
    // on the flag rather than a pin on the fixture.
    const withoutComposite = await retrieve(retrieveDeps, QUERY_TEXT);
    expect(withoutComposite.status).toBe('grounded');
  });
});
