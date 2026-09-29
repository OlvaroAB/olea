/**
 * `createWorkerPaperSlotOutcomePort` / `createWorkerPaperItemGenerationPort` tests — the
 * composition-root implementation of `PaperItemGenerationPort` (F4.11, `[D-250]`/`[D-252]`,
 * component register row 2.11), reading the REAL Worker envelope (`ol-egov.141.89.7.29`,
 * `[D-430]`, `[D-438]`).
 *
 * Every response below is built by `./worker-envelope-fixtures.ts`, which runs it through
 * `olea-contracts`' own `workerResponse` schema, so this file can no longer agree with the port on a
 * shape the Worker never sends (the fault this bead fixes: a `{ success, error }` reader that stored
 * a real grounding refusal as a generated item and read every prompt version as `unknown`).
 *
 * Scenarios: olea-service/features/F4-oracle.md — "F4.11 — Practice paper product scope", the
 * generation-pipeline block, tagged `@auto:plugin/oracle/paper-item-port.spec`.
 */
import { errorCode } from 'olea-contracts';
import type {
  PaperBlueprint,
  PaperBlueprintSlot,
  PaperItemGenerationRequest,
  WorkerTaskTransport,
} from 'olea-core';
import { classifyPaperSlotWorkerResult, fillPaperBlueprintSlots } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createWorkerPaperItemGenerationPort,
  createWorkerPaperSlotOutcomePort,
  PaperItemServiceUnavailableError,
} from '../../src/oracle/paper-item-port.js';
import { errorEnvelope, QUIZ_QUESTION, successEnvelope } from './worker-envelope-fixtures.js';

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

function outcomePort(body: unknown) {
  return createWorkerPaperSlotOutcomePort({ transport: fakeTransport(() => body) });
}

const QUIZ_SUCCESS = successEnvelope({ questions: [QUIZ_QUESTION] }, 'v3');

describe('createWorkerPaperSlotOutcomePort — the request', () => {
  it('sends the pre-chosen sourceChunks verbatim — no retrieval, no prompt assembly here', async () => {
    let sentPayload: unknown;
    const port = createWorkerPaperSlotOutcomePort({
      transport: fakeTransport((request) => {
        sentPayload = request;
        return QUIZ_SUCCESS;
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
});

describe('createWorkerPaperSlotOutcomePort — success', () => {
  it('a stamped success is generated, and the prompt version is read from stamp.promptVersion', async () => {
    const result = await outcomePort(QUIZ_SUCCESS)(REQUEST);
    expect(result).toEqual({
      status: 'generated',
      taskId: 'quiz.generate.v1',
      promptVersion: 'v3',
      response: QUIZ_SUCCESS,
    });
  });

  it('carries whichever version the stamp names, never a placeholder', async () => {
    for (const version of ['1.0.0', 'v2', '3.14.1-rc']) {
      const result = await outcomePort(successEnvelope({ questions: [QUIZ_QUESTION] }, version))(
        REQUEST,
      );
      expect(result).toMatchObject({ status: 'generated', promptVersion: version });
    }
  });

  it('a success with no usable stamp is an outage, never generated with a guessed version (D7.3)', async () => {
    const noStamp = { ok: true, result: { questions: [QUIZ_QUESTION] } };
    const emptyVersion = { ok: true, stamp: { promptVersion: '' }, result: { questions: [] } };
    for (const body of [noStamp, emptyVersion]) {
      const result = await outcomePort(body)(REQUEST);
      expect(result).toEqual({ status: 'unavailable', reason: 'no-stamp' });
    }
  });

  it('a version at the top level of the body (the retired shape) is not a stamp', async () => {
    const result = await outcomePort({
      ok: true,
      promptVersion: 'v9',
      result: { questions: [QUIZ_QUESTION] },
    })(REQUEST);
    expect(result).toEqual({ status: 'unavailable', reason: 'no-stamp' });
  });
});

describe('createWorkerPaperSlotOutcomePort — refusal is a fact about her material', () => {
  it('the contract grounding-refused code is refused, carrying that reason', async () => {
    const result = await outcomePort(errorEnvelope('grounding-refused'))(REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'grounding-refused' });
  });

  it('the service answers an empty or stub source with a stamped success of zero questions: refused, not generated', async () => {
    // olea-service registry.ts: "Zero is the refusal" — cards/quiz have no grounding-refused path, the
    // pre-call guard answers `{ questions: [] }` with a stamp. Stored as an item it would be a paper
    // item with nothing to ask (`paperItemMcqCandidate` throws on it).
    const result = await outcomePort(successEnvelope({ questions: [] }, 'v3'))(REQUEST);
    expect(result).toEqual({ status: 'refused', reason: 'empty-result' });
  });

  it('the same holds for a cards.generate.v1 slot with zero cards', async () => {
    const result = await outcomePort(successEnvelope({ cards: [] }, 'v2'))({
      ...REQUEST,
      taskId: 'cards.generate.v1',
    });
    expect(result).toEqual({ status: 'refused', reason: 'empty-result' });
  });

  it('a success whose result has no artefact list at all is an outage, not a verdict on her notes', async () => {
    for (const body of [successEnvelope({}), successEnvelope(null), successEnvelope('x')]) {
      const result = await outcomePort(body)(REQUEST);
      expect(result).toEqual({ status: 'unavailable', reason: 'malformed-result' });
    }
    // A cards list is not a quiz list: the artefact is read by the slot's own task id.
    const wrongList = await outcomePort(successEnvelope({ cards: [{ front: 'x', back: 'y' }] }))(
      REQUEST,
    );
    expect(wrongList).toEqual({ status: 'unavailable', reason: 'malformed-result' });
  });
});

describe('createWorkerPaperSlotOutcomePort — an outage is work owed, never a refusal', () => {
  it('every error code the contract defines except grounding-refused is unavailable, carrying that code', async () => {
    const codes = errorCode.options.filter((code) => code !== 'grounding-refused');
    // The service can answer a paper slot with each of these (olea-service src/index.ts: 426, 401,
    // 400, 429 and the allowance stop, 502 from a model that cannot answer or be reached, 500).
    expect([...codes].sort()).toEqual([
      'internal-error',
      'invalid-request',
      'quota-exceeded',
      'unauthenticated',
      'update-required',
      'upstream-error',
    ]);
    for (const code of codes) {
      const result = await outcomePort(errorEnvelope(code))(REQUEST);
      expect(result).toEqual({ status: 'unavailable', reason: code });
    }
  });

  it('a transport that throws is unavailable, with a structural reason and no message text', async () => {
    const port = createWorkerPaperSlotOutcomePort({
      transport: {
        async send() {
          throw new Error('network failure with detail that must not travel');
        },
      },
    });
    expect(await port(REQUEST)).toEqual({ status: 'unavailable', reason: 'transport-failure' });
  });

  it('a body that is not an envelope is unavailable', async () => {
    for (const body of [null, undefined, 'text', 42, [], {}, { ok: 'yes' }]) {
      const result = await outcomePort(body)(REQUEST);
      expect(result.status).toBe('unavailable');
    }
  });

  it('the retired { success, error } shape is never a refusal or an item', async () => {
    const retiredError = { success: false, error: { code: 'grounding-refused', message: 'm' } };
    const retiredSuccess = { success: true, promptVersion: 'v3', questions: [QUIZ_QUESTION] };
    for (const body of [retiredError, retiredSuccess]) {
      const result = await outcomePort(body)(REQUEST);
      expect(result.status).toBe('unavailable');
    }
  });

  it('a refusal and an outage never share a reason', async () => {
    const refused = await outcomePort(errorEnvelope('grounding-refused'))(REQUEST);
    const outage = await outcomePort(errorEnvelope('upstream-error'))(REQUEST);
    expect(refused.status).toBe('refused');
    expect(outage.status).toBe('unavailable');
    expect((refused as { reason: string }).reason).not.toBe((outage as { reason: string }).reason);
  });
});

describe('createWorkerPaperSlotOutcomePort — one classifier, not two', () => {
  it('agrees with core classifyPaperSlotWorkerResult on every envelope the core reads', async () => {
    const bodies: unknown[] = [
      QUIZ_SUCCESS,
      errorEnvelope('grounding-refused'),
      ...errorCode.options.map((code) => errorEnvelope(code)),
      { ok: true, result: {} },
      null,
      'x',
      { success: false, error: { code: 'grounding-refused' } },
    ];
    for (const body of bodies) {
      const viaPort = await outcomePort(body)(REQUEST);
      const viaCore = classifyPaperSlotWorkerResult(body);
      expect(viaPort.status).toBe(viaCore.status);
      if (viaCore.status !== 'generated') {
        expect((viaPort as { reason: string }).reason).toBe(viaCore.reason);
      }
    }
  });
});

describe('createWorkerPaperItemGenerationPort — the flat path (fillPaperBlueprintSlots)', () => {
  function slot(slotId: string): PaperBlueprintSlot {
    return {
      slotId,
      conceptKey: slotId,
      conceptName: slotId,
      formatClass: 'recall-style',
      intendedDemand: 'recall-a-fact',
      taskId: 'quiz.generate.v1',
      groundingTier: 'T2',
      groundingLabel: 'covered-by-her-material',
      heldSourceKind: 'notes',
      heldSourceId: 's1',
      sourceChunks: ['grounding text'],
      weight: 1,
      emphasised: false,
    };
  }

  function blueprint(slots: readonly PaperBlueprintSlot[]): PaperBlueprint {
    return {
      formatVersion: 'paper-blueprint-v1',
      course: 'COURSEA',
      asOf: '2026-09-29',
      alpha: 0.5,
      formatClass: 'recall-style',
      intendedDemand: 'recall-a-fact',
      steering: {},
      structureSummary: null,
      eligibleCount: slots.length,
      slots,
      emptySlots: [],
      unbuiltDemand: null,
      partial: false,
    };
  }

  it('a real success becomes an item that carries the stamped prompt version, not "unknown"', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => QUIZ_SUCCESS),
    });
    const filled = await fillPaperBlueprintSlots(blueprint([slot('slot-0')]), port);
    expect(filled.items).toHaveLength(1);
    expect(filled.items[0]?.promptVersion).toBe('v3');
    expect(filled.items[0]?.response).toEqual(QUIZ_SUCCESS);
    expect(filled.emptySlots).toHaveLength(0);
  });

  it('a real grounding refusal becomes an empty slot, never an item whose body is the error', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => errorEnvelope('grounding-refused')),
    });
    const filled = await fillPaperBlueprintSlots(blueprint([slot('slot-0')]), port);
    expect(filled.items).toHaveLength(0);
    expect(filled.emptySlots).toHaveLength(1);
    expect(filled.emptySlots[0]).toMatchObject({
      slotId: 'slot-0',
      reasonCode: 'generator-refused',
    });
    expect(filled.emptySlots[0]?.reason).toContain('grounding-refused');
  });

  it('a zero-question success (the service refusal for an empty or stub source) becomes an empty slot', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => successEnvelope({ questions: [] }, 'v3')),
    });
    const filled = await fillPaperBlueprintSlots(blueprint([slot('slot-0')]), port);
    expect(filled.items).toHaveLength(0);
    expect(filled.emptySlots[0]).toMatchObject({ reasonCode: 'generator-refused' });
  });

  it('an outage stops the request with the service reason, storing no item and no empty slot for it', async () => {
    const port = createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => errorEnvelope('upstream-error')),
    });
    const attempt = fillPaperBlueprintSlots(blueprint([slot('slot-0')]), port);
    await expect(attempt).rejects.toBeInstanceOf(PaperItemServiceUnavailableError);
    await expect(attempt).rejects.toMatchObject({ reason: 'upstream-error' });
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

  it('reports generated and refused exactly as the two-outcome result the flat path already consumes', async () => {
    const generated = await createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => QUIZ_SUCCESS),
    })(REQUEST);
    expect(generated).toEqual({
      status: 'generated',
      taskId: 'quiz.generate.v1',
      promptVersion: 'v3',
      response: QUIZ_SUCCESS,
    });
    const refused = await createWorkerPaperItemGenerationPort({
      transport: fakeTransport(() => errorEnvelope('grounding-refused')),
    })(REQUEST);
    expect(refused).toEqual({ status: 'refused', reason: 'grounding-refused' });
  });
});
