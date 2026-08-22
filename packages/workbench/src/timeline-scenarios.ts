/**
 * The timeline surface's addressable states (`ol-opmb.5` [TB-4], half one):
 * time as an axis over the real `GapView`, not a tenth static oracle state.
 *
 * Mirrors `oracle-scenarios.ts`'s shape (a state list, a finder, a builder
 * returning the real view's `deps` plus inspector data) with one structural
 * difference: an oracle state is one `(persona)` pair rendered at the fixed
 * workbench instant; a timeline state is one `(persona)` pinned to a whole
 * simulated semester, and the currently-viewed DAY is a second URL parameter
 * (`day=<n>`, `main.ts`'s `Route.day`) rather than a new state per day — "a
 * day scrubber over a derived series, not more states" (the bead's own
 * framing).
 *
 * `oracle/timeline.ts` does the actual work (`deriveOracleTimeline`); this
 * file only picks four personas whose planted patterns make a walk through
 * their semester legible on screen, and caches each persona's timeline so
 * scrubbing the day slider does not recompute ninety closed-loop derivations
 * per click.
 */

import { WORKBENCH_NOW } from './clock.js';
import { withSyntheticDisplayNames } from './oracle/display-names.js';
import {
  deriveOracleTimeline,
  masteryAdvancementOverTime,
  type OracleTimeline,
  planVersionSeries,
  queueCompositionVaries,
  type TimelineDayResult,
} from './oracle/timeline.js';
import type { StageId } from './oracle/trace.js';
import type { GapViewDeps, GapViewState } from './oracle-bridge.js';
import { buildWorld, type PersonaId } from './synthetic-bridge.js';

export interface TimelineWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'timeline';
  readonly persona: PersonaId;
  readonly note: string;
}

export const TIMELINE_STATES: readonly TimelineWorkbenchState[] = [
  {
    id: 'timeline-steady',
    label: 'Steady reviewer, across a semester',
    group: 'timeline',
    persona: 'steady-reviewer',
    note:
      'Scrub the day. Mastery rises where she practises, the queue composition changes day to ' +
      "day, and melspar's gap row picks up a readiness note once its MCQ has actually been " +
      'reviewed — none of that is visible from any single-instant oracle state.',
  },
  {
    id: 'timeline-struggler',
    label: 'Struggler, across a semester',
    group: 'timeline',
    persona: 'struggler',
    note:
      "Trap 2's defence, on screen across time rather than at one instant: vantrel reads worse " +
      'than her other course by the end of the semester, and this is where that shows rather ' +
      'than only being asserted in a test.',
  },
  {
    id: 'timeline-lapsed-returner',
    label: 'Lapsed returner, across a semester',
    group: 'timeline',
    persona: 'lapsed-returner',
    note:
      'Ten days with no events at all (her declared blackout), bracketed by ordinary study on ' +
      'both sides — scrub through it and back out the other side.',
  },
  {
    id: 'timeline-crammer',
    label: 'Crammer, across a semester',
    group: 'timeline',
    persona: 'crammer',
    note:
      'Reviews cluster into the days before each assessment. Scrub to a cram window and watch ' +
      'exam proximity pull the ranking around it.',
  },
];

export function findTimelineState(id: string): TimelineWorkbenchState | undefined {
  return TIMELINE_STATES.find((state) => state.id === id);
}

// Deliberately the SAME 90-day, `+00:00` shape `oracle-scenarios.ts`'s
// `worldFor` uses, so a timeline state's day 90 lands on the same asOf a
// single-instant oracle state renders at — a viewer can cross-check one
// against the other.
const WORLD_SEED = 'workbench-timeline';
const WORLD_START_DATE = '2026-10-17';
const WORLD_DAYS = 90;
const WORLD_ASSESSMENT_DAY_OFFSETS: readonly number[] = [42, 93];

/** Roughly mid-semester — enough evidence to be interesting without opening on a blank day 0. */
export const DEFAULT_TIMELINE_DAY = 60;

function computedAtFor(asOf: string): string {
  // Every day's plan is "computed" at the same wall-clock hour the single
  // fixed-instant oracle states use — WORKBENCH_NOW's own hour — so nothing
  // about a day's plan artifact looks stranger than an oracle state's would.
  const hour = WORKBENCH_NOW.toISOString().slice(11);
  return `${asOf}T${hour}`;
}

const timelineCache = new Map<PersonaId, Promise<OracleTimeline>>();

function timelineFor(persona: PersonaId): Promise<OracleTimeline> {
  const cached = timelineCache.get(persona);
  if (cached !== undefined) return cached;
  const world = buildWorld({
    persona,
    seed: WORLD_SEED,
    startDate: WORLD_START_DATE,
    days: WORLD_DAYS,
    deviceId: 'workbench',
    utcOffset: '+00:00',
    assessmentDayOffsets: WORLD_ASSESSMENT_DAY_OFFSETS,
  });
  const built = deriveOracleTimeline({ world, computedAtFor });
  timelineCache.set(persona, built);
  return built;
}

/** Every `StageId` whose `outputSummary` differs from the previous day's — "which stage moved it" (the bead's own phrase). `[]` on day 0 (nothing precedes it). */
function stagesChangedSincePreviousDay(
  timeline: OracleTimeline,
  dayIndex: number,
): readonly StageId[] {
  if (dayIndex <= 0) return [];
  const today = timeline.days[dayIndex];
  const yesterday = timeline.days[dayIndex - 1];
  if (today === undefined || yesterday === undefined) return [];
  const changed: StageId[] = [];
  for (const stage of today.result.trace.stages) {
    const previous = yesterday.result.trace.stages.find((s) => s.stage === stage.stage);
    if (
      previous === undefined ||
      JSON.stringify(previous.outputSummary) !== JSON.stringify(stage.outputSummary) ||
      previous.status !== stage.status
    ) {
      changed.push(stage.stage);
    }
  }
  return changed;
}

export interface TimelineScenario {
  readonly deps: GapViewDeps;
  readonly note: string;
  readonly persona: PersonaId;
  readonly day: TimelineDayResult;
  readonly dayIndex: number;
  readonly totalDays: number;
  /** Every distinct planVersion across the WHOLE timeline, in order — "what a plan version changing over time actually looks like" (C7.6, the parent bead's own ask). */
  readonly planVersionSeries: readonly string[];
  /** Which pipeline stages' output differs from the previous day's — `[]` on day 0. */
  readonly changedStages: readonly StageId[];
  /** The anti-degeneracy read on the FULL timeline (not just this day) — surfaced so a viewer never has to take the loop's liveness on faith. */
  readonly antiDegeneracy: {
    readonly queueVaries: boolean;
    readonly masteryRose: boolean;
  };
}

function clampDay(day: number, totalDays: number): number {
  if (!Number.isFinite(day)) return DEFAULT_TIMELINE_DAY;
  return Math.min(Math.max(Math.trunc(day), 0), Math.max(totalDays - 1, 0));
}

/** Builds one timeline-surface state at one day. Async: the underlying timeline is a real (cached) computation, never a stub. */
export async function buildTimelineScenario(
  stateId: string,
  requestedDay: number,
): Promise<TimelineScenario> {
  const state = findTimelineState(stateId);
  if (state === undefined)
    throw new Error(`workbench: unknown timeline state ${JSON.stringify(stateId)}`);

  const timeline = await timelineFor(state.persona);
  const dayIndex = clampDay(requestedDay, timeline.days.length);
  const day = timeline.days[dayIndex];
  if (day === undefined) throw new Error('workbench: timeline produced no days');

  // WBF-1 (`ol-mxw3`): `day.result.gap` still keys on the coined
  // `syn:concept:…`/`syn:course:…` ids — see `oracle/display-names.js`'s
  // module doc for why the substitution happens here, after the whole chain
  // agreed on identity, rather than upstream.
  const load: GapViewDeps['load'] = () =>
    Promise.resolve<GapViewState>({
      kind: 'model',
      model: withSyntheticDisplayNames(day.result.gap),
    });

  return {
    deps: { load },
    note: state.note,
    persona: state.persona,
    day,
    dayIndex,
    totalDays: timeline.days.length,
    planVersionSeries: planVersionSeries(timeline),
    changedStages: stagesChangedSincePreviousDay(timeline, dayIndex),
    antiDegeneracy: {
      queueVaries: queueCompositionVaries(timeline),
      masteryRose: masteryAdvancementOverTime(timeline).rose,
    },
  };
}
