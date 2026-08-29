/**
 * `createLocalHomeProvider` — the production `HomeDataDeps` (F8.8,
 * `[D-134]` Q1, `ol-0r92.17`). `./view.ts`'s module doc carries the full
 * argument for what "Home" means in this bead; this module is the read.
 *
 * Every standing offer, across every assessment and course — `resolveOffer
 * Cards`, unfiltered — matching `retrospective/offer-card.ts`'s own module
 * doc: "a future Home view would render all of them." `grove/provider.ts`
 * runs the identical computation and keeps only each course's own cards;
 * the two are not shared into one module because they differ in exactly
 * one filter, and sharing would need a home neither bead more naturally
 * owns than the other.
 *
 * **`openRetrospective` is deliberately absent from this factory's return
 * value** — a navigation callback, supplied by `main.ts` at the view
 * construction site, the same split `today/view.ts`'s `startReview` draws.
 *
 * Dismissal is delegated to `createLocalRetrospectiveProvider`'s own
 * `markDismissed` rather than re-implementing the `data.json` append this
 * bead does not own (`retrospective/offer-store.ts`).
 */

import {
  type AssessmentRecord,
  readAssessments,
  type VaultPath,
  type VaultSource,
} from 'olea-core';
import { ObsidianStudyPlanSettingsStore } from '../plan/settings-store.js';
import { resolveOfferCards } from '../retrospective/offer-card.js';
import type { ObsidianDataHost } from '../retrospective/offer-store.js';
import { ObsidianRetrospectiveOfferStore } from '../retrospective/offer-store.js';
import { createLocalRetrospectiveProvider } from '../retrospective/provider.js';
import type { HomeViewState } from './view.js';

export interface CreateLocalHomeProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
}

/** The data half of `HomeViewDeps` — `main.ts` adds `openRetrospective` at the construction site. */
export interface HomeDataDeps {
  readonly load: () => Promise<HomeViewState>;
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

async function safeAssessmentRecords(
  vault: VaultSource,
  basePath: string,
): Promise<readonly AssessmentRecord[]> {
  try {
    return (await readAssessments(vault, basePath)).records;
  } catch {
    // Not-yet-configured (`assignmentsBasePath === ''`) is the ordinary
    // early case — Home has nothing standing then, which is a true `[]`,
    // not an unavailable read.
    return [];
  }
}

export function createLocalHomeProvider(deps: CreateLocalHomeProviderDeps): HomeDataDeps {
  const settingsStore = new ObsidianStudyPlanSettingsStore(deps.settingsHost);
  const offerStore = new ObsidianRetrospectiveOfferStore(deps.settingsHost);
  const retrospective = createLocalRetrospectiveProvider({
    vault: deps.vault,
    deviceId: deps.deviceId,
    offerStore,
    settingsHost: deps.settingsHost,
    now: deps.now,
  });

  return {
    async load(): Promise<HomeViewState> {
      try {
        const now = deps.now();
        const { assignmentsBasePath } = await settingsStore.load();
        const [records, offerEvents] = await Promise.all([
          safeAssessmentRecords(deps.vault, assignmentsBasePath),
          offerStore.load(),
        ]);
        const cards = resolveOfferCards(records, offerEvents, now);
        return { kind: 'offers', cards };
      } catch (error) {
        console.error('Olea: could not compose Home', error);
        return { kind: 'unavailable' };
      }
    },

    async dismiss(assessmentPath: VaultPath): Promise<void> {
      await retrospective.markDismissed(assessmentPath);
    },
  };
}
