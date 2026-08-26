/**
 * The real, production port F7.4 needs that only exists inside a live
 * Obsidian host — `server-config-delete.ts`'s `DeleteHttpRequestFn`.
 *
 * **No test file, deliberately** — same reasoning `worker/obsidian-transport.ts`
 * and `vault/obsidian-source.ts` both give: `obsidian`'s own `package.json`
 * has `main: ""` (types only, no runtime), so any module importing it
 * cannot load under Vitest at all. Kept to exactly one adapter function,
 * with every byte of actual logic living in `cache-purge.ts`,
 * `vault-artifact-delete.ts` and `server-config-delete.ts` instead — there
 * is nothing here a test could usefully catch that those files' own tests
 * do not already cover against a fake of this same shape.
 *
 * **`createObsidianVaultDeletePort` (F7.4's `VaultDeletePort` adapter over
 * `app.vault.adapter.remove`) is gone (`ol-ppxj.15`).** `delete` is now a
 * method on `vault/obsidian-source.ts`'s `ObsidianSource` itself, over the
 * identical `vault.adapter.remove` call — see that class's own doc for why
 * it bypasses the `TFile`-based API. Privacy code no longer constructs a
 * delete adapter separately from the `VaultSource` it already receives.
 */

import { requestUrl } from 'obsidian';
import type { DeleteHttpRequestFn } from './types.js';

/** The real `DeleteHttpRequestFn` (F7.4, `ol-p6t01`) over `requestUrl` (C1.6, INV-1) — same reasoning as `worker/obsidian-transport.ts`'s `obsidianHttpRequest`: `requestUrl` runs outside the renderer's CORS restrictions. */
export const obsidianDeleteHttpRequest: DeleteHttpRequestFn = async ({ url, headers }) => {
  const response = await requestUrl({ url, method: 'DELETE', headers, throw: false });
  return { status: response.status };
};
