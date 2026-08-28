import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, TASK_IDS } from 'olea-contracts';
import { describe, expect, it } from 'vitest';
import type { WorkerTaskRequest, WorkerTaskTransport } from '../retrieval/workerProvider.js';
import {
  createWorkerSoloJudgeCaller,
  EXPLAIN_BACK_SOLO_CONTRACT_VERSION,
  EXPLAIN_BACK_SOLO_TASK_ID,
  WorkerSoloJudgeError,
} from './workerSoloJudgeCaller.js';

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
    stamp: { contractVersion: CONTRACT_VERSION, promptVersion: '1.0.0', modelId: 'test-model' },
    result,
  };
}

const baseWireInput = {
  question: 'Explain interference theory.',
  studentAnswer: 'Old memories block new ones.',
  sourceBlocks: [{ blockId: 'b1', text: 'Interference is retrieval competition.' }],
  relationExpected: false,
};

describe('createWorkerSoloJudgeCaller — the frozen vocabulary it mirrors', () => {
  // Production code deliberately does not import olea-contracts as a value
  // (see the module doc) — this test is what stops the mirror drifting.
  it('sends the task id the frozen catalogue reserves for the SOLO depth verdict', () => {
    expect(EXPLAIN_BACK_SOLO_TASK_ID).toBe(TASK_IDS.EXPLAIN_BACK_SOLO);
  });

  it('sends the current contract version', () => {
    expect(EXPLAIN_BACK_SOLO_CONTRACT_VERSION).toBe(CONTRACT_VERSION);
  });
});

describe('createWorkerSoloJudgeCaller — the request it builds', () => {
  it('sends the wire input verbatim, in the frozen envelope', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        soloLevel: 'unistructural',
        rationale: 'Names one relevant element, unelaborated.',
        citedBlockIds: [],
      }),
    );
    const callSolo = createWorkerSoloJudgeCaller({ transport });

    await callSolo(baseWireInput);

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe(TASK_IDS.EXPLAIN_BACK_SOLO);
    expect(request?.contractVersion).toBe(CONTRACT_VERSION);
    expect(request?.payload).toEqual(baseWireInput);
  });
});

describe('createWorkerSoloJudgeCaller — reading the response', () => {
  it('parses a full response with citations and a demonstrated neighbour use', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        soloLevel: 'relational',
        rationale: 'Connects both mechanisms under one principle.',
        citedBlockIds: ['b1'],
        neighbourUseDemonstrated: true,
      }),
    );
    const callSolo = createWorkerSoloJudgeCaller({ transport });

    const result = await callSolo({ ...baseWireInput, relationExpected: true });

    expect(result).toEqual({
      soloLevel: 'relational',
      rationale: 'Connects both mechanisms under one principle.',
      citedBlockIds: ['b1'],
      neighbourUseDemonstrated: true,
    });
  });

  it('reads a minimal response with no citedBlockIds and no neighbourUseDemonstrated', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        soloLevel: 'prestructural',
        rationale: 'No relevant structure.',
      }),
    );
    const callSolo = createWorkerSoloJudgeCaller({ transport });

    const result = await callSolo(baseWireInput);

    expect(result.citedBlockIds).toEqual([]);
    expect(Object.hasOwn(result, 'neighbourUseDemonstrated')).toBe(false);
  });

  it('rejects a response with an unrecognised soloLevel', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ soloLevel: 'expert', rationale: 'x' }),
    );
    const callSolo = createWorkerSoloJudgeCaller({ transport });

    await expect(callSolo(baseWireInput)).rejects.toThrow(WorkerSoloJudgeError);
  });

  it('rejects a response with no rationale', async () => {
    const transport = new RecordingTransport(() => okResponse({ soloLevel: 'unistructural' }));
    const callSolo = createWorkerSoloJudgeCaller({ transport });

    await expect(callSolo(baseWireInput)).rejects.toThrow(/no rationale text/);
  });

  it('surfaces the Worker refusal code and message', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'invalid-request',
      message: 'sourceBlocks must be an array',
    }));
    const callSolo = createWorkerSoloJudgeCaller({ transport });

    await expect(callSolo(baseWireInput)).rejects.toMatchObject({
      name: 'WorkerSoloJudgeError',
      code: 'invalid-request',
    });
  });
});

describe('createWorkerSoloJudgeCaller — never logs (D-005)', () => {
  it('the source file contains no console/logging call', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./workerSoloJudgeCaller.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/console\.\w+\(/);
  });
});
