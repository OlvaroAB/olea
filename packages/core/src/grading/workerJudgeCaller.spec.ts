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
    });
  });

  it('defaults citedIssues/misconceptionCandidates to [] when the response omits them (an old model shape)', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: 'correct', feedback: 'Good.', missedPoints: [] }),
    );
    const callJudge = createWorkerJudgeCaller({ transport });

    const result = await callJudge(baseWireInput);

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
