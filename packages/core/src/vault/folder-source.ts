/**
 * `FolderSource` — `VaultSource` over `node:fs/promises` (P1-T03, A2.1).
 *
 * This is the implementation core's own tests and any future CLI run against:
 * a plain folder of markdown, no Obsidian host required. It is constructed
 * from an absolute root directory and translates between that root and the
 * vault-relative POSIX paths the `VaultSource` contract speaks.
 *
 * `node:fs` belongs only in this file within `packages/core` — see the
 * package-level note in `../index.ts` and INV-1.
 */

import { watch as fsWatch } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import {
  isVaultPath,
  type ListOptions,
  type Unsubscribe,
  type VaultEvent,
  type VaultPath,
  type VaultSource,
} from './types.js';

function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  // No dot, or a dot only at position 0 (a dotfile with no further extension,
  // e.g. `.gitignore`) — no extension to report.
  if (dot <= 0) return undefined;
  return fileName.slice(dot + 1).toLowerCase();
}

export class FolderSource implements VaultSource {
  private readonly root: string;

  /** `root` must be an absolute path to the vault's directory on disk. */
  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Vault-relative POSIX path -> absolute filesystem path, after validation. */
  private toAbsolute(path: VaultPath): string {
    if (!isVaultPath(path)) {
      throw new Error(`FolderSource: not a valid vault path: ${JSON.stringify(path)}`);
    }
    return resolve(this.root, ...path.split('/'));
  }

  /** Absolute filesystem path -> vault-relative POSIX path. */
  private toVaultPath(absolute: string): VaultPath {
    const rel = relative(this.root, absolute);
    return sep === posix.sep ? rel : rel.split(sep).join(posix.sep);
  }

  async list(options: ListOptions = {}): Promise<readonly VaultPath[]> {
    const startAbsolute = options.under !== undefined ? this.toAbsolute(options.under) : this.root;
    const extensions = options.extensions?.map((ext) => ext.toLowerCase());

    const results: VaultPath[] = [];
    await this.walk(startAbsolute, extensions, results);
    results.sort();
    return results;
  }

  private async walk(
    dir: string,
    extensions: readonly string[] | undefined,
    acc: VaultPath[],
  ): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // `under` naming a subtree that doesn't exist -> an empty list, not a
      // throw; this keeps `list` predictable for callers probing an optional
      // folder.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      // Skip dotfiles/dot-directories (`.obsidian`, `.trash`, …) — never part
      // of the vault's content surface.
      if (entry.name.startsWith('.')) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(absolute, extensions, acc);
      } else if (entry.isFile()) {
        if (extensions !== undefined) {
          const ext = extensionOf(entry.name);
          if (ext === undefined || !extensions.includes(ext)) continue;
        }
        acc.push(this.toVaultPath(absolute));
      }
    }
  }

  async read(path: VaultPath): Promise<string> {
    // Byte-exact per the VaultSource contract: 'utf8' decoding neither
    // strips a leading BOM (it survives as U+FEFF, the first char of the
    // returned string) nor touches line endings or a missing/present
    // trailing newline. Nothing here may normalise any of that — see the
    // interface doc and INV-2.
    return readFile(this.toAbsolute(path), 'utf8');
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    return readFile(this.toAbsolute(path));
  }

  async write(path: VaultPath, content: string): Promise<void> {
    const absolute = this.toAbsolute(path);
    await mkdir(dirname(absolute), { recursive: true });
    // Written exactly as given: no trailing-newline insertion, no line-ending
    // translation. `writeFile` with a plain string and no encoding option
    // writes UTF-8 bytes verbatim, including any BOM character already
    // present in `content`.
    await writeFile(absolute, content, 'utf8');
  }

  async exists(path: VaultPath): Promise<boolean> {
    try {
      await readFile(this.toAbsolute(path));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /**
   * WATCH DECISION: implemented, not a no-op. Uses a real, recursive
   * `node:fs.watch` on the root (verified working on this project's Linux
   * dev/CI platform on Node 22; also supported on macOS and Windows).
   *
   * `node:fs.watch` only ever reports raw `'rename' | 'change'`, so the
   * mapping to `VaultEvent` is necessarily approximate:
   *  - `'change'` -> `'modify'`.
   *  - `'rename'` fires for both creation and deletion (and for a rename,
   *    without telling us the old name), so this resolves the ambiguity by
   *    checking whether the path still exists: present -> `'create'`,
   *    absent -> `'delete'`. True renames are therefore reported as a
   *    delete-then-create pair rather than a single `'rename'` event with
   *    `oldPath`, since `fs.watch` never gives us the old name to populate it
   *    with.
   * This is exactly the kind of coalescing/imprecision the interface doc
   * explicitly permits ("events may be coalesced or delivered late", "never
   * a guarantee"). Consumers must still treat watching as an optimisation
   * over rescanning — C2.4's delete-and-rebuild equivalence test is the real
   * correctness backstop, not this event stream.
   */
  watch(handler: (event: VaultEvent) => void): Unsubscribe {
    let closed = false;
    const watcher = fsWatch(this.root, { recursive: true }, (eventType, filename) => {
      if (closed || filename === null) return;
      const relPath =
        typeof filename === 'string' ? filename.split(sep).join(posix.sep) : String(filename);
      if (relPath.split('/').some((segment) => segment.startsWith('.'))) return;
      if (eventType === 'change') {
        handler({ kind: 'modify', path: relPath });
        return;
      }
      // eventType === 'rename': fs.watch fires this for both creation and
      // deletion (and for renames, without giving us the old name). Resolve
      // ambiguity by checking whether the path still exists.
      readFile(join(this.root, relPath))
        .then(() => handler({ kind: 'create', path: relPath }))
        .catch(() => handler({ kind: 'delete', path: relPath }));
    });

    return () => {
      if (closed) return;
      closed = true;
      watcher.close();
    };
  }
}
