/**
 * Wires `rank-weights-provider.ts`'s obsidian-free `RankWeightsHttpGet` to
 * Obsidian's real `requestUrl` (C1.6, INV-1) — the GET-shaped twin of
 * `worker/obsidian-transport.ts`'s `obsidianHttpRequest`, for exactly the
 * same reason: `requestUrl` runs outside the renderer's CORS restrictions.
 *
 * **No test file, deliberately** — same reasoning as
 * `worker/obsidian-transport.ts`: `obsidian` ships types only, no runtime,
 * so anything importing it cannot load under Vitest. This file is kept to
 * one adapter function with all the protocol reasoning living in
 * `rank-weights-provider.ts`, so there is nothing here a test could catch
 * that isn't already covered by that file's own suite.
 *
 * `throw: false` for the same reason `obsidianHttpRequest` sets it:
 * Obsidian's default throws on any non-2xx status, and
 * `fetchRankWeightsOptions` needs the response back as a value (to
 * distinguish "unreadable envelope" from "unauthenticated") rather than as
 * an exception.
 */

import { requestUrl } from 'obsidian';
import type { RankWeightsHttpGet } from './rank-weights-provider.js';

/** `RankWeightsHttpGet` over Obsidian's `requestUrl`. */
export const obsidianRankWeightsGet: RankWeightsHttpGet = async ({ url, headers }) => {
  const response = await requestUrl({ url, method: 'GET', headers, throw: false });
  return { status: response.status, text: response.text };
};
