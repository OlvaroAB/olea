/**
 * The `olea-uid` lookup table (P1-T04 accept criteria: "uid-keyed lookup
 * table in core"). Scans a vault for stamped notes and builds `uid -> path`,
 * for consumers that need to resolve an id back to a file (e.g. a review
 * event referencing the concept note it was logged against).
 *
 * Duplicate uids (two notes stamped with the same value — a copy-paste of a
 * whole note, most plausibly) are **reported, not silently resolved** by
 * last-write-wins or similar: the table keeps the first path seen for a
 * given uid, and every path *after* the first for that uid is recorded in
 * `duplicates` instead, so a caller can surface it as the anomaly it is
 * rather than silently losing one note's identity.
 */

import { parseDocument } from '../block/parse.js';
import { parseFrontmatter } from '../frontmatter/parse.js';
import { readScalar } from '../frontmatter/read.js';
import type { VaultPath, VaultSource } from '../vault/types.js';
import { OLEA_UID_KEY } from './stamp.js';

export interface UidTableOptions {
  /** Frontmatter key to read. Defaults to `olea-uid` (`OLEA_UID_KEY`). */
  readonly key?: string;
  /** Extensions to scan. Defaults to `['md']`. */
  readonly extensions?: readonly string[];
}

export interface UidTableEntry {
  readonly uid: string;
  readonly path: VaultPath;
}

export interface BuildUidTableResult {
  /** `uid -> path` for the first note seen carrying each uid. */
  readonly table: ReadonlyMap<string, VaultPath>;
  /** Every note whose uid was already claimed by an earlier path, in scan order. */
  readonly duplicates: readonly UidTableEntry[];
}

export async function buildUidTable(
  vault: VaultSource,
  options: UidTableOptions = {},
): Promise<BuildUidTableResult> {
  const key = options.key ?? OLEA_UID_KEY;
  const extensions = options.extensions ?? ['md'];

  const paths = await vault.list({ extensions });
  const table = new Map<string, VaultPath>();
  const duplicates: UidTableEntry[] = [];

  for (const path of paths) {
    const content = await vault.read(path);
    const doc = parseDocument(content);
    const first = doc.blocks[0];
    if (first?.kind !== 'frontmatter') continue;

    const fm = parseFrontmatter(first.inner);
    const uid = readScalar(fm, key).scalar;
    if (uid === '') continue;

    const existing = table.get(uid);
    if (existing === undefined) {
      table.set(uid, path);
    } else {
      duplicates.push({ uid, path });
    }
  }

  return { table, duplicates };
}
