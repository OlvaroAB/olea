/**
 * `WorkerHttpTransport` — the concrete `WorkerTaskTransport`
 * (`olea-core`'s `retrieval/workerProvider.ts`) that closes `ol-k57j`: until
 * this file existed, that interface had zero implementations outside test
 * doubles anywhere in either repo, so nothing the client built could ever
 * reach the Worker, no matter how many component pipelines passed their own
 * tests against an injected fake of exactly this seam.
 *
 * **Deliberately obsidian-free.** All of the actual protocol reasoning below
 * — build the URL, send the request, return the body whatever the status,
 * throw only when there is genuinely nothing to return — lives here so it can
 * be unit-tested directly under Vitest. The one thing this file cannot do
 * itself is make an HTTP call without CORS trouble from inside Obsidian's
 * renderer, which is why the call is made through an injected `HttpRequestFn`
 * rather than a bare `fetch`. `obsidian-transport.ts` supplies the real one,
 * over `requestUrl` (C1.6, INV-1) — see that file's module doc for why it
 * cannot itself be tested, and why keeping it a thin adapter over this class
 * is what makes that acceptable.
 *
 * **The contract this exists to honour**, restated from
 * `WorkerTaskTransport`'s own doc because getting it "helpfully" wrong here
 * would silently break every caller: a non-2xx response still carries a
 * well-formed `ErrorResponse` body whose `code` the caller translates into a
 * useful message, so `send` returns that body rather than throwing on it.
 * `send` throws only when there is genuinely no usable body — the HTTP call
 * itself failed, or what came back was not JSON.
 */

import { TASK_ENDPOINT_PATH } from 'olea-contracts';
import type { WorkerTaskRequest, WorkerTaskTransport } from 'olea-core';

/** Base URL and bearer token — F7.1's "pasted token in v0.9." Never logged; see the module doc above and `config-store.ts`. */
export interface WorkerConfig {
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * The minimal shape this module needs back from an HTTP call — deliberately
 * not `fetch`'s `Response` or Obsidian's own `RequestUrlResponse`, so a test
 * double needs to satisfy nothing but this, and so `obsidian-transport.ts`'s
 * adapter is the only place that shape conversion happens.
 */
export interface HttpResponseLike {
  readonly status: number;
  readonly text: string;
}

/**
 * The HTTP primitive this module needs, injected so `sendWorkerTask` and
 * `WorkerHttpTransport` below run under plain Vitest. Must resolve with
 * whatever body text came back for ANY status code (a caller that throws on
 * non-2xx here — as Obsidian's `requestUrl` does by default — breaks the
 * contract this class exists to honour) and must reject only on a genuine
 * transport-level failure (DNS, connection refused, timeout, offline).
 */
export type HttpRequestFn = (params: {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}) => Promise<HttpResponseLike>;

/**
 * Thrown by `sendWorkerTask`/`WorkerHttpTransport.send` in the two cases
 * `WorkerTaskTransport`'s contract reserves for a throw. The message is a
 * static, generic string in both cases — never the request body, the
 * response body, or the configured token, so a caller that (against the
 * rule) logs a caught error still cannot leak content or a credential
 * through this class. See `transport.spec.ts`'s "never logs" tests.
 */
export class WorkerTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerTransportError';
  }
}

/** Joins `baseUrl` and the frozen `/v1/task` path (`olea-contracts`' `TASK_ENDPOINT_PATH`) without producing a doubled or missing slash. */
export function buildTaskUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${TASK_ENDPOINT_PATH}`;
}

/**
 * The protocol itself, factored out of the class below so it can be called
 * directly in tests without constructing an object first. POSTs `request` as
 * the frozen envelope, with the configured bearer token, and returns the
 * parsed JSON body of whatever came back — 2xx or not. Throws only when
 * `httpRequest` itself rejects (network failure) or the body text is not
 * valid JSON.
 */
export async function sendWorkerTask(
  httpRequest: HttpRequestFn,
  config: WorkerConfig,
  request: WorkerTaskRequest,
): Promise<unknown> {
  let response: HttpResponseLike;
  try {
    response = await httpRequest({
      url: buildTaskUrl(config.baseUrl),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(request),
    });
  } catch {
    // Deliberately does not include the caught error in the message: a
    // network-layer error can carry the request URL (which is fine) but on
    // some platforms also headers or body fragments, and this class must
    // never be the reason a token or her content reaches a log a caller
    // writes from this message.
    throw new WorkerTransportError(
      'olea: could not reach the Worker. Check the base URL and your connection.',
    );
  }

  try {
    return JSON.parse(response.text);
  } catch {
    throw new WorkerTransportError('olea: the Worker response was not valid JSON.');
  }
}

/**
 * The `WorkerTaskTransport` implementation itself — a thin, stateful wrapper
 * around `sendWorkerTask` that closes over the HTTP primitive and the
 * configured base URL/token so callers only ever hand it a task envelope.
 */
export class WorkerHttpTransport implements WorkerTaskTransport {
  constructor(
    private readonly httpRequest: HttpRequestFn,
    private readonly config: WorkerConfig,
  ) {}

  send(request: WorkerTaskRequest): Promise<unknown> {
    return sendWorkerTask(this.httpRequest, this.config, request);
  }
}
