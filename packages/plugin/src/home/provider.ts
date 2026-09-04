/**
 * `createLocalHomeProvider` — the production `HomeDataDeps` (F6.10,
 * `[D-223]`, `ol-l5og.21` [HOME-2]). `./view.ts`'s module doc carries the
 * full argument for what Home renders now and why; this module is the read.
 *
 * **Composes two existing readers, never a third computation.** The headline
 * comes from `../session-builder/provider.ts#createLocalSessionBuilderProvider`
 * — the exact chain F4.6/F4.7/F4.8 already own — called here with no course
 * or concept filter, at the same default budget the session builder's own
 * view opens on (`DEFAULT_SESSION_BUDGET_MINUTES`). The per-course coverage
 * strips come from `../grove/provider.ts#createLocalGroveProvider` — F8.1's
 * own six-state computation. Both already recompute fresh on every call and
 * already swallow their own read failures into a `'unavailable'` sentinel
 * (never a thrown error), so `load()` below runs them concurrently and reads
 * each result rather than adding a second try/catch around logic that
 * already has one — see `./view.ts` for how each sentinel renders.
 *
 * **The retrospective offer, selected down to one per course.** `../grove/
 * provider.ts` already filters `resolveOfferCards`'s output to one course's
 * own cards (`GroveCourseSection.offerCards`) — but a course with several
 * passed, unopened assessments still gets one card PER assessment there,
 * which is correct for `[D-134]`'s own per-assessment mechanics. F6.10's own
 * clamp ("never more than one line per course") is what this module reads
 * as a SELECTION rule at render time: `pickCourseOffer` below keeps exactly
 * one, sorted by `assessmentPath` for a deterministic, stable pick across
 * two reads of the same unchanged set. This is the fix for the fidelity
 * judgment that found one course's card repeating up to six times on the
 * old flat-list Home — the repeat was never a bug in `resolveOfferCards`
 * (each card WAS a distinct, real assessment offer); it was this surface
 * rendering all of them with no course-level ceiling. Fixed here, in this
 * bead's own `owns`, rather than in `../retrospective/offer-card.ts`, which
 * `../grove/view.ts`'s own per-course list still renders unfiltered and
 * correctly (that surface has room for every assessment; this one names one
 * line per course by clause).
 *
 * **F6.10's "scope grew" quiet line.** `./scope-growth-store.ts` is the
 * durable per-install prior this needs — see that module's own doc for why
 * it is Home's own store rather than a second caller of `../grove/prior-
 * denominator-store.ts`, which tracks the opposite direction for a different
 * clause. Only `'declared'` courses ever have a real denominator to compare;
 * the whole stored map is replaced each save with exactly this read's
 * `'declared'`-course snapshots, same reasoning the grove's own prior store
 * gives for the identical replace-not-merge choice.
 *
 * **Ordering among a course's own quiet-line candidates**, since F6.10
 * allows only one: the retrospective offer wins first (F8.8's own "offered
 * from Home" mechanics is unconditional once an assessment has passed —
 * something is actually asking for her), then "scope grew" (a fact about
 * what just changed), then "set up, waiting" (a standing fact about a
 * course with nothing registered at all, which does not change read to
 * read). A course showing none of the three renders no quiet line, which is
 * F6.10's ordinary state, not a gap.
 */

import type {
  ConceptRelation,
  GroveCourseModel,
  Scheduler,
  VaultPath,
  VaultSource,
} from 'olea-core';
import { createLocalGroveProvider } from '../grove/provider.js';
import type { GroveCourseSection } from '../grove/view.js';
import type { FirstReadFolderView } from '../ingestion/wiring.js';
import type { ObsidianDataHost } from '../plan/settings-store.js';
import type { RetrospectiveOfferCard } from '../retrospective/offer-card.js';
import {
  createRetrospectiveOfferEventLog,
  type RetrospectiveOfferEventLog,
} from '../retrospective/offer-events.js';
import { createLocalRetrospectiveProvider } from '../retrospective/provider.js';
import { DEFAULT_SESSION_BUDGET_MINUTES } from '../session-builder/copy.js';
import { createLocalSessionBuilderProvider } from '../session-builder/provider.js';
import { HOME_SET_UP_WAITING, homeScopeGrewLine } from './copy.js';
import {
  type HomeScopeSnapshot,
  homeScopeGrowthReceiptFor,
  ObsidianHomeScopeGrowthStore,
} from './scope-growth-store.js';
import type { HomeCourseRow, HomeGroveMark, HomeQuietLine, HomeViewState } from './view.js';

export interface CreateLocalHomeProviderDeps {
  readonly vault: VaultSource;
  readonly deviceId: string;
  readonly settingsHost: ObsidianDataHost;
  /** Injected for determinism under test; production passes `() => new Date()`. */
  readonly now: () => Date;
  /**
   * The same `Scheduler` `main.ts` builds once for the Today panel's replay
   * and hands to the session builder's own provider — see that module's own
   * doc for why one instance, not a fresh one per surface, is what makes the
   * headline literally the same computation the session builder produces.
   */
  readonly scheduler: Scheduler;
  /**
   * F2.19/C7.9's served relation fold — the identical thunk shape and the
   * identical `[D-093]` abstention gate `../session-builder/provider.ts` and
   * `../grove/provider.ts` each already accept, passed straight through to
   * both.
   */
  readonly relations?: () => readonly ConceptRelation[];
  /**
   * `ol-ppa9` (F1.4/`[D-213]`): the first-read readout, for every course
   * folder ticked so far this session — see `./view.ts`'s own module doc for
   * why this branch still takes priority over the dashboard, unchanged by
   * this bead.
   */
  readonly firstRead?: () => readonly FirstReadFolderView[];
}

/** The data half of `HomeViewDeps` — `main.ts` adds the three navigation callbacks at the construction site. */
export interface HomeDataDeps {
  readonly load: () => Promise<HomeViewState>;
  readonly dismiss: (assessmentPath: VaultPath) => Promise<void>;
}

/** F6.10's own selection rule — see this module's doc, "The retrospective offer, selected down to one per course." */
function pickCourseOffer(
  cards: readonly RetrospectiveOfferCard[],
): RetrospectiveOfferCard | undefined {
  return [...cards].sort((a, b) => (a.assessmentPath < b.assessmentPath ? -1 : 1))[0];
}

/** F8.1's five in-scope states, reduced to F6.10's row-scale mark vocabulary — see `./view.ts`'s own doc for why `'ground'`/material-gap are not routed through the sprig. Volunteers are never included (F8.2: outside the declared scope). */
function marksForDeclaredCourse(
  model: Extract<GroveCourseModel, { readonly status: 'declared' }>,
): readonly HomeGroveMark[] {
  const stageMarks: HomeGroveMark[] = model.cells.map((cell) =>
    cell.state === 'ground' ? { kind: 'ground' } : { kind: 'stage', state: cell.state },
  );
  const gapMarks: HomeGroveMark[] = model.materialGaps.map(() => ({ kind: 'material-gap' }));
  return [...stageMarks, ...gapMarks];
}

/** One course's own quiet line, per the priority this module's doc names — `undefined` when none of the three apply. */
function quietLineFor(
  model: GroveCourseModel,
  offer: RetrospectiveOfferCard | undefined,
  growthLine: string | undefined,
): HomeQuietLine | undefined {
  if (offer !== undefined) {
    return { kind: 'retrospective-offer', text: offer.line, assessmentPath: offer.assessmentPath };
  }
  if (growthLine !== undefined) return { kind: 'scope-grew', text: growthLine };
  if (model.status === 'no-registered-source') {
    return { kind: 'set-up-waiting', text: HOME_SET_UP_WAITING };
  }
  return undefined;
}

/**
 * Builds every `HomeCourseRow` from one grove read, and persists this read's
 * `'declared'`-course scope snapshots as the NEXT read's prior — see this
 * module's own doc, "F6.10's 'scope grew' quiet line."
 */
async function buildCourseRows(
  sections: readonly GroveCourseSection[],
  scopeGrowthStore: ObsidianHomeScopeGrowthStore,
): Promise<readonly HomeCourseRow[]> {
  const priorScope = await scopeGrowthStore.load();
  const nextScope = new Map<string, HomeScopeSnapshot>();

  const rows = sections.map((section): HomeCourseRow => {
    const { course, model } = section;
    const offer = pickCourseOffer(section.offerCards);

    if (model.status !== 'declared') {
      const quiet = quietLineFor(model, offer, undefined);
      return { course, ...(quiet !== undefined ? { quiet } : {}) };
    }

    const current: HomeScopeSnapshot = {
      denominatorCount: model.summary.denominatorCount,
      denominatorSourcePaths: model.summary.denominatorSourcePaths,
    };
    nextScope.set(course, current);
    const growth = homeScopeGrowthReceiptFor(priorScope.get(course), current);
    const growthLine =
      growth !== undefined
        ? homeScopeGrewLine(
            growth.addedDocumentPath,
            growth.newDenominatorCount - growth.priorDenominatorCount,
          )
        : undefined;

    const quiet = quietLineFor(model, offer, growthLine);
    return {
      course,
      marks: marksForDeclaredCourse(model),
      ...(quiet !== undefined ? { quiet } : {}),
    };
  });

  await scopeGrowthStore.save(nextScope);
  return rows;
}

export function createLocalHomeProvider(deps: CreateLocalHomeProviderDeps): HomeDataDeps {
  const sessionProvider = createLocalSessionBuilderProvider({
    vault: deps.vault,
    deviceId: deps.deviceId,
    settingsHost: deps.settingsHost,
    now: deps.now,
    scheduler: deps.scheduler,
    ...(deps.relations !== undefined ? { relations: deps.relations } : {}),
  });
  const groveProvider = createLocalGroveProvider({
    vault: deps.vault,
    deviceId: deps.deviceId,
    settingsHost: deps.settingsHost,
    now: deps.now,
    ...(deps.relations !== undefined ? { relations: deps.relations } : {}),
  });
  const scopeGrowthStore = new ObsidianHomeScopeGrowthStore(deps.settingsHost);
  const offerStore: RetrospectiveOfferEventLog = createRetrospectiveOfferEventLog({
    vault: deps.vault,
    deviceId: deps.deviceId,
    now: deps.now,
  });
  const retrospective = createLocalRetrospectiveProvider({
    vault: deps.vault,
    deviceId: deps.deviceId,
    offerStore,
    settingsHost: deps.settingsHost,
    now: deps.now,
  });

  return {
    async load(): Promise<HomeViewState> {
      // `ol-ppa9` (F1.4/`[D-213]`): read fresh every call, never cached —
      // see `./view.ts`'s own module doc.
      const firstReadFolders = deps.firstRead?.() ?? [];
      if (firstReadFolders.length > 0) {
        return { kind: 'first-read', folders: firstReadFolders };
      }

      try {
        // F6.4's headline and F8.1's per-course maps are independent reads of
        // the same vault — paid concurrently, the same reasoning every other
        // multi-read provider in this plugin already gives.
        const [session, grove] = await Promise.all([
          sessionProvider.load({ budgetMinutes: DEFAULT_SESSION_BUDGET_MINUTES }),
          groveProvider.load(),
        ]);
        const courses =
          grove.kind === 'model' ? await buildCourseRows(grove.courses, scopeGrowthStore) : [];
        return { kind: 'dashboard', session, courses };
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
