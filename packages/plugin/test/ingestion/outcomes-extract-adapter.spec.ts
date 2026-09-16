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

describe('WorkerOutcomesExtractReader — availability mapping ([D-068]-shaped)', () => {
  it('maps a transport failure onto OutcomesExtractReaderUnavailableError("offline")', async () => {
    const transport = { send: async () => Promise.reject(new Error('network down')) };
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toMatchObject({ reason: 'offline' });
  });

  it('maps a quota-exceeded refusal onto OutcomesExtractReaderUnavailableError("budget-exhausted")', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'quota-exceeded',
      message: 'monthly budget spent',
    }));
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toBeInstanceOf(OutcomesExtractReaderUnavailableError);
  });

  it('a non-quota refusal is a real failure, never softened into unavailable', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'invalid-request',
      message: 'bad payload',
    }));
    const reader = new WorkerOutcomesExtractReader({ transport });

    await expect(
      reader.read({ documentKind: 'objectives', passages: OBJECTIVES_PASSAGES }),
    ).rejects.toThrow(OutcomesExtractReaderError);
  });
});
