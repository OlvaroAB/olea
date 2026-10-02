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
 *    fixture — cosine 0.55, which clears `assembleGroundedContext`'s own
 *    default relevance bar (0.25) AND the composite's own top1 sub-threshold
 *    (0.545) but not the band's lower bar (0.555) — refuses through this
 *    call site and would GROUND if `band` were ever silently dropped from
 *    it. That contrast is pinned directly against `retrieve()` itself (same
 *    deps, no options at all) rather than asserted by prose, so removing the
 *    option from `draft-quiz-cards.ts` turns the first assertion in that
 *    test red. The cosine is chosen just above the composite's own bar
 *    specifically so this isolates the BAND's contribution — see point 5.
 * 4. **The band's in-band tier (`[D-089]`, `[D-112]`) escalates through the
 *    real `WorkerGroundingJudge` this call site now constructs**, and folds
 *    the judge's verdict into the same refused/drafted split — a supported
 *    verdict proceeds to `quiz.generate.v1` (two transport calls, in
 *    order); an unsupported one refuses BEFORE the generative call ever
 *    happens (one transport call, never two).
 * 5. **There is no composite veto at this call site (`[D-449]`, ruled
 *    2026-09-30; was `[D-192]`, `ol-0r92.39`).** The call site no longer
 *    passes `requireComposite` or `compositeThresholds`. A request the
 *    composite alone refused (top1 clears the band's lower bar, the lexical
 *    clause fails) now reaches the sufficiency judge, while the band's lower
 *    bar (0.555, kept provisionally) still refuses from numbers with nothing
 *    sent.
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
  type GateStage,
  type JudgeRequestRecord,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  RECOMMENDED_COMPOSITE_THRESHOLDS,
  retrieve,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  type DraftQuizCardsDeps,
  draftQuizCardsForConcept,
  type RegisterHint,
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

/** The `quiz.generate.v1` call among a fake transport's recorded calls. Since D-442 an above-band request is judged first, so the quiz call is no longer always the first one. */
function quizCallOf(transport: { readonly calls: readonly WorkerTaskRequest[] }) {
  return transport.calls.find((call) => call.taskId === 'quiz.generate.v1');
}

/** The payload of the grounding-judge send among a fake transport's recorded calls (the first, since `[D-442]` judges every request above the lower bar before generating). */
function judgePayloadOf(transport: {
  readonly calls: readonly WorkerTaskRequest[];
}): Record<string, unknown> {
  const call = transport.calls.find((entry) => entry.taskId === 'grounding.judge.v1');
  return (call?.payload ?? {}) as Record<string, unknown>;
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

const REQUEST = { courseCode: 'COGS214', conceptName: QUERY_TEXT };

// `D112_GROUNDING_BAND` is lower 0.555 / upper 0.800 (`[D-112]`).
// `RECOMMENDED_COMPOSITE_THRESHOLDS.top1` is 0.545 (`[D-192]`); this call site no longer passes the
// composite (`[D-449]`), but the fixture cosines keep their position relative to it so the
// band-only fixture (0.55) stays the one that isolates the band's own bar.
// This fixture's `QUERY_TEXT`/`TARGET_TEXT` share the token "mitochondria"
// and nothing else in the corpus does, so `lexBest` is always 1.0 here and
// `marginP99` always equals `top1` itself (100 orthogonal zero-cosine filler
// chunks) — every cosine below isolates purely on `top1`.
const BELOW_BAND_COSINE = 0.4; // < band lower (0.555) (and < the dropped composite's top1 0.545): the band's own bar refuses
const BELOW_BAND_ONLY_COSINE = 0.55; // >= the dropped composite's top1 (0.545) but < band lower (0.555), isolating the band's own bar
const IN_BAND_COSINE = 0.65; // 0.555 <= x < 0.800, and clears the composite too
const ABOVE_BAND_COSINE = 1.0; // >= 0.800, and clears the composite too

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
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
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

describe('draftQuizCardsForConcept — above the upper bar the request still reaches the sufficiency judge (`[D-442]`, `[D-301]`)', () => {
  it('a supported verdict proceeds to the generative call — two sends, judge before quiz, the quiz carrying the retrieved chunk text and the frozen task id', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(transport.calls.map((call) => call.taskId)).toEqual([
      'grounding.judge.v1',
      'quiz.generate.v1',
    ]);
    const payload = quizCallOf(transport)?.payload as {
      courseCode: string;
      conceptName: string;
      sourceChunks: readonly string[];
    };
    expect(payload.courseCode).toBe('COGS214');
    expect(payload.conceptName).toBe(QUERY_TEXT);
    expect(payload.sourceChunks).toContain(TARGET_TEXT);
  });

  it('an unsupported verdict above the upper bar refuses as judge-rejected BEFORE any generative call: one send, never two', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({
      judge: judgeVerdict(false, 'the passages name it but do not answer it'),
    });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-rejected' });
    expect(transport.calls.map((call) => call.taskId)).toEqual(['grounding.judge.v1']);
  });

  it('a high retrieval band never certifies support: an unreachable judge above the upper bar refuses as judge-unavailable and never generates', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({
      judge: () => {
        throw new Error('network down');
      },
    });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-unavailable' });
    expect(quizCallOf(transport)).toBeUndefined();
  });

  it('a judge answer that is not a verdict, above the upper bar, also refuses without generating', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({
      judge: () => ({
        ok: true,
        stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'fake-model' },
        result: { unexpected: true },
      }),
    });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-unavailable' });
    expect(quizCallOf(transport)).toBeUndefined();
  });

  it('the judge request above the upper bar carries the concept name and the retrieved passage text', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    await draftQuizCardsForConcept(deps, REQUEST);

    const judgeCall = transport.calls[0];
    expect(judgeCall?.taskId).toBe('grounding.judge.v1');
    const payload = judgeCall?.payload as { query: string; context: string };
    expect(payload.query).toBe(QUERY_TEXT);
    expect(payload.context).toContain(TARGET_TEXT);
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

    // Grounded (above the upper bar, judged supported), but the model
    // legitimately produced zero questions: the Worker WAS reached (the judge
    // and then the generative call), even though the end result also has zero
    // cards to show her.
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const groundedTransport = fakeTransport({ quiz: zeroQuestionsResponse });
    const grounded = await draftQuizCardsForConcept(
      { retrieve: await makeRetrieveDeps(keywordIndex, provider), transport: groundedTransport },
      REQUEST,
    );
    expect(grounded.status).toBe('drafted');
    expect(groundedTransport.calls).toHaveLength(2);
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

    const payload = quizCallOf(transport)?.payload as {
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

    const payload = quizCallOf(transport)?.payload as {
      personalization?: { voiceExemplars: { phrasing: string[]; terminology: string[] } };
    };
    expect(payload.personalization?.voiceExemplars.phrasing).toEqual([TARGET_TEXT]);
    expect(payload.personalization?.voiceExemplars.terminology).toEqual([]);
  });

  it('personalization never affects the refusal decision — a below-band request still refuses with zero transport sends regardless of classifyPassage', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
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

describe('draftQuizCardsForConcept — purpose/registerHint passthrough (`[D-188]`, ol-0r92.35)', () => {
  const RICH_HINT: RegisterHint = {
    terminology: ['event-related potential'],
    sentenceShapes: ['State the mechanism by which X produces Y.'],
  };

  it('sends neither purpose nor registerHint when the caller supplies neither — byte-identical to before this bead', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    await draftQuizCardsForConcept(deps, REQUEST);

    const payload = quizCallOf(transport)?.payload as {
      purpose?: unknown;
      registerHint?: unknown;
    };
    expect(payload.purpose).toBeUndefined();
    expect(payload.registerHint).toBeUndefined();
    expect('purpose' in payload).toBe(false);
    expect('registerHint' in payload).toBe(false);
  });

  it('passes purpose and registerHint through to the request verbatim — this function decides neither', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    await draftQuizCardsForConcept(deps, {
      ...REQUEST,
      purpose: 'readiness',
      registerHint: RICH_HINT,
    });

    const payload = quizCallOf(transport)?.payload as {
      purpose?: string;
      registerHint?: RegisterHint;
    };
    expect(payload.purpose).toBe('readiness');
    expect(payload.registerHint).toEqual(RICH_HINT);
  });

  it('sends registerHint only when purpose was also supplied as readiness — a caller building a learning instrument never sends a stray hint', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    await draftQuizCardsForConcept(deps, REQUEST); // no purpose, no registerHint

    const payload = quizCallOf(transport)?.payload as { registerHint?: unknown };
    expect(payload.registerHint).toBeUndefined();
  });

  it('purpose/registerHint never affect the refusal decision — a below-band request still refuses with zero transport sends', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, {
      ...REQUEST,
      purpose: 'readiness',
      registerHint: RICH_HINT,
    });

    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('draftQuizCardsForConcept — N-013: the band is load-bearing at this call site (ol-i0y6)', () => {
  it('the same below-band input this call site refuses would GROUND if `band` were ever dropped from it', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
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

// A concept name that shares no token with the corpus, so the composite's lexical clause (0.18)
// fails while top1 (0.65) clears BOTH the composite's top1 clause and the band's lower bar: the
// composite veto, were it still passed, is the ONLY thing that would refuse this request. The
// query vector is the same as `QUERY_TEXT`'s, so the semantic signal is unchanged.
const NO_LEXICAL_OVERLAP_TEXT = 'organelle energy';

function buildVetoOnlyFixture(): {
  readonly keywordIndex: PersistedKeywordIndex;
  readonly provider: LookupEmbeddingProvider;
} {
  const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
  const residual = Math.sqrt(1 - IN_BAND_COSINE * IN_BAND_COSINE);
  provider.register(
    NO_LEXICAL_OVERLAP_TEXT,
    unitVector(0).map((c, i) => c * IN_BAND_COSINE + (i === 1 ? residual : 0)),
  );
  return { keywordIndex, provider };
}

describe('draftQuizCardsForConcept — no composite veto for drafting (`[D-449]`, was `[D-192]`)', () => {
  it('control: the composite veto, if passed, refuses the veto-only fixture — so the next test proves the call site no longer passes it', async () => {
    const { keywordIndex, provider } = buildVetoOnlyFixture();
    const retrieveDeps = await makeRetrieveDeps(keywordIndex, provider);

    const withVeto = await retrieve(retrieveDeps, NO_LEXICAL_OVERLAP_TEXT, {
      band: D112_GROUNDING_BAND,
      requireComposite: true,
      compositeThresholds: RECOMMENDED_COMPOSITE_THRESHOLDS,
    });
    expect(withVeto).toEqual({ status: 'refused', reason: 'below-composite-threshold' });

    // Same request, no veto: the band alone does not refuse it (it escalates to a judge, which
    // this control does not supply, so it fails closed rather than refusing from numbers).
    const withoutVeto = await retrieve(retrieveDeps, NO_LEXICAL_OVERLAP_TEXT, {
      band: D112_GROUNDING_BAND,
    });
    expect(withoutVeto.status === 'refused' ? withoutVeto.reason : 'ok').not.toBe(
      'below-composite-threshold',
    );
  });

  it('a request the composite veto alone would have refused now reaches the judge and, once supported, drafts — judge then quiz, two sends', async () => {
    const { keywordIndex, provider } = buildVetoOnlyFixture();
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, {
      courseCode: 'COGS214',
      conceptName: NO_LEXICAL_OVERLAP_TEXT,
    });

    expect(result.status).toBe('drafted');
    expect(transport.calls.map((call) => call.taskId)).toEqual([
      'grounding.judge.v1',
      'quiz.generate.v1',
    ]);
  });

  it('the judge still decides: an unsupported verdict on the same veto-only request refuses as judge-rejected, one send, never the generative call', async () => {
    const { keywordIndex, provider } = buildVetoOnlyFixture();
    const transport = fakeTransport({ judge: judgeVerdict(false) });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, {
      courseCode: 'COGS214',
      conceptName: NO_LEXICAL_OVERLAP_TEXT,
    });

    expect(result).toEqual({ status: 'refused', reason: 'judge-rejected' });
    expect(transport.calls.map((call) => call.taskId)).toEqual(['grounding.judge.v1']);
  });

  it('the retained lower bar still refuses: top1 below 0.555 refuses as below-band, never below-composite-threshold, with nothing sent', async () => {
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

  it('the ABOVE-band path still goes judge then quiz — two sends (`[D-442]`)', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(transport.calls.map((call) => call.taskId)).toEqual([
      'grounding.judge.v1',
      'quiz.generate.v1',
    ]);
  });

  it('the IN-band, judge-supported path is unchanged — judge then quiz, two sends', async () => {
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
    expect(transport.calls[1]?.taskId).toBe('quiz.generate.v1');
  });

  it('sanity: the dropped D-192 point is still the value the control above pins', () => {
    expect(RECOMMENDED_COMPOSITE_THRESHOLDS).toEqual({ lex: 0.18, top1: 0.545, marginP99: 0.055 });
  });
});

/**
 * `[JEV-11]` (`ol-3ux7.96`) — proves the traced path from this real call
 * site down to an attributed `GateStage`, through the actual band option this
 * function passes (`D112_GROUNDING_BAND`; no composite since `[D-449]`), not a re-derived fixture. Each test
 * reuses a fixture already pinned above (BELOW_BAND/IN_BAND/
 * ABOVE_BAND) so the stage asserted here is the SAME decision the sibling
 * describe block already proved by transport-call count — this block adds
 * only the new assertion, `deps.onStage`'s recorded stage.
 */
describe('draftQuizCardsForConcept — [JEV-11] onStage attributes the real call site to a GateStage', () => {
  function recorder() {
    const stages: GateStage[] = [];
    return { stages, onStage: (s: GateStage) => stages.push(s) };
  }

  it('is inert when no onStage is supplied — byte-identical to every deps object above', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };
    // No throw, no behaviour change: the field is optional and nothing here
    // requires it.
    const result = await draftQuizCardsForConcept(deps, REQUEST);
    expect(result.status).toBe('drafted');
  });

  it('never records composite-veto at this call site: a below-lower-bar request is attributed to below-band', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_COSINE);
    const transport = fakeTransport({});
    const rec = recorder();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onStage: rec.onStage,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(rec.stages).toEqual(['below-band']);
  });

  it('attributes the below-band refusal to below-band, exactly once', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
    const transport = fakeTransport({});
    const rec = recorder();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onStage: rec.onStage,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(rec.stages).toEqual(['below-band']);
  });

  it('attributes an above-the-upper-bar request to above-band, exactly once, even though the judge then decides it (`[D-442]`)', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({});
    const rec = recorder();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onStage: rec.onStage,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(rec.stages).toEqual(['above-band']);
  });

  it('attributes an in-band, judge-supported grant to escalated-to-judge, exactly once — this is the one stage counted in the judge-consulted share', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const rec = recorder();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onStage: rec.onStage,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result.status).toBe('drafted');
    expect(rec.stages).toEqual(['escalated-to-judge']);
  });

  it('attributes an in-band, judge-rejected refusal to escalated-to-judge too — the stage names which GATE decided, not the judge verdict', async () => {
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(false) });
    const rec = recorder();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onStage: rec.onStage,
    };

    const result = await draftQuizCardsForConcept(deps, REQUEST);

    expect(result).toEqual({ status: 'refused', reason: 'judge-rejected' });
    expect(rec.stages).toEqual(['escalated-to-judge']);
  });

  it('carries no content through the real call site — a planted sentinel course/concept name appears nowhere in the recorded stages', async () => {
    const sentinel = 'SENTINEL-COURSE-9f2';
    const { keywordIndex, provider } = buildFixture(IN_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const rec = recorder();
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onStage: rec.onStage,
    };

    await draftQuizCardsForConcept(deps, { ...REQUEST, courseCode: sentinel });

    for (const stage of rec.stages) {
      expect(JSON.stringify(stage)).not.toContain(sentinel);
    }
  });
});

/**
 * T3 of `docs/dev/intelligence-build/demand-carriage.md` (`[D-437]`, `ol-egov.141.89.2.20`), and the
 * forwarding half of `ol-egov.141.89.1.47`. A need that routed as served sends its demand, the
 * whole heading it was read from and, through the retrieval request, the operation the sufficiency
 * judge is asked about; a need that did not sends none of the three and the request is today's,
 * byte for byte. INV-3: every heading here is invented.
 */
describe('draftQuizCardsForConcept — the demand carried to retrieval, the judge and the request (T3, ol-egov.141.89.2.20)', () => {
  const ASK = { heading: 'What is a mitochondrion?', questionWord: 'What' } as const;

  async function draftWith(
    request: Parameters<typeof draftQuizCardsForConcept>[1],
    extra: Partial<DraftQuizCardsDeps> = {},
  ) {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      ...extra,
    };
    const result = await draftQuizCardsForConcept(deps, request);
    return { result, transport };
  }

  it('a served need sends intendedDemand and the whole requestedAsk, and the judge is asked about the operation', async () => {
    const { result, transport } = await draftWith({
      ...REQUEST,
      intendedDemand: 'recall-a-fact',
      requestedAsk: ASK,
    });

    expect(result.status).toBe('drafted');
    const payload = quizCallOf(transport)?.payload as Record<string, unknown>;
    expect(payload.intendedDemand).toBe('recall-a-fact');
    expect(payload.requestedAsk).toEqual(ASK);
    const judgePayload = judgePayloadOf(transport);
    expect(transport.calls[0]?.taskId).toBe('grounding.judge.v1');
    expect(judgePayload.intendedOperation).toBe('define');
    // The request that came back names the same fields (a caller reads what was sent from it).
    if (result.status === 'drafted') {
      expect(result.request.intendedDemand).toBe('recall-a-fact');
      expect(result.request.requestedAsk).toEqual(ASK);
    }
  });

  it('a served need with no heading behind it (the sweep) sends the demand alone', async () => {
    const { transport } = await draftWith({ ...REQUEST, intendedDemand: 'recall-a-fact' });

    const payload = quizCallOf(transport)?.payload as Record<string, unknown>;
    expect(payload.intendedDemand).toBe('recall-a-fact');
    expect('requestedAsk' in payload).toBe(false);
    expect(judgePayloadOf(transport).intendedOperation).toBe('define');
  });

  it('an unspecified or unserved need sends neither field and no operation: the request as it was', async () => {
    const { transport } = await draftWith(REQUEST);

    const payload = quizCallOf(transport)?.payload as Record<string, unknown>;
    expect('intendedDemand' in payload).toBe(false);
    expect('requestedAsk' in payload).toBe(false);
    expect('intendedOperation' in judgePayloadOf(transport)).toBe(false);
    expect(Object.keys(payload).sort()).toEqual([
      'conceptName',
      'courseCode',
      'personalization',
      'sourceChunks',
    ]);
  });

  it('a demand with no judge operation (a printed-result reading) sends the demand but no operation', async () => {
    const { transport } = await draftWith({
      ...REQUEST,
      intendedDemand: 'interpret-printed-result',
    });

    const payload = quizCallOf(transport)?.payload as Record<string, unknown>;
    expect(payload.intendedDemand).toBe('interpret-printed-result');
    expect('intendedOperation' in judgePayloadOf(transport)).toBe(false);
  });

  it('a heading with no demand is passed through as given: the caller decides what is sent', async () => {
    const { transport } = await draftWith({ ...REQUEST, requestedAsk: ASK });

    // The caller decides what to send (`authoringDemandFields`); this function passes what it is
    // given. A heading with no demand is still passed through, and the judge sees no operation.
    const payload = quizCallOf(transport)?.payload as Record<string, unknown>;
    expect(payload.requestedAsk).toEqual(ASK);
    expect('intendedDemand' in payload).toBe(false);
    expect('intendedOperation' in judgePayloadOf(transport)).toBe(false);
  });

  it('a refusal is unchanged by a demand: a below-band request with a demand still sends nothing', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
    const transport = fakeTransport({});
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
    };

    const result = await draftQuizCardsForConcept(deps, {
      ...REQUEST,
      intendedDemand: 'recall-a-fact',
      requestedAsk: ASK,
    });

    expect(result).toEqual({ status: 'refused', reason: 'below-band' });
    expect(transport.calls).toHaveLength(0);
  });
});

describe('draftQuizCardsForConcept — the JEV-6 capture reaches its recorder through retrieve() (ol-egov.141.89.1.47)', () => {
  it('calls deps.onJudgeRequest once, with the query, the chunk references and the operation', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const records: JudgeRequestRecord[] = [];
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onJudgeRequest: (record) => records.push(record),
    };

    await draftQuizCardsForConcept(deps, { ...REQUEST, intendedDemand: 'recall-a-fact' });

    expect(records).toEqual([
      {
        query: QUERY_TEXT,
        refs: [{ path: TARGET_PATH, blockIndex: 0 }],
        intendedOperation: 'define',
      },
    ]);
  });

  it('records no operation when the need carried no demand, and still records the case', async () => {
    const { keywordIndex, provider } = buildFixture(ABOVE_BAND_COSINE);
    const transport = fakeTransport({ judge: judgeVerdict(true) });
    const records: JudgeRequestRecord[] = [];
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onJudgeRequest: (record) => records.push(record),
    };

    await draftQuizCardsForConcept(deps, REQUEST);

    expect(records).toHaveLength(1);
    expect('intendedOperation' in (records[0] ?? {})).toBe(false);
  });

  it('does not record a request that never reaches the judge (a below-band refusal)', async () => {
    const { keywordIndex, provider } = buildFixture(BELOW_BAND_ONLY_COSINE);
    const transport = fakeTransport({});
    const records: JudgeRequestRecord[] = [];
    const deps: DraftQuizCardsDeps = {
      retrieve: await makeRetrieveDeps(keywordIndex, provider),
      transport,
      onJudgeRequest: (record) => records.push(record),
    };

    await draftQuizCardsForConcept(deps, REQUEST);

    expect(records).toEqual([]);
  });
});
