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
import { describe, expect, it, vi } from 'vitest';
import type { HttpRequestFn } from '../../plugin/src/worker/transport.js';
import { WorkerTransportError } from '../../plugin/src/worker/transport.js';
import type { GenerationCassette } from '../src/synthetic-bridge.js';
import { hashGenerationPayload } from '../src/synthetic-bridge.js';
import { createSimulatorTransport } from '../src/transport/index.js';

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
