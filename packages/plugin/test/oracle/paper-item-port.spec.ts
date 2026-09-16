/**
 * `createWorkerPaperItemGenerationPort` tests — the composition-root implementation of
 * `PaperItemGenerationPort` (F4.11, `[D-250]`/`[D-252]`, component register row 2.11).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
 * generation-pipeline block, tagged `@auto:plugin/oracle/paper-item-port.spec`.
 */
import type { PaperItemGenerationRequest, WorkerTaskTransport } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createWorkerPaperItemGenerationPort } from '../../src/oracle/paper-item-port.js';

const REQUEST: PaperItemGenerationRequest = {
  taskId: 'quiz.generate.v1',
  courseCode: 'COURSEA',
  conceptName: 'Krebs cycle',
  sourceChunks: ['grounding text'],
  purpose: 'readiness',
};

function fakeTransport(handler: (request: unknown) => unknown): WorkerTaskTransport {
  return {
    async send(request) {
      return handler(request);
    },
  };
}

describe('createWorkerPaperItemGenerationPort', () => {
  it('sends the pre-chosen sourceChunks verbatim — no retrieval, no prompt assembly here', async () => {
    let sentPayload: unknown;
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport((request) => {
        sentPayload = request;
        return { success: true, questions: [] };
      }),
    });
    await port(REQUEST);
    expect(sentPayload).toMatchObject({
      taskId: 'quiz.generate.v1',
      payload: {
        courseCode: 'COURSEA',
        conceptName: 'Krebs cycle',
        sourceChunks: ['grounding text'],
        purpose: 'readiness',
      },
    });
  });

  it('a well-formed ErrorResponse becomes a refused result, carrying the Worker error code', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => ({
        success: false,
        error: { code: 'below-composite-threshold', message: 'not enough held material' },
      })),
    });
    const result = await port(REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'below-composite-threshold' });
  });

  it('a successful response becomes a generated result, response passed through untouched', async () => {
    const workerBody = { success: true, promptVersion: 'v3', questions: [{ stem: 'x' }] };
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => workerBody),
    });
    const result = await port(REQUEST);
    expect(result).toEqual({
      status: 'generated',
      taskId: 'quiz.generate.v1',
      promptVersion: 'v3',
      response: workerBody,
    });
  });

  it('a transport failure propagates rather than being swallowed into a false refusal', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: {
        async send() {
          throw new Error('network failure');
        },
      },
    });
    await expect(port(REQUEST)).rejects.toThrow('network failure');
  });
});
