/**
 * The paper port's `toWorkerPayload` and the slot's demand (`[D-437]` W1, design
 * `docs/dev/intelligence-build/demand-carriage.md` section 6 row T4; bead `ol-egov.141.89.2.23`).
 *
 * A demand READ from her papers travels as `intendedDemand`; the recall default carries none, and
 * the payload is then exactly today's: the same four keys, no `intendedDemand` property at all.
 *
 * Scenarios: olea-service/features/F4-oracle.md — "the paper port sends a slot's demand only when it
 * was read from her papers", tagged `@auto:plugin/oracle/paper-item-port-demand.spec`.
 */
import type { PaperItemGenerationRequest, WorkerTaskTransport } from 'olea-core';
import { describe, expect, it } from 'vitest';
import { createWorkerPaperSlotOutcomePort } from '../../src/oracle/paper-item-port.js';
import { successEnvelope } from './worker-envelope-fixtures.js';

const BASE: PaperItemGenerationRequest = {
  taskId: 'quiz.generate.v1',
  courseCode: 'COURSEA',
  conceptName: 'Topic A',
  sourceChunks: ['grounding text'],
  purpose: 'readiness',
};

async function sentPayload(request: PaperItemGenerationRequest): Promise<unknown> {
  const sent: unknown[] = [];
  const transport: WorkerTaskTransport = {
    async send(message) {
      sent.push((message as { payload: unknown }).payload);
      return successEnvelope({ questions: [] });
    },
  };
  await createWorkerPaperSlotOutcomePort({ transport })(request);
  expect(sent).toHaveLength(1);
  return sent[0];
}

describe('the paper port sends a slot demand only when it was read from her papers', () => {
  it('a read demand is carried as intendedDemand', async () => {
    const payload = await sentPayload({ ...BASE, intendedDemand: 'recall-a-fact' });
    expect(payload).toEqual({
      courseCode: 'COURSEA',
      conceptName: 'Topic A',
      sourceChunks: ['grounding text'],
      purpose: 'readiness',
      intendedDemand: 'recall-a-fact',
    });
  });

  it('a request with no demand sends today’s payload: no intendedDemand property at all', async () => {
    const payload = await sentPayload(BASE);
    expect(payload).toEqual({
      courseCode: 'COURSEA',
      conceptName: 'Topic A',
      sourceChunks: ['grounding text'],
      purpose: 'readiness',
    });
    expect(Object.keys(payload as object)).toEqual([
      'courseCode',
      'conceptName',
      'sourceChunks',
      'purpose',
    ]);
    expect('intendedDemand' in (payload as object)).toBe(false);
  });
});
