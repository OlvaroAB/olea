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
 *
 * **`deps.onOverridesChanged` (`ol-r5j4`) is the one exception to "no
 * cache," and it is not this provider's own cache.** `retrieve()`'s two
 * production callers need a `RegistryOverrides` snapshot assembled
 * synchronously (`ol-l5og.11`'s alias expansion), while this store's own
 * `load()` is async — so `main.ts` keeps a cached copy for THAT purpose,
 * refreshed by this optional hook every time `rename`/`withdrawConcept`/
 * `restoreConcept` below write a new blob. This provider's own `load()`
 * above is untouched by it and still reads fresh every time, exactly as
 * before.
 */

import {
  buildRegistryModel,
  calendarDaysEndingOn,
  createFsrsScheduler,
  enumerateVaultInstruments,
  pruneConcept as pruneConceptOverride,
  type RegistryConceptEntry,
  type RegistryInstrumentSummary,
  type RegistryOverrides,
  type RegistrySourceLocation,
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

/** `[D-171]`'s click-through half: open a concept's or instrument's source location. */
export interface OpenSourceLocationPort {
  open(location: RegistrySourceLocation): Promise<void>;
}

export interface CreateLocalRegistryProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** The one Obsidian-backed port (INV-1) — see `./obsidian-ports.ts`'s `createObsidianEditInstrumentPort`. */
  readonly editPort: EditInstrumentPort;
  /**
   * The one Obsidian-backed port for `[D-171]`'s click-through — see
   * `./obsidian-ports.ts`'s `createObsidianOpenSourceLocationPort`.
   *
   * **Optional, deliberately, and only until `main.ts` is updated.** This
   * bead owns `packages/plugin/src/registry/` only; `main.ts`'s existing
   * `createLocalRegistryProvider({...})` call (the production caller, at the
   * call site this same file's `editPort` line sits in) is one line outside
   * that ownership. Omitting this field falls back to a port that logs and
   * does nothing, so a build that has not yet added the line still compiles
   * and fails LOUDLY rather than silently — never a default that pretends to
   * work. See this bead's close notes for the exact one-line addition.
   */
  readonly openSourceLocationPort?: OpenSourceLocationPort;
  /** Overridable for tests; defaults to the window every other provider probes by. */
  readonly probeDays?: number;
  readonly holdingCut?: number;
  /**
   * `ol-r5j4`: best-effort notification of a freshly-saved `RegistryOverrides`
   * blob, fired after every `overridesStore.save()` below (rename, withdraw,
   * restore). Exists so `main.ts` can keep a cached copy current for
   * `retrieve()`'s two production callers (`draftQuizCardsDeps`,
   * `composeExplainWhySourceChunks`) without either of them awaiting this
   * store's own async `load()` — see those call sites' own doc for why a
   * cache, not an async deps refactor, is the mechanism. Optional and
   * fire-and-forget, same shape `onUnitsLanded`/`onVerdict` already use one
   * directory over (`ingestion/wiring.ts`, `ingestion/materiality/wiring.ts`)
   * for the identical reason: a downstream cache-refresh failure must never
   * make a rename/prune/restore itself look like it failed.
   */
  readonly onOverridesChanged?: (overrides: RegistryOverrides) => void;
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
  const openSourceLocationPort: OpenSourceLocationPort = deps.openSourceLocationPort ?? {
    async open(location: RegistrySourceLocation) {
      console.error(
        'Olea: registry source-location click-through has no port wired ([D-171]) — a location was requested but not opened',
        location.sourcePath,
      );
    },
  };

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
      deps.onOverridesChanged?.(next);
    },

    async withdrawConcept(entry: RegistryConceptEntry): Promise<void> {
      const overrides = await overridesStore.load();
      const next = pruneConceptOverride(overrides, entry.key);
      await overridesStore.save(next);
      deps.onOverridesChanged?.(next);
    },

    async restoreConcept(entry: RegistryConceptEntry): Promise<void> {
      const overrides = await overridesStore.load();
      const next = unpruneConceptOverride(overrides, entry.key);
      await overridesStore.save(next);
      deps.onOverridesChanged?.(next);
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

    async openSourceLocation(location: RegistrySourceLocation): Promise<void> {
      await openSourceLocationPort.open(location);
    },
  };
}
