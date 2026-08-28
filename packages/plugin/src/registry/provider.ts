/**
 * `createLocalRegistryProvider` — the production `RegistryViewDeps` (F8.4,
 * `[REG-1]`, `ol-4v2l`, amended acceptance `[D-135]`).
 *
 * Composes, entirely on-device, no Worker call — the registry's twin of
 * `gap/provider.ts` and `session-builder/provider.ts`:
 *
 *   1. **The vault walk** — `enumerateVaultInstruments`, giving both the
 *      concept spine and the instrument records in one pass (same reuse
 *      those two providers already document for their own calls).
 *   2. **The whole review-log history** — `readReviewLogHistory`, WHOLE not
 *      windowed, matching `session/history.ts`'s own doc: mastery, vitality
 *      and the withdrawn-instrument set are all high-water-mark or
 *      current-state readings over the ENTIRE log, and a windowed read would
 *      silently un-withdraw an instrument suspended last term (exactly the
 *      bug that module's doc warns against for scheduling).
 *   3. **The local overrides** — `ObsidianRegistryOverridesStore`, read
 *      fresh on every `load()`, matching every other provider's "a change
 *      she makes between two opens must not need a reload to take" rule.
 *
 * Neither the vault walk nor the log read depends on the other's result, so
 * they run concurrently (`Promise.all`), the same concurrency
 * `gap/provider.ts` uses for the same reason.
 *
 * **No cache**, for the same reason `gap/provider.ts` states for its own
 * `GapViewModel`: a persisted registry blob would be a new cache with
 * nothing in the contract naming it (C6, D-002/D-004/D-005/D-008). `load()`
 * recomputes from scratch every time the view opens or refreshes.
 */

import {
  buildRegistryModel,
  calendarDaysEndingOn,
  createFsrsScheduler,
  enumerateVaultInstruments,
  pruneConcept as pruneConceptOverride,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  readReviewLogHistory,
  renameConcept as renameConceptOverride,
  reviewLogPath,
  suspendedInstrumentIds,
  unpruneConcept as unpruneConceptOverride,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { ObsidianDataHost } from './overrides-store.js';
import { ObsidianRegistryOverridesStore } from './overrides-store.js';
import { createVaultPruneInstrumentPort, type PruneInstrumentPort } from './ports.js';
import type { RegistryViewDeps, RegistryViewState } from './view.js';

/**
 * Vitality's own module doc (`../../core/mastery/rollup.ts`) names the
 * mastery surface that would show a stage beside its vitality as still
 * unbuilt when it was written. This provider, and `retrospective/
 * provider.ts` before it, are both that surface now — two independent Class
 * B declarations of the same unmeasured constant rather than one shared
 * module, matching this codebase's existing convention (no shared
 * `holdingCut` constant exists anywhere else in `packages/plugin`).
 * Ratifying it needs a real semester of her review log (see that module's
 * own doc); until then this is a plain-English default, not a derivation.
 */
const DECLARED_FALLBACK_HOLDING_CUT = 0.8;

export interface EditInstrumentPort {
  edit(instrument: RegistryInstrumentSummary): Promise<void>;
}

export interface CreateLocalRegistryProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** The one Obsidian-backed port (INV-1) — see `./obsidian-ports.ts`'s `createObsidianEditInstrumentPort`. */
  readonly editPort: EditInstrumentPort;
  /** Overridable for tests; defaults to the window every other provider probes by. */
  readonly probeDays?: number;
  readonly holdingCut?: number;
}

async function additionalReviewLogPaths(
  today: ReturnType<typeof localToday>,
  probeDays: number,
  deviceId: string,
): Promise<readonly VaultPath[]> {
  return calendarDaysEndingOn(today, probeDays).map((day) => reviewLogPath(day, deviceId));
}

/** A `RegistryViewDeps` whose every method reads the vault and the log fresh — the production wiring `main.ts` hands to `RegistryView`. */
export function createLocalRegistryProvider(
  deps: CreateLocalRegistryProviderDeps,
): RegistryViewDeps {
  const overridesStore = new ObsidianRegistryOverridesStore(deps.settingsHost);
  const pruneInstrumentPort: PruneInstrumentPort = createVaultPruneInstrumentPort(
    deps.vault,
    deps.deviceId,
  );
  const holdingCut = deps.holdingCut ?? DECLARED_FALLBACK_HOLDING_CUT;
  const scheduler = createFsrsScheduler();

  return {
    async load(): Promise<RegistryViewState> {
      try {
        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = await additionalReviewLogPaths(today, probeDays, deps.deviceId);

        const [{ entries }, enumeration, overrides] = await Promise.all([
          readReviewLogHistory(deps.vault, { additionalPaths }),
          enumerateVaultInstruments(deps.vault),
          overridesStore.load(),
        ]);

        const model = buildRegistryModel({
          concepts: enumeration.concepts,
          instrumentRecords: enumeration.records,
          entries,
          scheduler,
          now,
          holdingCut,
          overrides,
          suspendedInstrumentIds: suspendedInstrumentIds(entries),
        });

        return { kind: 'model', model };
      } catch (error) {
        console.error('Olea: could not compose the registry', error);
        return { kind: 'unavailable' };
      }
    },

    async rename(entry: RegistryConceptEntry, newDisplayName: string): Promise<void> {
      const overrides = await overridesStore.load();
      const next = renameConceptOverride(overrides, entry.key, entry.originalName, newDisplayName);
      await overridesStore.save(next);
    },

    async withdrawConcept(entry: RegistryConceptEntry): Promise<void> {
      const overrides = await overridesStore.load();
      await overridesStore.save(pruneConceptOverride(overrides, entry.key));
    },

    async restoreConcept(entry: RegistryConceptEntry): Promise<void> {
      const overrides = await overridesStore.load();
      await overridesStore.save(unpruneConceptOverride(overrides, entry.key));
    },

    async withdrawInstrument(instrument: RegistryInstrumentSummary): Promise<void> {
      await pruneInstrumentPort.prune(instrument);
    },

    async restoreInstrument(instrument: RegistryInstrumentSummary): Promise<void> {
      await pruneInstrumentPort.restore(instrument);
    },

    async editInstrument(instrument: RegistryInstrumentSummary): Promise<void> {
      await deps.editPort.edit(instrument);
    },
  };
}
