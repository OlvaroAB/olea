/**
 * `WorkerMaterialityJudge` tests (`ol-2zfj.18`, register row 1.4's paid
 * second stage, `TRG-1`).
 *
 * Runs entirely against a fake `WorkerTaskTransport` — no `obsidian` import
 * anywhere in this file (INV-1). Mirrors
 * `../../review/explainWhy.spec.ts`'s shape for `WorkerExplainWhyGenerator`.
 */

import { TASK_IDS } from 'olea-contracts';
import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  MATERIALITY_JUDGE_CONTRACT_VERSION,
  MATERIALITY_JUDGE_TASK_ID,
  WorkerMaterialityJudge,
  WorkerMaterialityJudgeError,
} from '../../../src/ingestion/materiality/workerJudge.js';

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

const INPUT = {
  path: 'Courses/GEO101/Lecture 3.md',
  previousText: 'Basalt weathers quickly.',
  currentText: 'Basalt does not weather at all in cold, dry climates.',
};

describe('WorkerMaterialityJudge — the frozen vocabulary it mirrors', () => {
  // The module deliberately does not import olea-contracts as a value in
  // production code (see the module doc). This test is what stops the
  // mirror drifting.
  it('sends the task id the frozen catalogue reserves for row 1.4', () => {
    expect(MATERIALITY_JUDGE_TASK_ID).toBe(TASK_IDS.MATERIALITY_JUDGE);
  });

  it('sends the current contract version', () => {
    expect(MATERIALITY_JUDGE_CONTRACT_VERSION).toBe(2);
  });
});

describe('WorkerMaterialityJudge — the request it builds', () => {
  it('sends field for field with the service request shape, and never sends `path`', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ material: true, reason: 'the claim reversed', overriddenToNotMaterial: false }),
    );
    const judge = new WorkerMaterialityJudge({ transport });

    await judge.judge(INPUT);

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('materiality.judge.v1');
    expect(request?.contractVersion).toBe(2);
    expect(request?.payload).toEqual({
      previousText: INPUT.previousText,
      currentText: INPUT.currentText,
    });
    expect(request?.payload).not.toHaveProperty('path');
  });

  it('accepts an empty previousText — a legitimate first sighting', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ material: true, reason: 'new material', overriddenToNotMaterial: false }),
    );
    const judge = new WorkerMaterialityJudge({ transport });

    await judge.judge({ ...INPUT, previousText: '' });

    expect(transport.sent[0]?.payload).toEqual({
      previousText: '',
      currentText: INPUT.currentText,
    });
  });
});

describe('WorkerMaterialityJudge — the response it reads', () => {
  it('reads a material:true verdict field for field', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ material: true, reason: 'the claim reversed', overriddenToNotMaterial: false }),
    );
    const judge = new WorkerMaterialityJudge({ transport });

    const verdict = await judge.judge(INPUT);

    expect(verdict).toEqual({ material: true, reason: 'the claim reversed' });
  });

  it('reads a material:false verdict field for field', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        material: false,
        reason: 'reworded only, same claim',
        overriddenToNotMaterial: false,
      }),
    );
    const judge = new WorkerMaterialityJudge({ transport });

    const verdict = await judge.judge(INPUT);

    expect(verdict).toEqual({ material: false, reason: 'reworded only, same claim' });
  });

  it('drops overriddenToNotMaterial — not part of the MaterialityJudgeVerdict port shape', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        material: false,
        reason: 'no groundable content in the current text',
        overriddenToNotMaterial: true,
      }),
    );
    const judge = new WorkerMaterialityJudge({ transport });

    const verdict = await judge.judge({ ...INPUT, currentText: '' });

    expect(verdict).toEqual({
      material: false,
      reason: 'no groundable content in the current text',
    });
    expect(verdict).not.toHaveProperty('overriddenToNotMaterial');
  });
});

describe('WorkerMaterialityJudge — refuses to hand back an unusable shape', () => {
  it('throws WorkerMaterialityJudgeError when the response body is not an object', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: new RecordingTransport(() => 'not an object'),
    });
    await expect(judge.judge(INPUT)).rejects.toThrow(WorkerMaterialityJudgeError);
  });

  it('throws when the response carries no `ok` discriminant', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: new RecordingTransport(() => ({ result: { material: true, reason: 'x' } })),
    });
    await expect(judge.judge(INPUT)).rejects.toThrow(WorkerMaterialityJudgeError);
  });

  it('throws when `result` is missing', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: new RecordingTransport(() => ({ ok: true, stamp: {} })),
    });
    await expect(judge.judge(INPUT)).rejects.toThrow(WorkerMaterialityJudgeError);
  });

  it('throws when `material` is missing or not boolean', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: new RecordingTransport(() => okResponse({ reason: 'x' })),
    });
    await expect(judge.judge(INPUT)).rejects.toThrow(WorkerMaterialityJudgeError);
  });

  it('throws when `reason` is missing or empty', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: new RecordingTransport(() => okResponse({ material: true, reason: '' })),
    });
    await expect(judge.judge(INPUT)).rejects.toThrow(WorkerMaterialityJudgeError);
  });

  it('throws WorkerMaterialityJudgeError (carrying the Worker code) on an ok:false refusal', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: new RecordingTransport(() => ({
        ok: false,
        code: 'upstream-error',
        message: 'The model call failed.',
      })),
    });
    try {
      await judge.judge(INPUT);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as WorkerMaterialityJudgeError).code).toBe('upstream-error');
    }
  });

  it('propagates a transport-level failure (no response at all, e.g. offline) as a rejected promise', async () => {
    const judge = new WorkerMaterialityJudge({
      transport: {
        send: async () => {
          throw new Error('network unreachable');
        },
      },
    });
    await expect(judge.judge(INPUT)).rejects.toThrow('network unreachable');
  });
});
