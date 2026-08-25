/**
 * `WorkerConceptReader` tests (EXT-7, `ol-5nle`).
 *
 * Runs entirely against a fake `WorkerTaskTransport` — no `obsidian` import
 * anywhere in this file (INV-1), and none needed: `workerConceptReader.ts`
 * imports nothing Obsidian-specific.
 */

import { TASK_IDS } from 'olea-contracts';
import { ConceptReaderUnavailableError, type WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  CONCEPTS_EXTRACT_CONTRACT_VERSION,
  CONCEPTS_EXTRACT_TASK_ID,
  WorkerConceptReader,
  WorkerConceptReaderError,
} from '../../src/concept/workerConceptReader.js';

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

const passages = [
  {
    text: 'Event-related potentials are voltage deflections time-locked to an event.',
    anchor: {
      sourcePath: 'Courses/PSYCH305/lecture-3.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
    course: 'PSYCH305',
  },
  {
    text: 'The P300 component is one well-studied ERP.',
    anchor: {
      sourcePath: 'Courses/PSYCH305/lecture-4.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
    course: 'PSYCH305',
  },
];

describe('WorkerConceptReader — the frozen vocabulary it mirrors', () => {
  // The module deliberately does not import olea-contracts as a value in
  // production code (see the module doc). This test is what stops the
  // mirror drifting.
  it('sends the task id the frozen catalogue reserves for W4', () => {
    expect(CONCEPTS_EXTRACT_TASK_ID).toBe(TASK_IDS.CONCEPTS_EXTRACT);
  });

  it('sends the current contract version', () => {
    expect(CONCEPTS_EXTRACT_CONTRACT_VERSION).toBe(1);
  });
});

describe('WorkerConceptReader — the request it builds', () => {
  it('sends passage text only — never a vault path or a course code (D-005)', async () => {
    const transport = new RecordingTransport(() => okResponse({ concepts: [] }));
    const reader = new WorkerConceptReader({ transport });

    await reader.read({ passages });

    expect(transport.sent).toHaveLength(1);
    const request = transport.sent[0];
    expect(request?.taskId).toBe('concepts.extract.v1');
    expect(request?.contractVersion).toBe(1);
    expect(request?.payload).toEqual({
      sourceChunks: [
        'Event-related potentials are voltage deflections time-locked to an event.',
        'The P300 component is one well-studied ERP.',
      ],
    });
  });

  it('never calls the transport for an empty passage list', async () => {
    const transport = new RecordingTransport(() => okResponse({ concepts: [] }));
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages: [] });

    expect(transport.sent).toHaveLength(0);
    expect(result).toEqual({ concepts: [] });
  });
});

describe('WorkerConceptReader — the response it reads', () => {
  it('maps a grounded anchorIndex back to the real Provenance the request held', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [
          {
            name: 'Event-related potential',
            aliases: ['ERP'],
            anchorIndex: 1,
            alsoInIndexes: [2],
          },
        ],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.concepts).toEqual([
      {
        name: 'Event-related potential',
        aliases: ['ERP'],
        anchor: passages[0]?.anchor,
        alsoIn: [passages[1]?.anchor],
      },
    ]);
  });

  it('defaults aliases and alsoIn to [] when the Worker omits them', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Concept X', anchorIndex: 1 }] }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.concepts[0]).toEqual({
      name: 'Concept X',
      aliases: [],
      anchor: passages[0]?.anchor,
      alsoIn: [],
    });
  });

  it('an empty concepts array is a valid, successful read (the refusal shape)', async () => {
    const transport = new RecordingTransport(() => okResponse({ concepts: [] }));
    const reader = new WorkerConceptReader({ transport });

    expect((await reader.read({ passages })).concepts).toEqual([]);
  });

  it('filters a fabricated alsoInIndexes entry without dropping the concept', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'Concept X', anchorIndex: 1, alsoInIndexes: [2, 99] }],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.concepts[0]?.alsoIn).toEqual([passages[1]?.anchor]);
  });
});

describe('WorkerConceptReader — refuses rather than mis-anchors on a confabulated index (belt and braces)', () => {
  it('throws WorkerConceptReaderError when anchorIndex names a passage never sent', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Invented', anchorIndex: 7 }] }),
    );
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });

  it('throws when a concept carries no name', async () => {
    const transport = new RecordingTransport(() => okResponse({ concepts: [{ anchorIndex: 1 }] }));
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });

  it('throws when the response body is not an object', async () => {
    const transport = new RecordingTransport(() => 'not an object');
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });

  it('throws when result.concepts is missing', async () => {
    const transport = new RecordingTransport(() => okResponse({}));
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });
});

describe('WorkerConceptReader — ConceptReaderUnavailableError mapping (`[D-068]`)', () => {
  it('maps quota-exceeded to budget-exhausted', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'quota-exceeded',
      message: 'Daily usage limit reached.',
    }));
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(ConceptReaderUnavailableError);
    try {
      await reader.read({ passages });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConceptReaderUnavailableError).reason).toBe('budget-exhausted');
    }
  });

  it('maps a transport-level failure (no response at all) to offline', async () => {
    const reader = new WorkerConceptReader({
      transport: {
        send: async () => {
          throw new Error('network unreachable');
        },
      },
    });

    await expect(reader.read({ passages })).rejects.toThrow(ConceptReaderUnavailableError);
    try {
      await reader.read({ passages });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConceptReaderUnavailableError).reason).toBe('offline');
    }
  });

  it('does NOT map an unauthenticated or update-required refusal to ConceptReaderUnavailableError — that is the composition root job (F7.8)', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'unauthenticated',
      message: 'This device is not linked.',
    }));
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
    await expect(reader.read({ passages })).rejects.not.toThrow(ConceptReaderUnavailableError);
  });
});
