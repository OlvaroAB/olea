/**
 * `createLocalGroveProvider` — the production `GroveDataDeps` (F8.1,
 * `[D-134]` Q1, `ol-0r92.17`). `./view.ts`'s module doc carries the full
 * argument for what this reads and why; the short version: this reuses
 * `buildRegistryModel` — the SAME projection `registry/provider.ts` reads
 * for F8.4's browse screen — grouped by course, rather than a second,
 * parallel computation of growth stage. Nothing here is a new fact about
 * her mastery; grouping by `RegistryConceptEntry.courses` and filtering out
 * withdrawn (`pruned`) concepts is the only work this module adds.
 *
 * **`openRetrospective` is deliberately absent from this factory's return
 * value.** It is a navigation callback (which Obsidian leaf to reveal),
 * not a data concern — `main.ts` supplies it directly at the view
 * construction site, the same split `today/view.ts`'s `startReview` and
 * `gap/view.ts`'s `buildSession` already draw between "what a provider
 * reads" and "what a host does with a click."
 *
 * **Whole-log mastery, not windowed** — same reasoning `registry/
 * provider.ts` states for its own read: growth stage is a current-state,
 * high-water-mark reading, and a windowed read would understate an old
 * concept's stage.
 *
 * **The standing offer, computed once, filtered per course** — mirrors
 * `home/provider.ts`'s identical computation over the SAME assessments and
 * offer-event reads; the two are not shared into one module because they
 * differ in exactly one line (grouping by course vs. not), and sharing
 * would mean a new file outside either bead's more natural home. Dismissal
 * is delegated to `createLocalRetrospectiveProvider`'s own `markDismissed`
 * — this module does not re-implement the `data.json` append.
 */

import {
  type AssessmentRecord,
  buildRegistryModel,
  calendarDaysEndingOn,
  createFsrsScheduler,
  enumerateVaultInstruments,
  type RegistryConceptEntry,
  readAssessments,
  readReviewLogHistory,
  reviewLogPath,
  suspendedInstrumentIds,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import type { ObsidianDataHost } from '../plan/settings-store.js';
import { ObsidianStudyPlanSettingsStore } from '../plan/settings-store.js';
import { ObsidianRegistryOverridesStore } from '../registry/overrides-store.js';
import { resolveOfferCards } from '../retrospective/offer-card.js';
import { createRetrospectiveOfferEventLog } from '../retrospective/offer-events.js';
import { createLocalRetrospectiveProvider } from '../retrospective/provider.js';
import { localToday, SCHEDULING_HISTORY_PROBE_DAYS } from '../today/data-source.js';
import type { GroveConceptRow, GroveCourseSection, GroveViewState } from './view.js';

/**
 * Same DECLARED shape `registry/provider.ts` and `retrospective/
 * provider.ts` each already carry — a plain-English default
 * (`buildRegistryModel` requires a holding cut to compute vitality), never
 * read by this module: F8.1 asks for growth stage/position, not vitality,
 * so `GroveConceptRow` never carries `.vitality`. Kept declared rather than
 * omitted so this call matches `BuildRegistryModelInput`'s real shape
 * without inventing a fourth site for the same unmeasured constant.
 */
const DECLARED_FALLBACK_HOLDING_CUT = 0.8;

export interface CreateLocalGroveProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /** Overridable for tests; defaults to the window every other provider probes by. */
  readonly probeDays?: number;
}

/** The data half of `GroveViewDeps` — `main.ts` adds `openRetrospective` at the construction site. */
export interface GroveDataDeps {
  readonly load: () => Promise<GroveViewState>;
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

function toConceptRow(entry: RegistryConceptEntry): GroveConceptRow {
  return { conceptId: entry.key, name: entry.displayName, mastery: entry.mastery.state };
}

async function safeAssessmentRecords(
  vault: VaultSource,
  basePath: string,
): Promise<readonly AssessmentRecord[]> {
  try {
    return (await readAssessments(vault, basePath)).records;
  } catch {
    // Not-yet-configured (`assignmentsBasePath === ''`) and an unreadable
    // `.base` file both land here — the grove's concept sections are still
    // real without a single registered assessment, so this module does not
    // let a missing assignments Base sink the whole view the way `registry/
    // provider.ts`'s vault-walk failure legitimately does.
    return [];
  }
}

export function createLocalGroveProvider(deps: CreateLocalGroveProviderDeps): GroveDataDeps {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);
  const offerStore = createRetrospectiveOfferEventLog({
    vault: deps.vault,
    deviceId: deps.deviceId,
    now: deps.now,
  });
  // Same store `RegistryView` reads (`registry/overrides-store.ts`) — a
  // concept withdrawn there (F8.5) stays withdrawn here too, rather than
  // this read-only browse reintroducing it through a second, unaware path.
  const overridesStore = new ObsidianRegistryOverridesStore(deps.settingsHost);
  const retrospective = createLocalRetrospectiveProvider({
    vault: deps.vault,
    deviceId: deps.deviceId,
    offerStore,
    settingsHost: deps.settingsHost,
    now: deps.now,
  });
  const scheduler = createFsrsScheduler();

  return {
    async load(): Promise<GroveViewState> {
      try {
        const now = deps.now();
        const today = localToday(now);
        const probeDays = deps.probeDays ?? SCHEDULING_HISTORY_PROBE_DAYS;
        const additionalPaths = calendarDaysEndingOn(today, probeDays).map((day) =>
          reviewLogPath(day, deps.deviceId),
        );
        const { assignmentsBasePath } = await settingsStore.load();

        const [{ entries }, enumeration, offerEvents, assessmentRecords, overrides] =
          await Promise.all([
            readReviewLogHistory(deps.vault, { additionalPaths }),
            enumerateVaultInstruments(deps.vault),
            offerStore.load(),
            safeAssessmentRecords(deps.vault, assignmentsBasePath),
            overridesStore.load(),
          ]);

        const model = buildRegistryModel({
          concepts: enumeration.concepts,
          instrumentRecords: enumeration.records,
          entries,
          scheduler,
          now,
          holdingCut: DECLARED_FALLBACK_HOLDING_CUT,
          overrides,
          suspendedInstrumentIds: suspendedInstrumentIds(entries),
        });

        // F8.5: withdrawn concepts stay off the default grove reading, the
        // same default `RegistryView` draws — never deleted, just excluded
        // from this browse.
        const visible = model.concepts.filter((entry) => !entry.pruned);

        const courseNames = new Set<string>();
        for (const entry of visible) for (const course of entry.courses) courseNames.add(course);
        for (const record of assessmentRecords) {
          if (record.course !== undefined) courseNames.add(record.course);
        }

        // `resolveOfferCards` itself excludes anything not yet passed, or
        // already opened/dismissed (see its own module doc) — every
        // assessment record is handed in unfiltered.
        const allCards = resolveOfferCards(assessmentRecords, offerEvents, now);

        const courses: GroveCourseSection[] = [...courseNames].sort().map((course) => ({
          course,
          concepts: visible
            .filter((entry) => entry.courses.includes(course))
            .map(toConceptRow)
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
          offerCards: allCards.filter((card) => card.course === course),
        }));

        return { kind: 'model', courses };
      } catch (error) {
        console.error('Olea: could not compose the grove', error);
        return { kind: 'unavailable' };
      }
    },

    async dismiss(assessmentPath: VaultPath): Promise<void> {
      await retrospective.markDismissed(assessmentPath);
    },
  };
}
