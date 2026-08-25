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

  /**
   * Best-effort "when did this file first become reachable to her" signal —
   * epoch milliseconds, or `null` when the host cannot say (file does not
   * exist, or the underlying filesystem/host does not track a creation time).
   * ARRIVE-1's (`ol-4pue`) vault-host arrival-day accessor: non-persisted,
   * reversible (Class B) — nothing is stamped into her files, this only reads
   * what the host already tracks.
   *
   * **Optional by design**, not merely by omission: adding it as a required
   * method would force every `VaultSource` implementation across the
   * workspace — several outside this module's ownership — to grow one
   * overnight, and every existing in-memory/fixture fake would have to invent
   * an answer. A missing method, an `undefined`-returning host, and a `null`
   * return for a real file all mean the same thing to a caller — "no signal"
   * — and MUST all be treated identically.
   *
   * **The honest fallback for "no signal" is `overdueDays: 0`, never
   * `Number.POSITIVE_INFINITY`** — see `study-session/compose.ts`'s module
   * doc ("The known data gap") for why treating an unknown wait as unbounded
   * reproduces the exact starvation this signal exists to fix, just for the
   * other obligation classes instead. A caller building an arrival-day map
   * from this accessor must preserve that fallback rather than substituting
   * its own.
   *
   * **Do not conflate this with "last modified."** A note edited long after
   * it first appeared should still read as having arrived when it first
   * appeared, not every time it is touched — see `FolderSource`'s
   * implementation note on why `mtime` is never used as a substitute here.
   */
  firstSeen?(path: VaultPath): Promise<number | null>;
}

/** Shared validity rule for the `VaultPath` contract above. */
export function isVaultPath(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\')) return false;
  return !value.split('/').includes('..');
}
