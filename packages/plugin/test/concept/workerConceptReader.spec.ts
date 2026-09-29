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

function okResponse(result: Record<string, unknown>) {
  return {
    ok: true,
    stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'm' },
    // Unless a test scripts its own, the Worker reports the numbering of a batch it showed in full:
    // `result.numbering` is how the reader ties a cited number to a sent passage (`ol-egov.141.89.3.32`).
    result: 'numbering' in result ? result : { ...result, numbering: identityNumbering(passages) },
  };
}

/** The Worker's `result.numbering` for a batch in which nothing was dropped: number k is position k. */
function identityNumbering(sent: readonly { readonly text: string }[]) {
  return { chunks: sent.map((passage, i) => ({ sentIndex: i + 1, length: passage.text.length })) };
}

const passages = [
  {
    text: 'Event-related potentials are voltage deflections time-locked to an event.',
    anchor: {
      sourcePath: 'Courses/COGS214/lecture-3.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
    course: 'COGS214',
  },
  {
    text: 'The P300 component is one well-studied ERP.',
    anchor: {
      sourcePath: 'Courses/COGS214/lecture-4.md',
      location: { page: 1, charRange: { start: 0, end: 10 } },
    },
    course: 'COGS214',
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
    expect(CONCEPTS_EXTRACT_CONTRACT_VERSION).toBe(2);
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
    expect(request?.contractVersion).toBe(2);
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

describe('WorkerConceptReader — the relations it reads ([EXT-10], C7.10, [D-070])', () => {
  it('resolves fromIndex/toIndex against the SAME concepts array it already parsed, to real concept names', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [
          { name: 'Event-related potential', anchorIndex: 1 },
          { name: 'P300', anchorIndex: 2 },
        ],
        relations: [{ type: 'is-a', fromIndex: 2, toIndex: 1, confidence: 0.9 }],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.relations).toEqual([
      { type: 'is-a', from: 'P300', to: 'Event-related potential', confidence: 0.9 },
    ]);
  });

  it('resolves a part-of edge the same way', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [
          { name: 'P300', anchorIndex: 1 },
          { name: 'Event-related potential', anchorIndex: 2 },
        ],
        relations: [{ type: 'part-of', fromIndex: 1, toIndex: 2, confidence: 0.6 }],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.relations).toEqual([
      { type: 'part-of', from: 'P300', to: 'Event-related potential', confidence: 0.6 },
    ]);
  });

  it('an omitted result.relations field reads exactly like an empty array', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Concept X', anchorIndex: 1 }] }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.relations).toEqual([]);
  });

  it('an empty relations array is a valid, honest answer', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Concept X', anchorIndex: 1 }], relations: [] }),
    );
    const reader = new WorkerConceptReader({ transport });

    expect((await reader.read({ passages })).relations).toEqual([]);
  });
});

describe('WorkerConceptReader — refuses rather than mis-resolves a confabulated relation (belt and braces)', () => {
  it('throws when result.relations is not an array', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Concept X', anchorIndex: 1 }], relations: 'not an array' }),
    );
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });

  it('throws when a relation names a type outside is-a/part-of', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [
          { name: 'A', anchorIndex: 1 },
          { name: 'B', anchorIndex: 2 },
        ],
        relations: [{ type: 'contrasts-with', fromIndex: 1, toIndex: 2, confidence: 0.5 }],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });

  it('throws when fromIndex names a concept position that never survived (grounding accounting drifted)', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'A', anchorIndex: 1 }],
        relations: [{ type: 'is-a', fromIndex: 7, toIndex: 1, confidence: 0.5 }],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
  });

  it('throws when a relation carries no numeric confidence — never defaulted', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [
          { name: 'A', anchorIndex: 1 },
          { name: 'B', anchorIndex: 2 },
        ],
        relations: [{ type: 'is-a', fromIndex: 1, toIndex: 2 }],
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    await expect(reader.read({ passages })).rejects.toThrow(WorkerConceptReaderError);
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

describe("WorkerConceptReader — anchorsRejected, forwarded from the Worker's groundingReport (ol-egov.141.89.3.4, cpt.md §8)", () => {
  it('forwards result.groundingReport.droppedUngroundedAnchorCount as anchorsRejected', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'Concept X', anchorIndex: 1 }],
        groundingReport: {
          citationsAvailable: true,
          droppedUngroundedAnchorCount: 2,
          droppedUngroundedRelationCount: 0,
        },
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.anchorsRejected).toBe(2);
  });

  it('an absent groundingReport leaves anchorsRejected undefined, never 0 (absent and zero mean different things)', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Concept X', anchorIndex: 1 }] }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.anchorsRejected).toBeUndefined();
  });

  it('a malformed groundingReport (not an object) is ignored rather than thrown on', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'Concept X', anchorIndex: 1 }],
        groundingReport: 'not an object',
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.anchorsRejected).toBeUndefined();
  });

  it('a non-numeric droppedUngroundedAnchorCount is ignored rather than forwarded', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'Concept X', anchorIndex: 1 }],
        groundingReport: { citationsAvailable: true, droppedUngroundedAnchorCount: 'two' },
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.anchorsRejected).toBeUndefined();
  });

  it('a zero count is forwarded as 0, not treated as absent', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'Concept X', anchorIndex: 1 }],
        groundingReport: {
          citationsAvailable: true,
          droppedUngroundedAnchorCount: 0,
          droppedUngroundedRelationCount: 0,
        },
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    const result = await reader.read({ passages });

    expect(result.anchorsRejected).toBe(0);
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

/**
 * `ol-egov.141.89.3.32`. The Worker numbers only the passages it shows the model, and leaves
 * furniture-only ones (a bare rule, an empty bullet, a bare quote marker) out. The number the model
 * cites is therefore a position in the SHOWN list. The reader used to index its own, unfiltered list
 * with it, so a furniture-only chunk ahead of a citation attached the concept to a different passage
 * and nothing flagged it, because the number was in range on both sides.
 */
describe('WorkerConceptReader — a cited number is resolved through the Worker numbering, never through the sent list (`ol-egov.141.89.3.32`)', () => {
  // A realistic unit: furniture-only blocks ahead of and between the content blocks. Coined words.
  const texts = [
    '---',
    '-',
    '# Zorbic flux\n\nZorbic flux is the drift of a settled fluid under a slow field.',
    '***',
    'Dornith is the process by which a system settles into its lowest-energy state.',
    '>',
    'Quenlar drift is what remains after Dornith has finished.',
  ];
  const furnitureFirst = texts.map((text, unit) => ({
    text,
    anchor: { sourcePath: 'Courses/COINED/unit.md', location: { page: 1, unit } },
    course: 'COINED',
  }));
  /** What the Worker reports for `furnitureFirst`: the three content chunks, sent at 3, 5 and 7. */
  const shown = {
    chunks: [3, 5, 7].map((sentIndex) => ({
      sentIndex,
      length: texts[sentIndex - 1]?.length ?? -1,
    })),
  };
  const read = (concepts: unknown[], numbering: unknown = shown) =>
    new WorkerConceptReader({
      transport: new RecordingTransport(() => okResponse({ concepts, numbering })),
    }).read({ passages: furnitureFirst });

  it('anchors each concept to the passage the model numbered, not to the passage at that position in the sent list', async () => {
    const result = await read([
      { name: 'Zorbic flux', anchorIndex: 1 },
      { name: 'Dornith', anchorIndex: 2 },
      { name: 'Quenlar drift', anchorIndex: 3 },
    ]);

    expect(result.concepts.map((concept) => concept.anchor)).toEqual([
      furnitureFirst[2]?.anchor,
      furnitureFirst[4]?.anchor,
      furnitureFirst[6]?.anchor,
    ]);
    // The defect, named: indexing the sent list with the model's number lands on furniture.
    expect(result.concepts[0]?.anchor).not.toEqual(furnitureFirst[0]?.anchor);
    expect(result.concepts[2]?.anchor).not.toEqual(furnitureFirst[2]?.anchor);
  });

  it('resolves alsoInIndexes through the same numbering', async () => {
    const result = await read([{ name: 'Dornith', anchorIndex: 2, alsoInIndexes: [1, 3] }]);

    expect(result.concepts[0]?.alsoIn).toEqual([
      furnitureFirst[2]?.anchor,
      furnitureFirst[6]?.anchor,
    ]);
  });

  it('a number the model was never shown is refused for an anchor and filtered for an also-in', async () => {
    await expect(read([{ name: 'Invented', anchorIndex: 4 }])).rejects.toThrow(/never shown/);

    const result = await read([{ name: 'Dornith', anchorIndex: 2, alsoInIndexes: [4, 99] }]);
    expect(result.concepts[0]?.alsoIn).toEqual([]);
  });

  it('refuses a Worker answer that carries concepts but no numbering, and says why, rather than guessing', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [{ name: 'Dornith', anchorIndex: 2 }], numbering: undefined }),
    );
    const reader = new WorkerConceptReader({ transport });

    const failure = await reader
      .read({ passages: furnitureFirst })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WorkerConceptReaderError);
    expect((failure as Error).message).toMatch(/numbering/);
  });

  it('needs no numbering when nothing was proposed: there is no number to resolve', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ concepts: [], numbering: undefined }),
    );
    const reader = new WorkerConceptReader({ transport });

    expect((await reader.read({ passages: furnitureFirst })).concepts).toEqual([]);
  });

  it.each([
    ['not an object', 'shown'],
    ['no chunks array', {}],
    ['an entry that is not an object', { chunks: [null] }],
    ['a sentIndex that is not an integer', { chunks: [{ sentIndex: 2.5, length: 3 }] }],
    ['a sentIndex past the passages sent', { chunks: [{ sentIndex: 8, length: 3 }] }],
    ['a sentIndex of zero', { chunks: [{ sentIndex: 0, length: 3 }] }],
    [
      'a repeated sentIndex',
      {
        chunks: [
          { sentIndex: 3, length: texts[2]?.length },
          { sentIndex: 3, length: texts[2]?.length },
        ],
      },
    ],
    [
      'entries out of order',
      {
        chunks: [
          { sentIndex: 5, length: texts[4]?.length },
          { sentIndex: 3, length: texts[2]?.length },
        ],
      },
    ],
  ])('refuses a malformed numbering: %s', async (_label, numbering) => {
    await expect(read([{ name: 'Dornith', anchorIndex: 1 }], numbering)).rejects.toThrow(
      WorkerConceptReaderError,
    );
  });

  it('refuses a numbering whose chunk is not the length of the passage sent at that position', async () => {
    // The Worker says shown number 1 is the chunk at position 3, but of a different length: it
    // numbered a trimmed, split or reordered copy of the batch, not the batch this reader sent.
    const drifted = { chunks: [{ sentIndex: 3, length: (texts[2]?.length ?? 0) - 1 }] };

    await expect(read([{ name: 'Zorbic flux', anchorIndex: 1 }], drifted)).rejects.toThrow(
      /length/,
    );
  });

  it('with nothing dropped, the numbering is the identity and a number is a position in the sent list', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        concepts: [{ name: 'P300', anchorIndex: 2 }],
        numbering: identityNumbering(passages),
      }),
    );
    const reader = new WorkerConceptReader({ transport });

    expect((await reader.read({ passages })).concepts[0]?.anchor).toEqual(passages[1]?.anchor);
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
