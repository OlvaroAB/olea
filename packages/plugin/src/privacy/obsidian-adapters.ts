/**
 * The real, production ports F7.4 needs that only exist inside a live
 * Obsidian host — `types.ts`'s `VaultDeletePort` and
 * `server-config-delete.ts`'s `DeleteHttpRequestFn`.
 *
 * **No test file, deliberately** — same reasoning `worker/obsidian-transport.ts`
 * and `vault/obsidian-source.ts` both give: `obsidian`'s own `package.json`
 * has `main: ""` (types only, no runtime), so any module importing it
 * cannot load under Vitest at all. Kept to exactly two adapter functions,
 * with every byte of actual logic living in `cache-purge.ts`,
 * `vault-artifact-delete.ts` and `server-config-delete.ts` instead — there
 * is nothing here a test could usefully catch that those files' own tests
 * do not already cover against a fake of this same shape.
 *
 * **`createObsidianVaultDeletePort` bypasses `vault/obsidian-source.ts`'s
 * `ObsidianSource` on purpose**, going straight to `app.vault.adapter.remove`
 * (Obsidian's raw filesystem adapter). `ObsidianSource.list()` — like every
 * `VaultSource` implementation — never enumerates a dot-prefixed folder
 * (`.olea/reviews/`, `.olea/misconceptions/`, `.olea/drafts/` all are), and
 * `VaultSource` has no `delete` method regardless (`types.ts`'s module doc).
 * The adapter's `remove` operates on a raw path with no such restriction,
 * which is exactly what deleting a file the vault layer cannot even list
 * requires.
 */

import type { App } from 'obsidian';
import { requestUrl } from 'obsidian';
import type { VaultPath } from 'olea-core';
import type { DeleteHttpRequestFn, VaultDeletePort } from './types.js';

/** The real `VaultDeletePort` (F7.4, `ol-p6t01`) over `app.vault.adapter.remove`. A no-op, not a throw, when the path is already gone. */
export function createObsidianVaultDeletePort(app: App): VaultDeletePort {
  return {
    async delete(path: VaultPath): Promise<void> {
      if (!(await app.vault.adapter.exists(path))) return;
      await app.vault.adapter.remove(path);
    },
  };
}

/** The real `DeleteHttpRequestFn` (F7.4, `ol-p6t01`) over `requestUrl` (C1.6, INV-1) — same reasoning as `worker/obsidian-transport.ts`'s `obsidianHttpRequest`: `requestUrl` runs outside the renderer's CORS restrictions. */
export const obsidianDeleteHttpRequest: DeleteHttpRequestFn = async ({ url, headers }) => {
  const response = await requestUrl({ url, method: 'DELETE', headers, throw: false });
  return { status: response.status };
};
