/**
 * `withExtraFile` — a read-only overlay that adds exactly ONE new path over
 * `base`, byte for byte otherwise. The additive half of `../oracle/
 * fixture-oracle-vault.ts`'s `EXTRA_FILES` convention, pulled out on its own
 * so a state that needs to hand the real, unmodified `olea-core` pipeline a
 * note that genuinely does not exist in `packages/core/fixtures/vault/` (an
 * evidence-based scan like `discoverScheduleEvents` — RHY-3, `[D-068]` — has
 * nowhere else to find one) does not have to hand-roll a whole `VaultSource`
 * class to do it.
 *
 * Deliberately narrow, same posture as `require-replace.ts`'s
 * `requireReplace`: one path, one content string, `write`/`delete` throw.
 * A caller needing more than one extra path or an edit to an existing one
 * should compose two overlays (`withExtraFile(withExtraFile(base, ...), ...)`)
 * or reach for `fixture-oracle-vault.ts`'s fuller `EXTRA_FILES`/
 * `OVERRIDDEN_FILES` shape instead of growing this one past its single job.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';

function extensionOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

/** Same matching rules `FolderSource`/`MemoryVaultSource` apply to their own listings — the extra path must obey the same `under`/`extensions` filters a real file would. */
function matchesListOptions(path: string, options: ListOptions): boolean {
  const under = options.under;
  if (under !== undefined && under !== '') {
    const prefix = `${under.replace(/\/$/, '')}/`;
    if (!path.startsWith(prefix)) return false;
  }
  if (options.extensions !== undefined) {
    const ext = extensionOf(path);
    const allowed = options.extensions.map((e) => e.toLowerCase());
    if (ext === undefined || !allowed.includes(ext)) return false;
  }
  return true;
}

class SingleFileOverlay implements VaultSource {
  constructor(
    private readonly base: VaultSource,
    private readonly extraPath: VaultPath,
    private readonly extraContent: string,
  ) {}

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const baseList = await this.base.list(options);
    if (!matchesListOptions(this.extraPath, options)) return baseList;
    return [...new Set([...baseList, this.extraPath])].sort();
  }

  async read(path: VaultPath): Promise<string> {
    if (path === this.extraPath) return this.extraContent;
    return this.base.read(path);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    if (path === this.extraPath) return new TextEncoder().encode(this.extraContent);
    return this.base.readBinary(path);
  }

  async exists(path: VaultPath): Promise<boolean> {
    if (path === this.extraPath) return true;
    return this.base.exists(path);
  }

  write(): Promise<void> {
    throw new Error('SingleFileOverlay: read-only, never written to');
  }

  delete(): Promise<void> {
    throw new Error('SingleFileOverlay: read-only, never written to');
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    return this.base.watch(handler);
  }
}

/** Wraps `base` so `path` reads as `content`, additively — every other path is `base`, unchanged. */
export function withExtraFile(base: VaultSource, path: VaultPath, content: string): VaultSource {
  return new SingleFileOverlay(base, path, content);
}
