/**
 * `VaultSource` — the storage boundary (A2.1, A2.2, P1-T03).
 *
 * A2.1 requires `olea-core` to be unit-testable against a plain folder of
 * markdown with no Obsidian present; A2.2 says that needing an Obsidian API
 * inside core is a design error rather than a reason to import one. This
 * interface is how both are satisfied *by construction*: core depends only on
 * this, `FolderSource` implements it over Node's fs for tests and CLI use, and
 * `ObsidianSource` implements it over the vault API inside the plugin — the one
 * package permitted to import `obsidian` (INV-1).
 *
 * Nothing here may leak an Obsidian type. If a future method cannot be
 * expressed without one, that is A2.2's design error and belongs in a decision
 * bead, not in this file.
 */

/**
 * A vault-relative path, always POSIX-separated, never absolute and never
 * containing `..`. Obsidian speaks these natively; `FolderSource` translates.
 * Kept as a plain string alias so it stays ergonomic — the constraint is
 * enforced by implementations, and `isVaultPath` below is the shared check.
 */
export type VaultPath = string;

/** What changed in the vault. Mirrors the events C1.5 incremental indexing needs. */
export type VaultEventKind = 'create' | 'modify' | 'delete' | 'rename';

export interface VaultEvent {
  readonly kind: VaultEventKind;
  readonly path: VaultPath;
  /** Previous path; present only when `kind` is `'rename'`. */
  readonly oldPath?: VaultPath;
}

export interface ListOptions {
  /** Restrict to a subtree, e.g. `'01 Courses'`. Defaults to the whole vault. */
  readonly under?: VaultPath;
  /** Restrict by lowercase extension without the dot, e.g. `['md']`. */
  readonly extensions?: readonly string[];
}

/** Unsubscribe handle returned by `watch`. Calling it twice must be safe. */
export type Unsubscribe = () => void;

export interface VaultSource {
  /**
   * Vault-relative paths of all files, in a **stable, sorted order** so tests
   * and golden fixtures do not depend on filesystem enumeration order.
   */
  list(options?: ListOptions): Promise<readonly VaultPath[]>;

  /**
   * Read a text file as UTF-8, **byte-exact**: line endings, trailing newline
   * or its absence, and any BOM are preserved as-is. INV-2 is defined over
   * what this returns, so an implementation that normalises here breaks the
   * round-trip before the parser is even reached.
   */
  read(path: VaultPath): Promise<string>;

  /** Read a binary file — lecture PDFs embedded in notes (F1.6, C3). */
  readBinary(path: VaultPath): Promise<Uint8Array>;

  /**
   * Write a text file, creating parent folders as needed. Writes exactly the
   * string given: no trailing-newline insertion, no line-ending translation.
   */
  write(path: VaultPath, content: string): Promise<void>;

  exists(path: VaultPath): Promise<boolean>;

  /**
   * Subscribe to vault changes (C1.5). Events may be coalesced or delivered
   * late, and an implementation may legitimately deliver none — `FolderSource`
   * in a test does not have to watch. Consumers must therefore treat watching
   * as an optimisation over rescanning, never as a guarantee, which is also
   * what makes the index's delete-and-rebuild equivalence test (C2.4) the real
   * correctness check rather than event bookkeeping.
   */
  watch(handler: (event: VaultEvent) => void): Unsubscribe;
}

/** Shared validity rule for the `VaultPath` contract above. */
export function isVaultPath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\')) return false;
  return !value.split('/').includes('..');
}
