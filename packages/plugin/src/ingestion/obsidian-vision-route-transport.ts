/**
 * Wires `vision-route-provider.ts`'s obsidian-free `VisionRouteHttpGet` to
 * Obsidian's real `requestUrl` (C1.6, INV-1) — the GET-shaped twin of
 * `worker/obsidian-transport.ts`'s `obsidianHttpRequest`, mirroring
 * `rank/obsidian-rank-weights-transport.ts` and
 * `depth-gate/obsidian-depth-gate-transport.ts` exactly: `requestUrl` runs
 * outside the renderer's CORS restrictions.
 *
 * **No test file, deliberately** — same reasoning both mirrored files give:
 * `obsidian` ships types only, no runtime, so anything importing it cannot
 * load under Vitest. This file is kept to one adapter function with all the
 * protocol reasoning living in `vision-route-provider.ts`, so there is
 * nothing here a test could catch that isn't already covered by that
 * file's own suite.
 *
 * `throw: false` for the same reason `obsidianHttpRequest` sets it:
 * Obsidian's default throws on any non-2xx status, and
 * `fetchVisionRouteOptions` needs the response back as a value (to
 * distinguish "unreadable envelope" from "unauthenticated") rather than as
 * an exception.
 */

import { requestUrl } from 'obsidian';
import type { VisionRouteHttpGet } from './vision-route-provider.js';

/** `VisionRouteHttpGet` over Obsidian's `requestUrl`. */
export const obsidianVisionRouteGet: VisionRouteHttpGet = async ({ url, headers }) => {
  const response = await requestUrl({ url, method: 'GET', headers, throw: false });
  return { status: response.status, text: response.text };
};
