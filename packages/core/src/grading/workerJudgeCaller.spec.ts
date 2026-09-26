import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { WorkerTaskRequest, WorkerTaskTransport } from '../retrieval/workerProvider.js';
import { gradeExplainBack } from './gradingPipeline.js';
import {
  createWorkerJudgeCaller,
  EXPLAIN_BACK_JUDGE_CONTRACT_VERSION,
  EXPLAIN_BACK_JUDGE_TASK_ID,
  WorkerJudgeError,
} from './workerJudgeCaller.js';

/** Records what was sent and answers with whatever the test scripted. */
class RecordingTransport implements WorkerTaskTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

function okResponse(result: unknown): unknown {
  return {
    ok: true,
    stamp: { contractVersion: CONTRACT_VERSION, promptVersion: '1.2.0', modelId: 'test-model' },
    result,
  };
}

const baseWireInput = {
  question: 'What is a heap?',
  studentAnswer: 'A tree-shaped structure.',
  referenceAnswer: 'A complete binary tree obeying the heap property.',
  sourceBlocks: [{ blockId: 'b1', text: 'Heaps are complete binary trees.' }],
  misconceptionDigest: [],
};

describe('createWorkerJudgeCaller — the frozen vocabulary it mirrors', () => {
  // Production code deliberately does not import olea-contracts as a value
  // (see the module doc) — this test is what stops the mirror drifting.
  it('sends the task id the frozen catalogue reserves for Slot J', () => {
    expect(EXPLAIN_BACK_JUDGE_TASK_ID).toBe(TASK_IDS.EXPLAIN_BACK_JUDGE);
  });

  it('sends the current contract version', () => {
    expect(EXPLAIN_BACK_JUDGE_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });
});

describe('createWorkerJudgeCaller — the request it builds', () => {
  it('sends the wire input verbatim, in the frozen envelope', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdict: 'correct',
        feedback: 'Good.',
        missedPoints: [],
      }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    await callJudge(baseWireInput);

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe(TASK_IDS.EXPLAIN_BACK_JUDGE);
    expect(request?.contractVersion).toBe(CONTRACT_VERSION);
    expect(request?.payload).toEqual(baseWireInput);
  });
});

describe('createWorkerJudgeCaller — reading the response', () => {
  it('parses a full response with citations and misconceptions', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdict: 'partial',
        feedback: 'Close, but you missed the shape invariant.',
        missedPoints: ['shape invariant'],
        citedIssues: [
          { kind: 'omission', description: 'missed the shape rule', sourceBlockIds: ['b1'] },
        ],
        misconceptionCandidates: [
          {
            concept: 'heap',
            statement: 'a heap is sorted',
            correction: 'a heap only orders parent/child, not siblings',
            correctionSourceBlockIds: ['b1'],
          },
        ],
      }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

    expect(result).toEqual({
      outcome: 'graded',
      verdict: 'partial',
      feedback: 'Close, but you missed the shape invariant.',
      missedPoints: ['shape invariant'],
      citedIssues: [
        { kind: 'omission', description: 'missed the shape rule', sourceBlockIds: ['b1'] },
      ],
      misconceptionCandidates: [
        {
          concept: 'heap',
          statement: 'a heap is sorted',
          correction: 'a heap only orders parent/child, not siblings',
          correctionSourceBlockIds: ['b1'],
        },
      ],
      stamp: { promptVersion: '1.2.0', modelId: 'test-model' },
    });
  });

  it('defaults citedIssues/misconceptionCandidates to [] when the response omits them (an old model shape)', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: 'correct', feedback: 'Good.', missedPoints: [] }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

    if (result.outcome !== 'graded') throw new Error('expected a graded outcome');
    expect(result.citedIssues).toEqual([]);
    expect(result.misconceptionCandidates).toEqual([]);
  });

  it('carries confusedWith only when the response actually populated it', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdict: 'incorrect',
        feedback: 'You conflated two concepts.',
        missedPoints: [],
        misconceptionCandidates: [
          {
            concept: 'heap',
            confusedWith: 'binary search tree',
            statement: 'confused heap ordering with BST ordering',
            correction: 'a heap does not guarantee left-right ordering',
            correctionSourceBlockIds: ['b1'],
          },
          {
            concept: 'stack',
            statement: 'thinks a stack grows from index 0 always',
            correction: 'growth direction is an implementation detail, not part of the ADT',
            correctionSourceBlockIds: ['b1'],
          },
        ],
      }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

    if (result.outcome !== 'graded') throw new Error('expected a graded outcome');
    expect(result.misconceptionCandidates[0]?.confusedWith).toBe('binary search tree');
    expect('confusedWith' in (result.misconceptionCandidates[1] ?? {})).toBe(false);
  });

  it('throws WorkerJudgeError with the code on a well-formed refusal', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'invalid-request',
      message: 'referenceAnswer is required',
    }));
    const callJudge = createWorkerJudgeCaller({ transport });

    await expect(callJudge(baseWireInput)).rejects.toMatchObject({
      name: 'WorkerJudgeError',
      code: 'invalid-request',
    });
  });

  it('throws on a response with no ok discriminant', async () => {
    const transport = new RecordingTransport(() => ({ result: {} }));
    const callJudge = createWorkerJudgeCaller({ transport });

    await expect(callJudge(baseWireInput)).rejects.toBeInstanceOf(WorkerJudgeError);
  });

  it('throws on an unrecognised verdict rather than passing it through', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: 'sort-of', feedback: 'Good.', missedPoints: [] }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    await expect(callJudge(baseWireInput)).rejects.toBeInstanceOf(WorkerJudgeError);
  });

  // -------------------------------------------------------------------------
  // `[D-321]` / `ol-0r92.130` round 2 — outcome: 'unable-to-assess'
  // -------------------------------------------------------------------------

  it('parses outcome unable-to-assess, checked BEFORE the graded fields, carrying the stamp through', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ outcome: 'unable-to-assess', reason: 'blank answer' }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

    expect(result).toEqual({
      outcome: 'unable-to-assess',
      reason: 'blank answer',
      stamp: { promptVersion: '1.2.0', modelId: 'test-model' },
    });
  });

  it('never falls through to the verdict/feedback checks for outcome unable-to-assess — a response with neither would otherwise throw', async () => {
    // Proves the outcome check runs FIRST: this response has no verdict and
    // no feedback at all, which would throw "unrecognised verdict" if the
    // graded checks ran unconditionally.
    const transport = new RecordingTransport(() =>
      okResponse({ outcome: 'unable-to-assess', reason: 'entirely off-topic' }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    await expect(callJudge(baseWireInput)).resolves.toMatchObject({
      outcome: 'unable-to-assess',
      reason: 'entirely off-topic',
    });
  });

  it('MALFORMED: throws WorkerJudgeError on outcome unable-to-assess with no reason text — never fabricates one', async () => {
    const transport = new RecordingTransport(() => okResponse({ outcome: 'unable-to-assess' }));
    const callJudge = createWorkerJudgeCaller({ transport });

    await expect(callJudge(baseWireInput)).rejects.toBeInstanceOf(WorkerJudgeError);
    await expect(callJudge(baseWireInput)).rejects.toMatchObject({
      message: expect.stringContaining('unable-to-assess'),
    });
  });

  it('MALFORMED: throws WorkerJudgeError on outcome unable-to-assess with an empty-string reason', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ outcome: 'unable-to-assess', reason: '' }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    await expect(callJudge(baseWireInput)).rejects.toBeInstanceOf(WorkerJudgeError);
  });

  it('an old Worker response with no outcome field at all still falls through to the graded checks unchanged', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: 'correct', feedback: 'Good.', missedPoints: [] }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);
    expect(result.outcome).toBe('graded');
  });

  it('reads the D7.3 prompt/model stamp off the response body (ol-egov.141.89.38)', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: 'correct', feedback: 'Good.', missedPoints: [] }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

    expect(result.stamp).toEqual({ promptVersion: '1.2.0', modelId: 'test-model' });
  });

  it('reads a null stamp when the response carries none, rather than inventing one', async () => {
    const transport = new RecordingTransport(() => ({
      ok: true,
      result: { verdict: 'correct', feedback: 'Good.', missedPoints: [] },
    }));
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

    expect(result.stamp).toBeNull();
  });

  it('throws when a present citedIssues entry is missing sourceBlockIds — never fabricates one', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdict: 'partial',
        feedback: 'Close.',
        missedPoints: [],
        citedIssues: [{ kind: 'omission', description: 'missed something' }],
      }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    // sourceBlockIds absent on the entry itself defaults to [] (readStringArray),
    // which groundCitations (downstream) would then drop — proved end to end below.
    const result = await callJudge(baseWireInput);
    if (result.outcome !== 'graded') throw new Error('expected a graded outcome');
    expect(result.citedIssues[0]?.sourceBlockIds).toEqual([]);
  });
});

describe("createWorkerJudgeCaller — end to end through gradeExplainBack (grounding is the caller's job)", () => {
  it('a citation to a real block survives grounding', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdict: 'partial',
        feedback: 'Missed the invariant.',
        missedPoints: ['shape invariant'],
        citedIssues: [
          { kind: 'omission', description: 'missed the shape rule', sourceBlockIds: ['b1'] },
        ],
      }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const pending = await gradeExplainBack(
      {
        question: baseWireInput.question,
        studentAnswer: baseWireInput.studentAnswer,
        referenceAnswer: baseWireInput.referenceAnswer,
        sourceBlocks: baseWireInput.sourceBlocks,
        misconceptionDigest: [],
      },
      callJudge,
    );

    if (pending.grading.outcome !== 'graded') throw new Error('expected a graded outcome');
    expect(pending.grading.citedIssues).toHaveLength(1);
    expect(pending.grading.droppedCitationCount).toBe(0);
  });

  it('a citation to a block never supplied is dropped, not surfaced (INV-5)', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdict: 'partial',
        feedback: 'Missed the invariant.',
        missedPoints: ['shape invariant'],
        citedIssues: [
          {
            kind: 'omission',
            description: 'invented citation',
            sourceBlockIds: ['not-a-real-block'],
          },
        ],
      }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const pending = await gradeExplainBack(
      {
        question: baseWireInput.question,
        studentAnswer: baseWireInput.studentAnswer,
        referenceAnswer: baseWireInput.referenceAnswer,
        sourceBlocks: baseWireInput.sourceBlocks,
        misconceptionDigest: [],
      },
      callJudge,
    );

    if (pending.grading.outcome !== 'graded') throw new Error('expected a graded outcome');
    expect(pending.grading.citedIssues).toHaveLength(0);
    expect(pending.grading.droppedCitationCount).toBe(1);
  });
});

describe('createWorkerJudgeCaller — never logs (D-005)', () => {
  it('the source file contains no console/logging call', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./workerJudgeCaller.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/console\.\w+\(/);
  });
});
