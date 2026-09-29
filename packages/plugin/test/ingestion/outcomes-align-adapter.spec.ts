/**
 * `WorkerOutcomesAlignReader` tests (`ol-egov.141.89.7.33`, `[D-431]`).
 *
 * Scenarios: olea-service/features/F4-examiner-scope-client-readers.md. Runs against a fake
 * transport: no `obsidian` import (INV-1) and zero model spend. Every envelope is built by
 * `worker-envelope-fixtures.ts`, which runs it through the vendored contract's own `workerResponse`
 * schema, so a fixture that is not the Worker's real envelope fails where it is built. Fixtures are
 * synthetic (INV-3): coined ids, no vault content.
 */

import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  OUTCOMES_ALIGN_CONTRACT_VERSION,
  OUTCOMES_ALIGN_TASK_ID,
  OutcomesAlignReaderError,
  OutcomesAlignReaderUnavailableError,
  type OutcomesAlignReadRequest,
  readOutcomesAlignResponse,
  WorkerOutcomesAlignReader,
} from '../../src/ingestion/outcomes-align-adapter.js';
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
 * Three records, three concepts, five units. Refs (`u1`..) are the wire handles; `unitIndex` is the
 * client's own ordinal and deliberately differs from the digit in the ref, so a mix-up shows.
 */
function request(over: Partial<OutcomesAlignReadRequest> = {}): OutcomesAlignReadRequest {
  return {
    documentKind: 'past-paper',
    batchId: 'b1',
    courseContext: { courseId: 'course-a', courseName: 'Course A' },
    coverage: {
      digest: 'digest-1',
      units: [
        { ref: 'u1', unitIndex: 11, state: 'sent' },
        { ref: 'u2', unitIndex: 12, state: 'sent' },
        { ref: 'u3', unitIndex: 13, state: 'sent' },
        { ref: 'u4', unitIndex: 14, state: 'not-read', reason: 'scan-unreadable' },
        { ref: 'u5', unitIndex: 15, state: 'read-not-sent', reason: 'no-scope-content' },
      ],
    },
    records: [
      {
        recordId: 'r1',
        kind: 'question-part',
        anchorRef: 'u1',
        headingPath: ['Section A'],
        passages: [
          {
            ref: 'u1',
            unitIndex: 11,
            text: 'Question 1(a): state the definition.',
            role: 'record',
          },
          { ref: 'u2', unitIndex: 12, text: 'Question 1 concerns a tank.', role: 'group-stem' },
          {
            ref: 'u3',
            unitIndex: 13,
            text: 'Description of the tank diagram.',
            role: 'figure-description',
          },
        ],
        group: {
          groupId: 'g1',
          kind: 'parent-question',
          stimulus: { status: 'described-figure', form: 'figure', ref: 'u3' },
        },
      },
      {
        recordId: 'r2',
        kind: 'question-part',
        anchorRef: 'u2',
        passages: [
          { ref: 'u2', unitIndex: 12, text: 'Question 2: explain the process.', role: 'record' },
        ],
      },
      {
        recordId: 'r3',
        kind: 'question-part',
        anchorRef: 'u3',
        passages: [
          { ref: 'u3', unitIndex: 13, text: 'Question 3: compare the two.', role: 'record' },
        ],
      },
    ],
    concepts: [
      {
        handle: 'c001',
        name: 'Concept One',
        description: {
          text: 'A verbatim span.',
          source: 'her-definition',
          truncated: { fullLength: 400 },
        },
        attribution: { courseId: 'course-a', courseName: 'Course A' },
      },
      {
        handle: 'c002',
        name: 'Concept Two',
        descriptionNone: 'no bound note',
        attribution: { courseId: 'course-a' },
      },
      {
        handle: 'c003',
        name: 'Concept Three',
        descriptionNone: 'no bound note',
        attribution: { courseId: 'course-b', courseName: 'Course B' },
      },
    ],
    ...over,
  };
}

/** What the Worker sends back for `request()`, after its own checks, with one edit applied. */
function answer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    batchId: 'b1',
    coverageDigest: 'digest-1',
    decisions: [
      { recordId: 'r1', attests: [] },
      { recordId: 'r2', attests: [] },
      { recordId: 'r3', attests: [] },
    ],
    ...over,
  };
}

const okResponse = (result: unknown, promptVersion = '1.0.0') =>
  successEnvelope(result, promptVersion);

const readWith = async (result: unknown, req = request()) =>
  new WorkerOutcomesAlignReader({
    transport: new RecordingTransport(() => okResponse(result)),
  }).read(req);

const refuses = (result: unknown, req = request()) =>
  expect(readWith(result, req)).rejects.toThrow(OutcomesAlignReaderError);

describe('WorkerOutcomesAlignReader: the request it builds', () => {
  it('sends the batch, coverage, records, passages with roles and concepts by handle, and no ordinal', async () => {
    const transport = new RecordingTransport(() => okResponse(answer()));
    await new WorkerOutcomesAlignReader({ transport }).read(request());

    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0];
    expect(sent?.taskId).toBe(OUTCOMES_ALIGN_TASK_ID);
    expect(sent?.taskId).toBe('outcomes.align.v1');
    expect(sent?.contractVersion).toBe(OUTCOMES_ALIGN_CONTRACT_VERSION);
    expect(sent?.payload).toEqual({
      documentKind: 'past-paper',
      batchId: 'b1',
      courseContext: { courseId: 'course-a', courseName: 'Course A' },
      coverage: {
        digest: 'digest-1',
        units: [
          { ref: 'u1', state: 'sent' },
          { ref: 'u2', state: 'sent' },
          { ref: 'u3', state: 'sent' },
          { ref: 'u4', state: 'not-read', reason: 'scan-unreadable' },
          { ref: 'u5', state: 'read-not-sent', reason: 'no-scope-content' },
        ],
      },
      records: [
        {
          recordId: 'r1',
          kind: 'question-part',
          anchorRef: 'u1',
          headingPath: ['Section A'],
          passages: [
            { ref: 'u1', text: 'Question 1(a): state the definition.', role: 'record' },
            { ref: 'u2', text: 'Question 1 concerns a tank.', role: 'group-stem' },
            { ref: 'u3', text: 'Description of the tank diagram.', role: 'figure-description' },
          ],
          group: {
            groupId: 'g1',
            kind: 'parent-question',
            stimulus: { status: 'described-figure', form: 'figure', ref: 'u3' },
          },
        },
        {
          recordId: 'r2',
          kind: 'question-part',
          anchorRef: 'u2',
          passages: [{ ref: 'u2', text: 'Question 2: explain the process.', role: 'record' }],
        },
        {
          recordId: 'r3',
          kind: 'question-part',
          anchorRef: 'u3',
          passages: [{ ref: 'u3', text: 'Question 3: compare the two.', role: 'record' }],
        },
      ],
      concepts: [
        {
          handle: 'c001',
          name: 'Concept One',
          description: {
            text: 'A verbatim span.',
            source: 'her-definition',
            truncated: { fullLength: 400 },
          },
          attribution: { courseId: 'course-a', courseName: 'Course A' },
        },
        {
          handle: 'c002',
          name: 'Concept Two',
          descriptionNone: 'no bound note',
          attribution: { courseId: 'course-a' },
        },
        {
          handle: 'c003',
          name: 'Concept Three',
          descriptionNone: 'no bound note',
          attribution: { courseId: 'course-b', courseName: 'Course B' },
        },
      ],
    });
    expect(JSON.stringify(sent?.payload)).not.toContain('unitIndex');
  });

  it('makes no call when there is nothing to decide: no records, or no concepts', async () => {
    const transport = new RecordingTransport(() => okResponse(answer()));
    const reader = new WorkerOutcomesAlignReader({ transport });

    const noRecords = await reader.read(request({ records: [] }));
    expect(noRecords.records).toEqual([]);
    const noConcepts = await reader.read(request({ concepts: [] }));
    expect(noConcepts.records.every((record) => record.pairs.length === 0)).toBe(true);

    expect(transport.sent).toHaveLength(0);
    expect(noRecords.stamp).toBeUndefined();
  });

  it('refuses, before any call, a request no answer could be read against', async () => {
    const transport = new RecordingTransport(() => okResponse(answer()));
    const reader = new WorkerOutcomesAlignReader({ transport });
    const base = request();
    const [first, second, third] = base.records;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('setup');

    await expect(
      reader.read(request({ records: [first, { ...second, recordId: 'r1' }, third] })),
    ).rejects.toThrow(OutcomesAlignReaderError);
    const [c1, c2, c3] = base.concepts;
    if (c1 === undefined || c2 === undefined || c3 === undefined) throw new Error('setup');
    await expect(
      reader.read(request({ concepts: [c1, { ...c2, handle: 'c001' }, c3] })),
    ).rejects.toThrow(OutcomesAlignReaderError);
    // One ref standing for two different units cannot be mapped back.
    await expect(
      reader.read(
        request({
          records: [
            first,
            { ...second, passages: [{ ref: 'u1', unitIndex: 99, text: 'x', role: 'record' }] },
            third,
          ],
        }),
      ),
    ).rejects.toThrow(OutcomesAlignReaderError);
    expect(transport.sent).toHaveLength(0);
  });
});

describe('WorkerOutcomesAlignReader: the four outcomes stay apart', () => {
  it('reads within-scope with its unit ordinals, cannot-tell with its reason, not-within-scope for what a decided record left out, and voided-by-check for a record the answer omitted', async () => {
    const result = await readWith({
      batchId: 'b1',
      coverageDigest: 'digest-1',
      decisions: [
        {
          recordId: 'r1',
          attests: [
            { handle: 'c001', verdict: 'within-scope', refs: ['u1', 'u2'] },
            { handle: 'c002', verdict: 'cannot-tell', reason: 'depends-on-figure' },
          ],
        },
        { recordId: 'r2', attests: [] },
        // r3 is not in the answer at all.
      ],
    });

    expect(result.batchId).toBe('b1');
    expect(result.coverageDigest).toBe('digest-1');
    expect(result.records).toStrictEqual([
      {
        recordId: 'r1',
        decided: true,
        pairs: [
          { handle: 'c001', verdict: { kind: 'within-scope', refs: [11, 12] } },
          { handle: 'c002', verdict: { kind: 'cannot-tell', reason: 'depends-on-figure' } },
          { handle: 'c003', verdict: { kind: 'not-within-scope' } },
        ],
      },
      {
        recordId: 'r2',
        decided: true,
        pairs: [
          { handle: 'c001', verdict: { kind: 'not-within-scope' } },
          { handle: 'c002', verdict: { kind: 'not-within-scope' } },
          { handle: 'c003', verdict: { kind: 'not-within-scope' } },
        ],
      },
      {
        recordId: 'r3',
        decided: false,
        pairs: [
          { handle: 'c001', verdict: { kind: 'cannot-tell', reason: 'voided-by-check' } },
          { handle: 'c002', verdict: { kind: 'cannot-tell', reason: 'voided-by-check' } },
          { handle: 'c003', verdict: { kind: 'cannot-tell', reason: 'voided-by-check' } },
        ],
      },
    ]);
  });

  it('an answer that decides nothing voids every pair; it never reads them as not within scope', async () => {
    const result = await readWith(answer({ decisions: [] }));
    for (const record of result.records) {
      expect(record.decided).toBe(false);
      expect(record.pairs.map((pair) => pair.verdict)).toEqual([
        { kind: 'cannot-tell', reason: 'voided-by-check' },
        { kind: 'cannot-tell', reason: 'voided-by-check' },
        { kind: 'cannot-tell', reason: 'voided-by-check' },
      ]);
    }
    // An answer with no decisions field at all is the same answer.
    const absent = await readWith({ batchId: 'b1', coverageDigest: 'digest-1' });
    expect(absent.records.every((record) => !record.decided)).toBe(true);
  });

  it("the Worker's own voided-by-check stays cannot-tell voided-by-check, apart from an ambiguous", async () => {
    const result = await readWith(
      answer({
        decisions: [
          {
            recordId: 'r1',
            attests: [
              { handle: 'c001', verdict: 'cannot-tell', reason: 'voided-by-check' },
              { handle: 'c002', verdict: 'cannot-tell', reason: 'ambiguous' },
            ],
          },
          { recordId: 'r2', attests: [] },
          { recordId: 'r3', attests: [] },
        ],
      }),
    );
    expect(result.records[0]?.pairs.slice(0, 2).map((pair) => pair.verdict)).toEqual([
      { kind: 'cannot-tell', reason: 'voided-by-check' },
      { kind: 'cannot-tell', reason: 'ambiguous' },
    ]);
  });

  it('a depends-on-unread-unit reason carries the unit ordinal of the unit the coverage lists as not read', async () => {
    const result = await readWith(
      answer({
        decisions: [
          {
            recordId: 'r1',
            attests: [
              {
                handle: 'c001',
                verdict: 'cannot-tell',
                reason: 'depends-on-unread-unit',
                unitRef: 'u4',
              },
            ],
          },
          { recordId: 'r2', attests: [] },
          { recordId: 'r3', attests: [] },
        ],
      }),
    );
    expect(result.records[0]?.pairs[0]?.verdict).toEqual({
      kind: 'cannot-tell',
      reason: 'depends-on-unread-unit',
      unitIndex: 14,
    });
  });

  it('carries the D7.3 stamp beside the pairs', async () => {
    const result = await readWith(answer());
    expect(result.stamp).toEqual({ promptVersion: '1.0.0', modelId: 'test-model' });
  });

  it('records self-rated confidence beside a record and never branches on it', async () => {
    const attests = [{ handle: 'c001', verdict: 'within-scope', refs: ['u1'] }];
    const withConfidence = (confidence: number | undefined) =>
      readWith(
        answer({
          decisions: [
            { recordId: 'r1', attests, ...(confidence === undefined ? {} : { confidence }) },
            { recordId: 'r2', attests: [] },
            { recordId: 'r3', attests: [] },
          ],
        }),
      );
    const high = await withConfidence(0.99);
    const low = await withConfidence(0.01);
    const none = await withConfidence(undefined);

    expect(high.records[0]?.confidence).toBe(0.99);
    expect(low.records[0]?.confidence).toBe(0.01);
    expect('confidence' in (none.records[0] ?? {})).toBe(false);
    expect(high.records[0]?.pairs).toEqual(low.records[0]?.pairs);
    expect(high.records[0]?.pairs).toEqual(none.records[0]?.pairs);
  });
});

describe('WorkerOutcomesAlignReader: an answer it cannot trust is a failure, never a verdict', () => {
  it('an echoed batch id or coverage digest that differs is refused', async () => {
    await refuses(answer({ batchId: 'b2' }));
    await refuses(answer({ coverageDigest: 'digest-2' }));
    await refuses({ decisions: [] });
  });

  it('refuses a decision for a record that was never sent, a duplicate decision and a handle outside the batch', async () => {
    await refuses(answer({ decisions: [{ recordId: 'r9', attests: [] }] }));
    await refuses(
      answer({
        decisions: [
          { recordId: 'r1', attests: [] },
          { recordId: 'r1', attests: [] },
        ],
      }),
    );
    await refuses(
      answer({
        decisions: [
          {
            recordId: 'r1',
            attests: [{ handle: 'c009', verdict: 'cannot-tell', reason: 'ambiguous' }],
          },
        ],
      }),
    );
    await refuses(
      answer({
        decisions: [
          {
            recordId: 'r1',
            attests: [
              { handle: 'c001', verdict: 'cannot-tell', reason: 'ambiguous' },
              { handle: 'c001', verdict: 'within-scope', refs: ['u1'] },
            ],
          },
        ],
      }),
    );
  });

  it('refuses a within-scope ref that was not sent for that record, or that was only a figure description', async () => {
    const within = (refs: unknown) =>
      answer({
        decisions: [
          { recordId: 'r1', attests: [{ handle: 'c001', verdict: 'within-scope', refs }] },
        ],
      });
    await refuses(within(['u9'])); // never sent at all
    await refuses(within(['u3'])); // sent for r1, but as a figure description
    await refuses(within(['u1', 'u3'])); // one bad ref spoils the pair
    await refuses(within([])); // a within-scope verdict cites something
    await refuses(within(undefined));
    // u2 was sent, but not for r2.
    await refuses(
      answer({
        decisions: [
          { recordId: 'r2', attests: [{ handle: 'c001', verdict: 'within-scope', refs: ['u1'] }] },
        ],
      }),
    );
  });

  it('refuses a depends-on-unread-unit reason that names no unit, or a unit the coverage lists as read', async () => {
    const unread = (extra: Record<string, unknown>) =>
      answer({
        decisions: [
          {
            recordId: 'r1',
            attests: [
              {
                handle: 'c001',
                verdict: 'cannot-tell',
                reason: 'depends-on-unread-unit',
                ...extra,
              },
            ],
          },
        ],
      });
    await refuses(unread({}));
    await refuses(unread({ unitRef: 'u1' })); // a unit that was sent
    await refuses(unread({ unitRef: 'u5' })); // read, not sent: not unread
    await refuses(unread({ unitRef: 'u9' }));
  });

  it('refuses an unknown verdict or reason, a malformed decision list and a bad confidence', async () => {
    const attest = (attestation: unknown) =>
      answer({ decisions: [{ recordId: 'r1', attests: [attestation] }] });
    await refuses(attest({ handle: 'c001', verdict: 'not-within-scope' })); // a verdict only the client derives
    await refuses(attest({ handle: 'c001', verdict: 'cannot-tell', reason: 'because' }));
    await refuses(attest('c001'));
    await refuses(answer({ decisions: {} }));
    await refuses(answer({ decisions: [{ recordId: 'r1', attests: {} }] }));
    await refuses(answer({ decisions: [{ recordId: 'r1', attests: [], confidence: 'high' }] }));
    await refuses('not an object');
  });
});

describe('WorkerOutcomesAlignReader: an outage is not a failed answer, and neither is a verdict', () => {
  it('maps a transport failure onto the unavailable error (offline)', async () => {
    const transport = { send: async () => Promise.reject(new Error('network down')) };
    await expect(
      new WorkerOutcomesAlignReader({ transport }).read(request()),
    ).rejects.toMatchObject({ name: 'OutcomesAlignReaderUnavailableError', reason: 'offline' });
  });

  it('maps quota-exceeded onto the unavailable error (budget-exhausted)', async () => {
    const transport = new RecordingTransport(() => errorEnvelope('quota-exceeded', 'budget spent'));
    const outcome = new WorkerOutcomesAlignReader({ transport }).read(request());
    await expect(outcome).rejects.toBeInstanceOf(OutcomesAlignReaderUnavailableError);
    await expect(outcome).rejects.toMatchObject({ reason: 'budget-exhausted' });
  });

  it("any other refusal is the reader error, with the Worker's code, never softened into unavailable", async () => {
    for (const code of ['invalid-request', 'upstream-error', 'internal-error'] as const) {
      const transport = new RecordingTransport(() => errorEnvelope(code));
      const outcome = new WorkerOutcomesAlignReader({ transport }).read(request());
      await expect(outcome).rejects.toBeInstanceOf(OutcomesAlignReaderError);
      await expect(outcome).rejects.toMatchObject({ code });
    }
  });

  it('a success envelope with no usable stamp is refused, not stamped with a guess (D7.3)', async () => {
    const bare = { ok: true, result: answer() };
    await expect(
      new WorkerOutcomesAlignReader({ transport: { send: async () => bare } }).read(request()),
    ).rejects.toThrow(OutcomesAlignReaderError);
    await expect(
      new WorkerOutcomesAlignReader({
        transport: {
          send: async () => ({ ok: true, stamp: { promptVersion: '' }, result: answer() }),
        },
      }).read(request()),
    ).rejects.toThrow(OutcomesAlignReaderError);
  });
});

describe('readOutcomesAlignResponse: the same reading, for a caller that already holds the body', () => {
  it('reads a captured envelope against the request that produced it, with no transport', () => {
    const result = readOutcomesAlignResponse(okResponse(answer()), request());
    expect(result.records.map((record) => record.recordId)).toEqual(['r1', 'r2', 'r3']);
  });
});
