/**
 * `createWorkerPaperItemGenerationPort` — the `cards.generate.v1` case specifically
 * (`ol-0r92.102` [DOS-I6]), reading the real Worker envelope (`ol-egov.141.89.7.29`).
 *
 * `./paper-item-port.spec.ts` already covers this port's request/response/refusal/outage behaviour
 * with a `quiz.generate.v1` fixture (the `recall-style` route, `oracle/paper-blueprint.ts`'s
 * `taskIdForFormatClass`). This file adds the sibling case the port is otherwise never exercised
 * against under test: a `written`/`practical` slot, whose `taskIdForFormatClass` resolves to
 * `'cards.generate.v1'` (`oracle/paper-blueprint.ts:231`). The port forwards `taskId` verbatim into
 * both the outgoing envelope and the `'generated'` result, but it now also reads the slot's
 * artefact list by task id (`cards` for this task, `questions` for the other), so this file is where
 * that per-task read is proved for cards: a hidden `taskId === 'quiz.generate.v1'` assumption
 * anywhere in the port would otherwise go uncaught.
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
 * generation-pipeline block (same tag family as `paper-item-port.spec.ts`).
 */
import type { PaperItemGenerationRequest, WorkerTaskTransport } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createWorkerPaperItemGenerationPort } from '../../src/oracle/paper-item-port.js';
import { errorEnvelope, successEnvelope } from './worker-envelope-fixtures.js';

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

const CARD = { front: 'What transports glucose?', back: 'GLUT transporters' };

describe('createWorkerPaperItemGenerationPort — cards.generate.v1 route', () => {
  it('sends taskId "cards.generate.v1" verbatim for a written/practical slot', async () => {
    let sentPayload: unknown;
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport((request) => {
        sentPayload = request;
        return successEnvelope({ cards: [CARD] }, 'v1');
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

  it('a successful cards.generate.v1 response comes back generated, carrying that taskId and the stamped version', async () => {
    const workerBody = successEnvelope({ cards: [CARD] }, 'v2');
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

  it('an INV-5 empty-context refusal (a stamped success of zero cards) becomes a refused result, never a generated item', async () => {
    // The service answers an empty or stub source with `{ cards: [] }` under a stamp, before any
    // model call (olea-service `emptyContextGuard`); it has no grounding-refused error path for
    // this task.
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => successEnvelope({ cards: [] }, 'v2')),
    });
    const result = await port(CARDS_REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'empty-result' });
  });

  it('a grounding-refused error for cards is refused; any other error is an outage that propagates, not a refusal', async () => {
    const refusing = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => errorEnvelope('grounding-refused')),
    });
    expect(await refusing(CARDS_REQUEST)).toEqual({
      status: 'refused',
      reason: 'grounding-refused',
    });

    const failing = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => errorEnvelope('quota-exceeded')),
    });
    await expect(failing(CARDS_REQUEST)).rejects.toMatchObject({ reason: 'quota-exceeded' });
  });
});
