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
  CORPUS_RELATION_REQUEST_CEILING_BYTES,
  corpusRelationPayloadBytes,
  planCorpusRelationBatches,
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

type Endpoint = CorpusVerdictRequest['candidates'][number]['a'];

const typeIEndpoint: Endpoint = {
  name: 'Type I error',
  aliases: [],
  anchor: {
    sourcePath: 'Courses/COGS214/lecture-3.md',
    location: { page: 1, charRange: { start: 0, end: 10 } },
  },
  passageText: 'A Type I error is a false positive: rejecting a true null hypothesis.',
};

const typeIIEndpoint: Endpoint = {
  name: 'Type II error',
  aliases: [],
  anchor: {
    sourcePath: 'Courses/COGS214/lecture-4.md',
    location: { page: 1, charRange: { start: 0, end: 10 } },
  },
  passageText: 'A Type II error is a false negative: failing to reject a false null hypothesis.',
};

const request: CorpusVerdictRequest = {
  candidates: [{ a: typeIEndpoint, b: typeIIEndpoint }],
};

describe('WorkerCorpusRelationVerdict — the frozen vocabulary it mirrors', () => {
  it('sends the task id [D-118] adopted', () => {
    expect(CONCEPTS_RELATIONS_TASK_ID).toBe(TASK_IDS.CONCEPTS_RELATIONS);
  });

  it('sends the current contract version', () => {
    expect(CONCEPTS_RELATIONS_CONTRACT_VERSION).toBe(2);
  });
});

const requestWithKeys: CorpusVerdictRequest = {
  candidates: [
    {
      a: { ...typeIEndpoint, key: 'key-type-i' },
      b: { ...typeIIEndpoint, key: 'key-type-ii' },
    },
  ],
};

describe('WorkerCorpusRelationVerdict — the request it builds, `key` on the wire (`ol-l40p` [REL-9])', () => {
  it('sends `key` on the wire when the candidate has one — key only, never anchor', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    await port.verdict(requestWithKeys);

    const sent = transport.sent[0];
    expect(sent?.payload).toEqual({
      endpoints: {
        'Type I error': {
          name: 'Type I error',
          aliases: [],
          sourceChunks: ['A Type I error is a false positive: rejecting a true null hypothesis.'],
          key: 'key-type-i',
        },
        'Type II error': {
          name: 'Type II error',
          aliases: [],
          sourceChunks: [
            'A Type II error is a false negative: failing to reject a false null hypothesis.',
          ],
          key: 'key-type-ii',
        },
      },
      candidates: [{ a: 'Type I error', b: 'Type II error' }],
    });
    expect(JSON.stringify(sent?.payload)).not.toContain('Courses/COGS214');
  });

  it('omits `key` entirely (never `key: undefined`) when the candidate has none', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    await port.verdict(request);

    const sent = transport.sent[0] as {
      payload: { endpoints: Record<string, object>; candidates: [{ a: string; b: string }] };
    };
    expect(sent.payload.endpoints['Type I error']).not.toHaveProperty('key');
    expect(sent.payload.endpoints['Type II error']).not.toHaveProperty('key');
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
      endpoints: {
        'Type I error': {
          name: 'Type I error',
          aliases: [],
          sourceChunks: ['A Type I error is a false positive: rejecting a true null hypothesis.'],
        },
        'Type II error': {
          name: 'Type II error',
          aliases: [],
          sourceChunks: [
            'A Type II error is a false negative: failing to reject a false null hypothesis.',
          ],
        },
      },
      candidates: [{ a: 'Type I error', b: 'Type II error' }],
    });
    expect(JSON.stringify(sent?.payload)).not.toContain('Courses/COGS214');
  });

  it('sends a reused "hub" endpoint once in the dictionary, with one candidate entry per pair', async () => {
    const thirdEndpoint: Endpoint = {
      name: 'Type III error',
      aliases: [],
      anchor: {
        sourcePath: 'Courses/COGS214/lecture-5.md',
        location: { page: 1, charRange: { start: 0, end: 10 } },
      },
      passageText: 'A Type III error is answering the wrong question correctly.',
    };
    const hubRequest: CorpusVerdictRequest = {
      candidates: [
        { a: typeIEndpoint, b: typeIIEndpoint },
        { a: typeIEndpoint, b: thirdEndpoint },
      ],
    };
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });

    await port.verdict(hubRequest);

    const sent = transport.sent[0] as {
      payload: {
        endpoints: Record<string, object>;
        candidates: readonly { a: string; b: string }[];
      };
    };
    expect(Object.keys(sent.payload.endpoints).sort()).toEqual([
      'Type I error',
      'Type II error',
      'Type III error',
    ]);
    expect(sent.payload.candidates).toEqual([
      { a: 'Type I error', b: 'Type II error' },
      { a: 'Type I error', b: 'Type III error' },
    ]);
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

  it('parses a directed verdict (causes) with its direction and echoed keys — ol-egov.141.89.4.23', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'causes',
            direction: 'b-to-a',
            confidence: 0.8,
            aKey: 'ck-a',
            bKey: 'ck-b',
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
        type: 'causes',
        direction: 'b-to-a',
        confidence: 0.8,
        aKey: 'ck-a',
        bKey: 'ck-b',
      },
    ]);
  });

  it('one causes verdict does not cost the batch: a causes and a prerequisite verdict in one response both come back', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'causes',
            direction: 'a-to-b',
            confidence: 0.7,
          },
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'prerequisite',
            direction: 'a-to-b',
            confidence: 0.6,
          },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    const result = await port.verdict(request);

    expect(result.verdicts.map((v) => v.type)).toEqual(['causes', 'prerequisite']);
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

  it('parses aKey/bKey when the service echoes them back (`ol-l40p` [REL-9])', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'contrasts-with',
            confidence: 0.9,
            aKey: 'key-type-i',
            bKey: 'key-type-ii',
          },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    const result = await port.verdict(requestWithKeys);

    expect(result.verdicts).toEqual([
      {
        a: 'Type I error',
        b: 'Type II error',
        type: 'contrasts-with',
        confidence: 0.9,
        aKey: 'key-type-i',
        bKey: 'key-type-ii',
      },
    ]);
  });

  it('an omitted aKey/bKey reads exactly like the pre-REL-9 shape — no property at all', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          { a: 'Type I error', b: 'Type II error', type: 'contrasts-with', confidence: 0.9 },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    const result = await port.verdict(request);

    expect(result.verdicts[0]).not.toHaveProperty('aKey');
    expect(result.verdicts[0]).not.toHaveProperty('bKey');
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

  it('throws when a verdict names a type outside prerequisite/contrasts-with/causes', async () => {
    for (const type of ['is-a', 'part-of', 'related']) {
      const transport = new RecordingTransport(() =>
        okResponse({
          verdicts: [{ a: 'Type I error', b: 'Type II error', type, confidence: 0.5 }],
        }),
      );
      const port = new WorkerCorpusRelationVerdict({ transport });

      await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
    }
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

  it('throws when a verdict carries a non-string aKey', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'contrasts-with',
            confidence: 0.5,
            aKey: 7,
          },
        ],
      }),
    );
    const port = new WorkerCorpusRelationVerdict({ transport });

    await expect(port.verdict(request)).rejects.toThrow(WorkerCorpusRelationVerdictError);
  });

  it('throws when a verdict carries an empty-string bKey', async () => {
    const transport = new RecordingTransport(() =>
      okResponse({
        verdicts: [
          {
            a: 'Type I error',
            b: 'Type II error',
            type: 'contrasts-with',
            confidence: 0.5,
            bKey: '',
          },
        ],
      }),
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

// ---- the request is split under a declared ceiling (ol-egov.141.89.3.61) -----------------------
//
// Scenario ids (filed against F8.1 / C7.10 by the hub; carried in the titles below):
//   S-REL-BATCH-1  batches respect the ceiling and every nominated pair travels exactly once
//   S-REL-BATCH-2  one failed batch leaves the other batches' verdicts, and is reported
//   S-REL-BATCH-3  every batch failing throws, as a single failed request always did
//   S-REL-BATCH-4  a document's concepts stay in one batch where the ceiling allows
//   S-REL-BATCH-5  a call under the ceiling is one request, unchanged
// Fixtures are coined for this file (INV-3).

function syntheticEndpoint(name: string, doc: string, chars: number): Endpoint {
  return {
    name,
    aliases: [],
    anchor: { sourcePath: `Courses/Synthetic/${doc}.md`, location: { page: 1 } },
    passageText: 'x'.repeat(chars),
  };
}

/** Three documents of four concepts each; every concept pairs with the next two in its own document and one other. */
function syntheticCandidates(chars: number): CorpusVerdictRequest['candidates'] {
  const docs = ['alpha', 'beta', 'gamma'];
  const endpoints = docs.flatMap((doc) =>
    [1, 2, 3, 4].map((n) => syntheticEndpoint(`${doc} concept ${n}`, doc, chars)),
  );
  const pairs: CorpusVerdictRequest['candidates'][number][] = [];
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++)
        pairs.push({ a: endpoints[d * 4 + i]!, b: endpoints[d * 4 + j]! });
    }
  }
  pairs.push({ a: endpoints[0]!, b: endpoints[4]! }, { a: endpoints[5]!, b: endpoints[9]! });
  return pairs;
}

describe('WorkerCorpusRelationVerdict — request batching under a declared ceiling (ol-egov.141.89.3.61)', () => {
  it('declares a ceiling that one maximal pair fits under', () => {
    const maximalPair = [
      { a: syntheticEndpoint('a', 'x', 8000), b: syntheticEndpoint('b', 'y', 8000) },
    ];
    expect(corpusRelationPayloadBytes(maximalPair)).toBeLessThan(
      CORPUS_RELATION_REQUEST_CEILING_BYTES,
    );
  });

  it('S-REL-BATCH-1: batches respect the ceiling and every nominated pair travels exactly once', async () => {
    const candidates = syntheticCandidates(3000);
    const ceiling = 30_000;
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport, requestCeilingBytes: ceiling });

    const response = await port.verdict({ candidates });

    expect(transport.sent.length).toBeGreaterThan(1);
    expect(response.batchesSent).toBe(transport.sent.length);
    const sentPairs: string[] = [];
    for (const sent of transport.sent) {
      const payload = sent.payload as { candidates: { a: string; b: string }[] };
      expect(new TextEncoder().encode(JSON.stringify(sent.payload)).length).toBeLessThanOrEqual(
        ceiling,
      );
      sentPairs.push(...payload.candidates.map((pair) => `${pair.a}|${pair.b}`));
    }
    expect(sentPairs.sort()).toEqual(
      candidates.map((pair) => `${pair.a.name}|${pair.b.name}`).sort(),
    );
  });

  it("S-REL-BATCH-2: one failed batch leaves the other batches' verdicts and is reported by count and code", async () => {
    const candidates = syntheticCandidates(3000);
    let call = 0;
    const transport = new RecordingTransport((sent) => {
      call += 1;
      if (call === 2) return { ok: false, code: 'upstream-unavailable', message: 'secret text' };
      const first = (sent.payload as { candidates: { a: string; b: string }[] }).candidates[0]!;
      return okResponse({
        verdicts: [{ a: first.a, b: first.b, type: 'contrasts-with', confidence: 0.8 }],
      });
    });
    const port = new WorkerCorpusRelationVerdict({ transport, requestCeilingBytes: 30_000 });

    const response = await port.verdict({ candidates });

    expect(response.verdicts).toHaveLength(transport.sent.length - 1);
    expect(response.failedBatches).toHaveLength(1);
    expect(response.failedBatches?.[0]?.reason).toBe('upstream-unavailable');
    expect(response.failedBatches?.[0]?.candidates).toBeGreaterThan(0);
    expect(JSON.stringify(response.failedBatches)).not.toContain('secret');
  });

  it('S-REL-BATCH-3: every batch failing throws, as a single failed request always did', async () => {
    const transport = new RecordingTransport(() => ({ ok: false, code: 'upstream-unavailable' }));
    const port = new WorkerCorpusRelationVerdict({ transport, requestCeilingBytes: 30_000 });
    await expect(port.verdict({ candidates: syntheticCandidates(3000) })).rejects.toBeInstanceOf(
      WorkerCorpusRelationVerdictError,
    );
    expect(transport.sent.length).toBeGreaterThan(1);
  });

  it("S-REL-BATCH-4: a document's concepts stay in one batch where the ceiling allows", () => {
    const candidates = syntheticCandidates(3000);
    // Room for one document\'s six pairs and four passages, not for two documents.
    const batches = planCorpusRelationBatches(candidates, undefined, 50_000);
    const batchOf = (name: string) =>
      batches.findIndex((batch) =>
        batch.some((pair) => pair.a.name === name || pair.b.name === name),
      );
    for (const doc of ['alpha', 'beta', 'gamma']) {
      const homes = new Set(
        [1, 2, 3, 4].map((n) =>
          batches.findIndex((batch) =>
            batch.some((p) => p.a.name === `${doc} concept ${n}` && p.b.name.startsWith(doc)),
          ),
        ),
      );
      homes.delete(-1);
      expect(homes.size).toBe(1);
    }
    expect(batchOf('alpha concept 1')).toBeGreaterThanOrEqual(0);
  });

  it('S-REL-BATCH-5: a call under the ceiling is one request carrying every pair', async () => {
    const transport = new RecordingTransport(() => okResponse({ verdicts: [] }));
    const port = new WorkerCorpusRelationVerdict({ transport });
    const response = await port.verdict(request);
    expect(transport.sent).toHaveLength(1);
    expect(response.batchesSent).toBe(1);
    expect(response.failedBatches).toBeUndefined();
  });
});
