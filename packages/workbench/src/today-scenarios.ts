/**
 * The addressable Today-panel states: one workbench URL per condition the
 * pane can be in.
 *
 * Sibling to `scenarios.ts`, not a branch of it — `TodayView` is a sidebar
 * pane with its own deps (`load`, `startReview`), not a full review session,
 * so it gets its own scenario builder and its own route surface
 * (`#/today/<state-id>`, `src/main.ts`).
 *
 * Two states are built from the real vault (`today-due`, `today-after-writing`,
 * `today-stale`): they call the product's own `loadTodayPanel` over the same
 * in-memory vault the review states use, walking real instruments and
 * replaying the real review log — nothing here hand-builds a `TodayViewModel`
 * for them. Two are built from `buildTodayPanel` directly with a deliberately
 * chosen edge input (`today-nothing-due`'s empty instrument list,
 * `today-unavailable`'s `null` one) — still the real, pure core function, just
 * exercised at the input that produces the state, which is the honest way to
 * reach a state a fixture vault does not naturally sit in.
 *
 * ## `ol-h3wy`, reproduced rather than described
 *
 * `TodayView.refresh()` has to be called by something — that was always true,
 * and is still true after the fix; what changed is *where* `main.ts` calls it
 * (`ReviewView.onClose`, and every `revealTodayView`). This workbench mounts
 * `TodayView` directly and never runs `main.ts`, so nothing calls `refresh()`
 * unless a scenario does. `today-after-writing` and `today-stale` both write a
 * real review-log record to the vault after the pane has opened — the same
 * kind of write `ol-h3wy`'s bug report describes finishing a session as — and
 * differ in exactly one line: whether `view.refresh()` runs afterward. That
 * is the whole bug, and the whole fix, in one boolean.
 */

import type { Rating } from 'olea-contracts';
import type { GroveCourseModel, RhythmCourseInput, Scheduler, VaultSource } from 'olea-core';
import { appendReviewLogRecord, buildTodayPanel } from 'olea-core';
import { WORKBENCH_NOW } from './clock.js';
import { Notice } from './obsidian-shim/index.js';
import type { PersonaHistory } from './persona/history.js';
import { NO_PERSONA_HISTORY } from './persona/history.js';
import {
  createVaultInstrumentSource,
  DEFAULT_STREAK_WINDOW_DAYS,
  endOfLocalDay,
  loadTodayPanel,
  localToday,
  type ReviewQueueItem,
  type TodayView,
  type TodayViewDeps,
} from './plugin-bridge.js';
import type { WorkbenchQueue } from './queue/derive.js';
import {
  isoWithLocalOffset,
  type LoggedEvent,
  type StateGroup,
  WORKBENCH_DEVICE_ID,
} from './scenarios.js';

export interface TodayWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: Extract<StateGroup, 'today'>;
  /** What this state is here to show. Rendered in the inspector. */
  readonly note: string;
}

export const TODAY_STATES: readonly TodayWorkbenchState[] = [
  {
    id: 'today-nothing-due',
    label: 'Nothing due',
    group: 'today',
    note:
      'F6.1 — a real, computed zero (buildTodayPanel with an empty instrument list), not the ' +
      '"cannot count" state below. ol-h3wy: the "Start review" button still renders at zero ' +
      '(showsStartReviewAction is true whenever due is non-null) — the front door does not ' +
      'disappear just because nothing is waiting.',
  },
  {
    id: 'today-due',
    label: 'Due today',
    group: 'today',
    note:
      'F6.1 — due total, per-course counts and the streak, computed the way main.ts computes ' +
      'them: loadTodayPanel walks the real vault instruments and replays .olea/reviews/. ' +
      'Persona history (.olea-synthetic/reviews/) is a disjoint namespace this pane never ' +
      'reads, so switching persona does not change this state — see the inspector.',
  },
  {
    id: 'today-after-writing',
    label: 'After a session (refreshed)',
    group: 'today',
    note:
      'ol-h3wy, fixed: a review just wrote to .olea/reviews/ under this pane, and ' +
      'view.refresh() was called afterward — the same call main.ts now makes from ' +
      'ReviewView.onClose and every revealTodayView. The due count and streak on screen are ' +
      'current.',
  },
  {
    id: 'today-stale',
    label: 'Stale after a session (ol-h3wy)',
    group: 'today',
    note:
      'ol-h3wy, reproduced: the identical write as "After a session", but nothing calls ' +
      "view.refresh() afterward — this workbench mounts TodayView directly, without main.ts's " +
      'wiring, so refresh only runs when a scenario asks for it. The pane on screen still shows ' +
      'what it computed when it first opened. Compare the inspector\'s "recomputed now" row ' +
      'against what is on screen: they disagree, and that disagreement is the bug.',
  },
  {
    id: 'today-unavailable',
    label: "Can't count what's due",
    group: 'today',
    note:
      'F6.1 — due: null (buildTodayPanel given a null instrument list), the "we could not read ' +
      'your vault" state. Deliberately not rendered as zero: DUE_UNAVAILABLE and NOTHING_DUE ' +
      'are different claims, and only one of them is true here. The "Start review" button stays ' +
      'absent — showsStartReviewAction is not extended to this case (see copy.ts).',
  },
  {
    id: 'today-scope-not-declared',
    label: 'Scope — no source registered (F1.5/F8.1)',
    group: 'today',
    note:
      'F6.2/F8.1 — courseScopeModels wired with one course whose GroveCourseModel status is ' +
      "'no-registered-source'. The panel's compact scope section states plainly that no " +
      'objectives document or past paper has been registered yet — the same fact ' +
      "grove/copy.ts's GROVE_NO_SOURCE_BODY states at its own screen. No prior today-* state " +
      'wired this field at all, so the section rendered nothing until this one.',
  },
  {
    id: 'today-rhythm-quiet',
    label: 'Rhythm — a genuinely quiet course (F6.9)',
    group: 'today',
    note:
      'F6.9 — courseMaterialArrivals wired with one course whose last observed arrival is well ' +
      "past QUIET_DAYS_THRESHOLD. detectRhythm is pure; the panel's rhythm section names the " +
      'course and states the measured day count plainly. No prior today-* state wired this field ' +
      'either, so the rhythm section rendered nothing until this one.',
  },
  {
    id: 'today-rhythm-fresh',
    label: 'Rhythm — material arrived recently (silence, F6.9)',
    group: 'today',
    note:
      'F6.9 — the identical course, with its last observed arrival inside the quiet window. ' +
      'Nothing crosses the threshold, so the rhythm section renders nothing at all: silence is ' +
      'the honest reading here, never a stale quiet-course line left over from another state.',
  },
];

export function findTodayState(id: string): TodayWorkbenchState | undefined {
  return TODAY_STATES.find((state) => state.id === id);
}

export interface TodayScenario {
  readonly deps: TodayViewDeps;
  /** Populated once a scenario's write has run, for the inspector. */
  readonly logged: LoggedEvent[];
  /**
   * Runs after the view has opened and settled. Where a scenario writes to the
   * vault and decides whether to call `view.refresh()` — see the module doc.
   */
  readonly afterOpen?: (view: TodayView) => Promise<void>;
  /** True only for `today-after-writing`: whether `afterOpen` calls `view.refresh()`. */
  readonly refreshedAfterWrite: boolean;
}

export interface BuildTodayScenarioOptions {
  readonly vault: VaultSource;
  readonly scheduler: Scheduler;
  /** The composed session, for the two real instruments the write-back states rate. */
  readonly queue: WorkbenchQueue;
  readonly stateId: string;
  readonly history?: PersonaHistory;
}

const RATE_GOOD: Rating = 'good';

/** Coined course code (INV-3) shared by `today-scope-not-declared` and both `today-rhythm-*` states. */
const WB_SCOPE_COURSE = 'syn:course:vantrel';

/**
 * `WORKBENCH_NOW` is `2027-01-15T09:15:00.000Z`, so `localToday` resolves to
 * `'2027-01-15'`. 31 days back clears `QUIET_DAYS_THRESHOLD` (21, the flat
 * default this fixture's un-set `tempoWeight` uses) with margin.
 */
const WB_RHYTHM_QUIET_ARRIVAL_DAY = '2026-12-15';

/** 3 days back — well inside the 21-day quiet threshold, so nothing fires. */
const WB_RHYTHM_FRESH_ARRIVAL_DAY = '2027-01-12';

export function buildTodayScenario(options: BuildTodayScenarioOptions): TodayScenario {
  const { vault, scheduler, queue, stateId } = options;
  // Unused today (see the state note on `today-due`) but accepted for symmetry
  // with `buildScenario` and so a later surface that DOES read persona history
  // (a mastery overview, Phase 4) has an unchanged call shape to grow into.
  void (options.history ?? NO_PERSONA_HISTORY);

  const logged: LoggedEvent[] = [];
  let eventCounter = 0;
  const today = localToday(WORKBENCH_NOW);
  const dueThrough = endOfLocalDay(WORKBENCH_NOW);

  const startReview: TodayViewDeps['startReview'] = () => {
    new Notice(
      'Workbench: pressing "Start review" would open a review session in the real product. ' +
        'This pane does not navigate — see the Review states in the sidebar.',
    );
  };

  const realLoad: TodayViewDeps['load'] = () =>
    loadTodayPanel({
      vault,
      deviceId: WORKBENCH_DEVICE_ID,
      instruments: createVaultInstrumentSource({
        vault,
        scheduler,
        deviceId: WORKBENCH_DEVICE_ID,
        now: () => WORKBENCH_NOW,
        excludePaths: ['README.md'],
      }),
      now: () => WORKBENCH_NOW,
    });

  /**
   * Writes one real review-log record for each of two instruments the
   * composer actually offered, exactly the way a finished session writes one
   * (`scenarios.ts`'s own `recordReview`, same shape). This is what "a review
   * just happened" means to both write-back states; only what happens *after*
   * the write differs between them.
   */
  async function writeCompletedReview(): Promise<void> {
    const items = [queue.qa[0], queue.cloze[0]].filter(
      (item): item is ReviewQueueItem => item !== undefined,
    );
    for (const item of items) {
      const result = await appendReviewLogRecord(
        vault,
        {
          timestamp: isoWithLocalOffset(WORKBENCH_NOW),
          instrumentId: item.instrument.instrumentId,
          instrumentType: item.instrument.type,
          conceptIds: [...item.instrument.conceptIds],
          rating: RATE_GOOD,
          wasUnsure: false,
          durationMs: null,
          selectionContext: item.selectionContext,
        },
        {
          deviceId: WORKBENCH_DEVICE_ID,
          generateEventId: () => {
            eventCounter += 1;
            return `wb-today-event-${String(eventCounter).padStart(4, '0')}`;
          },
        },
      );
      logged.push({ path: result.path, json: JSON.stringify(result.record) });
    }
  }

  switch (stateId) {
    case 'today-nothing-due':
      return {
        deps: {
          load: () =>
            Promise.resolve(
              // `ol-ksw7`: `courseFreshness` is now a `TodayPanelInput` field
              // `buildTodayPanel` itself resolves to `null` when omitted —
              // this state never wires a rhythm source, so no `courseFreshness`
              // input is needed to get that same "no rhythm source wired" null.
              buildTodayPanel({
                entries: [],
                instruments: [],
                today,
                dueThrough,
                windowDays: DEFAULT_STREAK_WINDOW_DAYS,
              }),
            ),
          startReview,
        },
        logged,
        refreshedAfterWrite: false,
      };

    case 'today-unavailable':
      return {
        deps: {
          load: () =>
            Promise.resolve(
              // See `today-nothing-due`'s comment above.
              buildTodayPanel({
                entries: [],
                instruments: null,
                today,
                dueThrough,
                windowDays: DEFAULT_STREAK_WINDOW_DAYS,
              }),
            ),
          startReview,
        },
        logged,
        refreshedAfterWrite: false,
      };

    case 'today-due':
      return { deps: { load: realLoad, startReview }, logged, refreshedAfterWrite: false };

    case 'today-after-writing':
      return {
        deps: { load: realLoad, startReview },
        logged,
        afterOpen: async (view) => {
          await writeCompletedReview();
          await view.refresh();
        },
        refreshedAfterWrite: true,
      };

    case 'today-stale':
      return {
        deps: { load: realLoad, startReview },
        logged,
        afterOpen: async () => {
          await writeCompletedReview();
          // Deliberately no `view.refresh()` call — see the module doc and
          // this state's note. This IS ol-h3wy's mechanism, not a simulation
          // of it.
        },
        refreshedAfterWrite: false,
      };

    case 'today-scope-not-declared': {
      const model: GroveCourseModel = { status: 'no-registered-source', course: WB_SCOPE_COURSE };
      return {
        deps: {
          load: () =>
            Promise.resolve(
              buildTodayPanel({
                entries: [],
                instruments: [],
                today,
                dueThrough,
                windowDays: DEFAULT_STREAK_WINDOW_DAYS,
                courseScopeModels: [model],
              }),
            ),
          startReview,
        },
        logged,
        refreshedAfterWrite: false,
      };
    }

    case 'today-rhythm-quiet': {
      const arrivals: RhythmCourseInput[] = [
        { course: WB_SCOPE_COURSE, lastMaterialArrivalDay: WB_RHYTHM_QUIET_ARRIVAL_DAY },
      ];
      return {
        deps: {
          load: () =>
            Promise.resolve(
              buildTodayPanel({
                entries: [],
                instruments: [],
                today,
                dueThrough,
                windowDays: DEFAULT_STREAK_WINDOW_DAYS,
                courseMaterialArrivals: arrivals,
              }),
            ),
          startReview,
        },
        logged,
        refreshedAfterWrite: false,
      };
    }

    case 'today-rhythm-fresh': {
      const arrivals: RhythmCourseInput[] = [
        { course: WB_SCOPE_COURSE, lastMaterialArrivalDay: WB_RHYTHM_FRESH_ARRIVAL_DAY },
      ];
      return {
        deps: {
          load: () =>
            Promise.resolve(
              buildTodayPanel({
                entries: [],
                instruments: [],
                today,
                dueThrough,
                windowDays: DEFAULT_STREAK_WINDOW_DAYS,
                courseMaterialArrivals: arrivals,
              }),
            ),
          startReview,
        },
        logged,
        refreshedAfterWrite: false,
      };
    }

    default:
      throw new Error(`workbench: unknown today state ${JSON.stringify(stateId)}`);
  }
}
