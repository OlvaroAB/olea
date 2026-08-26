/**
 * Shared types for F7.4 (export + full delete, `ol-p6t01`).
 *
 * - `ObsidianDataHost` — the same `{ loadData, saveData }` slice every other
 *   `data.json`-backed store in this plugin already depends on
 *   (`plan/store.ts`, `ingestion/queue-store.ts`, etc.). Redeclared locally
 *   rather than imported, following the exact precedent those files set in
 *   their own module docs: each persistence port names what it needs from
 *   `Plugin` on its own, with no coupling between features.
 *
 * **`VaultDeletePort` is gone (`ol-ppxj.15`).** F7.4 originally defined it
 * here because `olea-core`'s `VaultSource` had no `delete` method at all,
 * and adding one would have touched a file that bead did not own and forced
 * every `VaultSource` implementation across the workspace to grow a method
 * overnight. `ol-ppxj.15` did exactly that promotion — `delete` is now an
 * **optional** method on `VaultSource` itself (`packages/core/src/vault/
 * types.ts`), the same optionality shape as `firstSeen`, so implementations
 * that never need it (read-only fixtures, structural test fakes) are
 * unaffected. Every real backing store this plugin ships against
 * (`ObsidianSource`, `FolderSource`) implements it. `deleteVaultPath` below
 * is the thin adapter this file keeps instead of the old port: it exists
 * only to turn "the injected `VaultSource` happens not to implement delete"
 * into a clear thrown error rather than `undefined is not a function`,
 * since privacy's deletion flows need a guaranteed delete and TypeScript
 * cannot promise one from an optional method.
 */

import type { VaultPath, VaultSource } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this feature needs. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * Deletes one vault-relative path through `vault.delete`, failing loudly if
 * the injected `VaultSource` does not implement it (see the module doc
 * above — this should never fire against a real `ObsidianSource` or
 * `FolderSource`, only against a misconfigured or intentionally read-only
 * fake). A no-op (never a throw), same as `VaultSource.delete`'s own
 * contract, when the path does not exist — every caller in this feature
 * already checks `exists()` or works from a listing it trusts, but a
 * defensive no-op here means a double-delete (e.g. a retried purge) is
 * still safe.
 */
export async function deleteVaultPath(vault: VaultSource, path: VaultPath): Promise<void> {
  if (vault.delete === undefined) {
    throw new Error(`VaultSource.delete is required for privacy deletion flows (path: ${path})`);
  }
  await vault.delete(path);
}

/**
 * The minimal HTTP primitive `server-config-delete.ts` needs. Deliberately
 * not `worker/transport.ts`'s `HttpRequestFn` — that type's `method` field
 * is a `'POST'` literal (it exists solely for `POST /v1/task`), and that
 * file sits outside this bead's owned paths. A DELETE call needs no request
 * body and this feature only ever cares about the response status, so the
 * shape stays deliberately smaller than a general-purpose HTTP port.
 */
export type DeleteHttpRequestFn = (params: {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}) => Promise<{ readonly status: number }>;
