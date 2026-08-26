/**
 * Shared types for F7.4 (export + full delete, `ol-p6t01`).
 *
 * Two narrow ports this feature needs and the rest of the plugin does not
 * yet provide:
 *
 * - `ObsidianDataHost` — the same `{ loadData, saveData }` slice every other
 *   `data.json`-backed store in this plugin already depends on
 *   (`plan/store.ts`, `ingestion/queue-store.ts`, etc.). Redeclared locally
 *   rather than imported, following the exact precedent those files set in
 *   their own module docs: each persistence port names what it needs from
 *   `Plugin` on its own, with no coupling between features.
 * - `VaultDeletePort` — new. `olea-core`'s `VaultSource` (`vault/types.ts`)
 *   has no `delete` method at all — confirmed by reading it end to end
 *   while researching this bead. Every other feature in this plugin only
 *   ever reads and writes vault files; F7.4 is the first that needs to
 *   remove one. Adding `delete` to `VaultSource` itself would touch a file
 *   `ol-p6t01` does not own (`packages/core/src/vault/types.ts`) and would
 *   force every implementation across the workspace (`FolderSource`,
 *   `ObsidianSource`, every test fake) to grow a method overnight — exactly
 *   the concern `VaultSource`'s own doc raises about `firstSeen`. So this
 *   bead defines the narrowest possible port here instead, wires an
 *   Obsidian-native implementation in `obsidian-adapters.ts` (bypassing
 *   `ObsidianSource` entirely, via `app.vault.adapter.remove`), and flags
 *   promoting `delete` onto `VaultSource` proper as follow-on work in this
 *   bead's report — a two-line addition once a lane owns that file.
 */

import type { VaultPath } from 'olea-core';

/** The `{ loadData, saveData }` slice of Obsidian's `Plugin` this feature needs. */
export interface ObsidianDataHost {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

/**
 * Deletes one vault-relative path. A no-op (never a throw) when the path
 * does not exist — every caller in this feature already checks `exists()`
 * or works from a listing it trusts, but a defensive no-op here means a
 * double-delete (e.g. a retried purge) is still safe.
 */
export interface VaultDeletePort {
  delete(path: VaultPath): Promise<void>;
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
