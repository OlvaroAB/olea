/**
 * `deleteServerConfigRecord` — F7.4's server-side leg (`ol-p6t01`): calls
 * the Worker's `DELETE /v1/config` route (olea-service's own `ol-p6t01`
 * half) to purge the one per-user server-side record the Worker holds
 * (D-005, C6.4). See `../worker/transport.ts`'s module doc for the sibling
 * pattern this follows: all protocol reasoning lives here, obsidian-free
 * and unit-testable under plain Vitest, and `obsidian-adapters.ts` supplies
 * the one real HTTP primitive over `requestUrl` — this file never imports
 * `obsidian` itself (INV-1).
 *
 * **Not `worker/transport.ts`'s `HttpRequestFn`.** That type's `method`
 * field is a `'POST'`-only literal built for `POST /v1/task`, and that file
 * sits outside this bead's owned paths (`ol-p6t01` owns `privacy/` only).
 * `DeleteHttpRequestFn` (`./types.ts`) is this feature's own, smaller port.
 *
 * The endpoint path is a literal here (`/v1/config`) rather than a shared
 * `olea-contracts` constant like `TASK_ENDPOINT_PATH` — `packages/contracts`
 * is outside this bead's owned paths too. Promoting it to a named constant
 * there, alongside `TASK_ENDPOINT_PATH`, is flagged as an easy follow-on in
 * this bead's report.
 */

import type { WorkerConfig } from '../worker/transport.js';
import type { DeleteHttpRequestFn } from './types.js';

export type ServerConfigDeleteOutcome =
  | { readonly outcome: 'deleted' }
  /** The token was already invalid/unknown — same client-visible shape as never having been valid (see `src/index.ts`'s `DELETE /v1/config` module doc in olea-service: a second delete is idempotent and reads this way). */
  | { readonly outcome: 'unauthenticated' }
  /** The transport itself failed (network, non-2xx the caller cannot otherwise classify) — degrades to a message, never an uncaught throw, matching `testWorkerConnection`'s posture. */
  | { readonly outcome: 'unreachable' };

/**
 * Calls `DELETE /v1/config` with the configured bearer token. Never throws:
 * a transport-level failure (the injected `httpRequest` rejecting) resolves
 * to `{ outcome: 'unreachable' }` rather than propagating into settings UI,
 * the same posture `worker/test-connection.ts`'s `testWorkerConnection`
 * takes for the same reason.
 */
export async function deleteServerConfigRecord(
  config: WorkerConfig,
  httpRequest: DeleteHttpRequestFn,
): Promise<ServerConfigDeleteOutcome> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/v1/config`;
  try {
    const response = await httpRequest({
      url,
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (response.status === 200) return { outcome: 'deleted' };
    if (response.status === 401) return { outcome: 'unauthenticated' };
    return { outcome: 'unreachable' };
  } catch {
    return { outcome: 'unreachable' };
  }
}
