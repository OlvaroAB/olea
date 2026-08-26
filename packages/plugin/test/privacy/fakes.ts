/**
 * Shared, obsidian-free test fakes for `packages/plugin/test/privacy/*`.
 * Not a `.spec.ts` file, so vitest never collects it as its own suite
 * (`vitest.config.ts`'s `include` is `test/**\/*.spec.ts`).
 *
 * Deliberately its own copy rather than importing
 * `test/generation/fakes.ts`'s `MemoryVaultSource` — that file sits outside
 * `ol-ppxj.15`'s owned paths (`test/privacy/` only), and a test fake's
 * `delete` method is exactly the kind of change that belongs inside owned
 * paths, not bolted onto a file another lane may be editing concurrently.
 *
 * `delete` here implements `VaultSource.delete` directly (`ol-ppxj.15`
 * promoted it there from F7.4's now-removed narrow `VaultDeletePort`) — a
 * real delete needs nothing more than removing the map entry.
 */
import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import type { ObsidianDataHost } from '../../src/privacy/types.js';

/** A full read/write/delete in-memory `VaultSource`, text-only (no binary needed anywhere in `privacy/`). */
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

  /** `VaultSource.delete` — a no-op, never a throw, on an already-absent path. */
  async delete(path: VaultPath): Promise<void> {
    this.files.delete(path);
  }

  watch(_handler: (event: VaultEvent) => void): Unsubscribe {
    return () => {};
  }

  /** Test-only inspection, not part of `VaultSource`. */
  raw(path: VaultPath): string | undefined {
    return this.files.get(path);
  }

  /** Test-only inspection: every path currently held, sorted. */
  paths(): readonly VaultPath[] {
    return [...this.files.keys()].sort();
  }
}

/** Stands in for a real `Plugin`'s `loadData`/`saveData`, backed by an in-memory blob exactly as Obsidian persists one `data.json` per plugin. */
export class FakeDataHost implements ObsidianDataHost {
  blob: unknown = null;

  async loadData(): Promise<unknown> {
    return this.blob;
  }

  async saveData(data: unknown): Promise<void> {
    this.blob = data;
  }
}
