/**
 * `listUnderViaAdapter` (`ol-2zfj.44`) — the pure walk `ObsidianSource.listUnder`
 * runs over Obsidian's raw `vault.adapter` surface, factored out into its own
 * `obsidian`-free module so it can be unit-tested with a fake.
 * `obsidian-source.ts` cannot itself be imported under vitest (no runtime
 * `obsidian` package to resolve outside a real Obsidian host — see that
 * file's own module doc), so the algorithm lives here against a narrow
 * structural type (`DotFolderAdapter`) shaped exactly like the two
 * `DataAdapter` methods it needs, and `ObsidianSource` is a thin caller.
 */

import { isVaultPath, type VaultPath } from 'olea-core';

/** The narrow slice of Obsidian's `DataAdapter` this walk needs — shaped to match, not imported from, `obsidian` (see this module's doc). */
export interface DotFolderAdapter {
  exists(normalizedPath: string): Promise<boolean>;
  list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
}

/**
 * Enumerate a caller-named DOT-PREFIXED subtree — the `ObsidianSource` half
 * of the gap `ol-yk1c` (C5.2a) and `FolderSource.listUnder` (`ol-df19`,
 * DF-19) both name. `Vault.getFiles()` — what `ObsidianSource.list()` is
 * built on — never returns dot-prefixed paths at all, a real Obsidian host
 * limitation rather than a choice this file makes, so `list({ under:
 * '.olea/...' })` always came back empty on a real vault regardless of what
 * was actually on disk. This walks the adapter directly from `dotPath` as
 * the walk's root, so `.olea` is never "seen" as an entry to skip — it is
 * simply where the walk starts.
 *
 * Matches `FolderSource.listUnder`'s contract exactly: `dotPath` must be
 * dot-prefixed (guards against accidental use on an ordinary folder — plain
 * subtree restriction is `list({ under })`'s job); a dot-entry nested
 * *inside* `dotPath` is still skipped, so this cannot smuggle `.obsidian/`
 * or `.trash/` content out through some deeper path; a missing subtree
 * returns `[]` rather than throwing; results come back in stable sorted
 * order.
 */
export async function listUnderViaAdapter(
  adapter: DotFolderAdapter,
  dotPath: VaultPath,
  options: { readonly extensions?: readonly string[] } = {},
): Promise<readonly VaultPath[]> {
  const firstSegment = dotPath.split('/')[0];
  if (firstSegment === undefined || !firstSegment.startsWith('.')) {
    throw new Error(
      `listUnderViaAdapter: expected a dot-prefixed path (e.g. '.olea/reviews'), got: ${JSON.stringify(dotPath)}`,
    );
  }
  if (!(await adapter.exists(dotPath))) return [];

  const extensions = options.extensions?.map((ext) => ext.toLowerCase());
  const results: VaultPath[] = [];
  await walk(adapter, dotPath, extensions, results);
  return results.sort();
}

async function walk(
  adapter: DotFolderAdapter,
  dir: string,
  extensions: readonly string[] | undefined,
  acc: VaultPath[],
): Promise<void> {
  let listed: { files: string[]; folders: string[] };
  try {
    listed = await adapter.list(dir);
  } catch {
    // A subtree that doesn't exist (or was removed mid-walk) -> empty,
    // matching `FolderSource.listUnder`'s ENOENT-is-empty behaviour.
    return;
  }
  for (const filePath of listed.files) {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    if (name.startsWith('.')) continue;
    if (extensions !== undefined) {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
      if (ext === undefined || !extensions.includes(ext)) continue;
    }
    if (!isVaultPath(filePath)) continue;
    acc.push(filePath);
  }
  for (const folderPath of listed.folders) {
    const name = folderPath.slice(folderPath.lastIndexOf('/') + 1);
    if (name.startsWith('.')) continue;
    await walk(adapter, folderPath, extensions, acc);
  }
}
