/**
 * An in-memory `VaultSource` that makes overlapping store operations interleave on purpose, for
 * the write-loss suites (`ol-egov.141.89.104.2`).
 *
 * Reads, `exists`, `list` and `delete` settle within the current macrotask; a `write` lands one
 * macrotask later. So:
 * - two read-modify-writes started together both read the old bytes before either write lands,
 *   which is the interleaving that loses an update when nothing serialises them;
 * - a delete issued after a write overtakes it, which is the interleaving that recreates a record
 *   the delete removed.
 *
 * `list` sees every file, dot folders included (the same shortcut `FolderSource`'s `listUnder`
 * gives a real host), so every store's own listing works against it.
 */

import type {
  ListOptions,
  Unsubscribe,
  VaultEvent,
  VaultPath,
  VaultSource,
} from '../../src/vault/types.js';

function extensionOf(path: VaultPath): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export class OverlapVault implements VaultSource {
  private readonly files = new Map<VaultPath, string>();
  /** Every write that landed, in landing order. */
  readonly landed: { readonly path: VaultPath; readonly content: string }[] = [];

  constructor(initial: Readonly<Record<VaultPath, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    await Promise.resolve();
    const extensions = options.extensions?.map((ext) => ext.toLowerCase());
    return [...this.files.keys()]
      .filter((path) => options.under === undefined || path.startsWith(`${options.under}/`))
      .filter((path) => {
        if (extensions === undefined) return true;
        const ext = extensionOf(path);
        return ext !== undefined && extensions.includes(ext);
      })
      .sort();
  }

  async read(path: VaultPath): Promise<string> {
    await Promise.resolve();
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`OverlapVault: no such file: ${path}`);
    return content;
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(path));
  }

  async exists(path: VaultPath): Promise<boolean> {
    await Promise.resolve();
    return this.files.has(path);
  }

  async write(path: VaultPath, content: string): Promise<void> {
    await nextMacrotask();
    this.files.set(path, content);
    this.landed.push({ path, content });
  }

  async delete(path: VaultPath): Promise<void> {
    await Promise.resolve();
    this.files.delete(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => undefined;
  }

  /** Test-only: the bytes at `path`, or `undefined`. */
  raw(path: VaultPath): string | undefined {
    return this.files.get(path);
  }

  /** Test-only: puts bytes on "disk" directly, bypassing the write delay. */
  seed(path: VaultPath, content: string): void {
    this.files.set(path, content);
  }

  /** Test-only: every path held, sorted. */
  paths(): readonly VaultPath[] {
    return [...this.files.keys()].sort();
  }
}
