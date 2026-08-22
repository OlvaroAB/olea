/**
 * `ObsidianSource` — `VaultSource` over Obsidian's `Vault` API (P1-T03, A2.1,
 * A2.2). This file, together with `main.ts`, is the only place in the whole
 * monorepo permitted to import `obsidian` — see INV-1, `scripts/check-inv1.mjs`,
 * and `biome.json`'s `noRestrictedImports` override for `packages/core` and
 * `packages/contracts`.
 *
 * It cannot be unit-tested without a real Obsidian host, so there is no test
 * file here and none is expected (P1-T03 acceptance: "`ObsidianSource`
 * compiles in plugin"). Correctness for this class is exercised manually
 * against a real vault, and indirectly by `FolderSource`'s tests exercising
 * the shared `VaultSource` contract this class also implements.
 */

import { type App, TFile, type Vault } from 'obsidian';
import {
  isVaultPath,
  type ListOptions,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from 'olea-core';

export class ObsidianSource implements VaultSource {
  private readonly vault: Vault;

  constructor(app: App) {
    this.vault = app.vault;
  }

  private getFile(path: VaultPath): TFile {
    if (!isVaultPath(path)) {
      throw new Error(`ObsidianSource: not a valid vault path: ${JSON.stringify(path)}`);
    }
    const file = this.vault.getFileByPath(path);
    if (file === null) {
      throw new Error(`ObsidianSource: no such file: ${path}`);
    }
    return file;
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    if (options.under !== undefined && !isVaultPath(options.under)) {
      throw new Error(`ObsidianSource.list: invalid 'under' path: ${options.under}`);
    }
    const under = options.under;
    const extensions = options.extensions?.map((ext) => ext.toLowerCase());

    const paths = this.vault
      .getFiles()
      .map((file) => file.path)
      .filter((path) =>
        under === undefined ? true : path === under || path.startsWith(`${under}/`),
      )
      .filter((path) => {
        if (extensions === undefined) return true;
        const dot = path.lastIndexOf('.');
        const ext = dot > 0 ? path.slice(dot + 1).toLowerCase() : undefined;
        return ext !== undefined && extensions.includes(ext);
      });

    // `VaultSource.list` promises a stable, sorted order regardless of what
    // order `getFiles()` happens to enumerate in.
    return paths.sort();
  }

  async read(path: VaultPath): Promise<string> {
    const file = this.getFile(path);
    // `vault.read`, not `vault.cachedRead`: this result feeds the
    // read-modify-write round trip (INV-2), and `cachedRead` is documented as
    // "use this if you only want to display the content to the user" — it
    // may serve a stale in-memory cache. `read` always goes to disk, which is
    // the only source of truth a round-trip can be checked against.
    return this.vault.read(file);
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const file = this.getFile(path);
    const buffer = await this.vault.readBinary(file);
    return new Uint8Array(buffer);
  }

  async write(path: VaultPath, content: string): Promise<void> {
    if (!isVaultPath(path)) {
      throw new Error(`ObsidianSource.write: not a valid vault path: ${JSON.stringify(path)}`);
    }
    const existing = this.vault.getFileByPath(path);
    if (existing !== null) {
      await this.vault.modify(existing, content);
      return;
    }
    await this.ensureParentFolder(path);
    await this.vault.create(path, content);
  }

  private async ensureParentFolder(path: VaultPath): Promise<void> {
    const segments = path.split('/');
    segments.pop(); // drop the file name, keep folder segments only
    let ancestor = '';
    for (const segment of segments) {
      ancestor = ancestor === '' ? segment : `${ancestor}/${segment}`;
      if (this.vault.getFolderByPath(ancestor) !== null) continue;
      try {
        await this.vault.createFolder(ancestor);
      } catch {
        // Lost a race with another writer creating the same folder
        // concurrently — fine, as long as it exists now.
        if (this.vault.getFolderByPath(ancestor) === null)
          throw new Error(`ObsidianSource: could not create folder: ${ancestor}`);
      }
    }
  }

  async exists(path: VaultPath): Promise<boolean> {
    if (!isVaultPath(path)) return false;
    return this.vault.getFileByPath(path) !== null;
  }

  /**
   * Subscribes to the vault's own `create` | `modify` | `delete` | `rename`
   * events (C1.5) and maps them onto `VaultEvent`, forwarding only file
   * events (folder create/modify/delete/rename are not part of this
   * contract's surface). `rename`'s `oldPath` argument maps directly onto
   * `VaultEvent.oldPath`, which is the one case Obsidian gives us that
   * `FolderSource` cannot (`node:fs.watch` never reports the old name).
   */
  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    const refs = [
      this.vault.on('create', (file) => {
        if (file instanceof TFile) handler({ kind: 'create', path: file.path });
      }),
      this.vault.on('modify', (file) => {
        if (file instanceof TFile) handler({ kind: 'modify', path: file.path });
      }),
      this.vault.on('delete', (file) => {
        if (file instanceof TFile) handler({ kind: 'delete', path: file.path });
      }),
      this.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) handler({ kind: 'rename', path: file.path, oldPath });
      }),
    ];

    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      for (const ref of refs) this.vault.offref(ref);
    };
  }
}
