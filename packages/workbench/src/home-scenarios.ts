/**
 * `HomeView`'s own flat-surface states (`ol-qq61`, follow-up to `ol-z6x2`
 * [WB-2]). `[D-243]` (`ol-egov.132.7` [SESS-8.7]) moved the composed-session
 * headline (F6.4/F6.10), the ranked item list, the "could not find X" copy
 * and `SessionBuilderView`'s own `kind: 'unavailable'` box out of the (now
 * shrunk) session-builder screen and into `../../plugin/src/home/view.ts`'s
 * `HomeView`. Before this file, nothing in this workbench mounted `HomeView`
 * as a flat, addressable surface at all — `mountSession` (`main.ts`) still
 * mounted the real `SessionBuilderView` directly, which post-`[D-243]`
 * renders only the three F4.6 steering inputs, so none of what moved was
 * exercisable outside the simulator's whole real `OleaPlugin` mount. See
 * `session.spec.ts`'s own module doc for the fuller account of the gap this
 * closes, and `ol-qq61`'s own bead text.
 *
 * **Reuses `session-scenarios.ts#buildSessionScenario` for the
 * composed-session half, rather than re-deriving it a second time.**
 * `HomeViewState`'s `'dashboard'` branch carries a `session:
 * SessionBuilderState` field — literally the same type
 * `session-scenarios.ts` already builds, over the REAL fixture vault, with
 * real gap ranking, real durations, the real "could not find X" empty-session
 * copy and a real vault-walk failure for the unavailable box (see that
 * file's own module doc for the fixture-vault argument, the borrowed-
 * instrument finding, and the `'session-vault-unreadable'` mechanism this
 * file's own `'home-session-unavailable'` state reuses unchanged). Mounting
 * the identical composition through `HomeView` instead of
 * `SessionBuilderView` is exactly what this bead needs demonstrated — a
 * second, parallel derivation of the same numbers would be the mistake F6.4
 * itself warns against ("an implementation... has invented [something] and
 * hidden it").
 *
 * **`courses` and `avoidanceQuestion` (`ol-ppxj.49`, follow-up to the first
 * tranche above).** `home-composed` keeps `courses: []` and
 * `avoidanceQuestion: undefined` UNCHANGED — `test/home-scenarios.spec.ts`
 * pins exactly that pair for that one state ("courses left empty"), and
 * neither F6.10's course strip nor F4.6's avoidance question is specific to
 * the composed-session state, so there is no honesty reason to disturb a
 * locked assertion rather than land the new coverage on the other two
 * dashboard states instead. `home-session-unavailable` and `home-empty`
 * carry it — see `COURSES_FOR`/`AVOIDANCE_QUESTION_FOR` below.
 *
 * **The course rows are hand-built `HomeCourseRow`s, not a real
 * `createLocalGroveProvider` walk over the fixture vault.** `grove-
 * scenarios.ts`'s own module doc gives the reason this file borrows instead
 * of computing: its own scope is deliberately "the F1/F8.1 risk that does
 * NOT live in the Obsidian runtime", fed a HAND-BUILT `GroveCourseModel`
 * rather than a fixture-vault read, over coined vocabulary (`syn:course:…`).
 * There is no real objectives document or past paper anywhere in the fixture
 * vault `buildSessionScenario` reads above, so a real
 * `createLocalGroveProvider` call over it would only ever produce
 * `'no-registered-source'` rows — never the declared-course marks this bead
 * needs shown. This file follows the identical discipline instead:
 * `HomeCourseRow` (production's own type, via `./home-bridge.js`) filled
 * with fixture facts, sharing `grove-scenarios.ts`'s own `'vantrel'` course
 * name so a reader flipping between the Grove and Home panes sees the same
 * course rather than a second, uncoordinated coined one. Quiet-line text
 * calls the real, pure `home/copy.ts` functions (`HOME_SET_UP_WAITING`,
 * `homeScopeGrewLine`) over fixture numbers — never a workbench-invented
 * sentence, same "state real copy, feed it fixture facts" posture this
 * file's own `sessionStateId` reuse already holds to.
 *
 * **`avoidanceQuestion.onAnswer` writes nothing** — same "never wired to a
 * real event log" posture `grove-scenarios.ts#buildGroveScenario`'s own
 * `registerSource`/`dismiss` give, `Notice`d rather than silently swallowed
 * so a click is visibly acknowledged (mirrors that file's own
 * `openRetrospective`).
 */

import type { VaultSource } from 'olea-core';
import {
  HOME_SET_UP_WAITING,
  type HomeAvoidanceQuestion,
  type HomeCourseRow,
  type HomeViewState,
  homeScopeGrewLine,
} from './home-bridge.js';
import { Notice } from './obsidian-shim/index.js';
import { buildSessionScenario, type SessionScenario } from './session-scenarios.js';

/**
 * F6.10's course strip, per state — `undefined` (the default) leaves
 * `courses: []`, `home-composed`'s own pinned shape. Coined vocabulary,
 * `'syn:course:vantrel'` shared with `grove-scenarios.ts`'s own fixture
 * course — see this file's own module doc.
 */
const COURSES_FOR: Partial<Record<string, readonly HomeCourseRow[]>> = {
  'home-session-unavailable': [
    {
      course: 'syn:course:vantrel',
      marks: [{ kind: 'stage', state: 'sprout' }, { kind: 'ground' }, { kind: 'material-gap' }],
      quiet: {
        kind: 'scope-grew',
        text: homeScopeGrewLine('01 Courses/syn:course:vantrel/Objectives.md', 3),
      },
    },
    // A declared course with nothing built yet (`marks: []`, never
    // `undefined` — that shape is reserved for a status other than
    // `'declared'`, `home/provider.ts`'s own `marksForDeclaredCourse` never
    // returns `undefined`) — F6.10's `HOME_NO_MAP_DRAWN` branch, distinct
    // from `home-empty`'s `HOME_SCOPE_NOT_DECLARED` one below.
    { course: 'syn:course:driftglass', marks: [] },
  ],
  'home-empty': [
    // `marks` omitted (`undefined`), matching `home/provider.ts#buildCourseRows`'s
    // own shape for a `'no-registered-source'` course — never an empty array,
    // which is reserved for a declared course with zero concepts.
    {
      course: 'syn:course:brindlewood',
      quiet: { kind: 'set-up-waiting', text: HOME_SET_UP_WAITING },
    },
  ],
};

/**
 * F4.6's once-asked avoidance question, per state — `undefined` (the
 * default) leaves `avoidanceQuestion: undefined`, `home-composed`'s own
 * pinned shape. Named after `COURSES_FOR`'s own `'home-session-unavailable'`
 * course (F4.6's question only ever names a course that HAS material,
 * `findAvoidedCourse`'s own `hasMaterial` gate) — demonstrates `HomeView`
 * rendering the question ABOVE the session card's own unavailable box,
 * exactly the order `HomeView.render()` draws them in.
 */
const AVOIDANCE_QUESTION_FOR: Partial<Record<string, HomeAvoidanceQuestion>> = {
  'home-session-unavailable': {
    course: 'syn:course:vantrel',
    onAnswer: async (answer) => {
      new Notice(
        `Workbench: recording her answer ("${answer}") would write to HomeView's own ` +
          'per-install store in the real product. This pane writes nothing.',
      );
    },
  },
};

export interface HomeWorkbenchState {
  readonly id: string;
  readonly label: string;
  readonly group: 'home';
  readonly note: string;
  /**
   * Which `session-scenarios.ts` state this state's composed-session half
   * reuses. `undefined` only for `wholeViewUnavailable` states, which need no
   * composition at all.
   */
  readonly sessionStateId?: string;
  /**
   * `true` for `HomeView`'s OWN outer `kind: 'unavailable'` branch
   * (`HOME_UNAVAILABLE`) — `createLocalHomeProvider`'s top-level catch,
   * reached when the read fails before a session or a course row is ever
   * built. Distinct from `'home-session-unavailable'` below, which reaches
   * `SessionBuilderView`'s OWN `kind: 'unavailable'` box, still rendered
   * inside a `'dashboard'`-kind `HomeViewState`, exactly as `[D-243]`
   * relocated it.
   */
  readonly wholeViewUnavailable?: boolean;
}

export const HOME_STATES: readonly HomeWorkbenchState[] = [
  {
    id: 'home-composed',
    label: 'Composed session, inline on Home',
    group: 'home',
    // `session-short-20`, not `session-exam-eve-90`: `HomeView` has no deps
    // hook for an initial budget (unlike `SessionBuilderViewDeps.
    // defaultBudgetMinutes`, which `mountSession` uses) — its own
    // `budgetMinutes` field is hardcoded to `DEFAULT_SESSION_BUDGET_MINUTES`
    // (20) in its constructor (`home/view.ts`), so whatever this scenario
    // pre-computes at a DIFFERENT budget is immediately overwritten by the
    // real `onOpen -> refresh -> deps.load` call at 20 minutes anyway.
    // Reusing a session state whose OWN budget is already 20 keeps this
    // scenario's pre-view paint and the real mounted view in agreement,
    // rather than flashing from a 90-minute figure to a 20-minute one.
    sessionStateId: 'session-short-20',
    note:
      "[D-243]'s headline: the ranked item list, F4.9's reasoning and the countdown all render " +
      'inline on Home now, beside the three steering inputs, rather than on a separate builder ' +
      'screen. Reuses session-scenarios.ts\'s own "twenty minutes, mid-semester" composition ' +
      "(see that file's module doc; its budget — 20 — is HomeView's own hardcoded opening " +
      'budget, `DEFAULT_SESSION_BUDGET_MINUTES`, so this state mounts at the same budget it was ' +
      'built at) — the same real fixture-vault computation, mounted through HomeView instead of ' +
      'SessionBuilderView.',
  },
  {
    id: 'home-empty',
    label: 'Composed, but nothing to sit',
    group: 'home',
    sessionStateId: 'session-no-cards-yet',
    note:
      'The honest empty composition [D-243] relocated: every ranked concept is named as a ' +
      "coverage gap rather than a placeholder sentence of this view's own invention. Reuses " +
      'session-scenarios.ts\'s "session-no-cards-yet" finding unchanged.',
  },
  {
    id: 'home-session-unavailable',
    label: 'The composed-session box: unavailable',
    group: 'home',
    sessionStateId: 'session-vault-unreadable',
    note:
      "SessionBuilderView's own kind: 'unavailable' box (SESSION_UNAVAILABLE_TITLE/BODY) is one " +
      "of the three things [D-243] moved onto Home's dashboard card; this state reaches it the " +
      "same honest way session-scenarios.ts's own 'session-vault-unreadable' state does — a " +
      'vault whose list() throws, caught by the real scenario try/catch.',
  },
  {
    id: 'home-unavailable',
    label: 'The whole view: unavailable',
    group: 'home',
    wholeViewUnavailable: true,
    note:
      "HomeView's OWN outer kind: 'unavailable' branch (HOME_UNAVAILABLE) — distinct from the " +
      "session card's own box above: this is createLocalHomeProvider's top-level catch, reached " +
      'when the read fails before a session or a course row is ever built. No vault walk needed ' +
      '— a HomeViewState this shape needs no composition at all.',
  },
];

export function findHomeState(
  id: string,
): { readonly id: string; readonly note: string } | undefined {
  const found = HOME_STATES.find((s) => s.id === id);
  return found === undefined ? undefined : { id: found.id, note: found.note };
}

export interface HomeScenario {
  readonly state: HomeViewState;
  readonly note: string;
  readonly workbenchState: HomeWorkbenchState;
  /**
   * The reused session scenario, when this state has one — `undefined` for
   * `wholeViewUnavailable` states. Inspector data, so a viewer never has to
   * take the view's rendering on faith, the same convention every other
   * scenario file in this package uses.
   */
  readonly sessionScenario?: SessionScenario;
}

/** Builds one Home state over `vault` — see this file's own module doc. */
export async function buildHomeScenario(
  stateId: string,
  vault: VaultSource,
): Promise<HomeScenario> {
  const workbenchState = HOME_STATES.find((s) => s.id === stateId);
  if (workbenchState === undefined) {
    throw new Error(`workbench: unknown home state ${JSON.stringify(stateId)}`);
  }

  if (workbenchState.wholeViewUnavailable === true) {
    return { state: { kind: 'unavailable' }, note: workbenchState.note, workbenchState };
  }

  const sessionStateId = workbenchState.sessionStateId;
  if (sessionStateId === undefined) {
    throw new Error(`workbench: home state ${stateId} names no session state to reuse`);
  }
  const sessionScenario = await buildSessionScenario(sessionStateId, vault);
  const session = await sessionScenario.deps.load({
    budgetMinutes: sessionScenario.state.budgetMinutes,
  });

  const courses = COURSES_FOR[stateId] ?? [];
  const avoidanceQuestion = AVOIDANCE_QUESTION_FOR[stateId];

  return {
    state: {
      kind: 'dashboard',
      session,
      courses,
      ...(avoidanceQuestion !== undefined ? { avoidanceQuestion } : {}),
    },
    note: workbenchState.note,
    workbenchState,
    sessionScenario,
  };
}
