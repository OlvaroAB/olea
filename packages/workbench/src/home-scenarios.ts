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
 * **`courses` is deliberately left empty (`[]`) in every state here.** F6.10's
 * per-course coverage strip is a different, pre-existing risk — it does not
 * belong to `[D-243]`'s gap (the session composition and its unavailable
 * box), and `HomeView.renderCourses` already no-ops cleanly on an empty
 * array (`./view.ts`'s own `if (courses.length === 0) return;`). Covering the
 * course-strip render path honestly would mean reusing a real
 * `createLocalGroveProvider` walk (or `grove-scenarios.ts`'s hand-built
 * models) here too — left to a follow-up rather than folded into this pass,
 * so this file's own scope stays legible: it is about the composed session,
 * not the grove.
 *
 * **`avoidanceQuestion` is left `undefined` everywhere** — same reasoning:
 * F4.6's course-avoidance question is its own steering input, independent of
 * `[D-243]`'s session-composition move, and `HomeView` already renders
 * correctly with none offered.
 */

import type { VaultSource } from 'olea-core';
import type { HomeViewState } from './home-bridge.js';
import { buildSessionScenario, type SessionScenario } from './session-scenarios.js';

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

  return {
    state: { kind: 'dashboard', session, courses: [] },
    note: workbenchState.note,
    workbenchState,
    sessionScenario,
  };
}
