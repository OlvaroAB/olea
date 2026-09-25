/**
 * `createWorkerPaperItemGenerationPort` — the `cards.generate.v1` case specifically
 * (`ol-0r92.102` [DOS-I6]).
 *
 * `../../src/oracle/paper-item-port.spec.ts` already covers this port's request/response/refusal/
 * throw behaviour with a `quiz.generate.v1` fixture (the `recall-style` route,
 * `oracle/paper-blueprint.ts`'s `taskIdForFormatClass`). This file adds the sibling case the port
 * is otherwise never exercised against under test: a `written`/`practical` slot, whose
 * `taskIdForFormatClass` resolves to `'cards.generate.v1'` (`oracle/paper-blueprint.ts:231`).
 * The port itself does not branch on `taskId` — it is forwarded verbatim into both the outgoing
 * envelope and the `'generated'` result — so this test exists to prove that verbatim pass-through
 * actually holds for the `cards.generate.v1` literal too, not just for `quiz.generate.v1`, since a
 * hidden `taskId === 'quiz.generate.v1'` assumption anywhere in this file would otherwise go
 * uncaught (no test elsewhere in this package sends a `cards.generate.v1` request through this
 * port; `oracle/paper-items.spec.ts`, `olea-core`, tests the caller's routing decision, not this
 * transport-facing seam).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
 * generation-pipeline block (same tag family as `paper-item-port.spec.ts`).
 */
import type { PaperItemGenerationRequest, WorkerTaskTransport } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createWorkerPaperItemGenerationPort } from '../../src/oracle/paper-item-port.js';

const CARDS_REQUEST: PaperItemGenerationRequest = {
  taskId: 'cards.generate.v1',
  courseCode: 'COURSEA',
  conceptName: 'Cell membrane transport',
  sourceChunks: ['grounding text for a written-response slot'],
  purpose: 'readiness',
};

function fakeTransport(handler: (request: unknown) => unknown): WorkerTaskTransport {
  return {
    async send(request) {
      return handler(request);
    },
  };
}

describe('createWorkerPaperItemGenerationPort — cards.generate.v1 route', () => {
  it('sends taskId "cards.generate.v1" verbatim for a written/practical slot', async () => {
    let sentPayload: unknown;
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport((request) => {
        sentPayload = request;
        return { success: true, promptVersion: 'v1', card: { front: 'x', back: 'y' } };
      }),
    });
    await port(CARDS_REQUEST);
    expect(sentPayload).toMatchObject({
      taskId: 'cards.generate.v1',
      payload: {
        courseCode: 'COURSEA',
        conceptName: 'Cell membrane transport',
        sourceChunks: ['grounding text for a written-response slot'],
        purpose: 'readiness',
      },
    });
  });

  it('a successful cards.generate.v1 response comes back generated, carrying that taskId', async () => {
    const workerBody = {
      success: true,
      promptVersion: 'v2',
      card: { front: 'What transports glucose?', back: 'GLUT transporters' },
    };
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => workerBody),
    });
    const result = await port(CARDS_REQUEST);
    expect(result).toEqual({
      status: 'generated',
      taskId: 'cards.generate.v1',
      promptVersion: 'v2',
      response: workerBody,
    });
  });

  it('a refused cards.generate.v1 request (e.g. INV-5 empty-context) becomes a refused result, never a thrown error', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => ({
        success: false,
        error: { code: 'empty-context', message: 'no groundable material' },
      })),
    });
    const result = await port(CARDS_REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'empty-context' });
  });
});
