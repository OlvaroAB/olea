/**
 * The addressable oracle-surface states: one workbench URL per contract
 * clause the `mastery → rank → plan → gap` chain makes visible
 * (`ol-opmb.1` [TB-1]). Mirrors `today-scenarios.ts`'s shape: a state list,
 * a finder, and a builder that returns the real view's `deps` plus whatever
 * extra data the inspector needs.
 *
 * Every state renders the plugin's **real** `GapView`
 * (`../../plugin/src/gap/view.js`, re-exported through `plugin-bridge.js` and
 * `oracle-bridge.js`) against a `SyntheticWorld` — never a hand-built
 * `GapViewModel`. Six of the eight states share one derivation
 * (`deriveClosedLoop` over `steady-reviewer`) and differ only in which row or
 * fact the state's `note` points at, which is honest rather than a
 * shortcut: `oracle-ranked`, `oracle-abstained`, `gap-mastery`,
 * `gap-coverage`, `gap-material` and `coverage-unreadable-source` are all
 * simultaneously true of the SAME world (`curriculum.ts`'s module doc says
 * why: one course ranks, one abstains, and the three gap classes are three
 * different rows of the same course by construction). `plan-fresh` and
 * `plan-stale-offline` are genuinely different code paths — `refreshStudyPlan`
 * against a provider that succeeds vs. one that throws — and get their own
 * derivation. A ninth state, `oracle-struggling`, is not in the parent bead's
 * list but exists for the same reason `strugglingCourseReadsWorse` does: Trap
 * 2's defence belongs on screen, not only in a spec file.
 */

import type { StudyPlanEnvelope } from 'olea-contracts';
import { utcDate, WORKBENCH_NOW } from './clock.js';
import { deriveClosedLoop, deriveOracle, type OracleDeriveResult } from './oracle/derive.js';
import { withSyntheticDisplayNames } from './oracle/display-names.js';
import type { PipelineTrace } from './oracle/trace.js';
import type {
  GapViewDeps,
  GapViewState,
  StudyPlanProvider,
  StudyPlanRefreshResult,
  StudyPlanStore,
} from './oracle-bridge.js';
import { refreshStudyPlan } from './oracle-bridge.js';
import { buildWorld, type PersonaId } from './synthetic-bridge.js';

export interface OracleWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'oracle';
  /** Which persona's stream drives mastery for this state. */
  readonly persona: PersonaId;
  /** What this state is here to show. Rendered in the inspector. */
  readonly note: string;
}

export const ORACLE_STATES: readonly OracleWorkbenchState[] = [
  {
    id: 'oracle-ranked',
    label: 'Ranked (F4.2)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: "vantrel's four concepts, ranked with reasoning and citations, computed with no model call — F4.2's whole inspectable ranking.",
  },
  {
    id: 'oracle-abstained',
    label: 'Abstained — no evidence',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: 'quorbin has a registered assessment and zero evidence edges (curriculum.ts). It abstains rather than ranking from course membership alone — scroll to quorbin below; it never renders as a course that simply came back empty.',
  },
  {
    id: 'gap-mastery',
    label: 'Gap row — mastery-gap (F4.3)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: 'melspar: her material names it and cards exist for it, so this row reads "you know this badly" rather than "you have not started".',
  },
  {
    id: 'gap-coverage',
    label: 'Gap row — coverage-gap (F4.5)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: 'dornith: her material names it, no instrument exists yet — "you have not started". The draft-cards affordance is safe here because the notes exist to draft from.',
  },
  {
    id: 'gap-material',
    label: 'Gap row — material-gap (F4.10)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: "kelvane: the assessment evidence names it, her material does not. This row's affordances are ['find-source'] only — never draft-cards, not disabled, not relabelled. There is nothing to ground a draft on.",
  },
  {
    id: 'coverage-unreadable-source',
    label: 'Coverage scope — unreadable source (ol-cvsc)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: 'The corpus always carries one unreadable source and one that read and yielded nothing, so canStateExhaustiveness is false: the screen withdraws its "nothing else is missing" claim rather than rendering a false reassurance.',
  },
  {
    id: 'plan-fresh',
    label: 'Plan — fresh (provider succeeds)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: "refreshStudyPlan against a provider that returns today's plan: source 'provider', offline false. Check the inspector's plan row.",
  },
  {
    id: 'plan-stale-offline',
    label: 'Plan — stale, offline (provider throws)',
    group: 'oracle',
    persona: 'steady-reviewer',
    note: "refreshStudyPlan against a provider that throws: the plan already on disk (computed at an earlier asOf, a genuinely different planVersion) is kept — source 'cache', offline true, with a reason. F7.8: review keeps working with no AI at all.",
  },
  {
    id: 'oracle-struggling',
    label: 'Ground truth surfaces (Trap 2)',
    group: 'oracle',
    persona: 'struggler',
    note: "The struggler persona's declared strugglingCourseIds names vantrel. Her mastery here reads worse for vantrel's concepts than the steady reviewer's identical curriculum does — strugglingCourseReadsWorse in oracle/derive.spec.ts asserts this; this state is where a person can see it rather than take the assertion's word for it.",
  },
];

export function findOracleState(id: string): OracleWorkbenchState | undefined {
  return ORACLE_STATES.find((state) => state.id === id);
}

export interface OracleScenario {
  readonly deps: GapViewDeps;
  readonly note: string;
  readonly trace: PipelineTrace;
  readonly plan: StudyPlanEnvelope;
  /** Present only for `plan-fresh` / `plan-stale-offline`. */
  readonly refresh?: StudyPlanRefreshResult;
}

// Deliberately the SAME seed and spec shape `persona/history.ts`'s `specFor`
// uses (`HISTORY_SEED = 'workbench'`, same start date, days and assessment
// offsets) — not a coincidence. `generateStream` is a pure function of its
// spec, so for any persona both modules support, `buildWorld(...).stream` is
// byte-identical to `buildPersonaHistory(id).stream`. That is what makes
// `PersonaHistory.rawEntries` a genuine alternative entry point rather than
// decoration: a caller who already has the review/today surfaces' loaded
// persona can feed its `rawEntries` straight into `oracle/derive.ts` and get
// this same data, without this module regenerating it a second time.
const WORLD_SEED = 'workbench';
const WORLD_START_DATE = '2026-10-17';
const WORLD_DAYS = 90;
const WORLD_ASSESSMENT_DAY_OFFSETS: readonly number[] = [42, 93];

function worldFor(persona: PersonaId) {
  return buildWorld({
    persona,
    seed: WORLD_SEED,
    startDate: WORLD_START_DATE,
    days: WORLD_DAYS,
    deviceId: 'workbench',
    utcOffset: '+00:00',
    assessmentDayOffsets: WORLD_ASSESSMENT_DAY_OFFSETS,
  });
}

function createMemoryStudyPlanStore(seed: unknown): StudyPlanStore {
  let value: unknown = seed;
  return {
    load: () => Promise.resolve(value),
    save: (plan) => {
      value = plan;
      return Promise.resolve();
    },
  };
}

/** A plan built from the SAME world at an earlier `asOf` — genuinely stale, not a copy relabelled. */
async function buildStaleCachedPlan(persona: PersonaId): Promise<StudyPlanEnvelope> {
  const world = worldFor(persona);
  const staleAsOf = utcDate(new Date(WORKBENCH_NOW.getTime() - 10 * 86_400_000));
  const { result } = await deriveOracle({
    world,
    asOf: staleAsOf,
    computedAt: new Date(WORKBENCH_NOW.getTime() - 10 * 86_400_000).toISOString(),
  });
  return result.plan;
}

/** Builds one oracle-surface state. Async: every stage below is a real computation, never a stub. */
export async function buildOracleScenario(stateId: string): Promise<OracleScenario> {
  const state = findOracleState(stateId);
  if (state === undefined)
    throw new Error(`workbench: unknown oracle state ${JSON.stringify(stateId)}`);

  const world = worldFor(state.persona);
  const asOf = utcDate(WORKBENCH_NOW);
  const computedAt = WORKBENCH_NOW.toISOString();
  const closed: OracleDeriveResult = await deriveClosedLoop({ world, asOf, computedAt });

  // `withSyntheticDisplayNames`: `closed.gap` still keys everything on the
  // coined `syn:concept:…`/`syn:course:…` ids (see that module's doc) — this
  // is the one place they turn into what `GapView` actually shows her
  // (WBF-1, `ol-mxw3`).
  const load: GapViewDeps['load'] = () =>
    Promise.resolve<GapViewState>({ kind: 'model', model: withSyntheticDisplayNames(closed.gap) });

  if (stateId === 'plan-fresh' || stateId === 'plan-stale-offline') {
    const stalePlan = await buildStaleCachedPlan(state.persona);
    const store = createMemoryStudyPlanStore(stalePlan);
    const provider: StudyPlanProvider =
      stateId === 'plan-fresh'
        ? { fetchPlan: () => Promise.resolve(closed.plan) }
        : {
            fetchPlan: () => {
              throw new Error(
                'workbench: simulated provider failure (no network in this scenario)',
              );
            },
          };
    const refresh = await refreshStudyPlan({ store, provider, now: () => WORKBENCH_NOW });
    return { deps: { load }, note: state.note, trace: closed.trace, plan: closed.plan, refresh };
  }

  return { deps: { load }, note: state.note, trace: closed.trace, plan: closed.plan };
}
