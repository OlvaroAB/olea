/**
 * `WorkerExplainWhyGenerator` and `ReviewSession.requestExplainWhy` tests
 * (F2.7 "explain why I got this wrong", `ol-p3t08`).
 *
 * Runs entirely against a fake `WorkerTaskTransport` — no `obsidian` import
 * anywhere in this file (INV-1). Mirrors
 * `../retrieval/workerGroundingJudge.spec.ts`'s shape for the port half, and
 * `session.spec.ts`'s shape for the session half.
 */

import { TASK_IDS } from 'olea-contracts';
import {
  EmbeddingCacheEngine,
  type EmbeddingCacheStore,
  type EmbeddingProvider,
  type EmbedResult,
  type PersistedEmbeddingCache,
  type PersistedKeywordIndex,
  type WorkerTaskRequest,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildExplainWhyRequest,
  EXPLAIN_WHY_GENERATE_CONTRACT_VERSION,
  EXPLAIN_WHY_GENERATE_TASK_ID,
  retrieveExplainWhySourceChunks,
  WorkerExplainWhyError,
  WorkerExplainWhyGenerator,
} from '../../src/review/explainWhy.js';
import { ReviewSession, type ReviewSessionDeps } from '../../src/review/session.js';
import {
  clozeFixture,
  fakeDraftAcceptPort,
  fakeEditPort,
  fakeNoteExists,
  fakeReviewLog,
  fakeScheduler,
  fakeSuspendPort,
  fixedClock,
  mcqFixture,
  qaFixture,
  queueItem,
} from './fixtures.js';

/** Records what was sent and answers with whatever the test scripted. */
class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function okResponse(result: unknown) {
  return { ok: true, stamp: { contractVersion: 2, promptVersion: '1.0.0', modelId: 'm' }, result };
}

function baseDeps(overrides: Partial<ReviewSessionDeps> = {}): ReviewSessionDeps {
  return {
    queue: [],
    scheduler: fakeScheduler(),
    reviewLog: fakeReviewLog(),
    suspendPort: fakeSuspendPort(),
    editPort: fakeEditPort(),
    noteExists: fakeNoteExists(),
    clock: fixedClock('2026-08-10T09:00:00Z'),
    draftAcceptPort: fakeDraftAcceptPort(),
    ...overrides,
  };
}

describe('WorkerExplainWhyGenerator — the frozen vocabulary it mirrors', () => {
  // The module deliberately does not import olea-contracts as a value in
  // production code (see the module doc). This test is what stops the
  // mirror drifting.
  it('sends the task id the frozen catalogue reserves for F2.7', () => {
    expect(EXPLAIN_WHY_GENERATE_TASK_ID).toBe(TASK_IDS.EXPLAIN_WHY_GENERATE);
  });

  it('sends the current contract version', () => {
    expect(EXPLAIN_WHY_GENERATE_CONTRACT_VERSION).toBe(2);
  });
});

describe('WorkerExplainWhyGenerator — the request it builds', () => {
  it('sends field for field with the service request shape', async () => {
    const transport = new RecordingTransport(() => okResponse({ explanations: [] }));
    const generator = new WorkerExplainWhyGenerator({ transport });

    await generator.explainWhy({
      courseCode: 'PSYCH305',
      question: 'What does a P300 index?',
      studentAnswer: 'Memory',
      correctAnswer: 'Attention allocation',
      sourceChunks: ['chunk one', 'chunk two'],
    });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('explain-why.generate.v1');
    expect(request?.contractVersion).toBe(2);
    expect(request?.payload).toEqual({
      courseCode: 'PSYCH305',
      question: 'What does a P300 index?',
      studentAnswer: 'Memory',
      correctAnswer: 'Attention allocation',
      sourceChunks: ['chunk one', 'chunk two'],
    });
  });

  it('copies sourceChunks rather than sending the caller-owned array by reference', async () => {
    const transport = new RecordingTransport(() => okResponse({ explanations: [] }));
    const generator = new WorkerExplainWhyGenerator({ transport });
    const chunks = ['one'];

    await generator.explainWhy({
      courseCode: 'C',
      question: 'q',
      studentAnswer: '',
      correctAnswer: 'a',
      sourceChunks: chunks,
    });
    chunks.push('two');

    expect(transport.sent[0]?.payload).toMatchObject({ sourceChunks: ['one'] });
  });
});

describe('WorkerExplainWhyGenerator — the response it reads', () => {
  it('an empty explanations array reads as refused: true', async () => {
    const transport = new RecordingTransport(() => okResponse({ explanations: [] }));
    const generator = new WorkerExplainWhyGenerator({ transport });

    const outcome = await generator.explainWhy({
      courseCode: 'C',
      question: 'q',
      studentAnswer: '',
      correctAnswer: 'a',
      sourceChunks: [],
    });

    expect(outcome).toEqual({ refused: true });
  });

  it('a real explanation reads text and citedChunkIndex field for field', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ explanations: [{ text: 'Because the passage says so.', citedChunkIndex: 1 }] }),
    );
    const generator = new WorkerExplainWhyGenerator({ transport });

    const outcome = await generator.explainWhy({
      courseCode: 'C',
      question: 'q',
      studentAnswer: '',
      correctAnswer: 'a',
      sourceChunks: ['x'],
    });

    expect(outcome).toEqual({
      refused: false,
      text: 'Because the passage says so.',
      citedChunkIndex: 1,
    });
  });
});

describe('WorkerExplainWhyGenerator — refuses to hand back an unusable shape', () => {
  it('throws WorkerExplainWhyError when the response body is not an object', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: new RecordingTransport(() => 'not an object'),
    });
    await expect(
      generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      }),
    ).rejects.toThrow(WorkerExplainWhyError);
  });

  it('throws when the response carries no `ok` discriminant', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: new RecordingTransport(() => ({ result: { explanations: [] } })),
    });
    await expect(
      generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      }),
    ).rejects.toThrow(WorkerExplainWhyError);
  });

  it('throws when `explanations` is missing or not an array', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: new RecordingTransport(() => okResponse({})),
    });
    await expect(
      generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      }),
    ).rejects.toThrow(WorkerExplainWhyError);
  });

  it('throws when the first explanation carries no non-empty text', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: new RecordingTransport(() =>
        okResponse({ explanations: [{ citedChunkIndex: 1 }] }),
      ),
    });
    await expect(
      generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      }),
    ).rejects.toThrow(WorkerExplainWhyError);
  });

  it('throws when the first explanation carries no valid citedChunkIndex', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: new RecordingTransport(() =>
        okResponse({ explanations: [{ text: 'x', citedChunkIndex: 0 }] }),
      ),
    });
    await expect(
      generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      }),
    ).rejects.toThrow(WorkerExplainWhyError);
  });

  it('throws WorkerExplainWhyError (carrying the Worker code) on an ok:false refusal', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: new RecordingTransport(() => ({
        ok: false,
        code: 'upstream-error',
        message: 'The model call failed.',
      })),
    });
    try {
      await generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as WorkerExplainWhyError).code).toBe('upstream-error');
    }
  });

  it('propagates a transport-level failure (no response at all) as a rejected promise', async () => {
    const generator = new WorkerExplainWhyGenerator({
      transport: {
        send: async () => {
          throw new Error('network unreachable');
        },
      },
    });
    await expect(
      generator.explainWhy({
        courseCode: 'C',
        question: 'q',
        studentAnswer: '',
        correctAnswer: 'a',
        sourceChunks: [],
      }),
    ).rejects.toThrow('network unreachable');
  });
});

describe('buildExplainWhyRequest — composing the request from a review instrument', () => {
  it('a Q&A card carries its question and answer', () => {
    const request = buildExplainWhyRequest(qaFixture(), '', ['ctx']);
    expect(request.question).toBe(qaFixture().question);
    expect(request.correctAnswer).toBe(qaFixture().answer);
    expect(request.courseCode).toBe(qaFixture().courseCode);
  });

  it('a cloze card renders the blank inline and the correct answer is the cloze text', () => {
    const fixture = clozeFixture();
    const request = buildExplainWhyRequest(fixture, '', []);
    expect(request.question).toBe(`${fixture.before}____${fixture.after}`);
    expect(request.correctAnswer).toBe(fixture.clozeText);
  });

  it('an MCQ carries the stem and the label of the option marked correct', () => {
    const fixture = mcqFixture();
    const request = buildExplainWhyRequest(fixture, fixture.options[1]?.label ?? '', []);
    expect(request.question).toBe(fixture.stem);
    expect(request.correctAnswer).toBe(fixture.options[0]?.label);
    expect(request.studentAnswer).toBe(fixture.options[1]?.label);
  });

  it('copies sourceChunks rather than aliasing the caller-owned array', () => {
    const chunks = ['a'];
    const request = buildExplainWhyRequest(qaFixture(), '', chunks);
    chunks.push('b');
    expect(request.sourceChunks).toEqual(['a']);
  });
});

/** Always rejects — forces `retrieve()`'s "degrades to keyword-only" path (`engine.ts`'s own module doc), same posture `packages/workbench/src/explain/ground.ts`'s `NoEmbeddingProvider` already takes for this exact clause. */
class RejectingEmbeddingProvider implements EmbeddingProvider {
  embed(): Promise<EmbedResult> {
    return Promise.reject(new Error('RejectingEmbeddingProvider: no embedding provider wired'));
  }
}

class MemoryEmbeddingCacheStore implements EmbeddingCacheStore {
  private saved: PersistedEmbeddingCache | null = null;
  async load(): Promise<PersistedEmbeddingCache | null> {
    return this.saved;
  }
  async save(cache: PersistedEmbeddingCache): Promise<void> {
    this.saved = cache;
  }
}

function indexWithBlocks(path: string, blocks: readonly string[]): PersistedKeywordIndex {
  return {
    version: 1,
    documents: [
      {
        path,
        courses: [],
        contentHash: 'unused',
        blocks: blocks.map((text, blockIndex) => ({
          blockIndex,
          kind: 'paragraph' as const,
          text,
        })),
      },
    ],
  };
}

async function fakeRetrieveDeps(keywordIndex: PersistedKeywordIndex) {
  const embeddingProvider = new RejectingEmbeddingProvider();
  const embeddingCache = await EmbeddingCacheEngine.create({
    store: new MemoryEmbeddingCacheStore(),
    provider: embeddingProvider,
    model: 'fake-model-v1',
  });
  return { keywordIndex, embeddingCache, embeddingProvider };
}

describe('retrieveExplainWhySourceChunks — F2.7 grounding half (ol-sn1q)', () => {
  it("a Q&A instrument's own question text is what is searched, and real chunk text comes back", async () => {
    const instrument = qaFixture();
    const keywordIndex = indexWithBlocks('course/note.md', [instrument.question]);

    const chunks = await retrieveExplainWhySourceChunks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      instrument,
    );

    expect(chunks).toEqual([instrument.question]);
  });

  it("an MCQ instrument's stem is searched, not the correct answer", async () => {
    const instrument = mcqFixture();
    const keywordIndex = indexWithBlocks('course/note.md', [instrument.stem]);

    const chunks = await retrieveExplainWhySourceChunks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      instrument,
    );

    expect(chunks).toEqual([instrument.stem]);
  });

  it('an empty index refuses honestly downstream: [], never a thrown error', async () => {
    const keywordIndex = indexWithBlocks('course/empty.md', []);

    const chunks = await retrieveExplainWhySourceChunks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      qaFixture(),
    );

    expect(chunks).toEqual([]);
  });

  it('unrelated material in the index does not come back as if it were grounding', async () => {
    const keywordIndex = indexWithBlocks('course/unrelated.md', [
      'A completely unrelated sentence about something else entirely.',
    ]);

    const chunks = await retrieveExplainWhySourceChunks(
      { retrieve: await fakeRetrieveDeps(keywordIndex) },
      qaFixture(),
    );

    expect(chunks).toEqual([]);
  });
});

describe('ReviewSession.requestExplainWhy — F2.7 (ol-p3t08)', () => {
  it('returns null with no explainWhyPort wired, rather than throwing (AI features "greyed")', async () => {
    const session = new ReviewSession(baseDeps({ queue: [queueItem(qaFixture())] }));
    await session.start();

    const outcome = await session.requestExplainWhy('', []);

    expect(outcome).toBeNull();
  });

  it('returns null with no current item, rather than throwing', async () => {
    const session = new ReviewSession(baseDeps({ queue: [] }));
    await session.start();

    const explainWhyPort = { explainWhy: async () => ({ refused: true as const }) };
    const outcome = await new ReviewSession(
      baseDeps({ queue: [], explainWhyPort }),
    ).requestExplainWhy('', []);

    expect(outcome).toBeNull();
  });

  it('delegates to the wired port with a request built from the current instrument', async () => {
    const calls: unknown[] = [];
    const explainWhyPort = {
      explainWhy: async (request: unknown) => {
        calls.push(request);
        return { refused: false as const, text: 'Because...', citedChunkIndex: 1 };
      },
    };
    const session = new ReviewSession(
      baseDeps({ queue: [queueItem(qaFixture())], explainWhyPort }),
    );
    await session.start();

    const outcome = await session.requestExplainWhy('her answer', ['a source passage']);

    expect(outcome).toEqual({ refused: false, text: 'Because...', citedChunkIndex: 1 });
    expect(calls).toEqual([
      {
        courseCode: qaFixture().courseCode,
        question: qaFixture().question,
        studentAnswer: 'her answer',
        correctAnswer: qaFixture().answer,
        sourceChunks: ['a source passage'],
      },
    ]);
  });

  it("F2.7's 'the tap never blocks the session': rating still advances the queue after a request, whatever it returned", async () => {
    const items = [
      queueItem(qaFixture({ instrumentId: 'a' })),
      queueItem(qaFixture({ instrumentId: 'b' })),
    ];
    const explainWhyPort = { explainWhy: async () => ({ refused: true as const }) };
    const reviewLog = fakeReviewLog();
    const session = new ReviewSession(baseDeps({ queue: items, explainWhyPort, reviewLog }));
    await session.start();
    session.reveal();

    await session.requestExplainWhy('', []);
    await session.rate('good');

    const vm = session.getViewModel();
    expect(vm.phase).toBe('front');
    if (vm.phase === 'front') expect(vm.instrument.instrumentId).toBe('b');
    expect(reviewLog.calls).toHaveLength(1);
  });

  it("F2.7's 'the tap never blocks the session': a port that throws does not corrupt session state", async () => {
    const explainWhyPort = {
      explainWhy: async () => {
        throw new Error('network unreachable');
      },
    };
    const item = queueItem(qaFixture());
    const session = new ReviewSession(baseDeps({ queue: [item], explainWhyPort }));
    await session.start();
    session.reveal();

    await expect(session.requestExplainWhy('', [])).rejects.toThrow('network unreachable');

    // The session itself is untouched — reveal phase still intact, still ratable.
    expect(session.getViewModel().phase).toBe('reveal');
    await session.rate('good');
    expect(session.getViewModel().phase).toBe('complete');
  });

  it('is available regardless of phase (F2.20: "available at every stage"), not gated on reveal/answered', async () => {
    const explainWhyPort = { explainWhy: async () => ({ refused: true as const }) };
    const session = new ReviewSession(
      baseDeps({ queue: [queueItem(qaFixture())], explainWhyPort }),
    );
    await session.start();

    // Still on 'front' — not revealed yet.
    expect(session.getViewModel().phase).toBe('front');
    const outcome = await session.requestExplainWhy('', []);
    expect(outcome).toEqual({ refused: true });
  });
});
