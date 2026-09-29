/**
 * `WorkerDemandClassifyReader` tests (`ol-egov.141.89.7.33`, `[D-431]`).
 *
 * Scenarios: olea-service/features/F4-examiner-scope-client-readers.md. Runs against a fake
 * transport: no `obsidian` import (INV-1) and zero model spend. Every envelope is built by
 * `worker-envelope-fixtures.ts`, which runs it through the vendored contract's own `workerResponse`
 * schema. Fixtures are synthetic (INV-3): coined ids and wording, no vault content.
 */

import type { WorkerTaskRequest } from 'olea-core';
import { PAPER_DEMANDS } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  DEMAND_CLASSIFY_CONTRACT_VERSION,
  DEMAND_CLASSIFY_TASK_ID,
  DemandClassifyReaderError,
  DemandClassifyReaderUnavailableError,
  type DemandClassifyReadRequest,
  readDemandClassifyResponse,
  WorkerDemandClassifyReader,
} from '../../src/ingestion/demand-classify-adapter.js';
import { errorEnvelope, successEnvelope } from '../oracle/worker-envelope-fixtures.js';

class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(private readonly reply: (request: WorkerTaskRequest) => unknown) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    return this.reply(request);
  }
}

/**
 * One part read in its full context. Refs are wire handles; `unitIndex` is the client's ordinal and
 * differs from the digit in the ref, so a mix-up shows.
 */
function request(over: Partial<DemandClassifyReadRequest> = {}): DemandClassifyReadRequest {
  return {
    part: {
      partId: 'p2',
      label: '1(b)',
      instruction: {
        ref: 'u5',
        unitIndex: 15,
        text: 'Using your answer to (a), work out the value.',
      },
      questionForm: 'short answer',
      marks: 3,
    },
    section: {
      heading: { ref: 'u2', unitIndex: 12, text: 'Section A' },
      instruction: { ref: 'u3', unitIndex: 13, text: 'Answer all questions in this section.' },
    },
    group: {
      stem: [{ ref: 'u4', unitIndex: 14, text: 'A tank holds a stated volume.' }],
      stimulus: { status: 'identified', form: 'table', ref: 'u7' },
    },
    dependsOn: [
      {
        partId: 'p1',
        label: '1(a)',
        instruction: { ref: 'u6', unitIndex: 16, text: 'State the formula.' },
      },
    ],
    ...over,
  };
}

const okResponse = (result: unknown, promptVersion = '1.0.0') =>
  successEnvelope(result, promptVersion);

const readWith = async (result: unknown, req = request()) =>
  new WorkerDemandClassifyReader({
    transport: new RecordingTransport(() => okResponse(result)),
  }).read(req);

const refuses = (result: unknown, req = request()) =>
  expect(readWith(result, req)).rejects.toThrow(DemandClassifyReaderError);

describe('WorkerDemandClassifyReader: the request it builds', () => {
  it('sends the part with its section, group stem and stimulus status and dependencies, marks only when stated, and no ordinal', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: { kind: 'demand', demand: 'calculate' }, refs: ['u5'] }),
    );
    await new WorkerDemandClassifyReader({ transport }).read(request());

    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0];
    expect(sent?.taskId).toBe(DEMAND_CLASSIFY_TASK_ID);
    expect(sent?.taskId).toBe('demand.classify.v1');
    expect(sent?.contractVersion).toBe(DEMAND_CLASSIFY_CONTRACT_VERSION);
    expect(sent?.payload).toEqual({
      part: {
        partId: 'p2',
        label: '1(b)',
        instruction: { ref: 'u5', text: 'Using your answer to (a), work out the value.' },
        questionForm: 'short answer',
        marks: 3,
      },
      section: {
        heading: { ref: 'u2', text: 'Section A' },
        instruction: { ref: 'u3', text: 'Answer all questions in this section.' },
      },
      group: {
        stem: [{ ref: 'u4', text: 'A tank holds a stated volume.' }],
        stimulus: { status: 'identified', form: 'table', ref: 'u7' },
      },
      dependsOn: [
        {
          partId: 'p1',
          label: '1(a)',
          instruction: { ref: 'u6', text: 'State the formula.' },
        },
      ],
    });
    expect(JSON.stringify(sent?.payload)).not.toContain('unitIndex');
  });

  it('leaves marks, section and dependencies out when the caller has none: unknown is absent, never zero', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdict: { kind: 'demand', demand: 'recall-a-fact' }, refs: ['u5'] }),
    );
    const bare = request();
    await new WorkerDemandClassifyReader({ transport }).read({
      part: {
        partId: bare.part.partId,
        label: bare.part.label,
        instruction: bare.part.instruction,
        questionForm: bare.part.questionForm,
      },
      group: { stimulus: { status: 'none' } },
    });
    expect(transport.sent[0]?.payload).toEqual({
      part: {
        partId: 'p2',
        label: '1(b)',
        instruction: { ref: 'u5', text: 'Using your answer to (a), work out the value.' },
        questionForm: 'short answer',
      },
      group: { stimulus: { status: 'none' } },
    });
  });

  it('refuses, before any call, a request in which one ref stands for two different units', async () => {
    const transport = new RecordingTransport(() => okResponse({}));
    const base = request();
    await expect(
      new WorkerDemandClassifyReader({ transport }).read(
        request({
          group: { stem: [{ ref: 'u5', unitIndex: 99, text: 'x' }], stimulus: { status: 'none' } },
          part: base.part,
        }),
      ),
    ).rejects.toThrow(DemandClassifyReaderError);
    expect(transport.sent).toHaveLength(0);
  });
});

describe('WorkerDemandClassifyReader: the four verdicts are stored as [D-429] keeps them', () => {
  it('reads a demand as decided, with the unit ordinals its refs name and the command word beside it', async () => {
    const result = await readWith({
      verdict: { kind: 'demand', demand: 'calculate' },
      commandWord: 'work out',
      refs: ['u5', 'u6'],
    });
    expect(result.demand).toStrictEqual({
      status: 'decided',
      demand: 'calculate',
      commandWord: 'work out',
      refs: [15, 16],
    });
  });

  it('reads every one of the five demands, and none else', async () => {
    for (const demand of PAPER_DEMANDS) {
      const result = await readWith({ verdict: { kind: 'demand', demand }, refs: ['u5'] });
      expect(result.demand).toEqual({ status: 'decided', demand, refs: [15] });
    }
  });

  it('reads a compound as two different demands in the order the part asks them', async () => {
    const result = await readWith({
      verdict: { kind: 'compound', demands: ['calculate', 'compare-or-choose'] },
      commandWord: 'work out',
      refs: ['u5'],
    });
    expect(result.demand).toStrictEqual({
      status: 'compound',
      demands: ['calculate', 'compare-or-choose'],
      commandWord: 'work out',
      refs: [15],
    });
  });

  it('keeps an operation outside the five as unsupported with the command word verbatim, and carries no demand', async () => {
    const result = await readWith({
      verdict: { kind: 'unsupported' },
      commandWord: 'Evaluate',
      refs: ['u5'],
    });
    expect(result.demand).toStrictEqual({
      status: 'unsupported',
      commandWord: 'Evaluate',
      refs: [15],
    });
    expect('demand' in result.demand).toBe(false);
  });

  it('an unsupported part with no command word keeps none: the reader never supplies one', async () => {
    const result = await readWith({ verdict: { kind: 'unsupported' }, refs: ['u5'] });
    expect(result.demand).toStrictEqual({ status: 'unsupported', refs: [15] });
  });

  it('reads cannot-tell with its reason, and carries no refs or command word', async () => {
    for (const reason of [
      'stimulus-not-identified',
      'ambiguous',
      'depends-on-figure',
      'no-surviving-ref',
    ]) {
      const result = await readWith({
        verdict: { kind: 'cannot-tell', reason },
        commandWord: 'calculate',
        refs: ['u5'],
      });
      expect(result.demand).toStrictEqual({ status: 'cannot-tell', reason });
    }
  });

  it('cites a section, stem or dependency passage as readily as the part own instruction', async () => {
    const result = await readWith({
      verdict: { kind: 'demand', demand: 'interpret-printed-result' },
      refs: ['u4', 'u3', 'u2', 'u6', 'u4'],
    });
    expect(result.demand).toMatchObject({ refs: [14, 13, 12, 16] });
  });

  it('carries the D7.3 stamp beside the verdict', async () => {
    const result = await readWith({
      verdict: { kind: 'demand', demand: 'calculate' },
      refs: ['u5'],
    });
    expect(result.stamp).toEqual({ promptVersion: '1.0.0', modelId: 'test-model' });
  });
});

describe('WorkerDemandClassifyReader: an answer it cannot trust is a failure, never coerced into a verdict', () => {
  it('refuses a sixth demand, and a demand written as prose', async () => {
    await refuses({ verdict: { kind: 'demand', demand: 'evaluate' }, refs: ['u5'] });
    await refuses({ verdict: { kind: 'demand', demand: 'Calculate' }, refs: ['u5'] });
    await refuses({ verdict: { kind: 'demand' }, refs: ['u5'] });
  });

  it('refuses a compound that is not exactly two different, known demands', async () => {
    const compound = (demands: unknown) =>
      refuses({ verdict: { kind: 'compound', demands }, refs: ['u5'] });
    await compound(['calculate', 'calculate']);
    await compound(['calculate']);
    await compound(['calculate', 'compare-or-choose', 'recall-a-fact']);
    await compound(['calculate', 'evaluate']);
    await compound(undefined);
  });

  it('refuses a decided, compound or unsupported verdict that cites nothing', async () => {
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' }, refs: [] });
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' } });
    await refuses({ verdict: { kind: 'unsupported' }, refs: [] });
    await refuses({ verdict: { kind: 'compound', demands: ['calculate', 'compare-or-choose'] } });
  });

  it('refuses a ref that was not sent, and a stimulus pointer or figure description that cannot be cited', async () => {
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' }, refs: ['u9'] });
    // u7 is only the stimulus's pointer: its text was not in the request.
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' }, refs: ['u7'] });
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' }, refs: ['u5', 'u7'] });
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' }, refs: [5] });
  });

  it('refuses an unknown verdict kind, an unknown cannot-tell reason, an unavailable verdict and a malformed body', async () => {
    await refuses({ verdict: { kind: 'unavailable' }, refs: [] });
    await refuses({ verdict: { kind: 'cannot-tell', reason: 'because' } });
    await refuses({ verdict: { kind: 'cannot-tell' } });
    await refuses({ verdict: 'calculate', refs: ['u5'] });
    await refuses({ refs: ['u5'] });
    await refuses({ verdict: { kind: 'demand', demand: 'calculate' }, refs: 'u5' });
    await refuses({
      verdict: { kind: 'demand', demand: 'calculate' },
      commandWord: 7,
      refs: ['u5'],
    });
    await refuses('not an object');
  });
});

describe('WorkerDemandClassifyReader: unavailable is operational and never a verdict', () => {
  it('maps a transport failure onto the unavailable error (offline)', async () => {
    const transport = { send: async () => Promise.reject(new Error('network down')) };
    await expect(
      new WorkerDemandClassifyReader({ transport }).read(request()),
    ).rejects.toMatchObject({ name: 'DemandClassifyReaderUnavailableError', reason: 'offline' });
  });

  it('maps quota-exceeded onto the unavailable error (budget-exhausted)', async () => {
    const transport = new RecordingTransport(() => errorEnvelope('quota-exceeded', 'budget spent'));
    const outcome = new WorkerDemandClassifyReader({ transport }).read(request());
    await expect(outcome).rejects.toBeInstanceOf(DemandClassifyReaderUnavailableError);
    await expect(outcome).rejects.toMatchObject({ reason: 'budget-exhausted' });
  });

  it("any other refusal is the reader error, with the Worker's code, never softened into unavailable", async () => {
    for (const code of ['invalid-request', 'upstream-error', 'internal-error'] as const) {
      const transport = new RecordingTransport(() => errorEnvelope(code));
      const outcome = new WorkerDemandClassifyReader({ transport }).read(request());
      await expect(outcome).rejects.toBeInstanceOf(DemandClassifyReaderError);
      await expect(outcome).rejects.toMatchObject({ code });
    }
  });

  it('a success envelope with no usable stamp is refused, not stamped with a guess (D7.3)', async () => {
    const result = { verdict: { kind: 'demand', demand: 'calculate' }, refs: ['u5'] };
    await expect(
      new WorkerDemandClassifyReader({
        transport: { send: async () => ({ ok: true, result }) },
      }).read(request()),
    ).rejects.toThrow(DemandClassifyReaderError);
  });

  it('has no value that says not yet read: absence in the store is that, and a read never returns it', async () => {
    const result = await readWith({
      verdict: { kind: 'demand', demand: 'calculate' },
      refs: ['u5'],
    });
    expect(['decided', 'compound', 'unsupported', 'cannot-tell']).toContain(result.demand.status);
  });
});

describe('readDemandClassifyResponse: the same reading, for a caller that already holds the body', () => {
  it('reads a captured envelope against the request that produced it, with no transport', () => {
    const result = readDemandClassifyResponse(
      okResponse({ verdict: { kind: 'unsupported' }, commandWord: 'derive', refs: ['u5'] }),
      request(),
    );
    expect(result.demand).toEqual({ status: 'unsupported', commandWord: 'derive', refs: [15] });
  });
});
