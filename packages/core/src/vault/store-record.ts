/**
 * Reading one JSON record file back inside its path's queue (`./path-queue.ts`,
 * `ol-egov.141.89.104.2`).
 *
 * A store that found a record through a folder listing decides what to write from that listing's
 * copy. Between the listing and the write another task may have changed the file, so the store
 * takes the path's queue and reads the file again before it decides. This is that read, with the
 * three outcomes kept apart: no file, a file that does not read as a record, and a record. What a
 * store does with the middle one is the store's own rule, never this module's.
 */

import type { VaultPath, VaultSource } from './types.js';

export type StoreRecordRead<T> =
  | { readonly kind: 'absent' }
  /** A file is there, but it is not JSON, or not a record this build reads. Its bytes are untouched. */
  | { readonly kind: 'unreadable'; readonly cause?: unknown }
  | { readonly kind: 'record'; readonly record: T };

/** The record stored at `path`, read the way every sibling sidecar reads one (JSON, then `isRecord`). */
export async function readStoreRecord<T>(
  vault: VaultSource,
  path: VaultPath,
  isRecord: (value: unknown) => value is T,
): Promise<StoreRecordRead<T>> {
  if (!(await vault.exists(path))) return { kind: 'absent' };
  const text = await vault.read(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return { kind: 'unreadable', cause };
  }
  return isRecord(parsed) ? { kind: 'record', record: parsed } : { kind: 'unreadable' };
}

/**
 * A store refused to write over a record file that does not read as a record (T12,
 * `ol-egov.141.89.104.2`). The file is left byte-identical; nothing is set aside, because a copy
 * would be a new file family under `.olea/`. `path` says which file; the message names only its
 * folder, so a caller may log it without logging a key.
 */
export class UnreadableStoreRecordError extends Error {
  readonly path: VaultPath;
  readonly folder: VaultPath;

  constructor(path: VaultPath, cause?: unknown) {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    super(
      `A record in ${folder} could not be read, so it was left exactly as it is and nothing was written over it.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'UnreadableStoreRecordError';
    this.path = path;
    this.folder = folder;
  }
}

/**
 * For a write that may replace an authoritative record: the record at `path`, `undefined` when
 * there is no file, and an `UnreadableStoreRecordError` — never `undefined` — when a file is there
 * that does not read as a record, so the caller cannot mistake it for absent and write over it.
 */
export async function readStoreRecordForWrite<T>(
  vault: VaultSource,
  path: VaultPath,
  isRecord: (value: unknown) => value is T,
): Promise<T | undefined> {
  const read = await readStoreRecord(vault, path, isRecord);
  if (read.kind === 'unreadable') throw new UnreadableStoreRecordError(path, read.cause);
  return read.kind === 'record' ? read.record : undefined;
}

/**
 * How a batch reports a record it skipped because it could not read it: a warning naming the
 * folder only (D-005: never a key, a path segment or any content). Rethrows anything else.
 */
export function skipUnreadableStoreRecord(error: unknown): void {
  if (!(error instanceof UnreadableStoreRecordError)) throw error;
  console.warn(
    'Olea: a stored record could not be read; it was left exactly as it is and skipped.',
    { folder: error.folder },
  );
}
