/**
 * `MemoryVaultSource` — `VaultSource` over a byte map, for the browser.
 *
 * The third implementation of core's storage boundary, after `FolderSource`
 * (node:fs, tests/CLI) and `ObsidianSource` (the plugin). It exists because the
 * workbench runs in a browser where neither of the other two can: A2.1's claim
 * is that core needs nothing but this interface, and a working browser
 * implementation is that claim being exercised rather than asserted.
 *
 * **Byte-exactness is the whole contract.** `read` must return line endings, BOM
 * and trailing-newline-or-not verbatim (INV-2 is defined over what this returns),
 * so content is stored as bytes and decoded with `ignoreBOM: true` — the default
 * `TextDecoder` silently swallows a leading U+FEFF, which would break the
 * round-trip before the parser ever saw the file.
 *
 * Writes land in memory and are gone on reload. That is correct for a workbench:
 * nothing here should be able to modify the fixture vault on disk.
 */

import type { ListOptions, Unsubscribe, VaultEvent, VaultPath, VaultSource } from 'olea-core';
import { isVaultPath } from 'olea-core';

function extensionOf(path: VaultPath): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

export class MemoryVaultSource implements VaultSource {
  private readonly files: Map<VaultPath, Uint8Array>;
  private readonly watchers = new Set<(event: VaultEvent) => void>();
  private readonly decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: false });
  private readonly encoder = new TextEncoder();

  private constructor(files: Map<VaultPath, Uint8Array>) {
    this.files = files;
  }

  /**
   * Builds from raw bytes keyed by vault-relative path.
   *
   * Bytes, never a pre-decoded string and never an encoded blob: the former loses
   * byte-exactness and the latter takes the corpus out of reach of every INV-3
   * plaintext control. See `fixture-vault.ts` for that argument in full.
   */
  static fromBytes(entries: ReadonlyMap<string, Uint8Array>): MemoryVaultSource {
    const files = new Map<VaultPath, Uint8Array>();
    for (const [path, bytes] of entries) {
      if (!isVaultPath(path)) {
        throw new Error(`MemoryVaultSource: not a valid vault path: ${JSON.stringify(path)}`);
      }
      files.set(path, bytes);
    }
    return new MemoryVaultSource(files);
  }

  private require(path: VaultPath): Uint8Array {
    const bytes = this.files.get(path);
    if (bytes === undefined) {
      throw new Error(`MemoryVaultSource: no such file: ${JSON.stringify(path)}`);
    }
    return bytes;
  }

  list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const under = options.under;
    const extensions = options.extensions?.map((ext) => ext.toLowerCase());
    const prefix = under === undefined || under === '' ? null : `${under.replace(/\/$/, '')}/`;

    const result = [...this.files.keys()]
      .filter((path) => prefix === null || path.startsWith(prefix))
      .filter((path) => {
        if (extensions === undefined) return true;
        const ext = extensionOf(path);
        return ext !== undefined && extensions.includes(ext);
      })
      .sort();
    return Promise.resolve(result);
  }

  read(path: VaultPath): Promise<string> {
    return Promise.resolve(this.decoder.decode(this.require(path)));
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return Promise.resolve(this.require(path).slice());
  }

  write(path: VaultPath, content: string): Promise<void> {
    if (!isVaultPath(path)) {
      throw new Error(`MemoryVaultSource: not a valid vault path: ${JSON.stringify(path)}`);
    }
    const existed = this.files.has(path);
    this.files.set(path, this.encoder.encode(content));
    this.emit({ kind: existed ? 'modify' : 'create', path });
    return Promise.resolve();
  }

  exists(path: VaultPath): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    this.watchers.add(handler);
    return () => {
      this.watchers.delete(handler);
    };
  }

  private emit(event: VaultEvent): void {
    for (const handler of this.watchers) handler(event);
  }
}
