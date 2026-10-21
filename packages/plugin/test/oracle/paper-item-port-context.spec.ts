/**
 * The paper port's payload and the paper context (`[D-561]` the earlier part's question, `[D-562]`
 * a group's shared passage; bead `ol-egov.141.89.7.93`, contract field `ol-egov.141.89.7.97`).
 *
 * Scenario: olea-service/features/F4-oracle.md, "a dependent part is requested with the earlier
 * part's question", tagged `@auto:plugin/oracle/paper-item-port-context.spec` (the composition half
 * is `test/paper/journal-composition.spec.ts`).
 *
 * What is pinned here:
 *  - absent, the payload is today's exactly (the same four keys);
 *  - present, `earlierParts` and `sharedPassage` travel as the contract's shapes, untrimmed;
 *  - a field the contract's schema refuses is never sent: the Worker would answer `invalid-request`,
 *    which the port reads as an outage (owed and retried for good), so the port ends the request
 *    `refused` instead, which the journal records as `generator-refused` (Class B, flagged on the
 *    bead). Both ports, the three-outcome one and the flat adapter.
 *
 * Synthetic text only (INV-3).
 */
import {
  AUTHORING_EARLIER_PART_MAX_CHARS,
  AUTHORING_EARLIER_PARTS_LIMIT,
  AUTHORING_SHARED_PASSAGE_MAX_CHARS,
  authoringEarlierPartsField,
  authoringSharedPassageField,
} from 'olea-contracts';
import {
  classifyPaperSlotWorkerResult,
  type PaperItemGenerationRequest,
  type WorkerTaskTransport,
} from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  createWorkerPaperItemGenerationPort,
  createWorkerPaperSlotOutcomePort,
} from '../../src/oracle/paper-item-port.js';
import { errorEnvelope, successEnvelope } from './worker-envelope-fixtures.js';

const BASE: PaperItemGenerationRequest = {
  taskId: 'quiz.generate.v1',
  courseCode: 'COURSEA',
  conceptName: 'Topic A',
  sourceChunks: ['grounding text'],
  purpose: 'readiness',
};

const QUESTION = {
  stem: 'A synthetic question',
  correctAnswer: 'A synthetic answer',
  distractors: ['x', 'y', 'z'],
  feedback: 'f',
};

function recordingTransport(): { transport: WorkerTaskTransport; payloads: unknown[] } {
  const payloads: unknown[] = [];
  return {
    payloads,
    transport: {
      async send(message) {
        payloads.push((message as { payload: unknown }).payload);
        return successEnvelope({ questions: [QUESTION] });
      },
    },
  };
}

async function sentPayload(request: PaperItemGenerationRequest): Promise<unknown> {
  const { transport, payloads } = recordingTransport();
  const outcome = await createWorkerPaperSlotOutcomePort({ transport })(request);
  expect(outcome.status).toBe('generated');
  expect(payloads).toHaveLength(1);
  return payloads[0];
}

describe('the paper port sends the paper context only when the request has it', () => {
  it('a request with neither sends today’s payload exactly: the same four keys', async () => {
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
  });

  it('a dependent part carries its earlier parts, in order, each question with its answer when written', async () => {
    const earlierParts = [
      { question: 'Earlier question one', answer: 'Earlier answer one' },
      { question: 'Earlier question two' },
    ];
    const payload = (await sentPayload({ ...BASE, earlierParts })) as Record<string, unknown>;
    expect(payload.earlierParts).toEqual(earlierParts);
    expect('sharedPassage' in payload).toBe(false);
    expect(authoringEarlierPartsField.safeParse(payload.earlierParts).success).toBe(true);
  });

  it('a part of a group that shares material carries the passage as written, never trimmed', async () => {
    const sharedPassage = {
      form: 'table' as const,
      text: '  | Year | Units |\n| --- | --- |\n| 2020 | 10 |\n\n',
    };
    const payload = (await sentPayload({ ...BASE, sharedPassage })) as Record<string, unknown>;
    expect(payload.sharedPassage).toEqual(sharedPassage);
    expect((payload.sharedPassage as { text: string }).text).toBe(sharedPassage.text);
    expect('earlierParts' in payload).toBe(false);
    expect(authoringSharedPassageField.safeParse(payload.sharedPassage).success).toBe(true);
  });

  it('both travel together, after the fields of today’s payload', async () => {
    const payload = await sentPayload({
      ...BASE,
      intendedDemand: 'recall-a-fact',
      earlierParts: [{ question: 'Earlier question' }],
      sharedPassage: { form: 'scenario', text: 'A synthetic case.' },
    });
    expect(Object.keys(payload as object)).toEqual([
      'courseCode',
      'conceptName',
      'sourceChunks',
      'purpose',
      'intendedDemand',
      'earlierParts',
      'sharedPassage',
    ]);
  });

  it('fields at the contract’s limits are sent', async () => {
    const atLimit = 'q'.repeat(AUTHORING_EARLIER_PART_MAX_CHARS);
    const earlierParts = Array.from({ length: AUTHORING_EARLIER_PARTS_LIMIT }, () => ({
      question: atLimit,
      answer: atLimit,
    }));
    const sharedPassage = {
      form: 'extract' as const,
      text: 'p'.repeat(AUTHORING_SHARED_PASSAGE_MAX_CHARS),
    };
    const payload = (await sentPayload({ ...BASE, earlierParts, sharedPassage })) as Record<
      string,
      unknown
    >;
    expect(payload.earlierParts).toEqual(earlierParts);
    expect(payload.sharedPassage).toEqual(sharedPassage);
  });
});

describe('the paper port never sends what the Worker would refuse', () => {
  it('the Worker’s invalid-request is read as an outage, so a request it always refuses would stay owed for good', () => {
    expect(classifyPaperSlotWorkerResult(errorEnvelope('invalid-request'))).toEqual({
      status: 'unavailable',
      reason: 'invalid-request',
    });
  });

  const over = 'q'.repeat(AUTHORING_EARLIER_PART_MAX_CHARS + 1);
  const invalidEarlierParts: readonly [string, PaperItemGenerationRequest['earlierParts']][] = [
    ['an earlier question over its limit', [{ question: over }]],
    ['an earlier answer over its limit', [{ question: 'q', answer: over }]],
    ['a blank earlier question', [{ question: '   ' }]],
    [
      'more earlier parts than the contract allows',
      Array.from({ length: AUTHORING_EARLIER_PARTS_LIMIT + 1 }, () => ({ question: 'q' })),
    ],
    ['an empty list of earlier parts', []],
  ];
  for (const [name, earlierParts] of invalidEarlierParts) {
    it(`${name}: refused before any call, never unavailable, through both ports`, async () => {
      const outcome = recordingTransport();
      expect(
        await createWorkerPaperSlotOutcomePort({ transport: outcome.transport })({
          ...BASE,
          ...(earlierParts !== undefined ? { earlierParts } : {}),
        }),
      ).toEqual({ status: 'refused', reason: 'earlier-parts-invalid' });
      expect(outcome.payloads).toHaveLength(0);

      const flat = recordingTransport();
      expect(
        await createWorkerPaperItemGenerationPort({ transport: flat.transport })({
          ...BASE,
          ...(earlierParts !== undefined ? { earlierParts } : {}),
        }),
      ).toEqual({ status: 'refused', reason: 'earlier-parts-invalid' });
      expect(flat.payloads).toHaveLength(0);
    });
  }

  const invalidPassages: readonly [string, PaperItemGenerationRequest['sharedPassage']][] = [
    [
      'a passage over its limit',
      { form: 'table', text: 'p'.repeat(AUTHORING_SHARED_PASSAGE_MAX_CHARS + 1) },
    ],
    ['a blank passage', { form: 'extract', text: ' \n ' }],
    [
      'a figure, whose content is not text',
      {
        form: 'figure',
        text: 'a caption',
      } as unknown as PaperItemGenerationRequest['sharedPassage'],
    ],
  ];
  for (const [name, sharedPassage] of invalidPassages) {
    it(`${name}: refused before any call, through both ports`, async () => {
      const outcome = recordingTransport();
      expect(
        await createWorkerPaperSlotOutcomePort({ transport: outcome.transport })({
          ...BASE,
          ...(sharedPassage !== undefined ? { sharedPassage } : {}),
        }),
      ).toEqual({ status: 'refused', reason: 'shared-passage-invalid' });
      expect(outcome.payloads).toHaveLength(0);

      const flat = recordingTransport();
      expect(
        await createWorkerPaperItemGenerationPort({ transport: flat.transport })({
          ...BASE,
          ...(sharedPassage !== undefined ? { sharedPassage } : {}),
        }),
      ).toEqual({ status: 'refused', reason: 'shared-passage-invalid' });
      expect(flat.payloads).toHaveLength(0);
    });
  }
});
