/**
 * The Obsidian implementation of `ResolvedLinksPort` (`ol-egov.141.89.8.57`): a thin read of the
 * metadata cache's resolved links, taken fresh on every call. `resolvedLinks` maps each file to the
 * files its links and embeds resolve to (unresolved links are not in it); nothing is cached here.
 */

import type { VaultPath } from 'olea-core';
import type { ResolvedLinksPort } from './lecture-links.js';

/** The slice of Obsidian's `MetadataCache` this reads (structural, so tests need no `obsidian`). */
export interface MetadataCacheLike {
  /** Optional only because the workbench's reduced shim has no link graph; absent reads as no links. Obsidian always supplies it. */
  readonly resolvedLinks?: Record<string, Record<string, number>>;
  getCache(path: string): { frontmatter?: Record<string, unknown> } | null;
}

export function createObsidianResolvedLinksPort(cache: MetadataCacheLike): ResolvedLinksPort {
  return {
    resolvedLinks: () =>
      new Map(
        Object.entries(cache.resolvedLinks ?? {}).map(([source, targets]) => [
          source as VaultPath,
          Object.keys(targets) as VaultPath[],
        ]),
      ),
    frontmatterFor: (path) => cache.getCache(path)?.frontmatter,
  };
}
