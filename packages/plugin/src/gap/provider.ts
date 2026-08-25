/**
 * `createLocalGapProvider` — the production `GapViewDeps` (`ol-2tyj`, F4.3,
 * F4.5, F4.9, F4.10).
 *
 * `GapView` (`./view.ts`) has been complete and tested since P5-T06a; nothing
 * in either package ever constructed it against a real vault. `plan/
 * provider.ts`'s `createLocalStudyPlanProvider` composed `composeOracleRanking`
 * for the study plan and, per that module's own doc, discarded `edges` —
 * `compose.ts`'s `ComposeOracleRankingResult.edges` doc says outright it is
 * carried "`ol-2tyj`'s gap and coverage views need `tier3.sourcesReport`…and
 * re-running the tier-3 walk a second time to get it would defeat the point of
 * composing it once here." Nothing read it. This module is that reader.
 *
 * ## The two walks, and why there are two
 *
 * `buildGapView` needs five things: `ranking`, `assessments`, `mastery`,
 * `sourceCoverage` (all four now returned by one `composeOracleRanking` call —
 * `mastery` only as of this same bead, see `oracle/compose.ts`'s module doc)
 * and `materialPresence`, which `buildMaterialPresence` builds from
 * `ConceptRecord[]` plus a per-note instrument count. Nothing upstream of this
 * file has ever needed *both* "the tier-3 evidence join" and "every instrument
 * in the vault, per note" in the same call, so this is the first caller that
 * pays for both walks — `composeOracleRanking` (which re-walks for tier-3
 * evidence) and `enumerateVaultInstruments` (which walks for instruments and,
 * as of this bead, also returns the `extractConcepts` pass it already runs
 * internally — see `session/types.ts`'s `VaultInstrumentEnumeration.concepts`).
 * Run concurrently (`Promise.all`) since neither depends on the other's
 * result, both read the same read-only `VaultSource`, and this pays the cost
 * once per open rather than serially.
 *
 * ## No cache, deliberately
 *
 * `ol-2tyj` suggested caching the resulting `GapViewModel` the way `plan/
 * cache.ts` caches a `StudyPlanArtifact`. That would be a new persisted blob
 * with nothing in the contract naming it — a Class C stop (C6, D-002/D-004/
 * D-005/D-008 already decide every case where convenience like this tempts).
 * So `load()` recomputes from scratch on every call: `GapView.refresh()`
 * calls it, and `main.ts` calls `refresh()` alongside `refreshCachedStudyPlan`
 * — see that module's wiring. `compose.ts`'s own doc already warns the
 * tier-3 walk is real vault I/O "not a cache read"; this view re-pays it on
 * every open, visibly, rather than hiding the cost behind a cache this
 * project has no persisted home for.
 *
 * ## Unavailable, for two different reasons, one state
 *
 * `GapViewState` (`./view.ts`) is `{kind:'model', model} | {kind:'unavailable'}`
 * — two states, not three, and this module is not the place to widen that
 * (`GapView`'s public interface is out of this bead's scope; a workbench lane
 * mounts it). "No assignments Base path configured yet" (the same gate
 * `createLocalStudyPlanProvider` throws on) and "the vault walk itself threw"
 * both resolve to `'unavailable'` here, exactly as `plan/provider.ts`'s two
 * distinct failure causes both resolve to `refreshStudyPlan`'s one `reason`
 * field. `GAP_UNAVAILABLE_BODY`'s wording ("could not read your sources just
 * now") reads slightly off for the not-yet-configured case specifically; a
 * copy-level distinction between the two is a `./copy.ts` change this bead
 * does not make (`GapViewState` has no field to carry which case it was).
 */

import type { ConceptMaterialPresence, GapRow, VaultPath, VaultSource } from 'olea-core';
import {
  buildGapView,
  buildMaterialPresence,
  calendarDaysEndingOn,
  composeOracleRanking,
  enumerateVaultInstruments,
  readReviewLogHistory,
  reviewLogPath,
} from 'olea-core';
import {
  isStudyPlanConfigured,
  type ObsidianDataHost,
  ObsidianStudyPlanSettingsStore,
} from '../plan/settings-store.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { GapViewDeps, GapViewState } from './view.js';

export interface CreateLocalGapProviderDeps {
  readonly vault: VaultSource;
  /** Names this device's own review-log files for the probe — same discipline as `plan/provider.ts` (C5.2). */
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests. Defaults to the window `open-session.ts` and the Today panel both probe. */
  readonly probeDays?: number;
  /**
   * What the `'build-session'` affordance does (`ol-p5t06b`, F4.6) — passed
   * straight through to `GapViewDeps.buildSession`.
   *
   * **It lives here rather than being spread onto the deps at the call site**
   * because this factory's whole job is "the production `GapViewDeps`", and a
   * caller that has to remember to add a second field to what a factory
   * returned is a caller that can forget. Optional: a host with no session
   * builder (the workbench) leaves it out and the label renders inert, exactly
   * as it did before this bead.
   */
  readonly buildSession?: (row: GapRow) => void;
}

/**
 * Tallies `VaultInstrumentRecord.notePath` — `buildMaterialPresence`'s second
 * argument. A note the enumeration never mentions contributes zero, which is
 * the honest reading `build.ts`'s own doc names: the caller found no
 * instruments there.
 */
function instrumentCountsByNotePath(
  records: readonly { readonly notePath: VaultPath }[],
): ReadonlyMap<VaultPath, number> {
  const counts = new Map<VaultPath, number>();
  for (const record of records) {
    counts.set(record.notePath, (counts.get(record.notePath) ?? 0) + 1);
  }
  return counts;
}

/**
 * A `GapViewDeps` whose `load` composes a fresh `GapViewModel` from the vault
 * and the review log, entirely on-device, no Worker call — the gap-view twin
 * of `createLocalStudyPlanProvider`.
 */
export function createLocalGapProvider(deps: CreateLocalGapProviderDeps): GapViewDeps {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);

  return {
    // `exactOptionalPropertyTypes`: omit the key entirely rather than assign
    // `undefined` to it when no session builder is wired.
    ...(deps.buildSession !== undefined ? { buildSession: deps.buildSession } : {}),
    async load(): Promise<GapViewState> {
      try {
        const config = await settingsStore.load();
        if (!isStudyPlanConfigured(config)) return { kind: 'unavailable' };

        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
          reviewLogPath(day, deps.deviceId),
        );

        // Neither walk depends on the other's result — both read the same
        // read-only vault — so they run concurrently rather than paying two
        // walks' latency serially.
        const [{ entries }, enumeration] = await Promise.all([
          readReviewLogHistory(deps.vault, { additionalPaths }),
          enumerateVaultInstruments(deps.vault),
        ]);

        const { ranking, edges, mastery } = await composeOracleRanking({
          vault: deps.vault,
          basePath: config.assignmentsBasePath,
          reviewLog: entries,
          asOf: today,
          // The name→opaque-key source for `ConceptAssessmentEdge.conceptKey`
          // (`ol-63e1`) — already extracted by the instrument walk above, so
          // this pays no second walk.
          concepts: enumeration.concepts,
        });

        const materialPresence: ReadonlyMap<string, ConceptMaterialPresence> =
          buildMaterialPresence(
            enumeration.concepts,
            instrumentCountsByNotePath(enumeration.records),
          );

        const model = buildGapView({
          ranking,
          assessments: edges.assessmentsRead.records,
          mastery,
          materialPresence,
          // `tier3.sourceCoverage`, unmodified — `ol-cvsc`'s scope statement
          // (`GapViewModel.scope`) is only as honest as this pass-through.
          // N-013 mutation test: deleting this line and passing `[]` instead
          // turns `model.scope.canStateExhaustiveness` false on a fixture
          // where it should read true (see `provider.spec.ts`) — that
          // mutation was performed and confirmed red, then reverted.
          sourceCoverage: edges.tier3.sourceCoverage,
        });

        return { kind: 'model', model };
      } catch (error) {
        console.error('Olea: could not compose the gap view', error);
        return { kind: 'unavailable' };
      }
    },
  };
}
