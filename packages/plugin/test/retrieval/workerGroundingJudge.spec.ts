/**
 * `WorkerGroundingJudge` tests (`[WIRE-5]`, `ol-i0y6`).
 *
 * Runs entirely against a fake `WorkerTaskTransport` — no `obsidian` import
 * anywhere in this file (INV-1), and none needed:
 * `workerGroundingJudge.ts` imports nothing Obsidian-specific. Mirrors
 * `../concept/workerConceptReader.spec.ts`'s shape for the sibling adapter.
 */

import { TASK_IDS } from 'olea-contracts';
import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  GROUNDING_JUDGE_CONTRACT_VERSION,
  GROUNDING_JUDGE_TASK_ID,
  WorkerGroundingJudge,
  WorkerGroundingJudgeError,
} from '../../src/retrieval/workerGroundingJudge.js';

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
  return { ok: true, stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'm' }, result };
}

describe('WorkerGroundingJudge — the frozen vocabulary it mirrors', () => {
  // The module deliberately does not import olea-contracts as a value in
  // production code (see the module doc). This test is what stops the
  // mirror drifting.
  it('sends the task id the frozen catalogue reserves for W6/Slot J grounding judgment', () => {
    expect(GROUNDING_JUDGE_TASK_ID).toBe(TASK_IDS.GROUNDING_JUDGE);
  });

  it('sends the current contract version', () => {
    expect(GROUNDING_JUDGE_CONTRACT_VERSION).toBe(2);
  });
});

describe('WorkerGroundingJudge — the request it builds', () => {
  it('sends exactly the query and context fields, field for field with the service request shape', async () => {
    const transport = new RecordingTransport(() => okResponse({ supported: true, reason: 'ok' }));
    const judge = new WorkerGroundingJudge({ transport });

    await judge.judge({ query: 'What is an ERP?', context: 'ERPs are voltage deflections.' });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('grounding.judge.v1');
    expect(request?.contractVersion).toBe(2);
    expect(request?.payload).toEqual({
      query: 'What is an ERP?',
      context: 'ERPs are voltage deflections.',
    });
  });

  it('sends an empty context string as-is — a first-class value for this task, never coerced or dropped', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ supported: false, reason: 'no context' }),
    );
    const judge = new WorkerGroundingJudge({ transport });

    await judge.judge({ query: 'anything', context: '' });

    expect(transport.sent[0]?.payload).toEqual({ query: 'anything', context: '' });
  });
});

describe('WorkerGroundingJudge — the response it reads', () => {
  it('returns supported/reason field for field', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ supported: true, reason: 'the passages name the term and define it' }),
    );
    const judge = new WorkerGroundingJudge({ transport });

    const verdict = await judge.judge({ query: 'q', context: 'c' });

    expect(verdict).toEqual({
      supported: true,
      reason: 'the passages name the term and define it',
    });
  });

  it('returns a supported: false verdict just as faithfully as a true one', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        supported: false,
        reason: 'the passages mention the term but do not answer it',
      }),
    );
    const judge = new WorkerGroundingJudge({ transport });

    const verdict = await judge.judge({ query: 'q', context: 'c' });

    expect(verdict.supported).toBe(false);
  });
});

describe('WorkerGroundingJudge — refuses to hand back an unusable shape, so the band path can fail closed', () => {
  it('throws WorkerGroundingJudgeError when the response body is not an object', async () => {
    const transport = new RecordingTransport(() => 'not an object');
    const judge = new WorkerGroundingJudge({ transport });

    await expect(judge.judge({ query: 'q', context: 'c' })).rejects.toThrow(
      WorkerGroundingJudgeError,
    );
  });

  it('throws when the response carries no `ok` discriminant', async () => {
    const transport = new RecordingTransport(() => ({ result: { supported: true, reason: 'x' } }));
    const judge = new WorkerGroundingJudge({ transport });

    await expect(judge.judge({ query: 'q', context: 'c' })).rejects.toThrow(
      WorkerGroundingJudgeError,
    );
  });

  it('throws when result.supported is missing or not boolean', async () => {
    const transport = new RecordingTransport(() => okResponse({ reason: 'x' }));
    const judge = new WorkerGroundingJudge({ transport });

    await expect(judge.judge({ query: 'q', context: 'c' })).rejects.toThrow(
      WorkerGroundingJudgeError,
    );
  });

  it('throws when result.reason is missing or empty', async () => {
    const transport = new RecordingTransport(() => okResponse({ supported: true, reason: '' }));
    const judge = new WorkerGroundingJudge({ transport });

    await expect(judge.judge({ query: 'q', context: 'c' })).rejects.toThrow(
      WorkerGroundingJudgeError,
    );
  });

  it('throws WorkerGroundingJudgeError (carrying the Worker code) on an ok:false refusal — this class does not itself decide availability (F7.8 is the composition root job)', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'upstream-error',
      message: 'The model call failed.',
    }));
    const judge = new WorkerGroundingJudge({ transport });

    await expect(judge.judge({ query: 'q', context: 'c' })).rejects.toThrow(
      WorkerGroundingJudgeError,
    );
    try {
      await judge.judge({ query: 'q', context: 'c' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as WorkerGroundingJudgeError).code).toBe('upstream-error');
    }
  });

  it("propagates a transport-level failure (no response at all) as a rejected promise — the band's own judgeWithinBudget is what turns this into judge-unavailable, not this class", async () => {
    const judge = new WorkerGroundingJudge({
      transport: {
        send: async () => {
          throw new Error('network unreachable');
        },
      },
    });

    await expect(judge.judge({ query: 'q', context: 'c' })).rejects.toThrow('network unreachable');
  });
});
