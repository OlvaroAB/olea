/**
 * Shared, obsidian-free test fakes for `packages/plugin/test/generation/*`.
 * Not a `.spec.ts` file, so vitest never collects it as its own suite
 * (`vitest.config.ts`'s `include` is `test/**\/*.spec.ts`).
 */
import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';

/** A full read/write in-memory `VaultSource`, text-only (no binary needed by anything in `generation/`). */
export class MemoryVaultSource implements VaultSource {
  private readonly files = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const under = options.under;
    const extensions = options.extensions?.map((e) => e.toLowerCase());
    const paths = [...this.files.keys()].filter((p) => {
      if (under !== undefined && !p.startsWith(`${under}/`)) return false;
      if (extensions !== undefined) {
        const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
        if (!extensions.includes(ext)) return false;
      }
      return true;
    });
    return paths.sort();
  }

  async read(path: VaultPath): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`MemoryVaultSource.read: not found: ${path}`);
    return content;
  }

  async readBinary(): Promise<Uint8Array> {
    throw new Error('MemoryVaultSource.readBinary: not needed by these tests');
  }

  async write(path: VaultPath, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.files.has(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }

  /** Test-only inspection, not part of `VaultSource`. */
  raw(path: VaultPath): string | undefined {
    return this.files.get(path);
  }
}
