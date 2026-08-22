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
