/**
 * `createLocalStudyPlanProvider` — the production `StudyPlanProvider`
 * (P5-T07).
 *
 * `plan/types.ts`'s own doc calls this seam "A2.5's Worker half" and says a
 * production implementation "speaks the Worker envelope" — written before
 * `rankOracle` existed. Its own module doc is explicit that the ranking is
 * "computed with no model call and no network," and `oracle/compose.ts`'s
 * `composeOracleRanking` is the whole of that computation, vault and review
 * log in, `RankOracleResult` out. There is nothing for a Worker call to do
 * here: the policy the plan carries is derived entirely from her own
 * assessments Base and her own review log, both already on the device.
 * `StudyPlanProvider.fetchPlan` does not require HTTP anywhere in its
 * contract, only "compute a fresh plan" — this computes one locally.
 *
 * ## Never throws past `fetchPlan`'s own caller… except by design
 *
 * `refreshStudyPlan` (`olea-core`) is what actually calls `fetchPlan`, and its
 * whole design is "a bad or missing plan never costs her the one she already
 * has" (see that module's doc) — a throw here is caught there and reported
 * through `reason`, never surfaced past it. So this function throws freely
 * for the ordinary "not configured yet" and "vault walk failed" cases rather
 * than inventing its own degraded return value; `refreshStudyPlan` already
 * has the degradation path built and tested.
 *
 * ## The review-log read, and the same probe this file did not invent
 *
 * Obsidian's `vault.getFiles()` does not return dot-prefixed trees (see
 * `open-session.ts`'s identical comment), so `readReviewLogHistory`'s
 * listing-based discovery finds nothing under `.olea/reviews/` on this host
 * unless told the file names to look for. This reuses the exact
 * `calendarDaysEndingOn` + `reviewLogPath` probe `open-session.ts` and
 * `today/data-source.ts` already use, over the same window
 * (`SCHEDULING_HISTORY_PROBE_DAYS`) — one number, not a second one invented
 * for mastery specifically. It only names *this device's* files, same
 * limitation, same reason it is not fixed here (see `session/history.ts`'s
 * module doc).
 */

import type { StudyPlanProvider, VaultSource } from 'olea-core';
import {
  buildStudyPlan,
  calendarDaysEndingOn,
  composeOracleRanking,
  readReviewLogHistory,
  reviewLogPath,
} from 'olea-core';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import {
  isStudyPlanConfigured,
  type ObsidianDataHost,
  ObsidianStudyPlanSettingsStore,
} from './settings-store.js';

export interface CreateLocalStudyPlanProviderDeps {
  readonly vault: VaultSource;
  /** Names this device's own review-log files for the probe — same discipline as `open-session.ts` (C5.2). */
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests. Defaults to the window `open-session.ts` and the Today panel both probe. */
  readonly probeDays?: number;
}

/**
 * A `StudyPlanProvider` whose `fetchPlan` composes a fresh `RankOracleResult`
 * from the vault and the review log, and builds it into a `StudyPlanArtifact`
 * — entirely on-device, no Worker call.
 */
export function createLocalStudyPlanProvider(
  deps: CreateLocalStudyPlanProviderDeps,
): StudyPlanProvider {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);

  return {
    async fetchPlan(): Promise<unknown> {
      const config = await settingsStore.load();
      if (!isStudyPlanConfigured(config)) {
        throw new Error(
          'Olea: no assignments Base path configured (Settings → Olea) — cannot compose a study plan.',
        );
      }

      const now = deps.now();
      const today = localToday(now);
      const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
      const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
        reviewLogPath(day, deps.deviceId),
      );

      const { entries } = await readReviewLogHistory(deps.vault, { additionalPaths });

      const { ranking } = await composeOracleRanking({
        vault: deps.vault,
        basePath: config.assignmentsBasePath,
        reviewLog: entries,
        asOf: today,
      });

      return buildStudyPlan({ ranking, computedAt: now.toISOString() });
    },
  };
}
