/**
 * `simulator/transport` (WBX-4, `ol-3ux7.64.5`) — F9.S4's own scenarios:
 * replay never reaches the network, a replay miss renders as the plugin's
 * genuine unreachable-Worker state, and `direct` falls back to a live call
 * on a miss while still preferring a cassette hit. `record` mode's own
 * proxy behaviour (spend gating, the fake staging upstream) is
 * `olea-service`'s `scripts/simulator-serve.test.mjs`'s job — this file
 * only proves the CLIENT half: that `record` mode is a thin, correctly
 * wired `WorkerHttpTransport` pointed at whatever `baseUrl` it is given.
 */
import { createHash } from 'node:crypto';
import { RETRIEVAL_EMBED_TASK_ID } from 'olea-core';
import { describe, expect, it, vi } from 'vitest';
import type { HttpRequestFn } from '../../plugin/src/worker/transport.js';
import { WorkerTransportError } from '../../plugin/src/worker/transport.js';
import type { GenerationCassette } from '../src/synthetic-bridge.js';
import { hashGenerationPayload } from '../src/synthetic-bridge.js';
import {
  createSimulatorTransport,
  deriveEmbedKey,
  EmbedShardStore,
} from '../src/transport/index.js';

const TASK_ID = 'quiz.generate.v1';
const PAYLOAD = { courseCode: 'QUORBIN', conceptName: 'a synthetic concept', sourceChunks: ['x'] };

async function cassetteWithOneEntry(): Promise<GenerationCassette> {
  const payloadHash = await hashGenerationPayload(PAYLOAD);
  return {
    version: 1,
    datasetVersion: 1,
    entries: [
      {
        taskId: TASK_ID,
        promptVersion: 'v1',
        modelId: 'test-model',
        payloadHash,
        response: { ok: true, result: { questions: [] } },
      },
    ],
  };
}

describe('createSimulatorTransport — replay', () => {
  it('a hit replays from the cassette with zero httpRequest calls', async () => {
    const cassette = await cassetteWithOneEntry();
    const httpRequest = vi.fn<HttpRequestFn>();
    const transport = createSimulatorTransport({ mode: 'replay', cassette, httpRequest });

    const response = (await transport.send({
      contractVersion: 1,
      taskId: TASK_ID,
      payload: PAYLOAD,
    })) as { ok: boolean; result: unknown };

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ questions: [] });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('a miss throws the SAME WorkerTransportError a real network failure would, and reports the miss', async () => {
    const cassette = await cassetteWithOneEntry();
    const misses: { taskId: string; payloadHash: string }[] = [];
    const transport = createSimulatorTransport({
      mode: 'replay',
      cassette,
      onMiss: (miss) => misses.push(miss),
    });

    await expect(
      transport.send({
        contractVersion: 1,
        taskId: TASK_ID,
        payload: { ...PAYLOAD, conceptName: 'a completely different, unrecorded concept' },
      }),
    ).rejects.toThrow(WorkerTransportError);

    expect(misses).toHaveLength(1);
    expect(misses[0]?.taskId).toBe(TASK_ID);
    expect(typeof misses[0]?.payloadHash).toBe('string');
  });

  it('never calls httpRequest even when one is supplied — replay is zero-network by construction', async () => {
    const cassette = await cassetteWithOneEntry();
    const httpRequest = vi.fn<HttpRequestFn>();
    const transport = createSimulatorTransport({ mode: 'replay', cassette, httpRequest });

    await expect(
      transport.send({
        contractVersion: 1,
        taskId: TASK_ID,
        payload: { ...PAYLOAD, conceptName: 'unrecorded' },
      }),
    ).rejects.toThrow();

    expect(httpRequest).not.toHaveBeenCalled();
  });
});

describe('createSimulatorTransport — record', () => {
  it('is a thin transport over the given baseUrl, sending the token it was given', async () => {
    const calls: Parameters<HttpRequestFn>[0][] = [];
    const httpRequest: HttpRequestFn = async (params) => {
      calls.push(params);
      return {
        status: 200,
        text: JSON.stringify({
          ok: true,
          stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'm', usage: {} },
          result: { questions: [] },
          budgetHeadroom: 1,
        }),
      };
    };
    const onCallRecorded = vi.fn();
    const transport = createSimulatorTransport({
      mode: 'record',
      baseUrl: 'http://127.0.0.1:4322/__olea',
      httpRequest,
      onCallRecorded,
    });

    const response = (await transport.send({
      contractVersion: 1,
      taskId: TASK_ID,
      payload: PAYLOAD,
    })) as { ok: boolean };

    expect(response.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:4322/__olea/v1/task');
    expect(onCallRecorded).toHaveBeenCalledOnce();
  });

  it('refuses synchronously when baseUrl is missing — before any request is ever sent', () => {
    expect(() => createSimulatorTransport({ mode: 'record' })).toThrow(/baseUrl/);
  });
});

describe('createSimulatorTransport — bundled cassette (WBX-11, ol-3ux7.64.13)', () => {
  // `simulator/controller.ts`'s `loadReplayCassette` fetches
  // `dist/simulator-cassette.json` (bundled by `olea-service`'s
  // `scripts/simulator-build.mjs`) at startup for `replay`/`direct` only, and
  // falls through to an EMPTY cassette (`{version, datasetVersion: 0, entries:
  // []}`) whenever the fetch 404s, the response is not JSON, or the parsed
  // shape does not carry the expected `version`/`entries` fields — never a
  // throw. This factory (this module) never fetches anything itself (see its
  // own module doc), so what it must get right is the CONSUMING half of that
  // contract: an empty cassette behaves exactly like "nothing was bundled,"
  // for both modes that ever receive one.
  const EMPTY_CASSETTE: GenerationCassette = { version: 1, datasetVersion: 0, entries: [] };

  it('replay: an empty (fallback) cassette is a miss for every request, never a throw before send()', async () => {
    const misses: { taskId: string; payloadHash: string }[] = [];
    const transport = createSimulatorTransport({
      mode: 'replay',
      cassette: EMPTY_CASSETTE,
      onMiss: (miss) => misses.push(miss),
    });

    await expect(
      transport.send({ contractVersion: 1, taskId: TASK_ID, payload: PAYLOAD }),
    ).rejects.toThrow(WorkerTransportError);
    expect(misses).toHaveLength(1);
  });

  it('direct: an empty (fallback) cassette reports a miss and goes live, same as no cassette at all', async () => {
    const misses: { taskId: string; payloadHash: string }[] = [];
    const httpRequest: HttpRequestFn = async () => ({
      status: 200,
      text: JSON.stringify({
        ok: true,
        stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'm', usage: {} },
        result: { questions: [{ stem: 'live' }] },
        budgetHeadroom: 1,
      }),
    });
    const transport = createSimulatorTransport({
      mode: 'direct',
      cassette: EMPTY_CASSETTE,
      baseUrl: 'https://olea-service-staging.example.workers.dev',
      token: 'pasted-token',
      httpRequest,
      onMiss: (miss) => misses.push(miss),
    });

    const response = (await transport.send({
      contractVersion: 1,
      taskId: TASK_ID,
      payload: PAYLOAD,
    })) as { ok: boolean; result: unknown };

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ questions: [{ stem: 'live' }] });
    expect(misses).toHaveLength(1);
  });

  it('record: is never given a cassette at all (the bundled file is never loaded for this mode) and never checks one if it were', async () => {
    // `controller.ts`'s own ternary only calls `loadReplayCassette` for
    // `'replay' || 'direct'` — `record` always forwards to the proxy, which
    // decides hit/miss server-side. This factory has no `cassette`-shaped
    // branch in its `'record'` arm at all (see `createSimulatorTransport`'s
    // source), so passing one through anyway must be a no-op: the call still
    // goes over `httpRequest` to `baseUrl`, never short-circuited locally.
    const calls: Parameters<HttpRequestFn>[0][] = [];
    const httpRequest: HttpRequestFn = async (params) => {
      calls.push(params);
      return {
        status: 200,
        text: JSON.stringify({
          ok: true,
          stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'm', usage: {} },
          result: { questions: [] },
          budgetHeadroom: 1,
        }),
      };
    };
    const cassette = await cassetteWithOneEntry();
    const transport = createSimulatorTransport({
      mode: 'record',
      cassette,
      baseUrl: 'http://127.0.0.1:4322/__olea',
      httpRequest,
    });

    await transport.send({ contractVersion: 1, taskId: TASK_ID, payload: PAYLOAD });

    expect(calls).toHaveLength(1);
  });
});

describe('createSimulatorTransport — direct', () => {
  it('prefers a cassette hit over a live call', async () => {
    const cassette = await cassetteWithOneEntry();
    const httpRequest = vi.fn<HttpRequestFn>();
    const transport = createSimulatorTransport({
      mode: 'direct',
      cassette,
      baseUrl: 'https://olea-service-staging.example.workers.dev',
      token: 'pasted-token',
      httpRequest,
    });

    const response = (await transport.send({
      contractVersion: 1,
      taskId: TASK_ID,
      payload: PAYLOAD,
    })) as { ok: boolean; result: unknown };

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ questions: [] });
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('reports a miss and THEN goes live, with the pasted token, rather than refusing', async () => {
    const cassette = await cassetteWithOneEntry();
    const misses: { taskId: string; payloadHash: string }[] = [];
    let sentToken: string | undefined;
    const httpRequest: HttpRequestFn = async (params) => {
      sentToken = params.headers.authorization;
      return {
        status: 200,
        text: JSON.stringify({
          ok: true,
          stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'm', usage: {} },
          result: { questions: [{ stem: 'live' }] },
          budgetHeadroom: 1,
        }),
      };
    };
    const transport = createSimulatorTransport({
      mode: 'direct',
      cassette,
      baseUrl: 'https://olea-service-staging.example.workers.dev',
      token: 'pasted-token',
      httpRequest,
      onMiss: (miss) => misses.push(miss),
    });

    const response = (await transport.send({
      contractVersion: 1,
      taskId: TASK_ID,
      payload: { ...PAYLOAD, conceptName: 'not in the cassette' },
    })) as { ok: boolean; result: unknown };

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ questions: [{ stem: 'live' }] });
    expect(misses).toHaveLength(1);
    expect(sentToken).toBe('Bearer pasted-token');
  });

  it('goes straight live (reporting no miss against a cassette that does not exist) when no cassette is given', async () => {
    const httpRequest: HttpRequestFn = async () => ({
      status: 200,
      text: JSON.stringify({
        ok: true,
        stamp: { contractVersion: 1, promptVersion: 'v1', modelId: 'm', usage: {} },
        result: { questions: [] },
        budgetHeadroom: 1,
      }),
    });
    const onMiss = vi.fn();
    const transport = createSimulatorTransport({
      mode: 'direct',
      baseUrl: 'https://olea-service-staging.example.workers.dev',
      token: 'pasted-token',
      httpRequest,
      onMiss,
    });

    const response = (await transport.send({
      contractVersion: 1,
      taskId: TASK_ID,
      payload: PAYLOAD,
    })) as { ok: boolean };

    expect(response.ok).toBe(true);
    // No cassette was ever given, so there is nothing to call a "miss"
    // against — `onMiss` exists to report an UNFULFILLED cassette hope, not
    // every live call this mode ever makes.
    expect(onMiss).not.toHaveBeenCalled();
  });

  it('refuses synchronously when baseUrl or token is missing', () => {
    expect(() => createSimulatorTransport({ mode: 'direct', token: 'x' })).toThrow(/baseUrl/);
    expect(() => createSimulatorTransport({ mode: 'direct', baseUrl: 'https://x.test' })).toThrow(
      /token/,
    );
  });
});

describe('deriveEmbedKey — key-derivation parity (WBX-16d, ol-3ux7.64.18.4)', () => {
  it('agrees with an independently computed SHA-256 hex digest, for an invented text', async () => {
    // Invented nonsense, never real vault content (INV-3). The point of this test is that
    // `deriveEmbedKey` (re-exported `hashText` from `olea-core`'s `ingestion/hash.ts`) computes
    // the SAME contentHash a real retrieval.embed.v1 chunk would carry — proven here against a
    // derivation this test file computes on its own, via Node's `crypto`, rather than trusting
    // the import blindly. A mismatch here is exactly the failure mode embed-shards.ts's own
    // module doc calls out: a silent, wrong-key miss.
    const invented = 'zzq-invented-embed-key-parity-text-77f2';
    const viaImport = await deriveEmbedKey(invented);
    const viaIndependentSha256 = createHash('sha256').update(invented, 'utf8').digest('hex');
    expect(viaImport).toBe(viaIndependentSha256);
  });
});

describe('EmbedShardStore (WBX-16d, ol-3ux7.64.18.4)', () => {
  // Every content hash and text below is invented for this test file only (INV-3).
  const HASH_A = 'invented-shard-hash-aaaa';
  const HASH_B = 'invented-shard-hash-bbbb';
  const HASH_C = 'invented-shard-hash-cccc';
  const HASH_UNKNOWN = 'invented-shard-hash-unknown';
  const VECTOR_A = [0.1, 0.2, 0.3];
  const VECTOR_B = [0.4, 0.5, 0.6];
  const VECTOR_C = [0.7, 0.8, 0.9];
  const MODEL = 'invented-test-model';

  const INDEX = {
    version: 1,
    model: MODEL,
    datasetVersion: 0,
    shardCount: 2,
    keys: { [HASH_A]: '0.json', [HASH_B]: '0.json', [HASH_C]: '1.json' },
  };
  const SHARD_0 = {
    version: 1,
    model: MODEL,
    datasetVersion: 0,
    entries: [
      { contentHash: HASH_A, vector: VECTOR_A },
      { contentHash: HASH_B, vector: VECTOR_B },
    ],
  };
  const SHARD_1 = {
    version: 1,
    model: MODEL,
    datasetVersion: 0,
    entries: [{ contentHash: HASH_C, vector: VECTOR_C }],
  };

  function fakeFetch(calls: string[]): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/simulator-embeddings/index.json')) {
        return new Response(JSON.stringify(INDEX), { status: 200 });
      }
      if (url.endsWith('/simulator-embeddings/0.json')) {
        return new Response(JSON.stringify(SHARD_0), { status: 200 });
      }
      if (url.endsWith('/simulator-embeddings/1.json')) {
        return new Response(JSON.stringify(SHARD_1), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  }

  function embedRequest(chunks: readonly { contentHash: string; text: string }[]) {
    return { contractVersion: 2, taskId: RETRIEVAL_EMBED_TASK_ID, payload: { chunks } };
  }

  it('answers a single-key request from its shard, with the stamped model from the index', async () => {
    const calls: string[] = [];
    const store = new EmbedShardStore({ fetchFn: fakeFetch(calls) });

    const response = (await store.answer(
      embedRequest([{ contentHash: HASH_A, text: 'irrelevant — the lookup is by hash' }]),
    )) as { ok: boolean; stamp: { modelId: string }; result: { embeddings: unknown[] } };

    expect(response.ok).toBe(true);
    expect(response.stamp.modelId).toBe(MODEL);
    expect(response.result.embeddings).toEqual([{ contentHash: HASH_A, vector: VECTOR_A }]);
    expect(calls).toEqual([
      expect.stringContaining('/simulator-embeddings/index.json'),
      expect.stringContaining('/simulator-embeddings/0.json'),
    ]);
  });

  it('caches the index and each shard in memory — a second lookup makes zero further fetch calls', async () => {
    const calls: string[] = [];
    const store = new EmbedShardStore({ fetchFn: fakeFetch(calls) });

    await store.answer(embedRequest([{ contentHash: HASH_A, text: 'x' }]));
    expect(calls).toHaveLength(2); // index + shard 0

    await store.answer(embedRequest([{ contentHash: HASH_B, text: 'y' }])); // same shard
    expect(calls).toHaveLength(2); // no new fetch — index and shard 0 already cached

    await store.answer(embedRequest([{ contentHash: HASH_C, text: 'z' }])); // a different shard
    expect(calls).toHaveLength(3); // + shard 1, index still not refetched
  });

  it('an unknown key is a miss (undefined) — the caller applies its own existing miss behaviour', async () => {
    const calls: string[] = [];
    const store = new EmbedShardStore({ fetchFn: fakeFetch(calls) });

    const response = await store.answer(
      embedRequest([{ contentHash: HASH_UNKNOWN, text: 'not in the index' }]),
    );

    expect(response).toBeUndefined();
  });

  it('a batch with one known and one unknown key is a miss for the WHOLE request (no partial serve)', async () => {
    const store = new EmbedShardStore({ fetchFn: fakeFetch([]) });

    const response = await store.answer(
      embedRequest([
        { contentHash: HASH_A, text: 'known' },
        { contentHash: HASH_UNKNOWN, text: 'unknown' },
      ]),
    );

    expect(response).toBeUndefined();
  });

  it('no bundled index at all (404) is a miss, never a throw', async () => {
    const store = new EmbedShardStore({
      fetchFn: (async () => new Response('not found', { status: 404 })) as typeof fetch,
    });

    const response = await store.answer(embedRequest([{ contentHash: HASH_A, text: 'x' }]));

    expect(response).toBeUndefined();
  });

  it('the DEFAULT fetchFn (no option given) is receiver-safe — regression for a real "Illegal invocation" bug found live in a browser', async () => {
    // Node's global `fetch` tolerates being called unbound (`this` detached from `globalThis`),
    // so this exact bug passed every test in this suite that injected its own `fetchFn` fake —
    // it was only caught by an actual browser proof (WBX-16d's own close evidence), where the
    // WHATWG Fetch spec's real strictness threw "Failed to execute 'fetch' on 'Window': Illegal
    // invocation" the moment `EmbedShardStore` stored a bare `fetch` reference on `this` and
    // later called it as `this.fetchFn(...)`. This test recreates that strictness directly,
    // rather than trusting a Node-only re-run to ever exercise it again: a `fetch` stand-in that
    // THROWS unless invoked with `this === globalThis`, installed as the real global so
    // `EmbedShardStore`'s own default (`options.fetchFn ?? fetch.bind(globalThis)`) is what gets
    // exercised.
    const receiverSafeFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      const url = String(args[0]);
      if (url.endsWith('/simulator-embeddings/index.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: 1,
              model: 'm',
              datasetVersion: 0,
              shardCount: 1,
              keys: { [HASH_A]: '0.json' },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith('/simulator-embeddings/0.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: 1,
              model: 'm',
              datasetVersion: 0,
              entries: [{ contentHash: HASH_A, vector: VECTOR_A }],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    };

    vi.stubGlobal('fetch', receiverSafeFetch);
    try {
      const store = new EmbedShardStore(); // no fetchFn — exercises the class's own default
      const response = (await store.answer(embedRequest([{ contentHash: HASH_A, text: 'x' }]))) as
        | { ok: boolean; result: { embeddings: unknown[] } }
        | undefined;

      expect(response).not.toBeUndefined();
      expect(response?.ok).toBe(true);
      expect(response?.result.embeddings).toEqual([{ contentHash: HASH_A, vector: VECTOR_A }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createSimulatorTransport — retrieval.embed.v1 served from bundled shards (WBX-16d, ol-3ux7.64.18.4)', () => {
  const HASH_KNOWN = 'invented-transport-hash-known';
  const HASH_UNKNOWN = 'invented-transport-hash-unknown';
  const VECTOR = [1, 2, 3];
  const MODEL = 'invented-transport-model';

  function storeWithOneEntry(): EmbedShardStore {
    const index = {
      version: 1,
      model: MODEL,
      datasetVersion: 0,
      shardCount: 1,
      keys: { [HASH_KNOWN]: '0.json' },
    };
    const shard = {
      version: 1,
      model: MODEL,
      datasetVersion: 0,
      entries: [{ contentHash: HASH_KNOWN, vector: VECTOR }],
    };
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('index.json')) return new Response(JSON.stringify(index), { status: 200 });
      if (url.endsWith('0.json')) return new Response(JSON.stringify(shard), { status: 200 });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return new EmbedShardStore({ fetchFn });
  }

  function embedRequest(contentHash: string) {
    return {
      contractVersion: 2,
      taskId: RETRIEVAL_EMBED_TASK_ID,
      payload: { chunks: [{ contentHash, text: 'irrelevant — looked up by hash' }] },
    };
  }

  it('replay: a shard hit answers with zero cassette lookup and zero httpRequest calls', async () => {
    const httpRequest = vi.fn<HttpRequestFn>();
    const onMiss = vi.fn();
    const transport = createSimulatorTransport({
      mode: 'replay',
      cassette: { version: 1, datasetVersion: 0, entries: [] }, // empty — would be a miss on its own
      embedShards: storeWithOneEntry(),
      httpRequest,
      onMiss,
    });

    const response = (await transport.send(embedRequest(HASH_KNOWN))) as {
      ok: boolean;
      result: { embeddings: unknown[] };
    };

    expect(response.ok).toBe(true);
    expect(response.result.embeddings).toEqual([{ contentHash: HASH_KNOWN, vector: VECTOR }]);
    expect(httpRequest).not.toHaveBeenCalled();
    expect(onMiss).not.toHaveBeenCalled();
  });

  it('replay: a shard miss falls through to the existing replay miss behaviour (throws, reports onMiss)', async () => {
    const onMiss = vi.fn();
    const transport = createSimulatorTransport({
      mode: 'replay',
      cassette: { version: 1, datasetVersion: 0, entries: [] },
      embedShards: storeWithOneEntry(),
      onMiss,
    });

    await expect(transport.send(embedRequest(HASH_UNKNOWN))).rejects.toThrow(WorkerTransportError);
    expect(onMiss).toHaveBeenCalledOnce();
  });

  it('replay: with no embedShards option at all, retrieval.embed.v1 behaves exactly like before (an ordinary cassette miss)', async () => {
    const onMiss = vi.fn();
    const transport = createSimulatorTransport({
      mode: 'replay',
      cassette: { version: 1, datasetVersion: 0, entries: [] },
      onMiss,
    });

    await expect(transport.send(embedRequest(HASH_KNOWN))).rejects.toThrow(WorkerTransportError);
    expect(onMiss).toHaveBeenCalledOnce();
  });

  it('direct: a shard hit answers with zero httpRequest calls, preferred over going live', async () => {
    const httpRequest = vi.fn<HttpRequestFn>();
    const transport = createSimulatorTransport({
      mode: 'direct',
      baseUrl: 'https://olea-service-staging.example.workers.dev',
      token: 'pasted-token',
      embedShards: storeWithOneEntry(),
      httpRequest,
    });

    const response = (await transport.send(embedRequest(HASH_KNOWN))) as {
      ok: boolean;
      result: { embeddings: unknown[] };
    };

    expect(response.ok).toBe(true);
    expect(response.result.embeddings).toEqual([{ contentHash: HASH_KNOWN, vector: VECTOR }]);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('direct: a shard miss falls through to the existing direct behaviour — reports onMiss and goes live', async () => {
    const misses: { taskId: string }[] = [];
    const httpRequest: HttpRequestFn = async () => ({
      status: 200,
      text: JSON.stringify({
        ok: true,
        stamp: { contractVersion: 2, promptVersion: 'v1', modelId: 'live-model', usage: {} },
        result: { embeddings: [{ contentHash: HASH_UNKNOWN, vector: [9, 9, 9] }] },
        budgetHeadroom: 1,
      }),
    });
    const transport = createSimulatorTransport({
      mode: 'direct',
      cassette: { version: 1, datasetVersion: 0, entries: [] }, // present, so a fallthrough miss is reported — same as any other direct cassette miss
      baseUrl: 'https://olea-service-staging.example.workers.dev',
      token: 'pasted-token',
      embedShards: storeWithOneEntry(),
      httpRequest,
      onMiss: (miss) => misses.push(miss),
    });

    const response = (await transport.send(embedRequest(HASH_UNKNOWN))) as {
      ok: boolean;
      result: { embeddings: unknown[] };
    };

    expect(response.ok).toBe(true);
    expect(response.result.embeddings).toEqual([{ contentHash: HASH_UNKNOWN, vector: [9, 9, 9] }]);
    expect(misses).toHaveLength(1);
    expect(misses[0]?.taskId).toBe(RETRIEVAL_EMBED_TASK_ID);
  });
});
