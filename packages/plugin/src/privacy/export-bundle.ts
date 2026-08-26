/**
 * `buildPrivacyExportBundle` — F7.4's export leg (`ol-p6t01`): "export
 * bundles logs + instruments" into one object she can save.
 *
 * **Logs** — her review-event history and misconception history, both
 * durable vault content (`vault-artifact-delete.ts`'s module doc). Read via
 * the same discovery `discoverLogPaths` gives the delete path, then parsed
 * with `olea-core`'s own tolerant parsers (`parseReviewLog`,
 * `parseMisconceptionLog` — a corrupt trailing line is skipped, never
 * fails the whole export) and merged into one deduplicated, deterministically
 * ordered stream per log (`mergeReviewLogRecords`, `mergeMisconceptionEvents`)
 * so a multi-device vault exports one coherent timeline rather than one
 * blob per device file.
 *
 * **Instruments** — practice items (Q&A/cloze/MCQ) parsed out of her own
 * notes via `enumerateVaultInstruments`, the single join point
 * `olea-core`'s `session/enumerate.ts` already owns ("deliberately the
 * *only* place a note's bytes become an instrument record"). Each carries
 * its exact source `raw` text — no paraphrase, no re-serialization — so the
 * export reflects what is actually in her notes.
 *
 * **Read-only, always.** This function never writes anywhere — not to
 * `data.json`, not to the vault. Nothing here is a delete-target discussion;
 * see `cache-purge.ts`/`vault-artifact-delete.ts` for those.
 *
 * The `usageLog` (D-005 telemetry: task id, prompt version, model id — never
 * content) is deliberately excluded from "logs" here. It is about Olea's own
 * operation cost, not her study evidence, and F7.3's usage view already
 * surfaces it; duplicating it into this bundle would blur what "her data" is
 * meant to mean. Flagged in this bead's report as an easy follow-on if that
 * reading is wrong.
 */

import type { ReviewLogEntry } from 'olea-contracts';
import {
  type CalendarDay,
  type EnumerateVaultInstrumentsOptions,
  enumerateVaultInstruments,
  MISCONCEPTION_LOG_FOLDER,
  type MisconceptionEvent,
  mergeMisconceptionEvents,
  mergeReviewLogRecords,
  misconceptionLogPath,
  parseMisconceptionLog,
  parseReviewLog,
  REVIEW_LOG_FOLDER,
  reviewLogPath,
  type VaultInstrumentRecord,
  type VaultSource,
} from 'olea-core';
import { DEFAULT_LOG_PROBE_DAYS, discoverLogPaths } from './log-discovery.js';

export const PRIVACY_EXPORT_BUNDLE_VERSION = 1 as const;

export interface PrivacyExportBundle {
  readonly version: 1;
  /** ISO-8601, when this bundle was built (not stored anywhere — computed at export time). */
  readonly exportedAt: string;
  readonly reviewLog: readonly ReviewLogEntry[];
  readonly misconceptionLog: readonly MisconceptionEvent[];
  readonly instruments: readonly VaultInstrumentRecord[];
}

export interface BuildPrivacyExportBundleDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly today: CalendarDay;
  /** Defaults to `DEFAULT_LOG_PROBE_DAYS` (`log-discovery.ts`). */
  readonly probeDays?: number;
  /** Passed through to `enumerateVaultInstruments` unchanged — a caller that needs a non-default Zettelkasten folder or a pinned instrument-id source. */
  readonly instrumentOptions?: EnumerateVaultInstrumentsOptions;
  /** Injectable for a deterministic `exportedAt` in tests. Defaults to `() => new Date().toISOString()`. */
  readonly now?: () => string;
}

export async function buildPrivacyExportBundle(
  deps: BuildPrivacyExportBundleDeps,
): Promise<PrivacyExportBundle> {
  const probeDays = deps.probeDays ?? DEFAULT_LOG_PROBE_DAYS;
  const now = deps.now ?? (() => new Date().toISOString());

  const reviewPaths = await discoverLogPaths(
    deps.vault,
    REVIEW_LOG_FOLDER,
    reviewLogPath,
    deps.deviceId,
    deps.today,
    probeDays,
  );
  const reviewSources: ReviewLogEntry[][] = [];
  for (const path of reviewPaths) {
    const content = await deps.vault.read(path);
    reviewSources.push([...parseReviewLog(content).records]);
  }
  const reviewLog = mergeReviewLogRecords(...reviewSources).records;

  const misconceptionPaths = await discoverLogPaths(
    deps.vault,
    MISCONCEPTION_LOG_FOLDER,
    misconceptionLogPath,
    deps.deviceId,
    deps.today,
    probeDays,
  );
  const misconceptionSources: MisconceptionEvent[][] = [];
  for (const path of misconceptionPaths) {
    const content = await deps.vault.read(path);
    misconceptionSources.push([...parseMisconceptionLog(content).events]);
  }
  const misconceptionLog = mergeMisconceptionEvents(...misconceptionSources).events;

  const { records: instruments } = await enumerateVaultInstruments(
    deps.vault,
    deps.instrumentOptions ?? {},
  );

  return {
    version: PRIVACY_EXPORT_BUNDLE_VERSION,
    exportedAt: now(),
    reviewLog,
    misconceptionLog,
    instruments,
  };
}
