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
