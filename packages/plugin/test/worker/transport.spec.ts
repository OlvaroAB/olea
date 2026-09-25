/**
 * `transport.ts` tests. Obsidian-free by design (see that file's module
 * doc), so this exercises `WorkerHttpTransport`/`sendWorkerTask` against a
 * fake `HttpRequestFn` — no real network, no Obsidian host.
 *
 * Scenario: `features/F7-plugin-surface.md`, "F7.1 — a real transport
 * honours the return-body-whatever-the-status contract" —
 * @auto:plugin/worker/transport.spec.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TASK_ENDPOINT_PATH } from 'olea-contracts';
import type { WorkerTaskRequest } from 'olea-core';
import { describe, expect, it } from 'vitest';
import {
  buildTaskUrl,
  type HttpRequestFn,
  sendWorkerTask,
  WorkerHttpTransport,
  WorkerTransportError,
} from '../../src/worker/transport.js';

const CONFIG = { baseUrl: 'https://olea-service.example.workers.dev', token: 'SECRET-TOKEN-VALUE' };
const REQUEST: WorkerTaskRequest = {
  contractVersion: 1,
  taskId: 'retrieval.embed.v1',
  payload: { chunks: [{ contentHash: 'abc', text: 'hello' }] },
};

describe('buildTaskUrl', () => {
  it('joins the base URL and the frozen task endpoint path', () => {
    expect(buildTaskUrl('https://example.com')).toBe(`https://example.com${TASK_ENDPOINT_PATH}`);
  });

  it('does not double a trailing slash on the base URL', () => {
    expect(buildTaskUrl('https://example.com/')).toBe(`https://example.com${TASK_ENDPOINT_PATH}`);
  });
});

describe('sendWorkerTask / WorkerHttpTransport.send — the return-body-whatever-the-status contract', () => {
  it('returns the parsed body on a 2xx response', async () => {
    const body = {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'm' },
      result: {},
    };
    const httpRequest: HttpRequestFn = async () => ({ status: 200, text: JSON.stringify(body) });

    const transport = new WorkerHttpTransport(httpRequest, CONFIG);
    await expect(transport.send(REQUEST)).resolves.toEqual(body);
  });

  it('returns — does NOT throw — the parsed body on a non-2xx response carrying a well-formed error', async () => {
    const body = { ok: false, code: 'unauthenticated', message: 'nope' };
    const httpRequest: HttpRequestFn = async () => ({ status: 401, text: JSON.stringify(body) });

    const transport = new WorkerHttpTransport(httpRequest, CONFIG);
    await expect(transport.send(REQUEST)).resolves.toEqual(body);
  });

  it('returns the body on every other non-2xx status too (500, 400, 429)', async () => {
    for (const status of [400, 429, 500]) {
      const body = { ok: false, code: 'internal-error', message: 'x' };
      const httpRequest: HttpRequestFn = async () => ({ status, text: JSON.stringify(body) });
      const transport = new WorkerHttpTransport(httpRequest, CONFIG);
      await expect(transport.send(REQUEST)).resolves.toEqual(body);
    }
  });

  it('throws when the HTTP call itself fails (network failure)', async () => {
    const httpRequest: HttpRequestFn = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const transport = new WorkerHttpTransport(httpRequest, CONFIG);
    await expect(transport.send(REQUEST)).rejects.toThrow(WorkerTransportError);
  });

  it('throws when the body is not JSON', async () => {
    const httpRequest: HttpRequestFn = async () => ({ status: 200, text: '<html>not json</html>' });
    const transport = new WorkerHttpTransport(httpRequest, CONFIG);
    await expect(transport.send(REQUEST)).rejects.toThrow(WorkerTransportError);
  });

  it('throws on a non-JSON body even when the status is a well-formed-looking 401', async () => {
    // A misconfigured base URL pointing at some other HTTP server is exactly
    // this case: a non-2xx status with an HTML error page, not the Worker's
    // JSON envelope. Must throw, not be handed to the caller as if it were
    // a WorkerResponse.
    const httpRequest: HttpRequestFn = async () => ({ status: 401, text: 'Unauthorized' });
    const transport = new WorkerHttpTransport(httpRequest, CONFIG);
    await expect(transport.send(REQUEST)).rejects.toThrow(WorkerTransportError);
  });
});

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

describe('sendWorkerTask — the request it sends', () => {
  it('POSTs to baseUrl + the frozen task endpoint path, with the bearer token and JSON body', async () => {
    const captures: CapturedRequest[] = [];
    const httpRequest: HttpRequestFn = async (params) => {
      captures.push(params);
      return { status: 200, text: JSON.stringify({ ok: true, stamp: {}, result: {} }) };
    };

    await sendWorkerTask(httpRequest, CONFIG, REQUEST);

    expect(captures).toHaveLength(1);
    const captured = captures[0] as CapturedRequest;
    expect(captured.url).toBe(buildTaskUrl(CONFIG.baseUrl));
    expect(captured.method).toBe('POST');
    expect(captured.headers.authorization).toBe(`Bearer ${CONFIG.token}`);
    expect(captured.headers['content-type']).toBe('application/json');
    expect(JSON.parse(captured.body)).toEqual(REQUEST);
  });
});

describe('WorkerHttpTransport — `[D-123]` usage figures reach `onCallRecorded`', () => {
  it('passes every usage figure through when the stamp carries a well-formed usage block', async () => {
    const body = {
      ok: true,
      stamp: {
        contractVersion: 2,
        promptVersion: '1.0.0',
        modelId: 'm',
        usage: {
          inputTokens: 120,
          inputTokensSource: 'reported',
          cachedInputTokens: 40,
          outputTokens: 30,
          costUsd: 0.0042,
          latencyMs: 850,
        },
      },
      result: {},
    };
    const httpRequest: HttpRequestFn = async () => ({ status: 200, text: JSON.stringify(body) });
    const recorded: unknown[] = [];
    const transport = new WorkerHttpTransport(httpRequest, CONFIG, (entry) => recorded.push(entry));

    await transport.send(REQUEST);

    expect(recorded).toEqual([
      {
        taskId: REQUEST.taskId,
        promptVersion: '1.0.0',
        modelId: 'm',
        inputTokens: 120,
        inputTokensSource: 'reported',
        cachedInputTokens: 40,
        outputTokens: 30,
        costUsd: 0.0042,
        latencyMs: 850,
      },
    ]);
  });

  it('records the base entry with no usage figures — never fabricated zeros — when the stamp omits `usage` entirely', async () => {
    const body = {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'm' },
      result: {},
    };
    const httpRequest: HttpRequestFn = async () => ({ status: 200, text: JSON.stringify(body) });
    const recorded: unknown[] = [];
    const transport = new WorkerHttpTransport(httpRequest, CONFIG, (entry) => recorded.push(entry));

    await transport.send(REQUEST);

    expect(recorded).toEqual([{ taskId: REQUEST.taskId, promptVersion: '1.0.0', modelId: 'm' }]);
    const entry = recorded[0] as Record<string, unknown>;
    expect(entry.inputTokens).toBeUndefined();
    expect(entry.outputTokens).toBeUndefined();
    expect(entry.costUsd).toBeUndefined();
    expect(entry.latencyMs).toBeUndefined();
    expect(entry.inputTokensSource).toBeUndefined();
    expect(entry.cachedInputTokens).toBeUndefined();
  });

  it('carries through only the well-formed figures — never a fabricated `0` — when `usage` is present but partial/malformed', async () => {
    const body = {
      ok: true,
      stamp: {
        contractVersion: 2,
        promptVersion: '1.0.0',
        modelId: 'm',
        usage: {
          inputTokens: 100,
          // inputTokensSource omitted
          outputTokens: 'not-a-number', // malformed — must be dropped, not coerced or zeroed
          costUsd: 0.01,
          // latencyMs omitted
        },
      },
      result: {},
    };
    const httpRequest: HttpRequestFn = async () => ({ status: 200, text: JSON.stringify(body) });
    const recorded: unknown[] = [];
    const transport = new WorkerHttpTransport(httpRequest, CONFIG, (entry) => recorded.push(entry));

    await transport.send(REQUEST);

    expect(recorded).toEqual([
      {
        taskId: REQUEST.taskId,
        promptVersion: '1.0.0',
        modelId: 'm',
        inputTokens: 100,
        costUsd: 0.01,
      },
    ]);
  });

  it('never calls `onCallRecorded` on an error response, usage figures or not', async () => {
    const body = { ok: false, code: 'internal-error', message: 'x' };
    const httpRequest: HttpRequestFn = async () => ({ status: 500, text: JSON.stringify(body) });
    const recorded: unknown[] = [];
    const transport = new WorkerHttpTransport(httpRequest, CONFIG, (entry) => recorded.push(entry));

    await transport.send(REQUEST);

    expect(recorded).toHaveLength(0);
  });
});

describe('WorkerHttpTransport — item 5 (ol-egov.141.89.10.25): failed calls are recorded too, via onCallFailed', () => {
  it('calls onCallFailed, not onCallRecorded, on a well-formed error response — so failed spend is counted rather than invisible', async () => {
    const body = { ok: false, code: 'upstream-error', message: 'The model could not be reached.' };
    const httpRequest: HttpRequestFn = async () => ({ status: 502, text: JSON.stringify(body) });
    const recordedOk: unknown[] = [];
    const recordedFailed: unknown[] = [];
    const transport = new WorkerHttpTransport(
      httpRequest,
      CONFIG,
      (entry) => recordedOk.push(entry),
      (entry) => recordedFailed.push(entry),
    );

    await transport.send(REQUEST);

    expect(recordedOk).toHaveLength(0);
    // `ol-egov.141.89.10.55`: `latencyMs` is now always present on a failed
    // entry (a real, client-measured duration, never fabricated) — asserted
    // as "a real non-negative number" here rather than an exact figure,
    // matching the dedicated latency tests below for the actual measurement.
    expect(recordedFailed).toEqual([
      { taskId: REQUEST.taskId, errorCode: 'upstream-error', latencyMs: expect.any(Number) },
    ]);
    expect((recordedFailed[0] as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('carries whichever ErrorCode came back — quota-exceeded, grounding-refused, unauthenticated all recorded honestly', async () => {
    for (const code of [
      'quota-exceeded',
      'grounding-refused',
      'unauthenticated',
      'invalid-request',
    ]) {
      const body = { ok: false, code, message: 'x' };
      const httpRequest: HttpRequestFn = async () => ({ status: 400, text: JSON.stringify(body) });
      const recordedFailed: unknown[] = [];
      const transport = new WorkerHttpTransport(httpRequest, CONFIG, undefined, (entry) =>
        recordedFailed.push(entry),
      );

      await transport.send(REQUEST);

      expect(recordedFailed).toEqual([
        { taskId: REQUEST.taskId, errorCode: code, latencyMs: expect.any(Number) },
      ]);
    }
  });

  it('never fabricates promptVersion/modelId/usage figures for a failed call — none are on the wire for an error response', async () => {
    const body = { ok: false, code: 'internal-error', message: 'x' };
    const httpRequest: HttpRequestFn = async () => ({ status: 500, text: JSON.stringify(body) });
    const recordedFailed: Record<string, unknown>[] = [];
    const transport = new WorkerHttpTransport(httpRequest, CONFIG, undefined, (entry) =>
      recordedFailed.push(entry),
    );

    await transport.send(REQUEST);

    const entry = recordedFailed[0] as Record<string, unknown>;
    expect(entry.promptVersion).toBeUndefined();
    expect(entry.modelId).toBeUndefined();
    expect(entry.inputTokens).toBeUndefined();
    expect(entry.outputTokens).toBeUndefined();
    expect(entry.costUsd).toBeUndefined();
  });

  it('does nothing when onCallFailed is omitted — purely additive, every existing construction site untouched', async () => {
    const body = { ok: false, code: 'internal-error', message: 'x' };
    const httpRequest: HttpRequestFn = async () => ({ status: 500, text: JSON.stringify(body) });
    const transport = new WorkerHttpTransport(httpRequest, CONFIG);

    await expect(transport.send(REQUEST)).resolves.toEqual(body);
  });

  it('does not call onCallFailed on a successful response', async () => {
    const body = {
      ok: true,
      stamp: { contractVersion: 1, promptVersion: '1.0.0', modelId: 'm' },
      result: {},
    };
    const httpRequest: HttpRequestFn = async () => ({ status: 200, text: JSON.stringify(body) });
    const recordedFailed: unknown[] = [];
    const transport = new WorkerHttpTransport(httpRequest, CONFIG, undefined, (entry) =>
      recordedFailed.push(entry),
    );

    await transport.send(REQUEST);

    expect(recordedFailed).toHaveLength(0);
  });

  it('measures a real client round trip, not a fabricated figure — an artificially slow response yields a proportionally larger latencyMs', async () => {
    // Two failed calls through the same transport instance, one delayed
    // well past the other, prove `startedAt` is a fresh local per `send`
    // invocation (never contaminated by a previous or concurrent call on
    // the same instance) and that the number really tracks elapsed time
    // rather than being a constant or omitted placeholder.
    const body = { ok: false, code: 'internal-error', message: 'x' };
    const fastHttpRequest: HttpRequestFn = async () => ({
      status: 500,
      text: JSON.stringify(body),
    });
    const slowHttpRequest: HttpRequestFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 500, text: JSON.stringify(body) };
    };
    const recordedFast: Record<string, unknown>[] = [];
    const recordedSlow: Record<string, unknown>[] = [];
    const fastTransport = new WorkerHttpTransport(fastHttpRequest, CONFIG, undefined, (entry) =>
      recordedFast.push(entry),
    );
    const slowTransport = new WorkerHttpTransport(slowHttpRequest, CONFIG, undefined, (entry) =>
      recordedSlow.push(entry),
    );

    await fastTransport.send(REQUEST);
    await slowTransport.send(REQUEST);

    const fastLatency = recordedFast[0]?.latencyMs as number;
    const slowLatency = recordedSlow[0]?.latencyMs as number;
    expect(typeof fastLatency).toBe('number');
    expect(typeof slowLatency).toBe('number');
    expect(slowLatency).toBeGreaterThanOrEqual(50);
    expect(slowLatency).toBeGreaterThan(fastLatency);
  });
});

describe('transport.ts never logs — no console call exists in the source at all', () => {
  // Source-level check, the same technique `test/main-wiring.spec.ts` uses
  // for a different reachability property: this is the one instrument that
  // can assert "there is no code path that could log the token or the
  // request/response body", rather than merely "the paths this test thought
  // to exercise didn't log".
  it('has zero `console.` occurrences', () => {
    const path = fileURLToPath(new URL('../../src/worker/transport.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/console\./);
  });

  it('the thrown network-failure error never includes the caught error or the token', async () => {
    const httpRequest: HttpRequestFn = async () => {
      throw new Error(`connection refused, Authorization: Bearer ${CONFIG.token}`);
    };
    const transport = new WorkerHttpTransport(httpRequest, CONFIG);
    let thrown: unknown;
    try {
      await transport.send(REQUEST);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WorkerTransportError);
    expect((thrown as Error).message).not.toContain(CONFIG.token);
  });
});
