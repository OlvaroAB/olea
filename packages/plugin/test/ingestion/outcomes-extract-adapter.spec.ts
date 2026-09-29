/**
 * `WorkerOutcomesExtractReader` tests (`ol-4s30` [EXT-13]).
 *
 * Runs entirely against a fake transport — no `obsidian` import anywhere in
 * this file (INV-1), and none needed: `outcomes-extract-adapter.ts` imports
 * nothing Obsidian-specific. Zero model spend: every response below is a
 * plain scripted object, never a real Worker call.
 */

import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  OUTCOMES_EXTRACT_CONTRACT_VERSION,
  OUTCOMES_EXTRACT_TASK_ID,
  OutcomesExtractReaderError,
  OutcomesExtractReaderUnavailableError,
  WorkerOutcomesExtractReader,
} from '../../src/ingestion/outcomes-extract-adapter.js';
import { scopePaperStructureFrom } from '../../src/scope-reading/persistence.js';
import { errorEnvelope, successEnvelope } from '../oracle/worker-envelope-fixtures.js';

/**
 * The numbering the Worker returns when nothing it was sent was furniture-only: shown number k is
 * the chunk sent at position k, with that chunk's length (`ol-egov.141.89.7.38`).
 */
function identityNumbering(request: WorkerTaskRequest) {
  const chunks = (request.payload as { sourceChunks: string[] }).sourceChunks;
  return { chunks: chunks.map((chunk, i) => ({ sentIndex: i + 1, length: chunk.length })) };
}

/**
 * Records what was sent and answers with whatever the test scripted. A success envelope whose
 * result carries no `numbering` key gets the identity numbering, because the Worker always returns
 * one (`groundOutcomes`); a test that wants something else scripts `numbering` itself, or passes
 * `{ numbering: 'omit' }` to model a Worker from before the field existed.
 */
class RecordingTransport {
  readonly sent: WorkerTaskRequest[] = [];
  constructor(
    private readonly reply: (request: WorkerTaskRequest) => unknown,
    private readonly options: { readonly numbering?: 'identity' | 'omit' } = {},
  ) {}
  async send(request: WorkerTaskRequest): Promise<unknown> {
    this.sent.push(request);
    const envelope = this.reply(request);
    if (this.options.numbering === 'omit') return envelope;
    if (typeof envelope !== 'object' || envelope === null) return envelope;
    const body = envelope as { ok?: unknown; result?: unknown };
    if (body.ok !== true || typeof body.result !== 'object' || body.result === null)
      return envelope;
    if ('numbering' in body.result) return envelope;
    return { ...body, result: { ...body.result, numbering: identityNumbering(request) } };
  }
}

/**
 * A stamped success envelope, run through the vendored contract's own `workerResponse` schema
 * before it is returned (`worker-envelope-fixtures.ts`, `ol-egov.141.89.7.29`): a fixture that is
 * not the Worker's real envelope throws in the test that built it. The prompt version defaults to
 * the one this reader's newest shape comes from.
 */
function okResponse(result: unknown, promptVersion = '1.2.0') {
  return successEnvelope(result, promptVersion);
}

/** A coined, opaque anchor value — this adapter never inspects it, only passes it through. */
function fixtureAnchor(id: string) {
  return { fixtureAnchorId: id };
}

const OBJECTIVES_PASSAGES = [
  { text: 'Students will be able to explain long-term potentiation.', anchor: fixtureAnchor('p1') },
  { text: 'Students will be able to describe synaptic plasticity.', anchor: fixtureAnchor('p2') },
];

const PAST_PAPER_PASSAGES = [
  {
    text: 'Section A — Multiple Choice (20 marks): answer all 20 questions.',
    anchor: fixtureAnchor('s1'),
  },
];

describe('WorkerOutcomesExtractReader — the request it builds', () => {
  it('sends passage text and documentKind only — never a vault path or a course code (D-005)', async () => {
    const transport = new RecordingTransport(() => okResponse({ outcomes: [] }));
    const reader = new WorkerOutcomesExtractReader({ transport });

    await reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe(OUTCOMES_EXTRACT_TASK_ID);
    expect(request?.taskId).toBe('outcomes.extract.v1');
    expect(request?.contractVersion).toBe(OUTCOMES_EXTRACT_CONTRACT_VERSION);
    expect(request?.payload).toEqual({
      sourceChunks: [
        'Students will be able to explain long-term potentiation.',
        'Students will be able to describe synaptic plasticity.',
      ],
      documentKind: 'objectives',
    });
  });

  it('never calls the transport for an empty passage list', async () => {
    const transport = new RecordingTransport(() => okResponse({ outcomes: [] }));
    const reader = new WorkerOutcomesExtractReader({ transport });

    const result = await reader.read({ documentKind: 'objectives', passages: [] });

    expect(transport.sent).toHaveLength(0);
    expect(result).toEqual({ outcomes: [], paperStructure: { sections: [] } });
  });

  it('carries the documentKind through unchanged for a past-paper request', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ paperStructure: { sections: [] } }),
    );
    const reader = new WorkerOutcomesExtractReader({ transport });

    await reader.read({ documentKind: 'past-paper', passages: PAST_PAPER_PASSAGES });

    expect(transport.sent[0]?.payload).toMatchObject({ documentKind: 'past-paper' });
  });
});

describe('WorkerOutcomesExtractReader — resolving outcomes back onto the real anchor', () => {
  it('resolves anchorIndex back onto the caller-supplied anchor, never invents one', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ outcomes: [{ label: 'Explain LTP.', confidence: 0.9, anchorIndex: 2 }] }),
    );
    const reader = new WorkerOutcomesExtractReader({ transport });

    const result = await reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES });

    expect(result.outcomes).toEqual([
      { label: 'Explain LTP.', confidence: 0.9, anchor: fixtureAnchor('p2') },
    ]);
  });

  it('throws rather than silently mis-anchoring on an index the Worker never sent a passage for', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ outcomes: [{ label: 'Invented.', confidence: 0.9, anchorIndex: 99 }] }),
    );
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toThrow(OutcomesExtractReaderError);
  });

  it('an absent outcomes field reads as an empty list, not a failure', async () => {
    const transport = new RecordingTransport(() => okResponse({}));
    const reader = new WorkerOutcomesExtractReader({ transport });

    const result = await reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES });

    expect(result.outcomes).toEqual([]);
  });
});

describe('WorkerOutcomesExtractReader — resolving paper sections back onto the real anchor', () => {
  it('resolves a section, verbatim questionForm included, back onto the caller-supplied anchor', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        paperStructure: {
          sections: [
            {
              label: 'Section A',
              questionForm: 'multiple choice',
              itemCount: 20,
              marks: 20,
              anchorIndex: 1,
            },
          ],
        },
      }),
    );
    const reader = new WorkerOutcomesExtractReader({ transport });

    const result = await reader.read({ documentKind: 'past-paper', passages: PAST_PAPER_PASSAGES });

    expect(result.paperStructure.sections).toEqual([
      {
        label: 'Section A',
        questionForm: 'multiple choice',
        itemCount: 20,
        marks: 20,
        anchor: fixtureAnchor('s1'),
      },
    ]);
  });

  it('rejects a section with a negative itemCount rather than passing it through', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        paperStructure: {
          sections: [
            { label: 'Section A', questionForm: 'essay', itemCount: -1, marks: 10, anchorIndex: 1 },
          ],
        },
      }),
    );
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'past-paper', passages: PAST_PAPER_PASSAGES }),
    ).rejects.toThrow(OutcomesExtractReaderError);
  });

  it('an absent paperStructure field reads as an empty sections list, not a failure', async () => {
    const transport = new RecordingTransport(() => okResponse({}));
    const reader = new WorkerOutcomesExtractReader({ transport });

    const result = await reader.read({ documentKind: 'past-paper', passages: PAST_PAPER_PASSAGES });

    expect(result.paperStructure.sections).toEqual([]);
  });
});

describe('WorkerOutcomesExtractReader — question groups (ol-egov.141.89.7.21)', () => {
  const TWO_PASSAGES = [
    { text: 'Section B: answer ONE question.', anchor: fixtureAnchor('g1') },
    { text: 'Table 1 shows the data.', anchor: fixtureAnchor('g2') },
  ];
  const read = async (result: unknown, passages = TWO_PASSAGES) =>
    new WorkerOutcomesExtractReader({
      transport: new RecordingTransport(() => okResponse(result)),
    }).read({ documentKind: 'past-paper', passages });

  it('carries groups through, resolving group and stimulus anchors onto the caller anchors', async () => {
    const result = await read({
      paperStructure: {
        sections: [],
        questionGroups: [
          {
            id: 'g1',
            kind: 'choice',
            label: 'Answer ONE',
            memberLabels: ['4', '5'],
            choose: 1,
            anchorIndex: 1,
            stimulus: { status: 'identified', form: 'table', anchorIndex: 2 },
          },
          {
            id: 'g2',
            kind: 'parent-question',
            label: 'Question 4',
            parentGroupId: 'g1',
            memberLabels: ['4(a)'],
            anchorIndex: 2,
            stimulus: { status: 'not-identified', form: 'figure', reason: 'figure-not-in-text' },
          },
        ],
      },
    });
    expect(result.paperStructure.questionGroups).toEqual([
      {
        id: 'g1',
        kind: 'choice',
        label: 'Answer ONE',
        memberLabels: ['4', '5'],
        choose: 1,
        anchor: fixtureAnchor('g1'),
        stimulus: { status: 'identified', form: 'table', anchor: fixtureAnchor('g2') },
      },
      {
        id: 'g2',
        kind: 'parent-question',
        label: 'Question 4',
        parentGroupId: 'g1',
        memberLabels: ['4(a)'],
        anchor: fixtureAnchor('g2'),
        stimulus: { status: 'not-identified', form: 'figure', reason: 'figure-not-in-text' },
      },
    ]);
  });

  it('absent questionGroups stays absent (not an empty list); an empty list stays empty', async () => {
    const absent = await read({ paperStructure: { sections: [] } });
    expect('questionGroups' in absent.paperStructure).toBe(false);
    const empty = await read({ paperStructure: { sections: [], questionGroups: [] } });
    expect(empty.paperStructure.questionGroups).toEqual([]);
  });

  it('a group with no stimulus reads as not-identified, never none', async () => {
    const result = await read({
      paperStructure: {
        questionGroups: [
          { id: 'a', kind: 'section', label: 'Section A', memberLabels: ['1'], anchorIndex: 1 },
        ],
      },
    });
    expect(result.paperStructure.questionGroups?.[0]?.stimulus).toEqual({
      status: 'not-identified',
    });
  });

  it('rejects an unresolvable anchor, an unknown kind, and non-array groups', async () => {
    const group = { id: 'a', kind: 'section', label: 'S', memberLabels: ['1'], anchorIndex: 1 };
    await expect(
      read({ paperStructure: { questionGroups: [{ ...group, anchorIndex: 9 }] } }),
    ).rejects.toThrow(OutcomesExtractReaderError);
    await expect(
      read({ paperStructure: { questionGroups: [{ ...group, kind: 'bogus' }] } }),
    ).rejects.toThrow(OutcomesExtractReaderError);
    await expect(read({ paperStructure: { questionGroups: {} } })).rejects.toThrow(
      OutcomesExtractReaderError,
    );
  });
});

describe('WorkerOutcomesExtractReader — unknown marks, parts, total and time ([D-431], ol-egov.141.89.7.33)', () => {
  /** Anchors shaped like the production caller's (`OutcomeSourceReference`'s ordinal), so the result feeds the store mapping. */
  const PASSAGES = [
    { text: 'Time allowed: 90 minutes. Total marks: 60.', anchor: { blockIndex: 0 } },
    { text: 'Section A: short answer questions.', anchor: { blockIndex: 1 } },
    { text: 'Section B: answer one question.', anchor: { blockIndex: 2 } },
    { text: 'Question 1(a): state the definition.', anchor: { blockIndex: 3 } },
    {
      text: 'Question 1(b): using your answer to (a), work out the value.',
      anchor: { blockIndex: 4 },
    },
    { text: 'Question 1(c): comment on the result.', anchor: { blockIndex: 5 } },
  ];
  const read = async (result: unknown, promptVersion = '1.2.0') =>
    new WorkerOutcomesExtractReader({
      transport: new RecordingTransport(() => okResponse(result, promptVersion)),
    }).read({ documentKind: 'past-paper', passages: PASSAGES });

  const GROUP = {
    id: 'g1',
    kind: 'parent-question',
    label: 'Question 1',
    memberLabels: ['1(a)', '1(b)', '1(c)'],
    anchorIndex: 4,
    stimulus: { status: 'none' },
  };
  const PART_A = {
    id: 'p1',
    label: '1(a)',
    groupId: 'g1',
    instructionAnchorIndex: 4,
    questionForm: 'short answer',
    marks: 2,
    dependsOn: { status: 'unknown' },
  };
  const PART_B = {
    id: 'p2',
    label: '1(b)',
    groupId: 'g1',
    instructionAnchorIndex: 5,
    questionForm: 'short answer',
    marks: 3,
    dependsOn: { status: 'stated', onPartIds: ['p1'] },
  };
  /** No marks, no dependsOn, and a form no taxonomy would hold: kept verbatim. */
  const PART_C = {
    id: 'p3',
    label: '1(c)',
    groupId: 'g1',
    instructionAnchorIndex: 6,
    questionForm: 'comment on the result, in your own words',
  };

  describe('sections whose marks the paper does not state', () => {
    it('reads a section with no marks field as marks absent: never zero, never a failure', async () => {
      const result = await read({
        paperStructure: {
          sections: [{ label: 'Section B', questionForm: 'essay', itemCount: 2, anchorIndex: 3 }],
        },
      });
      const [section] = result.paperStructure.sections;
      expect(section).toStrictEqual({
        label: 'Section B',
        questionForm: 'essay',
        itemCount: 2,
        anchor: { blockIndex: 2 },
      });
      expect('marks' in (section ?? {})).toBe(false);
    });

    it('keeps a section that states marks beside one that does not, each as it was said', async () => {
      const result = await read({
        paperStructure: {
          sections: [
            {
              label: 'Section A',
              questionForm: 'short answer',
              itemCount: 3,
              marks: 30,
              anchorIndex: 2,
            },
            { label: 'Section B', questionForm: 'essay', itemCount: 2, anchorIndex: 3 },
          ],
        },
      });
      expect(result.paperStructure.sections.map((section) => section.marks)).toEqual([
        30,
        undefined,
      ]);
    });

    it('a printed zero is stated marks, not unknown', async () => {
      const result = await read({
        paperStructure: {
          sections: [
            {
              label: 'Section A',
              questionForm: 'unassessed',
              itemCount: 1,
              marks: 0,
              anchorIndex: 2,
            },
          ],
        },
      });
      expect(result.paperStructure.sections[0]?.marks).toBe(0);
    });

    it('an explicit null reads as unknown too, never as zero (the service refuses null; the reader still does not fail the paper over it)', async () => {
      const result = await read({
        paperStructure: {
          sections: [
            {
              label: 'Section B',
              questionForm: 'essay',
              itemCount: 2,
              marks: null,
              anchorIndex: 3,
            },
          ],
        },
      });
      expect('marks' in (result.paperStructure.sections[0] ?? {})).toBe(false);
    });

    it('still refuses marks that are stated but not a valid number', async () => {
      const section = { label: 'Section A', questionForm: 'essay', itemCount: 1, anchorIndex: 2 };
      await expect(
        read({ paperStructure: { sections: [{ ...section, marks: '20' }] } }),
      ).rejects.toThrow(OutcomesExtractReaderError);
      await expect(
        read({ paperStructure: { sections: [{ ...section, marks: -1 }] } }),
      ).rejects.toThrow(OutcomesExtractReaderError);
    });
  });

  describe('a response written before the new fields existed', () => {
    it('reads exactly as before: a prompt 1.1.0 response carries no parts, total or time key', async () => {
      const result = await read(
        {
          outcomes: [],
          paperStructure: {
            sections: [
              {
                label: 'Section A',
                questionForm: 'short answer',
                itemCount: 3,
                marks: 30,
                anchorIndex: 2,
              },
            ],
            questionGroups: [GROUP],
          },
          groundingReport: {
            citationsAvailable: true,
            droppedUngroundedOutcomeCount: 0,
            droppedUngroundedSectionCount: 0,
            droppedUngroundedGroupCount: 0,
            ungroundedStimulusCount: 0,
            droppedDuplicateGroupCount: 0,
            clearedGroupReferenceCount: 0,
          },
        },
        '1.1.0',
      );
      expect(result).toStrictEqual({
        outcomes: [],
        paperStructure: {
          sections: [
            {
              label: 'Section A',
              questionForm: 'short answer',
              itemCount: 3,
              marks: 30,
              anchor: { blockIndex: 1 },
            },
          ],
          questionGroups: [
            {
              id: 'g1',
              kind: 'parent-question',
              label: 'Question 1',
              memberLabels: ['1(a)', '1(b)', '1(c)'],
              anchor: { blockIndex: 3 },
              stimulus: { status: 'none' },
            },
          ],
        },
      });
      expect(Object.keys(result.paperStructure)).toEqual(['sections', 'questionGroups']);
    });

    it('a prompt 1.0.0 response (sections only) carries the sections key alone', async () => {
      const result = await read(
        {
          paperStructure: {
            sections: [
              {
                label: 'Section A',
                questionForm: 'short answer',
                itemCount: 3,
                marks: 30,
                anchorIndex: 2,
              },
            ],
          },
        },
        '1.0.0',
      );
      expect(Object.keys(result.paperStructure)).toEqual(['sections']);
    });
  });

  describe('question parts', () => {
    it('resolves each part instruction onto the caller anchor and keeps a dependency only where it was stated', async () => {
      const result = await read({
        paperStructure: { sections: [], questionGroups: [GROUP], questionParts: [PART_A, PART_B] },
      });
      expect(result.paperStructure.questionParts).toStrictEqual([
        {
          id: 'p1',
          label: '1(a)',
          groupId: 'g1',
          instructionAnchor: { blockIndex: 3 },
          questionForm: 'short answer',
          marks: 2,
          dependsOn: { status: 'unknown' },
        },
        {
          id: 'p2',
          label: '1(b)',
          groupId: 'g1',
          instructionAnchor: { blockIndex: 4 },
          questionForm: 'short answer',
          marks: 3,
          dependsOn: { status: 'stated', onPartIds: ['p1'] },
        },
      ]);
    });

    it('a part with no dependsOn reads unknown, never independent; marks absent stay absent; the form is verbatim', async () => {
      const result = await read({
        paperStructure: { sections: [], questionGroups: [GROUP], questionParts: [PART_C] },
      });
      const [part] = result.paperStructure.questionParts ?? [];
      expect(part).toStrictEqual({
        id: 'p3',
        label: '1(c)',
        groupId: 'g1',
        instructionAnchor: { blockIndex: 5 },
        questionForm: 'comment on the result, in your own words',
        dependsOn: { status: 'unknown' },
      });
      expect('marks' in (part ?? {})).toBe(false);
    });

    it('a part reads its marks as unknown when null and keeps a printed zero', async () => {
      const result = await read({
        paperStructure: {
          sections: [],
          questionParts: [
            { ...PART_A, marks: null },
            { ...PART_B, marks: 0 },
          ],
        },
      });
      const [first, second] = result.paperStructure.questionParts ?? [];
      expect('marks' in (first ?? {})).toBe(false);
      expect(second?.marks).toBe(0);
    });

    it('carries no demand: a part is read for its instruction and form, and demand is another task', async () => {
      const result = await read({
        paperStructure: {
          sections: [],
          questionParts: [{ ...PART_A, demand: 'calculate', commandWord: 'state' }],
        },
      });
      const [part] = result.paperStructure.questionParts ?? [];
      expect(part).toBeDefined();
      expect('demand' in (part ?? {})).toBe(false);
      expect('commandWord' in (part ?? {})).toBe(false);
    });

    it('absent questionParts stays absent (not an empty list); an empty list stays empty', async () => {
      const absent = await read({ paperStructure: { sections: [] } });
      expect('questionParts' in absent.paperStructure).toBe(false);
      const empty = await read({ paperStructure: { sections: [], questionParts: [] } });
      expect(empty.paperStructure.questionParts).toEqual([]);
    });

    it('refuses a part it cannot trust, rather than mis-anchoring or guessing', async () => {
      const refuse = (part: unknown) =>
        expect(read({ paperStructure: { sections: [], questionParts: [part] } })).rejects.toThrow(
          OutcomesExtractReaderError,
        );
      await refuse({ ...PART_A, instructionAnchorIndex: 99 });
      await refuse({ ...PART_A, instructionAnchorIndex: undefined });
      await refuse({ ...PART_A, id: '' });
      await refuse({ ...PART_A, label: undefined });
      await refuse({ ...PART_A, groupId: undefined });
      await refuse({ ...PART_A, questionForm: '' });
      await refuse({ ...PART_A, marks: '2' });
      await refuse({ ...PART_A, marks: -1 });
      await refuse({ ...PART_A, dependsOn: { status: 'stated', onPartIds: [] } });
      await refuse({ ...PART_A, dependsOn: { status: 'stated', onPartIds: [3] } });
      await refuse({ ...PART_A, dependsOn: { status: 'independent' } });
      await refuse({ ...PART_A, dependsOn: 'p1' });
      await expect(read({ paperStructure: { sections: [], questionParts: {} } })).rejects.toThrow(
        OutcomesExtractReaderError,
      );
    });
  });

  describe('total marks and time allowance', () => {
    it('carries both numbers when stated', async () => {
      const result = await read({
        paperStructure: {
          sections: [],
          totalMarks: { value: 60, anchorIndex: 1 },
          timeAllowanceMinutes: { value: 90, anchorIndex: 1 },
        },
      });
      expect(result.paperStructure.totalMarks).toBe(60);
      expect(result.paperStructure.timeAllowanceMinutes).toBe(90);
    });

    it('carries neither key when the paper states neither: absent, not zero', async () => {
      const result = await read({ paperStructure: { sections: [], questionParts: [PART_A] } });
      expect('totalMarks' in result.paperStructure).toBe(false);
      expect('timeAllowanceMinutes' in result.paperStructure).toBe(false);
    });

    it('carries one without the other', async () => {
      const result = await read({
        paperStructure: { sections: [], timeAllowanceMinutes: { value: 45, anchorIndex: 1 } },
      });
      expect('totalMarks' in result.paperStructure).toBe(false);
      expect(result.paperStructure.timeAllowanceMinutes).toBe(45);
    });

    it('a printed total of zero is stated, not unknown', async () => {
      const result = await read({
        paperStructure: { sections: [], totalMarks: { value: 0, anchorIndex: 1 } },
      });
      expect(result.paperStructure.totalMarks).toBe(0);
    });

    it('refuses an anchor that names no sent passage, and a value that cannot be a total or a time', async () => {
      const refuse = (paperStructure: Record<string, unknown>) =>
        expect(read({ paperStructure: { sections: [], ...paperStructure } })).rejects.toThrow(
          OutcomesExtractReaderError,
        );
      await refuse({ totalMarks: { value: 60, anchorIndex: 99 } });
      await refuse({ timeAllowanceMinutes: { value: 90, anchorIndex: 99 } });
      await refuse({ totalMarks: { value: -1, anchorIndex: 1 } });
      await refuse({ totalMarks: 60 });
      await refuse({ timeAllowanceMinutes: { value: 0, anchorIndex: 1 } });
      await refuse({ timeAllowanceMinutes: { value: 1.5, anchorIndex: 1 } });
      await refuse({ timeAllowanceMinutes: 90 });
    });
  });

  describe('the whole prompt 1.2.0 response', () => {
    it('reads groups, parts, total and time together, and feeds the stored structure mapping (marks unknown stay unknown)', async () => {
      const result = await read({
        outcomes: [],
        paperStructure: {
          sections: [
            {
              label: 'Section A',
              questionForm: 'short answer',
              itemCount: 3,
              marks: 30,
              anchorIndex: 2,
            },
            { label: 'Section B', questionForm: 'essay', itemCount: 2, anchorIndex: 3 },
          ],
          questionGroups: [GROUP],
          questionParts: [PART_A, PART_B, PART_C],
          totalMarks: { value: 60, anchorIndex: 1 },
          timeAllowanceMinutes: { value: 90, anchorIndex: 1 },
        },
        groundingReport: {
          citationsAvailable: true,
          droppedUngroundedOutcomeCount: 0,
          droppedUngroundedSectionCount: 0,
          droppedUngroundedPartCount: 0,
          droppedDuplicatePartCount: 0,
          droppedPartOutsideGroupCount: 0,
          clearedPartDependencyCount: 0,
          droppedUngroundedTotalCount: 0,
        },
      });

      // `paperStructure` is assignable to the store mapping's input as it stands (compile-time),
      // and the mapping keeps what was unknown unknown (run-time).
      const stored = scopePaperStructureFrom(result.paperStructure);
      expect(stored.sections.map((section) => section.marks)).toEqual([
        { status: 'stated', value: 30 },
        { status: 'unknown' },
      ]);
      expect(stored.parts?.map((part) => [part.id, part.marks, part.dependsOn])).toEqual([
        ['p1', { status: 'stated', value: 2 }, { status: 'unknown' }],
        ['p2', { status: 'stated', value: 3 }, { status: 'stated', onPartIds: ['p1'] }],
        ['p3', { status: 'unknown' }, { status: 'unknown' }],
      ]);
      expect(stored.parts?.[0]?.instructionAnchor).toEqual({ unitIndex: 3 });
      expect(stored.totalMarks).toEqual({ status: 'stated', value: 60 });
      expect(stored.timeAllowance).toEqual({ status: 'stated', minutes: 90 });
    });
  });
});

describe('WorkerOutcomesExtractReader — the model cites the passages it was SHOWN, and the Worker says which those were (ol-egov.141.89.7.38)', () => {
  /**
   * Seven passages as the landed units come: furniture-only blocks (a bare rule, an empty bullet, a
   * bare quote marker) ahead of and between three that hold something. The Worker numbers only those
   * three, so the model's number 1, 2 and 3 stand for the passages sent at positions 3, 5 and 7.
   */
  const SENT = [
    '---',
    '-',
    'Time allowed: 90 minutes. Total marks: 60.',
    '***',
    'Section A. Answer ALL questions on the invented alloy.',
    '>',
    '1 (a) State one property of the invented alloy.',
  ];
  const PASSAGES = SENT.map((text, i) => ({ text, anchor: { blockIndex: i } }));
  const at = (position: number) => ({ blockIndex: position - 1 });
  /** What the Worker sends for SENT: shown number k is the chunk at `[3, 5, 7][k - 1]`. */
  const NUMBERING = {
    chunks: [3, 5, 7].map((sentIndex) => ({ sentIndex, length: SENT[sentIndex - 1]?.length })),
  };
  const read = async (
    result: Record<string, unknown>,
    options: { numbering?: unknown; documentKind?: 'objectives' | 'past-paper' } = {},
  ) =>
    new WorkerOutcomesExtractReader({
      transport: new RecordingTransport(() =>
        okResponse({
          ...result,
          ...('numbering' in options ? { numbering: options.numbering } : { numbering: NUMBERING }),
        }),
      ),
    }).read({ documentKind: options.documentKind ?? 'past-paper', passages: PASSAGES });

  const SECTION = { label: 'Section A', questionForm: 'structured', itemCount: 1 };
  const GROUP = { id: 'g1', kind: 'parent-question', label: '1', memberLabels: ['1(a)'] };

  it('resolves an outcome to the passage the model numbered, not to the one at that position in what was sent', async () => {
    const result = await read(
      {
        outcomes: [
          { label: 'First.', confidence: 0.9, anchorIndex: 1 },
          { label: 'Second.', confidence: 0.9, anchorIndex: 2 },
          { label: 'Third.', confidence: 0.9, anchorIndex: 3 },
        ],
      },
      { documentKind: 'objectives' },
    );
    expect(result.outcomes.map((outcome) => outcome.anchor)).toEqual([at(3), at(5), at(7)]);
  });

  it('resolves a section, a question group, its stimulus and a part instruction through the same numbering', async () => {
    const result = await read({
      paperStructure: {
        sections: [{ ...SECTION, anchorIndex: 2 }],
        questionGroups: [
          {
            ...GROUP,
            anchorIndex: 3,
            stimulus: { status: 'identified', form: 'figure', anchorIndex: 2 },
          },
        ],
        questionParts: [
          {
            id: 'p1',
            label: '1(a)',
            groupId: 'g1',
            instructionAnchorIndex: 3,
            questionForm: 'short answer',
          },
        ],
      },
    });
    const structure = result.paperStructure;
    expect(structure.sections[0]?.anchor).toEqual(at(5));
    expect(structure.questionGroups?.[0]?.anchor).toEqual(at(7));
    expect(structure.questionGroups?.[0]?.stimulus).toEqual({
      status: 'identified',
      form: 'figure',
      anchor: at(5),
    });
    expect(structure.questionParts?.[0]?.instructionAnchor).toEqual(at(7));
  });

  it('accepts a total and a time allowance cited on a shown number, and refuses one cited on a number never shown', async () => {
    const shown = await read({
      paperStructure: {
        sections: [],
        totalMarks: { value: 60, anchorIndex: 1 },
        timeAllowanceMinutes: { value: 90, anchorIndex: 1 },
      },
    });
    expect(shown.paperStructure.totalMarks).toBe(60);
    expect(shown.paperStructure.timeAllowanceMinutes).toBe(90);

    // Seven chunks were sent but three were shown, so 4 names a passage of what was sent that the
    // model never saw: in range of the sent list, absent from the shown one.
    await expect(
      read({ paperStructure: { sections: [], totalMarks: { value: 60, anchorIndex: 4 } } }),
    ).rejects.toThrow(/never shown/);
    await expect(
      read({
        paperStructure: { sections: [], timeAllowanceMinutes: { value: 90, anchorIndex: 4 } },
      }),
    ).rejects.toThrow(/never shown/);
  });

  it('refuses a number the Worker never showed for every kind of anchor', async () => {
    const refuse = (
      result: Record<string, unknown>,
      documentKind: 'objectives' | 'past-paper' = 'past-paper',
    ) => expect(read(result, { documentKind })).rejects.toThrow(OutcomesExtractReaderError);
    await refuse({ outcomes: [{ label: 'X.', confidence: 0.9, anchorIndex: 4 }] }, 'objectives');
    await refuse({ paperStructure: { sections: [{ ...SECTION, anchorIndex: 4 }] } });
    await refuse({ paperStructure: { questionGroups: [{ ...GROUP, anchorIndex: 4 }] } });
    await refuse({
      paperStructure: {
        questionGroups: [
          {
            ...GROUP,
            anchorIndex: 1,
            stimulus: { status: 'identified', form: 'table', anchorIndex: 4 },
          },
        ],
      },
    });
    await refuse({
      paperStructure: {
        questionGroups: [{ ...GROUP, anchorIndex: 1 }],
        questionParts: [
          { id: 'p1', label: '1(a)', groupId: 'g1', instructionAnchorIndex: 4, questionForm: 'f' },
        ],
      },
    });
  });

  it('with nothing dropped the numbering is the identity and reads as it always did (control)', async () => {
    const passages = SENT.filter((_, i) => [2, 4, 6].includes(i)).map((text, i) => ({
      text,
      anchor: { blockIndex: i },
    }));
    const result = await new WorkerOutcomesExtractReader({
      transport: new RecordingTransport(() =>
        okResponse({ outcomes: [{ label: 'X.', confidence: 0.9, anchorIndex: 3 }] }),
      ),
    }).read({ documentKind: 'objectives', passages });
    expect(result.outcomes[0]?.anchor).toEqual({ blockIndex: 2 });
  });

  it('refuses a response with no numbering when a number is about to be resolved: it does not guess that number is a position in what was sent', async () => {
    const transport = new RecordingTransport(
      () => okResponse({ outcomes: [{ label: 'X.', confidence: 0.9, anchorIndex: 1 }] }),
      { numbering: 'omit' },
    );
    await expect(
      new WorkerOutcomesExtractReader({ transport }).read({
        documentKind: 'objectives',
        passages: PASSAGES,
      }),
    ).rejects.toThrow(/numbering/);
    // and each other kind of anchor is refused the same way
    for (const paperStructure of [
      { sections: [{ ...SECTION, anchorIndex: 1 }] },
      { questionGroups: [{ ...GROUP, anchorIndex: 1 }] },
      { totalMarks: { value: 60, anchorIndex: 1 } },
      { timeAllowanceMinutes: { value: 90, anchorIndex: 1 } },
    ]) {
      await expect(
        new WorkerOutcomesExtractReader({
          transport: new RecordingTransport(() => okResponse({ paperStructure }), {
            numbering: 'omit',
          }),
        }).read({ documentKind: 'past-paper', passages: PASSAGES }),
      ).rejects.toBeInstanceOf(OutcomesExtractReaderError);
    }
  });

  it('a response that cites nothing needs no numbering, so an older Worker reading an empty document is not refused', async () => {
    const transport = new RecordingTransport(() => okResponse({ outcomes: [] }), {
      numbering: 'omit',
    });
    const result = await new WorkerOutcomesExtractReader({ transport }).read({
      documentKind: 'objectives',
      passages: PASSAGES,
    });
    expect(result.outcomes).toEqual([]);
  });

  it('refuses a numbering it cannot trust, rather than reading through it', async () => {
    const cited = { outcomes: [{ label: 'X.', confidence: 0.9, anchorIndex: 1 }] };
    const refuse = (numbering: unknown) =>
      expect(read(cited, { numbering, documentKind: 'objectives' })).rejects.toThrow(
        OutcomesExtractReaderError,
      );
    const [first, second, third] = NUMBERING.chunks;
    await refuse('three');
    await refuse(null);
    await refuse({});
    await refuse({ chunks: 'all' });
    await refuse({ chunks: [null] });
    await refuse({ chunks: [{ sentIndex: 3 }] }); // no length
    await refuse({ chunks: [{ sentIndex: '3', length: first?.length }] });
    await refuse({ chunks: [{ sentIndex: 0, length: SENT[0]?.length }] }); // positions count from 1
    await refuse({ chunks: [{ sentIndex: 1.5, length: 1 }] });
    await refuse({ chunks: [{ sentIndex: 8, length: 1 }] }); // beyond the seven sent
    await refuse({ chunks: [second, first, third] }); // out of order
    await refuse({ chunks: [first, first] }); // a position twice
  });

  it('refuses a numbering whose recorded length is not the length of the passage sent there: the Worker numbered a different list', async () => {
    await expect(
      read(
        { outcomes: [{ label: 'X.', confidence: 0.9, anchorIndex: 1 }] },
        {
          numbering: { chunks: [{ sentIndex: 3, length: (SENT[2]?.length ?? 0) + 1 }] },
          documentKind: 'objectives',
        },
      ),
    ).rejects.toThrow(/different list/);
  });

  it('never leaks the numbering into the result the caller receives', async () => {
    const result = await read({ paperStructure: { sections: [{ ...SECTION, anchorIndex: 1 }] } });
    expect(Object.keys(result)).toEqual(['outcomes', 'paperStructure']);
    expect(JSON.stringify(result)).not.toContain('sentIndex');
  });
});

describe('WorkerOutcomesExtractReader — availability mapping ([D-068]-shaped)', () => {
  it('maps a transport failure onto OutcomesExtractReaderUnavailableError("offline")', async () => {
    const transport = { send: async () => Promise.reject(new Error('network down')) };
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toMatchObject({ reason: 'offline' });
  });

  it('maps a quota-exceeded refusal onto OutcomesExtractReaderUnavailableError("budget-exhausted")', async () => {
    const transport = new RecordingTransport(() =>
      errorEnvelope('quota-exceeded', 'monthly budget spent'),
    );
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toBeInstanceOf(OutcomesExtractReaderUnavailableError);
  });

  it('a non-quota refusal is a real failure, never softened into unavailable', async () => {
    const transport = new RecordingTransport(() => errorEnvelope('invalid-request', 'bad payload'));
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toThrow(OutcomesExtractReaderError);
  });
});
