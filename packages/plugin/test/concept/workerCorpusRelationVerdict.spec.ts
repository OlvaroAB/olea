/**
 * `WorkerCorpusRelationVerdict` tests (`[EXT-11]`, `ol-kw4a`, `[D-118]`).
 *
 * Runs entirely against a fake `WorkerTaskTransport` — no `obsidian` import
 * anywhere in this file (INV-1), and none needed:
 * `workerCorpusRelationVerdict.ts` imports nothing Obsidian-specific.
 */

import { TASK_IDS } from 'olea-contracts';
import type { CorpusVerdictRequest, WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  CONCEPTS_RELATIONS_CONTRACT_VERSION,
  CONCEPTS_RELATIONS_TASK_ID,
  WorkerCorpusRelationVerdict,
  WorkerCorpusRelationVerdictError,
} from '../../src/concept/workerCorpusRelationVerdict.js';

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

const request: CorpusVerdictRequest = {
  candidates: [
    {
      a: {
        name: 'Type I error',
        aliases: [],
        anchor: {
          sourcePath: 'Courses/PSYCH305/lecture-3.md',
          location: { page: 1, charRange: { start: 0, end: 10 } },
        },
        passageText: 'A Type I error is a false positive: rejecting a true null hypothesis.',
      },
      b: {
        name: 'Type II error',
        aliases: [],
        anchor: {
          sourcePath: 'Courses/PSYCH305/lecture-4.md',
          location: { page: 1, charRange: { start: 0, end: 10 } },
        },
        passageText:
          'A Type II error is a false negative: failing to reject a false null hypothesis.',
      },
    },
  ],
};

describe('WorkerCorpusRelationVerdict — the frozen vocabulary it mirrors', () => {
  it('sends the task id [D-118] adopted', () => {
    expect(CONCEPTS_RELATIONS_TASK_ID).toBe(TASK_IDS.CONCEPTS_RELATIONS);
  });

  it('sends the current contract version', () => {
    expect(CONCEPTS_RELATIONS_CONTRACT_VERSION).toBe(2);
  });
});

describe('WorkerCorpusRelationVerdict — the request it builds', () => {
  it('sends name, aliases and passage text only — never the anchor / vault path (D-005)', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    await port.verdict(request);

    expect(transport.sent).toHaveLength(1);
    const sent = transport.sent[0];
    expect(sent?.taskId).toBe('concepts.relations.v1');
    expect(sent?.contractVersion).toBe(2);
    expect(sent?.payload).toEqual({
      candidates: [
        {
          a: {
            name: 'Type I error',
            aliases: [],
            sourceChunks: ['A Type I error is a false positive: rejecting a true null hypothesis.'],
          },
          b: {
            name: 'Type II error',
            aliases: [],
            sourceChunks: [
              'A Type II error is a false negative: failing to reject a false null hypothesis.',
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(sent?.payload)).not.toContain('Courses/PSYCH305');
  });

  it('never calls the transport for an empty candidate batch', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    const result = await port.verdict({ candidates: [] });

    expect(transport.sent).toHaveLength(0);
    expect(result).toEqual({ verdicts: [] });
  });
});

describe('WorkerCorpusRelationVerdict — the response it reads', () => {
  it('parses a directed verdict (prerequisite) with a direction', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'prerequisite',
            direction: 'a-to-b',
            confidence: 0.7,
          },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    const result = await port.verdict(request);

    expect(result.verdicts).toEqual([
      {
        a: 'Type I error',
        b: 'Type II error',
        type: 'prerequisite',
        direction: 'a-to-b',
        confidence: 0.7,
      },
    ]);
  });

  it('parses a symmetric verdict (contrasts-with) with no direction field at all', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          { a: 'Type I error', b: 'Type II error', type: 'contrasts-with', confidence: 0.9 },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    const result = await port.verdict(request);

    expect(result.verdicts).toEqual([
      { a: 'Type I error', b: 'Type II error', type: 'contrasts-with', confidence: 0.9 },
    ]);
    expect(result.verdicts[0]).not.toHaveProperty('direction');
  });

  it('an empty verdicts array is a valid, successful response (abstention)', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    expect((await port.verdict(request)).verdicts).toEqual([]);
  });

  it('an omitted result.verdicts field reads exactly like an empty array', async () => {
    const transport = new RecordingTransport(() => okResponse({}));
    const port = new WorkerCorpusRelationVerdict({ transport });

    expect((await port.verdict(request)).verdicts).toEqual([]);
  });
});

describe('WorkerCorpusRelationVerdict — refuses rather than mis-parses a confabulated shape (belt and braces)', () => {
  it('throws when result.verdicts is not an array', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: 'not an array' }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws when a verdict names a type outside prerequisite/contrasts-with', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [{ a: 'Type I error', b: 'Type II error', type: 'is-a', confidence: 0.5 }],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws when a verdict carries an unrecognised direction', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'prerequisite',
            direction: 'sideways',
            confidence: 0.5,
          },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws when a verdict carries no numeric confidence — never defaulted', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({ verdicts: [{ a: 'Type I error', b: 'Type II error', type: 'contrasts-with' }] }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws when the response body is not an object', async () => {
    const transport = new RecordingTransport(() => 'not an object');
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws when the Worker refuses the request', async () => {
    const transport = new RecordingTransport(() => ({
      ok: false,
      code: 'upstream-error',
      message: 'model call failed',
    }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws (wrapped) when the transport fails before any response arrives', async () => {
    const port = new WorkerCorpusRelationVerdict({
      transport: {
        send: async () => {
          throw new Error('network unreachable');
        },
      },
    });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });
});
