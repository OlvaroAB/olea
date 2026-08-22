/**
 * Reading the **whole** review log out of the vault (C5.2, D-020).
 *
 * The one piece of I/O the session pipeline does beyond reading notes, kept in
 * its own thin file so `replay.ts` and `suspension.ts` stay pure functions over
 * entries and so a caller that already holds the log (the workbench, a test)
 * can skip this entirely.
 *
 * ## Whole, not windowed — and that is the difference from the Today panel
 *
 * `plugin/today/data-source.ts` reads a *trailing window* of the log, because
 * the streak only cares about recent days and reading a year of files to draw a
 * sidebar would be wasteful. Scheduling state and suspension cannot be read
 * that way: an instrument reviewed four months ago still has the state that
 * review produced, and a suspend from last term is still in force. A windowed
 * read would silently un-suspend it and silently reset its schedule to "never
 * reviewed", which is the worst kind of bug — it looks like new material.
 *
 * So this reads every log file it can see, and takes the folder listing as its
 * only discovery mechanism. That is a real limitation on hosts that hide
 * dot-prefixed folders, and it is stated rather than papered over: pass
 * `additionalPaths` for the files a caller knows exist by name (this device's
 * own, via `reviewLogPath`), exactly as the Today panel probes for its own.
 *
 * ## Tolerant, per line
 *
 * `parseReviewLog` already guarantees that one bad line costs that line and
 * nothing else, and nothing here throws a file away wholesale. `invalidLines`
 * is surfaced for diagnostics; a crash-truncated final line is the expected
 * case, not corruption.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import { mergeReviewLogRecords } from '../review-log/merge.js';
import type { InvalidReviewLogLine } from '../review-log/parse.js';
import { parseReviewLog } from '../review-log/parse.js';
import { REVIEW_LOG_FOLDER } from '../review-log/path.js';
import type { VaultPath, VaultSource } from '../vault/types.js';

/** The extension every C5.2 log file carries. */
export const REVIEW_LOG_EXTENSION = 'jsonl';

export interface ReadReviewLogHistoryOptions {
  /**
   * Folder to list. Defaults to `.olea/reviews/`.
   *
   * Overridable for exactly one reason, and it is not "point the product
   * somewhere else": a harness may keep a *synthetic* history in its own
   * namespace and want it composed. The write side's guard against synthetic
   * records reaching `.olea/` is a separate mechanism and is untouched by this
   * option — this reads, it does not write.
   */
  readonly folder?: VaultPath;
  /** Files the caller knows by name, for hosts whose `list` hides the folder. Deduplicated against the listing. */
  readonly additionalPaths?: readonly VaultPath[];
}

export interface ReviewLogHistory {
  /** Every entry, merged by `eventId` and in `(timestamp, eventId)` order. */
  readonly entries: readonly ReviewLogEntry[];
  /** Lines that did not parse, with the file they came from. Diagnostics only. */
  readonly invalidLines: readonly {
    readonly path: VaultPath;
    readonly line: InvalidReviewLogLine;
  }[];
  /** Files actually read, sorted. */
  readonly files: readonly VaultPath[];
}

/** Every review-log entry the vault can show us, merged and ordered. */
export async function readReviewLogHistory(
  vault: VaultSource,
  options: ReadReviewLogHistoryOptions = {},
): Promise<ReviewLogHistory> {
  const folder = options.folder ?? REVIEW_LOG_FOLDER;

  const paths = new Set<VaultPath>(options.additionalPaths ?? []);
  try {
    for (const path of await vault.list({ under: folder, extensions: [REVIEW_LOG_EXTENSION] })) {
      paths.add(path);
    }
  } catch {
    // A host that refuses to list a dot-prefixed folder is an expected case,
    // not an error condition — `additionalPaths` is the guaranteed route.
  }

  const sources: (readonly ReviewLogEntry[])[] = [];
  const invalidLines: { path: VaultPath; line: InvalidReviewLogLine }[] = [];
  const files: VaultPath[] = [];

  for (const path of [...paths].sort()) {
    if (!(await vault.exists(path))) continue;
    files.push(path);
    const parsed = parseReviewLog(await vault.read(path));
    sources.push(parsed.records);
    for (const line of parsed.invalidLines) invalidLines.push({ path, line });
  }

  const merged = mergeReviewLogRecords(...sources);
  return { entries: merged.records, invalidLines, files };
}
