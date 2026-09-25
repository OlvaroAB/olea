/**
 * Wires `depth-gate-provider.ts`'s obsidian-free `DepthGateHttpGet` to
 * Obsidian's real `requestUrl` (C1.6, INV-1) — the depth-gate twin of
 * `rank/obsidian-rank-weights-transport.ts`'s `obsidianRankWeightsGet`, for
 * exactly the same reason: `requestUrl` runs outside the renderer's CORS
 * restrictions.
 *
 * **No test file, deliberately** — same reasoning as
 * `rank/obsidian-rank-weights-transport.ts` and `worker/obsidian-transport.ts`:
 * `obsidian` ships types only, no runtime, so anything importing it cannot
 * load under Vitest. This file is kept to one adapter function with all the
 * protocol reasoning living in `depth-gate-provider.ts`, so there is nothing
 * here a test could catch that isn't already covered by that file's own
 * suite.
 *
 * `throw: false` for the same reason `obsidianRankWeightsGet` sets it:
 * Obsidian's default throws on any non-2xx status, and
 * `fetchDepthGateOptions` needs the response back as a value (to
 * distinguish "unreadable envelope" from "unauthenticated") rather than as
 * an exception.
 */

import { requestUrl } from 'obsidian';
import type { DepthGateHttpGet } from './depth-gate-provider.js';

/** `DepthGateHttpGet` over Obsidian's `requestUrl`. */
export const obsidianDepthGateGet: DepthGateHttpGet = async ({ url, headers }) => {
  const response = await requestUrl({ url, method: 'GET', headers, throw: false });
  return { status: response.status, text: response.text };
};
