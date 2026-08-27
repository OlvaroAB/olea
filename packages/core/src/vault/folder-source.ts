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
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
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

  /**
   * Enumerate a caller-named DOT-PREFIXED subtree — the escape hatch `list()`
   * deliberately does not provide (`ol-df19`, DF-19).
   *
   * `list()` skips every dotfile/dot-directory it encounters while walking,
   * by design: `.obsidian/` and `.trash/` must never surface as vault
   * content, however deep the recursion goes. That is correct for note
   * discovery and is untouched by this method. But it also means nothing can
   * discover an UNKNOWN file inside a KNOWN dot-directory — `.olea/reviews/
   * *.jsonl` (C5.2) is the worked example: the writer and the per-day reader
   * both address a file by its exact name (`reviewLogPath`), so neither ever
   * needed `list()`, but a caller that must ask "which devices wrote a log
   * today?" *without* already knowing every device id has no reader at all.
   *
   * `listUnder` is that reader. It takes `dotPath` directly as the walk's
   * ROOT rather than reaching it by recursing down from the vault root — so
   * `.olea` is never "seen" as an entry to exclude, it is simply where the
   * walk starts. The exclusion itself is otherwise unchanged: a dot-entry
   * nested *inside* `dotPath` is still skipped exactly as `list()` would skip
   * it (see `walk`'s own check), so this cannot be used to smuggle
   * `.obsidian/` or `.trash/` out through some deeper path — only the one
   * subtree named by `dotPath` is exposed, for the duration of this one call.
   *
   * Deliberately a separate method rather than a `ListOptions` flag on
   * `list()`: a flag every caller of the one general-purpose method can flip
   * widens what a reader has to hold in mind about the *default* surface.
   * Keeping this on its own, dot-gated name means a reader of a call site
   * sees the intent (`listUnder('.olea/reviews')`) without having to also
   * audit every other `list()` call in the codebase for an accidentally-set
   * flag. `dotPath` is required to start with a dot precisely so this cannot
   * be reached for an ordinary folder by mistake — plain subtree restriction
   * is `list({ under })`'s job, unchanged.
   *
   * **Not part of the `VaultSource` contract.** `ObsidianSource`'s
   * `vault.getFiles()` never returns dot-prefixed paths at all (a real host
   * limitation, not a choice this file makes), so this capability is
   * necessarily `FolderSource`-specific for now — see `ol-yk1c` (C5.2a) for
   * the open question of whether/how `ObsidianSource` grows an equivalent.
   */
  async listUnder(
    dotPath: VaultPath,
    options: { readonly extensions?: readonly string[] } = {},
  ): Promise<readonly VaultPath[]> {
    const firstSegment = dotPath.split('/')[0];
    if (firstSegment === undefined || !firstSegment.startsWith('.')) {
      throw new Error(
        `FolderSource.listUnder: expected a dot-prefixed path (e.g. '.olea/reviews'), got: ${JSON.stringify(dotPath)}`,
      );
    }
    const startAbsolute = this.toAbsolute(dotPath);
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
   * `VaultSource.delete` (`ol-ppxj.15`, promoted from F7.4's narrow
   * `VaultDeletePort`). A no-op, never a throw, when the path is already
   * gone — the interface doc's contract, exercised here by treating ENOENT
   * as success rather than an error.
   */
  async delete(path: VaultPath): Promise<void> {
    try {
      await unlink(this.toAbsolute(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  /**
   * ARRIVE-1 (`ol-4pue`): `VaultSource.firstSeen`, over `node:fs`'s
   * `birthtimeMs`. Deliberately NOT `mtimeMs` — a note edited long after it
   * first appeared would then read as having *just* arrived every time it is
   * touched, which is backwards for an "arrival day" signal (and would make a
   * heavily-revisited old note perpetually look newest, exactly inverted from
   * what this accessor exists to report).
   *
   * `birthtimeMs` is itself unreliable on this project's own dev/CI platform:
   * checked-out git files here report `birthtimeMs: 0` (verified against this
   * repo's own tracked files, not a synthetic case) because Linux ext4-family
   * filesystems frequently do not track a true creation time and Node reports
   * the epoch rather than throwing. A `0` (or otherwise non-finite/non-
   * positive) value is therefore treated as "unavailable", identically to a
   * missing file — see the interface doc: absence is a first-class, expected
   * outcome here, not an edge case.
   */
  async firstSeen(path: VaultPath): Promise<number | null> {
    let stats: import('node:fs').Stats;
    try {
      stats = await stat(this.toAbsolute(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const birth = stats.birthtimeMs;
    return Number.isFinite(birth) && birth > 0 ? birth : null;
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
