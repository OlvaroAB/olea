/**
 * `draftQuizCardsForConcept` tests (`ol-odb0.2`, `ol-odb0.3`, `[WIRE-5]` /
 * `ol-i0y6`).
 *
 * Four things this file has to prove, per the beads' own acceptance
 * criteria, and each gets its own `describe` block below:
 *
 * 1. **INV-5 against the WIRED path, not the pure function** (`ol-odb0.3`,
 *    extended for the band by `ol-i0y6`). A completely empty index refuses,
 *    and — the property that actually matters, per `ol-odb0`'s own
 *    diagnosis — `transport.send` is never called when that happens.
 *    Counting the transport calls, not inspecting the shape of the result,
 *    is what tells "refused before ever asking" apart from "asked, and the
 *    model said zero" (see block 2 below): an empty question list is
 *    reachable BOTH ways, and only a transport-call count can tell them
 *    apart. Since the band switch, a BELOW-BAND refusal carries the SAME
 *    zero-sends property — nothing leaves the device, not even a call to
 *    the grounding judge — and that is asserted here too, not only at the
 *    pure-function level `groundedContext.spec.ts` already covers.
 * 2. **The two ways to get "no cards" are not the same fact.** A refused
 *    retrieval and a grounded call whose model legitimately drafted zero
 *    questions both leave a caller with nothing to show her — but only one
 *    of them ever reached the Worker.
 * 3. **N-013 on the wiring itself, restated for the band** (`ol-i0y6`): this
 *    call site passes `band: D112_GROUNDING_BAND` EXPLICITLY. A below-band
 *    fixture — cosine 0.4, which clears `assembleGroundedContext`'s own
 *    default relevance bar (0.25) but not the band's lower bar (0.555) —
 *    refuses through this call site and would GROUND if `band` were ever
 *    silently dropped from it. That contrast is pinned directly against
 *    `retrieve()` itself (same deps, no `band` option) rather than asserted
 *    by prose, so removing the option from `draft-quiz-cards.ts` turns the
 *    first assertion in that test red.
 * 4. **The band's in-band tier (`[D-089]`, `[D-112]`) escalates through the
 *    real `WorkerGroundingJudge` this call site now constructs**, and folds
 *    the judge's verdict into the same refused/drafted split — a supported
 *    verdict proceeds to `quiz.generate.v1` (two transport calls, in
 *    order); an unsupported one refuses BEFORE the generative call ever
 *    happens (one transport call, never two).
 *
 * **Why the embedding space here is orthogonal, unlike `engine.spec.ts`'s.**
 * `engine.spec.ts`'s realistic overlapping-bands fixture exists to prove
 * `ol-cmpl`'s calibration claim (does a THRESHOLD separate related from
 * unrelated on real embeddings) — not this file's job. This file needs
 * exact, reproducible control over `top1` to hit specific points relative
 * to `D112_GROUNDING_BAND`'s two bars, which an orthogonal basis gives
 * directly: one dedicated axis per filler chunk, cosine exactly 0 to
 * everything else, and one shared axis whose weight against the query is
 * chosen per test.
 *
 * **Why the corpus is 101 chunks, not a handful.** The band deliberately
 * does NOT sit on `marginP99` (`groundedContext.ts`'s own doc explains why,
 * per `ol-3h2f`), so that degeneracy does not bind these tests the way it
 * bound the old composite ones — but the fixture is kept at the same size
 * as the pre-existing suite for a boring reason: `computeCompositeGroundingSignals`
 * still runs (the band needs `top1`) and this corpus already isolates
 * `top1` control cleanly at this size, so there is no reason to shrink it
 * and reintroduce a variable nobody is testing.
 */
import {
  D112_GROUNDING_BAND,
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

/** Looks vectors up by exact text — deterministic and exact, unlike a hash-derived direction, which is what lets the tests below hit precise `top1` values. Throws on an unregistered text so a fixture gap is a loud test failure, not a silent wrong vector. */
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

/**
 * A `WorkerTaskTransport` fake that records every call and dispatches by
 * `taskId` — needed because the band path can now send TWO different task
 * ids per call (`grounding.judge.v1` for an escalation, `quiz.generate.v1`
 * for the generative call), unlike the single-gate path this fixture
 * originally served.
 */
function fakeTransport(responders: {
  readonly quiz?: (request: WorkerTaskRequest) => unknown;
  readonly judge?: (request: WorkerTaskRequest) => unknown;
}) {
  const calls: WorkerTaskRequest[] = [];
  return {
    send: async (request: WorkerTaskRequest): Promise<unknown> => {
      calls.push(request);
      if (request.taskId === 'grounding.judge.v1') {
        return (responders.judge ?? defaultJudgeResponse)(request);
      }
      return (responders.quiz ?? defaultQuizResponse)(request);
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

function defaultJudgeResponse(): unknown {
  return {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
    result: { supported: true, reason: 'the passages answer the query' },
  };
}

function judgeVerdict(supported: boolean, reason = 'stated verdict'): () => unknown {
  return () => ({
    ok: true,
    stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
    result: { supported, reason },
  });
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
 * exact rather than realistic. `targetCosine` IS `top1` for this fixture,
 * since the target is always the best-scoring chunk.
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

// `D112_GROUNDING_BAND` is lower 0.555 / upper 0.800 (`[D-112]`). Fixture
// cosines below are chosen relative to those two bars, not to the retired
// single-gate composite's thresholds.
const BELOW_BAND_COSINE = 0.4; // < 0.555
const IN_BAND_COSINE = 0.65; // 0.555 <= x < 0.800
const ABOVE_BAND_COSINE = 1.0; // >= 0.800

// -------------------------------------------------------------------------

describe('draftQuizCardsForConcept — INV-5 zero-transport-sends on refusal (ol-odb0.3, extended for the band by ol-i0y6)', () => {
  it('a completely empty index refuses (no-hits) and NEVER calls transport.send', async () => {
    const provider = new LookupEmbeddingProvider();
    provider.register(QUERY_TEXT, unitVector(0)); // registered so embedQuery doesn't need to fall through its own catch
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(index([]), provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'no-hits' });
    expect(transport.calls).toHaveLength(0);
  });

  it('a below-band concept refuses and NEVER calls transport.send — not the generative call, and not the judge either', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('draftQuizCardsForConcept — above the upper bar, generation proceeds with no judge consulted', () => {
  it('sends exactly one transport call (quiz.generate.v1 only), carrying the retrieved chunk text and the frozen task id', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
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

describe('draftQuizCardsForConcept — inside the band, the real WorkerGroundingJudge is consulted (`[D-089]`, `[D-112]`, ol-i0y6)', () => {
  it('a supported verdict proceeds to the generative call — two transport sends, judge before quiz', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0]?.taskId).toBe('grounding.judge.v1');
    expect(transport.calls[0]?.payload).toMatchObject({ query: QUERY_TEXT });
    expect(transport.calls[1]?.taskId).toBe('quiz.generate.v1');
  });

  it('an unsupported verdict refuses BEFORE any generative call — one transport send, never two', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({
      judge: judgeVerdict(false, 'the passages name it but do not answer it'),
    });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-rejected' });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.taskId).toBe('grounding.judge.v1');
  });

  it('fails closed when the judge is unreachable — refuses as judge-unavailable, never falls through to generation', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({
      judge: () => {
        throw new Error('network unreachable');
      },
    });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-unavailable' });
    expect(transport.calls.some((call) => call.taskId === 'quiz.generate.v1')).toBe(false);
  });

  it('fails closed when the judge returns a shape that is not a verdict', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({
      judge: () => ({
        ok: true,
        stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'm' },
        result: {},
      }),
    });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-unavailable' });
  });
});

describe('draftQuizCardsForConcept — refusal and "grounded but zero cards" are NOT the same fact (ol-odb0)', () => {
  it('a refused retrieval and a grounded call whose model drafted zero questions both leave nothing to show her, but only one of them touched the Worker', async () => {
    // Refused: no-hits, zero transport sends.
    const emptyProvider = new LookupEmbeddingProvider();
    emptyProvider.register(QUERY_TEXT, unitVector(0));
    const refusedTransport = fakeTransport({});
    const refused = await draftQuizCardsForConcept(
      { retrieve: await makeRetrieveDeps(index([]), emptyProvider), transport: refusedTransport },
      REQUEST,
    );
    expect(refused.status).toBe('refused');
    expect(refusedTransport.calls).toHaveLength(0);

    // Grounded (above the upper bar, no judge involved), but the model
    // legitimately produced zero questions: one transport send DID happen,
    // even though the end result also has zero cards to show her.
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const groundedTransport = fakeTransport({ quiz: zeroQuestionsResponse });
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

describe('draftQuizCardsForConcept — F3.8 personalization context (`[D-008]`, `[D-101]`, ol-p3t07c)', () => {
  it('defaults every chunk to unknown/unknown when deps.classifyPassage is absent — empty exemplars, sent honestly rather than omitted', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    await draftQuizCardsForConcept(deps, REQUEST);

    const payload = transport.calls[0]?.payload as {
      personalization?: { voiceExemplars: { phrasing: string[]; terminology: string[] } };
    };
    expect(payload.personalization?.voiceExemplars).toEqual({ phrasing: [], terminology: [] });
  });

  it('threads deps.classifyPassage through to voice exemplars — hers phrasing, instructor terminology', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      classifyPassage: (chunk) =>
        chunk.path === TARGET_PATH
          ? { authorship: 'hers', curationAuthority: 'unknown' }
          : { authorship: 'unknown', curationAuthority: 'unknown' },
    };

    await draftQuizCardsForConcept(deps, REQUEST);

    const payload = transport.calls[0]?.payload as {
      personalization?: { voiceExemplars: { phrasing: string[]; terminology: string[] } };
    };
    expect(payload.personalization?.voiceExemplars.phrasing).toEqual([TARGET_TEXT]);
    expect(payload.personalization?.voiceExemplars.terminology).toEqual([]);
  });

  it('personalization never affects the refusal decision — a below-band request still refuses with zero transport sends regardless of classifyPassage', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      classifyPassage: () => ({ authorship: 'hers', curationAuthority: 'instructor' }),
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('draftQuizCardsForConcept — N-013: the band is load-bearing at this call site (ol-i0y6)', () => {
  it('the same below-band input this call site refuses would GROUND if `band` were ever dropped from it', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_COSINE);
    const retrieveDeps = await makeRetrieveDeps(keywordIndex, provider);
    const transport = fakeTransport({});

    // Through the real call site: refuses, zero transport sends. If
    // `draft-quiz-cards.ts` ever stops passing `band: D112_GROUNDING_BAND`
    // explicitly, THIS assertion is what goes red.
    const result = await draftQuizCardsForConcept({ retrieve: retrieveDeps, transport }, REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(transport.calls).toHaveLength(0);

    // The counterfactual, proved directly against `retrieve()` itself with
    // the IDENTICAL deps and query: without the band, the same input
    // grounds on the bare default relevance bar (0.25) alone. This is what
    // makes the assertion above a genuine pin on the option rather than a
    // pin on the fixture.
    const withoutBand = await retrieve(retrieveDeps, QUERY_TEXT);
    expect(withoutBand.status).toBe('grounded');
  });

  it('sanity: D112_GROUNDING_BAND is the ratified pair this call site is pinned to', () => {
    expect(D112_GROUNDING_BAND).toEqual({ lower: 0.555, upper: 0.8 });
  });
});
