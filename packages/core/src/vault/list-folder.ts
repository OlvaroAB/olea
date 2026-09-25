/**
 * `listFolder` (`ol-egov.141.89.10.52`) — the one way a store under `.olea/` lists its own folder.
 *
 * **Why a store cannot just call `vault.list({ under })`.** `ObsidianSource.list()` is built on
 * Obsidian's `vault.getFiles()`, which never returns a dot-prefixed path — on a real host, and in
 * the workbench's Obsidian shim, which reproduces that (`ol-3ux7.64.21`). So
 * `list({ under: '.olea/concepts' })` is always empty there whatever is on disk, and a store that
 * scans its folder to find an existing record never finds one: `resolveConceptKey` minted a fresh
 * key and a fresh file on every extraction pass, breaking `[D-088]`'s conservation property and
 * growing her vault without bound (found by `ol-yr6l`).
 *
 * **The fix pattern already existed, in one place.** `ObsidianSource.listUnder` walks the raw
 * adapter instead of `getFiles()` (`ol-2zfj.44`, `packages/plugin/src/vault/dot-folder-walk.ts`),
 * and `packages/plugin/src/today/data-source.ts` feature-detects it for `.olea/reviews/`. This
 * module is that feature-detect, shared, so every store reads its folder the same way:
 *
 *   - a dot-prefixed folder, on a source that has `listUnder` → `listUnder` (the adapter walk on
 *     `ObsidianSource`; `FolderSource`'s own dot-rooted walk);
 *   - anything else → plain `list({ under })`. That covers a source without `listUnder` (the
 *     workbench's in-memory sources and most test fakes, whose `list` already sees every path),
 *     `FolderSource` (whose `list({ under })` starts its walk AT `under`, so it already sees a dot
 *     folder), and an ordinary, non-dot folder — `listUnder` refuses one by contract, and plain
 *     subtree restriction is `list`'s job.
 *
 * **`listUnder` is feature-detected, not declared on `VaultSource`.** Same duck-typed posture the
 * interface already takes for `delete`/`firstSeen`, and the same guard `today/data-source.ts`
 * uses; promoting it to an optional `VaultSource` member would remove the cast below but is an
 * interface change of its own, not needed for this fix.
 *
 * Errors propagate: a caller that treats a failed listing as "nothing there" (the review-log
 * readers) keeps its own try/catch, exactly as it did around `list`.
 */

import type { VaultPath, VaultSource } from './types.js';

export interface ListFolderOptions {
  /** Restrict by lowercase extension without the dot, e.g. `['json']`. */
  readonly extensions?: readonly string[];
}

/** The `listUnder` capability `ObsidianSource` and `FolderSource` both implement outside the `VaultSource` contract. */
export interface ListUnderCapableVault {
  listUnder(dotPath: VaultPath, options?: ListFolderOptions): Promise<readonly VaultPath[]>;
}

export function hasListUnder(vault: VaultSource): vault is VaultSource & ListUnderCapableVault {
  return typeof (vault as Partial<ListUnderCapableVault>).listUnder === 'function';
}

/** True when the path's first segment is dot-prefixed (`.olea/...`), the rule `listUnder` enforces. */
export function isDotFolder(folder: VaultPath): boolean {
  return folder.split('/')[0]?.startsWith('.') ?? false;
}

/**
 * Every file under `folder`, in the stable sorted order `VaultSource.list` promises, whether or not
 * the host's `list()` can see a dot-prefixed folder. See the module doc for the routing rule.
 */
export async function listFolder(
  vault: VaultSource,
  folder: VaultPath,
  options: ListFolderOptions = {},
): Promise<readonly VaultPath[]> {
  const extensions = options.extensions;
  if (isDotFolder(folder) && hasListUnder(vault)) {
    return vault.listUnder(folder, extensions !== undefined ? { extensions } : {});
  }
  return vault.list(extensions !== undefined ? { under: folder, extensions } : { under: folder });
}
