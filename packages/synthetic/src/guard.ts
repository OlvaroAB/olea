/**
 * The refusal: a synthetic stream can never be written into a real vault's log
 * path.
 *
 * SYN-1's wording is deliberate — *"write a test that proves a synthetic stream
 * cannot be written to a real vault log path, not a comment saying it
 * shouldn't."* So this is a function that throws, exercised by
 * `test/guard.spec.ts` pointing the writer straight at
 * `olea-core`'s own `reviewLogPath(...)` and watching it refuse.
 *
 * ## Why the refusal is drawn at the whole `.olea/` namespace
 *
 * `reviewLogPath` puts logs at `.olea/reviews/<date>.<device>.jsonl`. Refusing
 * only that exact shape would be a guard that a rename of the file convention
 * silently disarms — the same defect class as an INV-3 marker list, which only
 * catches strings someone already knew to list. `.olea/` is the product's whole
 * vault namespace, nothing this package writes has any business inside it, and
 * refusing the namespace stays correct across any future change to the file
 * naming inside it. The narrower check is kept alongside it
 * (`isRealVaultReviewLogPath`) so a failure message can say *which* rule fired.
 *
 * ## Why the log path and not just the vault
 *
 * The event log in her vault is the truth (plan §7.1): every knowledge
 * projection — FSRS state, mastery, misconception recurrence, streaks,
 * insights — is recomputed from it. A fabricated record inside it is not a
 * cosmetic problem; it corrupts the single source the architecture trusts, and
 * it does so in a way no later cleanup can fully undo, because by then the
 * projections have been recomputed from it and believed. That is the same
 * argument INV-4 makes about a missing field, pointed the other way.
 */

import type { VaultPath, VaultSource } from 'olea-core';
import { isValidDeviceId, REVIEW_LOG_FOLDER } from 'olea-core';
import type { SyntheticStream } from './generate.js';
import { toJsonl } from './serialize.js';

/** Where synthetic streams are allowed to land. Deliberately outside `.olea/`. */
export const SYNTHETIC_LOG_FOLDER = '.olea-synthetic/reviews';

/** The product's vault namespace, refused wholesale. */
const PRODUCT_NAMESPACE = '.olea';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strips a leading `./` and collapses redundant separators, so a guard cannot be walked around by spelling. */
function normalise(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

/** True when `path` is inside the product's own vault namespace (`.olea/…`, including the review log). */
export function isProductVaultPath(path: string): boolean {
  const p = normalise(path);
  return p === PRODUCT_NAMESPACE || p.startsWith(`${PRODUCT_NAMESPACE}/`);
}

/** True when `path` is inside the real review-log folder specifically — the narrower of the two rules. */
export function isRealVaultReviewLogPath(path: string): boolean {
  const p = normalise(path);
  return p === REVIEW_LOG_FOLDER || p.startsWith(`${REVIEW_LOG_FOLDER}/`);
}

/**
 * Throws unless `path` is somewhere a synthetic stream may legitimately go.
 * Exported so a caller building its own destination can ask *before* it holds
 * an open file handle.
 */
export function assertSyntheticSafePath(path: string): void {
  if (isRealVaultReviewLogPath(path)) {
    throw new Error(
      `olea-synthetic: refusing to write a synthetic stream to a real vault review-log path ` +
        `(${JSON.stringify(path)}). The event log in her vault is the truth (plan §7.1); a ` +
        `fabricated record inside it corrupts the one source every projection is rebuilt from. ` +
        `Synthetic streams belong under ${SYNTHETIC_LOG_FOLDER}/.`,
    );
  }
  if (isProductVaultPath(path)) {
    throw new Error(
      `olea-synthetic: refusing to write a synthetic stream inside the product's vault ` +
        `namespace (${JSON.stringify(path)}). Nothing fabricated belongs under ` +
        `${PRODUCT_NAMESPACE}/. Synthetic streams belong under ${SYNTHETIC_LOG_FOLDER}/.`,
    );
  }
}

/**
 * The synthetic counterpart of `reviewLogPath` — same one-file-per-day-per-device
 * convention (C5.2), different folder. Validated the same way, because a
 * sloppily-named synthetic file is still a file in someone's vault.
 */
export function syntheticLogPath(date: string, deviceId: string): VaultPath {
  if (!DATE_RE.test(date)) {
    throw new Error(`syntheticLogPath: not a calendar date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  }
  if (!isValidDeviceId(deviceId)) {
    throw new Error(`syntheticLogPath: not a valid device id: ${JSON.stringify(deviceId)}`);
  }
  const path = `${SYNTHETIC_LOG_FOLDER}/${date}.${deviceId}.jsonl`;
  // Belt and braces: this function is the *only* default destination, so if a
  // future edit ever moved SYNTHETIC_LOG_FOLDER under `.olea/`, every write
  // would fail loudly here rather than quietly succeeding into the real log.
  assertSyntheticSafePath(path);
  return path;
}

export type LogPathResolver = (date: string, deviceId: string) => VaultPath;

export interface WriteSyntheticStreamOptions {
  /**
   * Destination resolver. Defaults to `syntheticLogPath`. Injectable so a test
   * can aim the writer at a real vault log path and prove it refuses — which is
   * the only way to demonstrate the guard rather than assert its existence.
   */
  readonly pathFor?: LogPathResolver;
}

/** One day's file: the path it goes to and the JSONL bytes that go in it. */
export interface SyntheticLogFile {
  readonly path: VaultPath;
  readonly content: string;
}

/**
 * Splits a stream into one file per (local day, device), the way C5.2 says a
 * real log is laid out, and checks every destination *before* returning any of
 * them. All-or-nothing on purpose: a partial write that stopped at the first
 * bad path would leave half a corpus somewhere nobody expected.
 */
export function syntheticLogFiles(
  stream: SyntheticStream,
  options: WriteSyntheticStreamOptions = {},
): readonly SyntheticLogFile[] {
  const pathFor = options.pathFor ?? syntheticLogPath;
  const byDay = new Map<string, string[]>();
  for (const entry of stream.entries) {
    const day = entry.timestamp.slice(0, 10);
    const lines = byDay.get(day);
    if (lines) lines.push(JSON.stringify(entry));
    else byDay.set(day, [JSON.stringify(entry)]);
  }

  const files = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day]) => ({
      path: pathFor(day, stream.spec.deviceId),
      content: toJsonl(stream.entries.filter((e) => e.timestamp.slice(0, 10) === day)),
    }));

  for (const file of files) assertSyntheticSafePath(file.path);
  return files;
}

/**
 * Writes a stream into a `VaultSource`, refusing outright if any destination is
 * a real vault log path. Nothing is written unless every path passes.
 */
export async function writeSyntheticStream(
  vault: VaultSource,
  stream: SyntheticStream,
  options: WriteSyntheticStreamOptions = {},
): Promise<readonly VaultPath[]> {
  const files = syntheticLogFiles(stream, options);
  for (const file of files) {
    await vault.write(file.path, file.content);
  }
  return files.map((f) => f.path);
}
