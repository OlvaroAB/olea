/**
 * Wires `transport.ts`'s obsidian-free `WorkerHttpTransport` to Obsidian's
 * real `requestUrl` (C1.6, INV-1) — `requestUrl` rather than `fetch` because
 * it runs outside the renderer's CORS restrictions, which is exactly why
 * `olea-core`'s `retrieval/workerProvider.ts` leaves the HTTP call to an
 * injected transport instead of doing it itself: "the plugin supplies one
 * over `requestUrl`" (see that file and `packages/core/src/index.ts`).
 *
 * **No test file, deliberately.** `obsidian`'s own `package.json` has
 * `main: ""` — it ships types only, no runtime — so any module that imports
 * it cannot be loaded under Vitest at all, the same constraint
 * `vault/obsidian-source.ts` and `review/obsidian-ports.ts` document for the
 * identical reason. Keeping this file to exactly one adapter function, with
 * every byte of protocol reasoning living in `transport.ts` instead, is what
 * makes that acceptable: there is nothing here to get wrong that a test
 * could have caught, because there is nothing here but a shape conversion.
 *
 * `throw: false` is required, not optional. Obsidian's default is to throw
 * on any non-2xx status; `WorkerTaskTransport`'s contract requires a non-2xx
 * body to come back as a *value* the caller can inspect for its error code,
 * never as a throw (see `transport.ts`'s module doc). Passing `throw: false`
 * is the one line that keeps this adapter honest to that contract.
 */

import { requestUrl } from 'obsidian';
import type { HttpRequestFn, WorkerConfig } from './transport.js';
import { WorkerHttpTransport } from './transport.js';

/** `HttpRequestFn` over Obsidian's `requestUrl`. */
export const obsidianHttpRequest: HttpRequestFn = async ({ url, method, headers, body }) => {
  const response = await requestUrl({ url, method, headers, body, throw: false });
  return { status: response.status, text: response.text };
};

/**
 * The real, production `WorkerTaskTransport` — base URL and token in,
 * `requestUrl` underneath. `onCallRecorded` is the F7.3 usage hook,
 * widened for `[D-123]` (`ol-ppxj.18`); this signature is a pure
 * pass-through of `transport.ts`'s — see that file for what each field
 * means and why every usage figure is optional and never defaulted to `0`.
 */
export function createObsidianWorkerTransport(
  config: WorkerConfig,
  onCallRecorded?: (entry: {
    taskId: string;
    promptVersion: string;
    modelId: string;
    inputTokens?: number;
    inputTokensSource?: 'reported' | 'derived' | 'unreported';
    cachedInputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    latencyMs?: number;
  }) => void,
): WorkerHttpTransport {
  return new WorkerHttpTransport(obsidianHttpRequest, config, onCallRecorded);
}
