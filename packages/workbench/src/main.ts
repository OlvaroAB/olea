/**
 * Workbench entry point. Mounts the real `ReviewView` from `packages/plugin`
 * against `olea-core` and an in-memory `VaultSource` over the synthetic fixture
 * vault, with no Obsidian runtime anywhere.
 *
 * Routing is `#/<surface>/<state-id>?set=<variable-set-id>&persona=<persona-id>`,
 * one URL per (surface × state × variable set × persona), so every screen is
 * addressable and reloadable. `surface` is `review` (mounts the real
 * `ReviewView`, driven by real keystrokes — twelve states), `today` (mounts
 * the real `TodayView`, driven by its own `deps` — five states; see
 * `today-scenarios.ts`), or `oracle` (mounts the real `GapView` against a
 * synthetic curriculum + corpus, driven by its own `deps` — nine states; see
 * `oracle-scenarios.ts` — `ol-opmb.1` [TB-1]), `retrieve`, `generate` or
 * `timeline` (see their own scenario files), or `walk` — a seventh, LINEAR
 * mode (`ol-c48c`) over twelve steps that reuses the other six surfaces'
 * scenario builders and mounts the identical views; see `walkthrough.ts`'s
 * module doc. Stable hooks for a later Playwright pass (WB-2, `ol-z6x2` —
 * not this bead) are:
 *
 *   [data-wb-surface]                CONFUSINGLY ALSO an existing attribute
 *                                    name — see below; kept for WB-2 compat.
 *   [data-wb-state="<id>"]           on <html>, the state currently mounted
 *   [data-wb-route-surface="<id>"]   on <html>, "review", "today" or "oracle"
 *   [data-wb-variable-set="<id>"]    on the host pane
 *   [data-wb-persona="<id>"]         on <html>, the history behind the surface
 *   [data-wb-ready="true"]           on <html>, set only after the scripted
 *                                    keystrokes (or Today's `afterOpen`) have
 *                                    settled — the wait condition
 *   [data-wb-notice]                 one element per Notice the host would show
 *
 * `[data-wb-surface]` is the pre-existing attribute on the host `<iframe>`
 * (`host-frame.ts` / `ol-mioe`) — the screenshot target. It is a coincidence
 * of naming with the route's `surface` segment, not the same thing; the route
 * attribute is `[data-wb-route-surface]` specifically so the two never collide.
 *
 * That is the whole of what this file does for WB-2. No Playwright, no
 * screenshot harness, no `@auto-web` tags.
 */

import { CONTEST_GESTURE_LABEL, createFsrsScheduler, type TodayViewModel } from 'olea-core';
import { renderSyntheticProvisionalBadge } from './badge.js';
import { BulkReviewView } from './bulk-review-bridge.js';
import {
  BULK_REVIEW_STATES,
  buildBulkReviewScenario,
  findBulkReviewState,
  seedBulkReviewScenario,
} from './bulk-review-scenarios.js';
import {
  buildExplainBackScenario,
  EXPLAIN_BACK_STATES,
  findExplainBackState,
} from './explain-back-scenarios.js';
import {
  buildExplainScenario,
  EXPLAIN_STATES,
  type ExplainScenario,
  findExplainState,
} from './explain-scenarios.js';
import {
  buildGenerateScenario,
  findGenerateState,
  GENERATE_STATES,
  type GenerateScenario,
} from './generate-scenarios.js';
import { createHostFrame, type HostFrame } from './host-frame.js';
import { installObsidianDomHelpers } from './obsidian-shim/dom.js';
import { Notice, type WorkspaceLeaf } from './obsidian-shim/index.js';
import { buildFixtureOracle, type FixtureOracleResult } from './oracle/fixture-oracle.js';
import { fixtureOracleFocus, fixtureOracleFocusNote } from './oracle/fixture-oracle-focus.js';
import { acceptCandidates } from './oracle/generate.js';
import { loadEmbeddingCassette } from './oracle/load-cassette.js';
import { loadGenerationCassette } from './oracle/load-generation-cassette.js';
import type { GeneratedMcqCandidate } from './oracle-bridge.js';
import { GapView } from './oracle-bridge.js';
import {
  buildOracleScenario,
  findOracleState,
  ORACLE_STATES,
  type OracleScenario,
} from './oracle-scenarios.js';
import {
  buildPersonaHistory,
  checkVaultBoundary,
  DEFAULT_PERSONA,
  findPersona,
  PERSONA_OPTIONS,
  PERSONA_PROVISIONAL_NOTE,
  type PersonaHistory,
  type WorkbenchPersonaId,
  writePersonaHistory,
} from './persona/history.js';
import { ReviewSession, ReviewView, TodayView } from './plugin-bridge.js';
import {
  buildPluginSurfaceScenario,
  findPluginSurfaceState,
  PLUGIN_SURFACE_STATES,
} from './plugin-surface-scenarios.js';
import {
  deriveWorkbenchQueue,
  describeWorkbenchQueue,
  type WorkbenchQueue,
} from './queue/derive.js';
import { RegistryView } from './registry-bridge.js';
import { buildRegistryScenario, findRegistryState, REGISTRY_STATES } from './registry-scenarios.js';
import {
  buildRetrieveScenario,
  findRetrieveState,
  RETRIEVE_STATES,
  type RetrieveScenario,
} from './retrieve-scenarios.js';
import {
  buildRhythmScenario,
  findRhythmState,
  RHYTHM_STATES,
  type RhythmComposedPanel,
  type RhythmScenario,
} from './rhythm-scenarios.js';
import { buildScenario, findState, REVIEW_STATES, type Scenario } from './scenarios.js';
import { SessionBuilderView } from './session-bridge.js';
import {
  buildSessionScenario,
  findSessionState,
  SESSION_STATES,
  type SessionScenario,
} from './session-scenarios.js';
import {
  applyVariableSet,
  DEFAULT_VARIABLE_SET,
  findVariableSet,
  VARIABLE_SETS,
} from './themes/index.js';
import {
  buildTimelineScenario,
  DEFAULT_TIMELINE_DAY,
  findTimelineState,
  TIMELINE_STATES,
  type TimelineScenario,
} from './timeline-scenarios.js';
import {
  buildTodayScenario,
  findTodayState,
  TODAY_STATES,
  type TodayScenario,
} from './today-scenarios.js';
import {
  buildTrendsScenario,
  findTrendsState,
  TRENDS_STATES,
  type TrendsScenario,
} from './trends-scenarios.js';
import { loadFixtureVault } from './vault/fixture-vault.js';
import {
  DEFAULT_WALK_STEP,
  findWalkStep,
  WALKTHROUGH_STEPS,
  type WalkGap,
  type WalkStep,
} from './walkthrough.js';

type RouteSurface =
  | 'review'
  | 'today'
  | 'oracle'
  | 'retrieve'
  | 'generate'
  | 'timeline'
  | 'explain'
  | 'explain-back'
  | 'session'
  | 'trends'
  | 'rhythm'
  | 'bulk-review'
  | 'registry'
  | 'plugin-surface'
  | 'walk';

const DEFAULT_STATE = 'qa-front';
const DEFAULT_TODAY_STATE = 'today-due';
const DEFAULT_ORACLE_STATE = 'oracle-ranked';
const DEFAULT_RETRIEVE_STATE = 'grounded-with-citations';
const DEFAULT_GENERATE_STATE = 'generation-pending-accept';
const DEFAULT_TIMELINE_STATE = 'timeline-steady';
const DEFAULT_EXPLAIN_STATE = 'explanation-grounded';
const DEFAULT_EXPLAIN_BACK_STATE = 'explain-back-fresh-prompt';
const DEFAULT_SESSION_STATE = 'session-exam-eve-90';
const DEFAULT_TRENDS_STATE = 'trends-cramming';
const DEFAULT_RHYTHM_STATE = 'rhythm-two-flagged';
const DEFAULT_BULK_REVIEW_STATE = 'bulk-review-two-groups';
const DEFAULT_REGISTRY_STATE = 'registry-populated';
const DEFAULT_PLUGIN_SURFACE_STATE = 'plugin-surface-fresh';

/**
 * The illustrative label D-041 (`ol-st9i`) requires next to the numbers on the fixture-vault
 * oracle steps — verbatim wording, non-negotiable placement (inside the host pane, not the
 * sidebar, not the inspector).
 *
 * This is D-041's ruled wording and is reproduced exactly. Do not edit it here; it is a
 * decision, and changing it is a decision change.
 *
 * A second sentence used to live here, added by the orchestrator after the build lane reported
 * that every concept on these two steps read `new`: the fixture vault's review history was
 * borrowed from a synthetic persona stream by positional join, and it did not line up with the
 * concepts the ranking actually ranked, so mastery was fabricated on top of a real ranking with
 * nothing on screen to tell the two apart. `ol-0v9n` fixed the underlying cause — see
 * `oracle/fixture-oracle-history.ts` — rather than widening the caveat: the mastery states below
 * are now computed the same way the ranking is, from real fixture-vault concept ids, so the
 * extra sentence is gone rather than reworded.
 */
const FIXTURE_ORACLE_ILLUSTRATIVE_LABEL =
  'Illustrative. These rankings come from invented course material and are not a measurement of ' +
  'how well Olea ranks anything.';

/**
 * The session surface's illustrative label — shown only on states whose data
 * says something was borrowed (`SessionWorkbenchState.instruments === 'borrowed'`
 * or `.history === 'borrowed'`), never hardcoded against a state id list, so a
 * new borrowing state picks it up automatically and an honest-empty one
 * (`session-no-cards-yet`, `session-nothing-to-build`) never does.
 */
const SESSION_ILLUSTRATIVE_LABEL =
  "Illustrative. The session is assembled by the product's own logic, but the cards in it " +
  'were re-bound onto the ranked concepts for this demo. In the invented vault as it stands, ' +
  'every concept its past papers cite has notes and no cards — so an honest session would be ' +
  'empty, and the "Ranked, but nothing to practise" state shows exactly that. Timings are ' +
  'assumptions, not measurements, wherever the screen says Olea is assuming.';

/** The trends surface's illustrative label — every state runs on synthetic history, so this applies to all six. */
const TRENDS_ILLUSTRATIVE_LABEL =
  "Illustrative. This is a synthetic student's study history, not hers, and the pattern in " +
  'it was planted on purpose so the detector could be checked against a known answer. On that ' +
  'check the effort pattern separates cleanly. The cramming pattern does not: it also fires on ' +
  'one in five histories where the pattern was deliberately removed. Nothing here measures how ' +
  'well Olea reads real behaviour.';

/**
 * The rhythm surface's own notice, in place of `mountGenerate`'s "no product
 * view to mount yet" pattern (`RETRIEVE`/`GENERATE`'s own wording for
 * P3-T07b) — see `rhythm-scenarios.ts`'s module doc for the full argument.
 * States what this draws (the real discover -> associate -> freshness chain,
 * composed per the design doc's own rule) and what it is NOT (a product
 * surface): `[D-072]`'s reachability clause is not discharged by this pane.
 */
const RHYTHM_NO_PRODUCT_VIEW_NOTICE =
  "RHY-3's multicourse composition (ol-i0zw) has no product surface yet. The real Today panel's " +
  "rhythm section (ol-at1a, in progress) still surfaces at most ONE course's reading — this " +
  "pane draws the design's composed-panel rule (RHY-3-multicourse-composition.md §4) directly " +
  "against olea-core's own, unmodified discover -> associate -> freshness chain, over the fixture " +
  'vault plus one synthetic calendar note this workbench adds. Reachability: NONE — this is a ' +
  'workbench-only rendering, not a product view; see the inspector and this bead for what is ' +
  'still undone.';

/** Where `build.mjs` copies `packages/plugin/styles.css`, unmodified. */
const PLUGIN_STYLES_HREF = './plugin-styles.css';

interface Route {
  readonly surface: RouteSurface;
  readonly stateId: string;
  readonly setId: string;
  readonly personaId: WorkbenchPersonaId;
  /** The timeline surface's day scrubber (`ol-opmb.5` [TB-4]) — a `0`-based index, ignored by every other surface. Always present in the URL so a timeline link is reloadable on its own. */
  readonly day: number;
  /**
   * The gap view's `build-session` affordance (`ol-p5t06b`, F4.6): the
   * concept name to seed the session builder with. `''` means none, the same
   * "always present, ignored elsewhere" convention {@link day} uses — read
   * only by `mountSession`. Always present in the URL for the same reason:
   * a build-session link is reloadable on its own.
   */
  readonly focus: string;
}

function defaultStateFor(surface: RouteSurface): string {
  switch (surface) {
    case 'today':
      return DEFAULT_TODAY_STATE;
    case 'oracle':
      return DEFAULT_ORACLE_STATE;
    case 'retrieve':
      return DEFAULT_RETRIEVE_STATE;
    case 'generate':
      return DEFAULT_GENERATE_STATE;
    case 'timeline':
      return DEFAULT_TIMELINE_STATE;
    case 'explain':
      return DEFAULT_EXPLAIN_STATE;
    case 'explain-back':
      return DEFAULT_EXPLAIN_BACK_STATE;
    case 'session':
      return DEFAULT_SESSION_STATE;
    case 'trends':
      return DEFAULT_TRENDS_STATE;
    case 'rhythm':
      return DEFAULT_RHYTHM_STATE;
    case 'bulk-review':
      return DEFAULT_BULK_REVIEW_STATE;
    case 'registry':
      return DEFAULT_REGISTRY_STATE;
    case 'plugin-surface':
      return DEFAULT_PLUGIN_SURFACE_STATE;
    case 'review':
      return DEFAULT_STATE;
    case 'walk':
      return DEFAULT_WALK_STEP;
  }
}

function findStateFor(
  surface: RouteSurface,
  stateId: string,
): { readonly id: string; readonly note: string } | undefined {
  switch (surface) {
    case 'today':
      return findTodayState(stateId);
    case 'oracle':
      return findOracleState(stateId);
    case 'retrieve':
      return findRetrieveState(stateId);
    case 'generate':
      return findGenerateState(stateId);
    case 'timeline':
      return findTimelineState(stateId);
    case 'explain':
      return findExplainState(stateId);
    case 'explain-back':
      return findExplainBackState(stateId);
    case 'session':
      return findSessionState(stateId);
    case 'trends':
      return findTrendsState(stateId);
    case 'rhythm':
      return findRhythmState(stateId);
    case 'bulk-review':
      return findBulkReviewState(stateId);
    case 'registry':
      return findRegistryState(stateId);
    case 'plugin-surface':
      return findPluginSurfaceState(stateId);
    case 'review':
      return findState(stateId);
    case 'walk': {
      // Every step — live, partial OR gap — is a valid destination in walk
      // mode (a gap step is still a real place to be, rendering the gap
      // card); only an out-of-range step number is invalid. `id`/`note` here
      // are load-bearing only for the generic route guard and the nav-active
      // loops below, which never read a walk step's own title through this
      // path — `render()`'s walk branch reads `WalkStep` fields directly.
      const step = findWalkStep(stateId);
      return step === undefined ? undefined : { id: String(step.n), note: step.title };
    }
  }
}

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = hash.split('?');
  const segments = path.split('/').filter((s) => s.length > 0);
  const params = new URLSearchParams(query);
  const surface: RouteSurface =
    segments[0] === 'today'
      ? 'today'
      : segments[0] === 'oracle'
        ? 'oracle'
        : segments[0] === 'retrieve'
          ? 'retrieve'
          : segments[0] === 'generate'
            ? 'generate'
            : segments[0] === 'timeline'
              ? 'timeline'
              : segments[0] === 'explain'
                ? 'explain'
                : segments[0] === 'explain-back'
                  ? 'explain-back'
                  : segments[0] === 'session'
                    ? 'session'
                    : segments[0] === 'trends'
                      ? 'trends'
                      : segments[0] === 'rhythm'
                        ? 'rhythm'
                        : segments[0] === 'bulk-review'
                          ? 'bulk-review'
                          : segments[0] === 'registry'
                            ? 'registry'
                            : segments[0] === 'plugin-surface'
                              ? 'plugin-surface'
                              : segments[0] === 'walk'
                                ? 'walk'
                                : 'review';
  const requestedStateId = segments[1] ?? defaultStateFor(surface);
  const setId = params.get('set') ?? DEFAULT_VARIABLE_SET;
  const personaId = params.get('persona') ?? DEFAULT_PERSONA;
  const persona = findPersona(personaId);
  const stateFound = findStateFor(surface, requestedStateId);
  const requestedDay = Number(params.get('day'));
  return {
    surface,
    stateId: stateFound === undefined ? defaultStateFor(surface) : requestedStateId,
    setId: findVariableSet(setId) === undefined ? DEFAULT_VARIABLE_SET : setId,
    personaId: persona === undefined ? DEFAULT_PERSONA : persona.id,
    day: Number.isFinite(requestedDay) && params.has('day') ? requestedDay : DEFAULT_TIMELINE_DAY,
    focus: params.get('focus') ?? '',
  };
}

function writeRoute(route: Route): void {
  const focusParam = route.focus.length > 0 ? `&focus=${encodeURIComponent(route.focus)}` : '';
  const next = `#/${route.surface}/${route.stateId}?set=${route.setId}&persona=${route.personaId}&day=${String(route.day)}${focusParam}`;
  if (window.location.hash !== next) window.location.hash = next;
}

function requireEl(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`workbench: missing element ${selector}`);
  return el;
}

/** Lets the scripted keystrokes' async port calls settle before the next one. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

/**
 * A real keystroke, resolved by the real `keymap.ts` — unchanged by `ol-mioe`
 * except that the event is now constructed with the **host frame's** own
 * `KeyboardEvent` so the whole dispatch happens inside one realm.
 */
function sendKey(frame: HostFrame, target: HTMLElement, key: string): void {
  target.dispatchEvent(
    new frame.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

async function main(): Promise<void> {
  const vault = await loadFixtureVault();
  const fixtureCount = (await vault.list()).length;
  const scheduler = createFsrsScheduler();

  const stateList = requireEl('[data-wb-states]');
  const todayStateList = requireEl('[data-wb-today-states]');
  const oracleStateList = requireEl('[data-wb-oracle-states]');
  const retrieveStateList = requireEl('[data-wb-retrieve-states]');
  const generateStateList = requireEl('[data-wb-generate-states]');
  const timelineStateList = requireEl('[data-wb-timeline-states]');
  const explainStateList = requireEl('[data-wb-explain-states]');
  const explainBackStateList = requireEl('[data-wb-explain-back-states]');
  const sessionStateList = requireEl('[data-wb-session-states]');
  const trendsStateList = requireEl('[data-wb-trends-states]');
  const rhythmStateList = requireEl('[data-wb-rhythm-states]');
  const bulkReviewStateList = requireEl('[data-wb-bulk-review-states]');
  const registryStateList = requireEl('[data-wb-registry-states]');
  const pluginSurfaceStateList = requireEl('[data-wb-plugin-surface-states]');
  const walkStepList = requireEl('[data-wb-walk-steps]');
  const modeSwitchList = requireEl('[data-wb-mode-switch]');
  const flatNav = requireEl('[data-wb-flat-nav]');
  const walkNav = requireEl('[data-wb-walk-nav]');
  const walkChrome = requireEl('[data-wb-walk-chrome]');
  const walkCounter = requireEl('[data-wb-walk-counter]');
  const walkStatusBadge = requireEl('[data-wb-walk-status]');
  const walkTitle = requireEl('[data-wb-walk-title]');
  const walkCopy = requireEl('[data-wb-walk-copy]');
  const walkPrev = requireEl('[data-wb-walk-prev]');
  const walkNext = requireEl('[data-wb-walk-next]');
  const setList = requireEl('[data-wb-sets]');
  const personaList = requireEl('[data-wb-personas]');
  const frameEl = requireEl('[data-wb-surface]');
  if (!(frameEl instanceof HTMLIFrameElement)) {
    throw new Error('workbench: [data-wb-surface] must be the host <iframe> (ol-mioe).');
  }
  const frame = await createHostFrame(frameEl, PLUGIN_STYLES_HREF);
  const host = frame.body;
  const inspector = requireEl('[data-wb-inspector]');
  const noticeHost = requireEl('[data-wb-notices]');

  // Both realms: the chrome's elements are created in this document, the view's
  // inside the frame's. See `obsidian-shim/dom.ts`.
  installObsidianDomHelpers(window);
  installObsidianDomHelpers(frame.window);

  for (const state of REVIEW_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'review', stateId: state.id });
    });
    stateList.appendChild(button);
  }

  for (const state of TODAY_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbTodayStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'today', stateId: state.id });
    });
    todayStateList.appendChild(button);
  }

  for (const state of ORACLE_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbOracleStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'oracle', stateId: state.id });
    });
    oracleStateList.appendChild(button);
  }

  for (const state of RETRIEVE_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbRetrieveStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'retrieve', stateId: state.id });
    });
    retrieveStateList.appendChild(button);
  }

  for (const state of GENERATE_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbGenerateStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'generate', stateId: state.id });
    });
    generateStateList.appendChild(button);
  }

  for (const state of TIMELINE_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbTimelineStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({
        ...readRoute(),
        surface: 'timeline',
        stateId: state.id,
        day: DEFAULT_TIMELINE_DAY,
      });
    });
    timelineStateList.appendChild(button);
  }

  for (const state of EXPLAIN_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbExplainStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'explain', stateId: state.id });
    });
    explainStateList.appendChild(button);
  }

  for (const state of EXPLAIN_BACK_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbExplainBackStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'explain-back', stateId: state.id });
    });
    explainBackStateList.appendChild(button);
  }

  for (const state of SESSION_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbSessionStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      // A deliberate "load this state fresh" click, not a continuation of
      // whatever focus concept a prior build-session navigation set —
      // `SessionBuilderView.setFocusConcept`'s own doc says the choice to
      // focus is deliberate, so clearing it here is the same discipline
      // applied to how a focus is entered as to how it is left.
      writeRoute({ ...readRoute(), surface: 'session', stateId: state.id, focus: '' });
    });
    sessionStateList.appendChild(button);
  }

  for (const state of TRENDS_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbTrendsStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'trends', stateId: state.id });
    });
    trendsStateList.appendChild(button);
  }

  for (const state of RHYTHM_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbRhythmStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'rhythm', stateId: state.id });
    });
    rhythmStateList.appendChild(button);
  }

  for (const state of BULK_REVIEW_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbBulkReviewStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'bulk-review', stateId: state.id });
    });
    bulkReviewStateList.appendChild(button);
  }

  for (const state of REGISTRY_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbRegistryStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'registry', stateId: state.id });
    });
    registryStateList.appendChild(button);
  }

  for (const state of PLUGIN_SURFACE_STATES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbPluginSurfaceStateLink = state.id;
    button.textContent = state.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'plugin-surface', stateId: state.id });
    });
    pluginSurfaceStateList.appendChild(button);
  }

  // The walkthrough's own step list (rule: "collapses the six state lists to
  // a single ordered step list with a live/partial/gap dot per step"). Status
  // classes are set here once (status never changes at runtime) and
  // `is-active` is toggled per render, same discipline as every list above.
  for (const step of WALKTHROUGH_STEPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `wb-nav-item wb-walk-nav-item wb-walk-status--${step.status}`;
    button.dataset.wbWalkStepLink = String(step.n);
    const dot = document.createElement('span');
    dot.className = 'wb-walk-dot';
    dot.setAttribute('aria-hidden', 'true');
    button.appendChild(dot);
    button.appendChild(document.createTextNode(`${String(step.n)}. ${step.title}`));
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), surface: 'walk', stateId: String(step.n) });
    });
    walkStepList.appendChild(button);
  }

  // Two links, not a toggle: each is a real, reloadable URL, same discipline
  // as every other nav control here. Entering the walkthrough pins the
  // persona to `steady-reviewer` — "one student, one fortnight" needs a
  // history loaded, and `'none'` (the app default) would render Today and
  // review with nothing behind them. Leaving it does not touch persona: the
  // component workbench has never had an opinion about which one is loaded.
  const flatModeButton = document.createElement('button');
  flatModeButton.type = 'button';
  flatModeButton.className = 'wb-nav-item';
  flatModeButton.dataset.wbModeLink = 'flat';
  flatModeButton.textContent = 'Component workbench';
  flatModeButton.addEventListener('click', () => {
    writeRoute({ ...readRoute(), surface: 'review', stateId: DEFAULT_STATE });
  });
  modeSwitchList.appendChild(flatModeButton);

  const walkModeButton = document.createElement('button');
  walkModeButton.type = 'button';
  walkModeButton.className = 'wb-nav-item';
  walkModeButton.dataset.wbModeLink = 'walk';
  walkModeButton.textContent = 'Walkthrough';
  walkModeButton.addEventListener('click', () => {
    writeRoute({
      ...readRoute(),
      surface: 'walk',
      stateId: DEFAULT_WALK_STEP,
      personaId: 'steady-reviewer',
    });
  });
  modeSwitchList.appendChild(walkModeButton);

  for (const set of VARIABLE_SETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbSetLink = set.id;
    button.textContent = set.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), setId: set.id });
    });
    setList.appendChild(button);
  }

  for (const option of PERSONA_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-nav-item';
    button.dataset.wbPersonaLink = option.id;
    button.textContent = option.label;
    button.addEventListener('click', () => {
      writeRoute({ ...readRoute(), personaId: option.id });
    });
    personaList.appendChild(button);
  }

  let mounted: {
    view: ReviewView | TodayView | GapView | SessionBuilderView | BulkReviewView | RegistryView;
  } | null = null;
  /**
   * `ExplainBackModal` (`ol-z6x2` F5 tranche) is a `Modal`, not an `ItemView`
   * — it never joins the `mounted.view` union above, which is
   * `onClose`/`unloadComponent`'s ItemView-shaped contract. Tracked
   * separately so switching surfaces (or reloading the same one) closes any
   * still-open modal from a prior render, same lifecycle discipline as
   * `mounted` for every flat-surface view.
   */
  let mountedModal: { close(): void } | null = null;
  let generation = 0;
  /**
   * The persona history currently loaded into the vault, and where it went.
   *
   * Rebuilt only when the persona in the URL changes: `generateStream` replays
   * ninety days through the real FSRS scheduler, and doing that on every
   * variable-set click would make the switcher feel broken for no gain.
   */
  let loaded: { history: PersonaHistory; paths: readonly string[] } = {
    history: buildPersonaHistory(DEFAULT_PERSONA),
    paths: [],
  };
  /**
   * The composed session for the persona currently loaded.
   *
   * Recomposed whenever the persona changes, because the whole point of the
   * swap is that `priorState` and `selectionContext` are now *consequences* of
   * her history rather than fields a slot number filled in — so a different
   * history is a different composition, not a different decoration.
   */
  let composed: WorkbenchQueue | null = null;
  /**
   * The embedding cassette (`ol-opmb.2` [TB-2]), fetched once and reused —
   * same corpus and query set for every retrieval state, so there is no
   * reason to re-fetch and re-validate it on every state click. Loading is
   * lazy (only the first time the `retrieve` surface renders) so every other
   * surface stays unaffected by a missing cassette file.
   */
  let cassettePromise: ReturnType<typeof loadEmbeddingCassette> | null = null;
  function ensureEmbeddingCassette(): ReturnType<typeof loadEmbeddingCassette> {
    if (cassettePromise === null) cassettePromise = loadEmbeddingCassette();
    return cassettePromise;
  }
  /**
   * The generation cassette (`ol-opmb.3` [TB-3]), fetched once and reused —
   * same discipline as `ensureEmbeddingCassette` above, for the same reason.
   */
  let generationCassettePromise: ReturnType<typeof loadGenerationCassette> | null = null;
  function ensureGenerationCassette(): ReturnType<typeof loadGenerationCassette> {
    if (generationCassettePromise === null) generationCassettePromise = loadGenerationCassette();
    return generationCassettePromise;
  }
  /**
   * The fixture-vault oracle (walkthrough steps 7-8, D-041 `ol-st9i`), built
   * once and reused — same discipline as the two cassette caches above, for
   * the same reason: it walks the whole fixture vault (assessment read,
   * concept extraction, tier-3 evidence) and there is no reason to re-pay
   * that per state click when both steps read the SAME derivation. See
   * `oracle/fixture-oracle.ts`.
   */
  let fixtureOraclePromise: ReturnType<typeof buildFixtureOracle> | null = null;
  function ensureFixtureOracle(): ReturnType<typeof buildFixtureOracle> {
    if (fixtureOraclePromise === null) fixtureOraclePromise = buildFixtureOracle(vault);
    return fixtureOraclePromise;
  }

  async function loadPersona(personaId: WorkbenchPersonaId): Promise<void> {
    if (loaded.history.id === personaId && composed !== null) return;
    // A previous persona's day-files stay in the in-memory vault under
    // `.olea-synthetic/reviews/`; clearing them keeps "what is behind this
    // surface" a function of the URL alone. `MemoryVaultSource` has no delete,
    // so they are overwritten with an empty file rather than removed — which is
    // honest about what happened and keeps the path enumerable.
    for (const path of loaded.paths) await vault.write(path, '');
    const history = buildPersonaHistory(personaId);
    const paths = await writePersonaHistory(vault, history);
    loaded = { history, paths };

    // The persona's stream reaches the composer as parsed records, never by
    // pointing it at a folder — see `persona/history.ts`'s `entriesFor`.
    composed = await deriveWorkbenchQueue({
      vault,
      scheduler,
      entries: (records) => history.entriesFor(records),
    });
    requireEl('[data-wb-counts]').textContent = describeWorkbenchQueue(composed, fixtureCount);
  }

  /** The day scrubber's whole mechanism: change one field of the route and let `hashchange` re-render. */
  function scrubTo(day: number): void {
    writeRoute({ ...readRoute(), day });
  }

  async function render(): Promise<void> {
    const run = ++generation;
    const route = readRoute();
    const state = findStateFor(route.surface, route.stateId);
    const walkStep: WalkStep | undefined =
      route.surface === 'walk' ? findWalkStep(route.stateId) : undefined;
    const set = findVariableSet(route.setId);
    const persona = findPersona(route.personaId);
    if (state === undefined || set === undefined || persona === undefined) return;
    // Re-bound once, non-optional, right here: `set`/`persona` keep TS's
    // control-flow narrowing only in code that runs synchronously in THIS
    // scope — none of it survives into the nested `mount*` function
    // declarations below, which TS treats as possibly running at some other
    // time. `activeSet`/`activePersona` are declared non-optional from their
    // own initializer, so every closure over them stays narrowed.
    const activeSet = set;
    const activePersona = persona;

    document.documentElement.setAttribute('data-wb-ready', 'false');
    document.documentElement.setAttribute('data-wb-state', state.id);
    document.documentElement.setAttribute('data-wb-route-surface', route.surface);
    document.documentElement.setAttribute('data-wb-persona', persona.id);
    if (walkStep !== undefined) {
      document.documentElement.setAttribute('data-wb-walk-step', String(walkStep.n));
      document.documentElement.setAttribute('data-wb-walk-status', walkStep.status);
    } else {
      document.documentElement.removeAttribute('data-wb-walk-step');
      document.documentElement.removeAttribute('data-wb-walk-status');
    }

    await loadPersona(persona.id);
    if (run !== generation) return;

    if (mounted !== null) {
      await mounted.view.onClose();
      mounted.view.unloadComponent();
      mounted = null;
    }
    if (mountedModal !== null) {
      mountedModal.close();
      mountedModal = null;
    }
    host.empty();
    host.removeAttribute('data-wb-detached');
    noticeHost.empty();
    await applyVariableSet(set, frame);
    if (run !== generation) return;

    for (const button of stateList.querySelectorAll<HTMLElement>('[data-wb-state-link]')) {
      button.classList.toggle(
        'is-active',
        route.surface === 'review' && button.dataset.wbStateLink === state.id,
      );
    }
    for (const button of todayStateList.querySelectorAll<HTMLElement>(
      '[data-wb-today-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'today' && button.dataset.wbTodayStateLink === state.id,
      );
    }
    for (const button of oracleStateList.querySelectorAll<HTMLElement>(
      '[data-wb-oracle-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'oracle' && button.dataset.wbOracleStateLink === state.id,
      );
    }
    for (const button of retrieveStateList.querySelectorAll<HTMLElement>(
      '[data-wb-retrieve-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'retrieve' && button.dataset.wbRetrieveStateLink === state.id,
      );
    }
    for (const button of generateStateList.querySelectorAll<HTMLElement>(
      '[data-wb-generate-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'generate' && button.dataset.wbGenerateStateLink === state.id,
      );
    }
    for (const button of timelineStateList.querySelectorAll<HTMLElement>(
      '[data-wb-timeline-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'timeline' && button.dataset.wbTimelineStateLink === state.id,
      );
    }
    for (const button of explainStateList.querySelectorAll<HTMLElement>(
      '[data-wb-explain-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'explain' && button.dataset.wbExplainStateLink === state.id,
      );
    }
    for (const button of explainBackStateList.querySelectorAll<HTMLElement>(
      '[data-wb-explain-back-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'explain-back' && button.dataset.wbExplainBackStateLink === state.id,
      );
    }
    for (const button of sessionStateList.querySelectorAll<HTMLElement>(
      '[data-wb-session-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'session' && button.dataset.wbSessionStateLink === state.id,
      );
    }
    for (const button of trendsStateList.querySelectorAll<HTMLElement>(
      '[data-wb-trends-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'trends' && button.dataset.wbTrendsStateLink === state.id,
      );
    }
    for (const button of rhythmStateList.querySelectorAll<HTMLElement>(
      '[data-wb-rhythm-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'rhythm' && button.dataset.wbRhythmStateLink === state.id,
      );
    }
    for (const button of bulkReviewStateList.querySelectorAll<HTMLElement>(
      '[data-wb-bulk-review-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'bulk-review' && button.dataset.wbBulkReviewStateLink === state.id,
      );
    }
    for (const button of registryStateList.querySelectorAll<HTMLElement>(
      '[data-wb-registry-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'registry' && button.dataset.wbRegistryStateLink === state.id,
      );
    }
    for (const button of pluginSurfaceStateList.querySelectorAll<HTMLElement>(
      '[data-wb-plugin-surface-state-link]',
    )) {
      button.classList.toggle(
        'is-active',
        route.surface === 'plugin-surface' && button.dataset.wbPluginSurfaceStateLink === state.id,
      );
    }
    for (const button of setList.querySelectorAll<HTMLElement>('[data-wb-set-link]')) {
      button.classList.toggle('is-active', button.dataset.wbSetLink === set.id);
    }
    for (const button of personaList.querySelectorAll<HTMLElement>('[data-wb-persona-link]')) {
      button.classList.toggle('is-active', button.dataset.wbPersonaLink === persona.id);
    }

    // The host tab. `detach()` is the only thing a mounted view asks a leaf for.
    // Built fresh per mount (cheap — a two-method object closing over `host`)
    // rather than shared, because a walk step and a flat route can mount
    // different surfaces' views within the same `render()` call's lifetime as
    // navigation continues.
    function makeLeaf(): WorkspaceLeaf {
      return {
        // `ol-z6x2` [WB-2] F5 tranche: `WorkspaceLeaf` gained `view`/
        // `setViewState` for the explain-back → registry hand-off's OWN
        // `Workspace` shim leaves (`obsidian-shim/index.ts`'s module doc).
        // Every flat-surface `ItemView` mount still only ever calls
        // `detach()` on the leaf it is given, so these two are harmless
        // stubs here — never read by anything a flat-surface view does.
        view: null,
        async setViewState() {},
        detach() {
          host.empty();
          host.createDiv({
            cls: 'wb-detached',
            text: 'The view detached its tab. In Obsidian this closes the review tab.',
          });
          host.setAttr('data-wb-detached', 'true');
        },
      };
    }

    // Six mounters, one per flat surface, each doing exactly what that
    // surface's inline branch always did — extracted so BOTH the flat
    // dispatch below AND the walkthrough dispatch above it can reach the
    // identical code path a step reuses (rule 1: "mounts it exactly as that
    // surface would"). None of these decide routing; they only take the
    // state id (and, for timeline, the day) a caller already resolved.

    async function mountOracle(stateId: string): Promise<void> {
      // Self-contained: never touches the fixture vault, never reads `composed`
      // or `loaded.history` — each oracle state carries its own persona and
      // builds its own synthetic world (`oracle-scenarios.ts`). `loadPersona`
      // above still ran (harmless; keeps `composed` warm for a surface switch
      // back to review/today) but nothing below depends on it.
      const scenario = await buildOracleScenario(stateId);
      if (run !== generation) return;
      const view = new GapView(makeLeaf(), {
        ...scenario.deps,
        // `ol-p5t06b` (F4.6), workbench harness wiring only — the plugin's
        // own `GapView` already has this affordance and a real production
        // caller (`gap/view.ts`'s own doc); this mount had never set it,
        // leaving `.olea-gap-action-build-session` unclickable in every
        // oracle-surface state. Navigating to the session surface (rather
        // than seeding a leaf already on screen, `SessionBuilderView`'s own
        // `setFocusConcept` doc) is the honest workbench equivalent: there is
        // no already-open session tab here, only a route to land one on.
        // `row.conceptName` and the session surface's own fixture-vault
        // world are two different corpora by design (this surface's own
        // module doc), so the honest outcome on a synthetic-world concept is
        // `focusLine`'s "could not find" sentence, not a false match — see
        // the e2e test asserting exactly that.
        buildSession: (row) => {
          writeRoute({
            ...readRoute(),
            surface: 'session',
            stateId: DEFAULT_SESSION_STATE,
            focus: row.conceptName,
          });
        },
      });
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      renderOracleInspector(inspector, {
        stateNote: scenario.note,
        setNote: activeSet.note,
        scenario,
      });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountTimeline(stateId: string, day: number): Promise<void> {
      // Self-contained, same reasoning as `mountOracle`: each timeline state
      // pins its own persona and builds its own (cached) `SyntheticWorld`
      // timeline (`timeline-scenarios.ts`, [TB-4]). `day` is the only thing
      // that changes on a scrub — the persona's simulated semester is
      // computed once and reused.
      const scenario = await buildTimelineScenario(stateId, day);
      if (run !== generation) return;
      const view = new GapView(makeLeaf(), scenario.deps);
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      document.documentElement.setAttribute('data-wb-timeline-day', String(scenario.dayIndex));
      document.documentElement.setAttribute(
        'data-wb-timeline-total-days',
        String(scenario.totalDays),
      );
      renderTimelineInspector(inspector, { setNote: activeSet.note, scenario, onScrub: scrubTo });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountRetrieve(stateId: string): Promise<void> {
      // Self-contained, same reasoning as `mountOracle`: never touches the
      // fixture vault or `composed`. Unlike oracle there is no real product
      // view to mount (no plugin surface renders raw retrieval results) —
      // see index.html's own note on this nav section — so the host pane
      // gets an honest placeholder and the whole result lives in the
      // inspector.
      host.createDiv({
        cls: 'wb-detached',
        text:
          'The query -> retrieve -> ground/refuse chain has no product view to mount. See the ' +
          'inspector for the query, the result and the pipeline trace.',
      });

      const cassette = await ensureEmbeddingCassette();
      if (run !== generation) return;
      const scenario = await buildRetrieveScenario(stateId, cassette);
      if (run !== generation) return;

      renderRetrieveInspector(inspector, { setNote: activeSet.note, scenario });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountGenerate(stateId: string): Promise<void> {
      // Self-contained, same reasoning as `mountRetrieve`.
      host.createDiv({
        cls: 'wb-detached',
        text:
          'The query -> retrieve -> ground/refuse -> generate chain has no product view to mount ' +
          'yet — P3-T07b\'s own accept-step wiring is still open in the product (see "Not built ' +
          'yet"). See the inspector for the trace. The control below the notice IS a real accept ' +
          'gate (INV-6): nothing becomes McqFields until it is clicked.',
      });

      const embeddingCassette = await ensureEmbeddingCassette();
      if (run !== generation) return;
      const generationCassette = await ensureGenerationCassette();
      if (run !== generation) return;
      const scenario = await buildGenerateScenario(stateId, embeddingCassette, generationCassette);
      if (run !== generation) return;

      renderGenerateInspector(inspector, { setNote: activeSet.note, scenario });
      renderAcceptGate(host, inspector, activeSet.note, scenario);
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountToday(stateId: string): Promise<void> {
      if (composed === null)
        throw new Error('workbench: no composed session after loading a persona');
      const todayState = findTodayState(stateId);
      const scenario = buildTodayScenario({
        vault,
        scheduler,
        queue: composed,
        stateId,
        history: loaded.history,
      });
      const view = new TodayView(makeLeaf(), scenario.deps);
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      if (scenario.afterOpen) {
        await scenario.afterOpen(view);
        if (run !== generation) return;
      }

      const boundary = await checkVaultBoundary(vault);
      if (run !== generation) return;
      const recomputed = await scenario.deps.load();
      if (run !== generation) return;

      renderTodayInspector(inspector, {
        stateNote: todayState?.note ?? '',
        setNote: activeSet.note,
        persona: activePersona,
        history: loaded.history,
        boundary,
        scenario,
        recomputed,
      });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountReview(stateId: string): Promise<void> {
      if (composed === null)
        throw new Error('workbench: no composed session after loading a persona');
      const reviewState = findState(stateId);
      const scenario = buildScenario({
        vault,
        scheduler,
        queue: composed,
        stateId,
        history: loaded.history,
      });

      const session = new ReviewSession(scenario.deps);
      // `ReviewView` takes a session *provider* rather than a session, because
      // Obsidian's `registerView` factory is synchronous while composing a
      // session over a vault is not (see `review/view.ts`'s
      // `ReviewSessionProvider`). The workbench already holds a fully built
      // session for the scenario it is mounting, so its provider is the identity.
      const view = new ReviewView(makeLeaf(), () => session);
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      for (const key of scenario.keys) {
        sendKey(frame, view.contentEl, key);
        await settle();
        if (run !== generation) return;
      }

      const boundary = await checkVaultBoundary(vault);
      if (run !== generation) return;

      renderInspector(inspector, {
        stateNote: reviewState?.note ?? '',
        setNote: activeSet.note,
        persona: activePersona,
        history: loaded.history,
        boundary,
        scenario,
      });
      if (stateId !== 'loading') {
        document.documentElement.setAttribute('data-wb-ready', 'true');
      }
    }

    async function mountExplain(stateId: string): Promise<void> {
      // Self-contained, same reasoning as `mountRetrieve`: no product view
      // exists for F2.7's grounding-plus-prose result (the review view's own
      // on-demand trigger is the real surface — see `explain/generate.ts`'s
      // module doc), so this reports through the inspector only.
      host.createDiv({
        cls: 'wb-detached',
        text:
          "F2.7's two halves both run for real here: the grounding half quotes her own notes " +
          '(real fixture-vault text, real keyword search), and `explain-why.generate.v1` writes ' +
          'the explanation from those exact quotes (a recorded call, replayed — see the inspector ' +
          'for the query, the cited passages, the prose and the pipeline trace).',
      });

      const generationCassette = await ensureGenerationCassette();
      if (run !== generation) return;
      const scenario = await buildExplainScenario(stateId, vault, generationCassette);
      if (run !== generation) return;

      renderExplainInspector(inspector, { setNote: activeSet.note, scenario });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountSession(stateId: string, focusConceptName = ''): Promise<void> {
      // The real fixture vault, exactly as `mountFixtureOracle` reads it —
      // never `composed`/`loaded.history`, which belong to the synthetic
      // persona machinery this surface deliberately does not use (see
      // `session-scenarios.ts`'s module doc).
      const scenario = await buildSessionScenario(stateId, vault);
      if (run !== generation) return;

      // Derived from the state's own data, never a hardcoded id list — see
      // `SESSION_ILLUSTRATIVE_LABEL`'s own comment.
      if (scenario.state.instruments === 'borrowed' || scenario.state.history === 'borrowed') {
        host.createDiv({ cls: 'wb-illustrative-label', text: SESSION_ILLUSTRATIVE_LABEL });
        renderSyntheticProvisionalBadge(host);
      }

      const view = new SessionBuilderView(makeLeaf(), scenario.deps);
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      // `route.focus` (`ol-p5t06b`): the gap view's build-session affordance
      // navigated here with a concept name. `setFocusConcept` is the real
      // `SessionBuilderView` method the plugin's own `main.ts` would call to
      // seed a leaf it is about to reveal — this harness has no leaf to seed
      // in advance, so it calls the same method immediately after opening
      // the fresh one instead. A concept absent from this state's ranking is
      // not an error (`focusLine`'s own doc): the session still builds, and
      // says so on screen.
      if (focusConceptName.length > 0) {
        await view.setFocusConcept(focusConceptName);
        await settle();
        if (run !== generation) return;
      }

      renderSessionInspector(inspector, { setNote: activeSet.note, scenario });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountTrends(stateId: string): Promise<void> {
      // Synchronous and self-contained, same reasoning as `mountOracle`: each
      // trends state replays its own persona stream through the product's own
      // `buildTodayPanel`, never touching `composed`/`loaded.history`.
      host.createDiv({ cls: 'wb-illustrative-label', text: TRENDS_ILLUSTRATIVE_LABEL });
      renderSyntheticProvisionalBadge(host);

      const scenario = buildTrendsScenario(stateId);
      const view = new TodayView(makeLeaf(), scenario.deps);
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      renderTrendsInspector(inspector, { setNote: activeSet.note, scenario });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    /**
     * RHY-3's multicourse composition (`ol-i0zw`), against the REAL fixture
     * vault plus one synthetic calendar note — never `composed`/
     * `loaded.history`, same reasoning as `mountSession`. No product view to
     * mount (`rhythm-scenarios.ts`'s module doc), so this draws real DOM
     * straight into `host`, the same posture `mountGenerate`'s accept-gate
     * panel already takes for a chain with no product renderer yet.
     */
    async function mountRhythm(stateId: string): Promise<void> {
      host.createDiv({ cls: 'wb-illustrative-label', text: RHYTHM_NO_PRODUCT_VIEW_NOTICE });
      renderSyntheticProvisionalBadge(host);

      const scenario = await buildRhythmScenario(stateId, vault);
      if (run !== generation) return;

      renderRhythmPanel(host, scenario.panel);
      renderRhythmInspector(inspector, { setNote: activeSet.note, scenario });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    /**
     * F3.3's bulk-review triage (`ol-jie3`) — the REAL `BulkReviewView` over
     * the REAL `BulkReviewController`, `createVaultDraftCacheStore` and
     * `createDraftAcceptPort` from `packages/plugin`, run against a
     * synthetic in-memory vault this surface seeds itself
     * (`bulk-review-scenarios.ts`). Every accept/edit/reject click below is
     * a real vault write and a real verdict-record append, not a rendered
     * mock — see that file's module doc.
     */
    async function mountBulkReview(stateId: string): Promise<void> {
      const scenario = buildBulkReviewScenario(stateId);
      await seedBulkReviewScenario(scenario);
      if (run !== generation) return;

      const view = new BulkReviewView(makeLeaf(), () => scenario.controller);
      host.appendChild(view.containerEl);
      mounted = { view };

      inspector.empty();
      inspector.createDiv({ cls: 'wb-inspector-note', text: activeSet.note });
      const editNoteEl = inspector.createDiv({ cls: 'wb-inspector-note' });
      function renderEditNote(): void {
        editNoteEl.setText(
          scenario.editPort.edited.length === 0
            ? 'No "Edit before saving" click yet this state.'
            : `Edit hand-off recorded for: ${scenario.editPort.edited
                .map((e) => e.sourcePath)
                .join(', ')}`,
        );
      }
      scenario.editPort.onEdit = renderEditNote;
      renderEditNote();

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    /**
     * F8.4's concept-and-instrument registry (`[D-171]`, `ol-4v2l`) — the
     * REAL `RegistryView` over the REAL `buildRegistryModel`, fed fixture
     * `ConceptRecord`/`VaultInstrumentRecord` arrays rather than a vault walk
     * (`registry-scenarios.ts`'s own module doc explains why). Rename,
     * withdraw and restore run through the real `overrides.ts` pure
     * transforms, held in memory for this scenario instance.
     */
    async function mountRegistry(stateId: string): Promise<void> {
      const scenario = buildRegistryScenario(stateId);
      if (run !== generation) return;

      const originalEditInstrument = scenario.deps.editInstrument.bind(scenario.deps);
      const originalOpenSourceLocation = scenario.deps.openSourceLocation.bind(scenario.deps);
      const registryDeps = {
        ...scenario.deps,
        editInstrument: async (instrumentSummary: Parameters<typeof originalEditInstrument>[0]) => {
          await originalEditInstrument(instrumentSummary);
          renderRegistryNotes();
        },
        openSourceLocation: async (location: Parameters<typeof originalOpenSourceLocation>[0]) => {
          await originalOpenSourceLocation(location);
          renderRegistryNotes();
        },
      };
      const view = new RegistryView(makeLeaf(), registryDeps);
      host.appendChild(view.containerEl);
      mounted = { view };

      inspector.empty();
      inspector.createDiv({ cls: 'wb-inspector-note', text: activeSet.note });
      // F8.4's mastery/vitality readings shown per concept are computed over
      // this scenario's synthetic fixture records, never a real vault read —
      // TB-0's `[ol-opmb.6]` badge applies. Withheld on the empty state,
      // which shows no concept row and therefore no number to mislabel.
      if (stateId !== 'registry-empty') renderSyntheticProvisionalBadge(inspector);
      const editNoteEl = inspector.createDiv({ cls: 'wb-inspector-note' });
      const sourceNoteEl = inspector.createDiv({ cls: 'wb-inspector-note' });
      function renderRegistryNotes(): void {
        editNoteEl.setText(
          scenario.editHandoffs.length === 0
            ? 'No "Edit" hand-off yet this state.'
            : `Edit hand-off recorded for: ${scenario.editHandoffs.map((e) => e.notePath).join(', ')}`,
        );
        sourceNoteEl.setText(
          scenario.sourceOpens.length === 0
            ? 'No "Open source" click yet this state.'
            : `Source location opened: ${scenario.sourceOpens.map((l) => l.sourcePath).join(', ')}`,
        );
      }
      renderRegistryNotes();

      void view.onOpen();
      await settle();
      if (run !== generation) return;
      renderRegistryNotes();

      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    /**
     * F7's plugin surface (`ol-z6x2` [WB-2], `olea-service`'s
     * `features/F7-plugin-surface.md`) — the REAL `OleaSettingTab`
     * (`packages/plugin/src/settings/settings-tab.ts`) mounted whole, over a
     * fixture data host and a canned Worker transport
     * (`plugin-surface-scenarios.ts`'s own module doc explains the scope:
     * rendered copy, a section's conditional presence, and the "Test
     * connection" status line — never a real vault walk or a real HTTP
     * call). Not an `ItemView`: `OleaSettingTab` is Obsidian's
     * `PluginSettingTab`, which owns its own `containerEl` rather than
     * taking a `WorkspaceLeaf`, so this mounter never joins `mounted` — same
     * posture `mountRetrieve`/`mountRhythm` take for a surface with no
     * leaf-based lifecycle.
     */
    async function mountPluginSurface(stateId: string): Promise<void> {
      const scenario = buildPluginSurfaceScenario(stateId);
      if (run !== generation) return;

      host.appendChild(scenario.tab.containerEl);
      scenario.tab.display();
      // `display()` kicks off several `void this.render*Fields(...)` calls
      // (`settings-tab.ts`'s own doc) that each await at least one
      // `dataHost.loadData()` — two ticks lets every one of them settle
      // before the pane is read.
      await settle();
      await settle();
      if (run !== generation) return;

      inspector.empty();
      inspector.createDiv({ cls: 'wb-inspector-note', text: activeSet.note });
      inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.state.note });

      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    /**
     * F5.1's "Explain it back" surface (`ol-z6x2` F5 tranche, `[D-163]`) —
     * the REAL `ExplainBackModal` over CANNED `grade`/`acceptWithObservation`
     * results (`explain-back-scenarios.ts`'s own module doc explains why:
     * this surface's own risk is the modal's phase-rendering state machine,
     * never the grading pipeline itself, which is already covered by
     * `packages/core`'s own spec files).
     *
     * A `Modal`, not an `ItemView` (`obsidian-shim`'s own `Modal` doc): it
     * renders as an app-wide overlay into `[data-wb-modal-host]`, never into
     * `host` — so, like `mountRetrieve`/`mountGenerate`/`mountExplain`, the
     * host pane gets an honest placeholder and the real screen is the
     * overlay below the stage.
     */
    async function mountExplainBack(stateId: string): Promise<void> {
      host.createDiv({
        cls: 'wb-detached',
        text:
          "F5.1's ExplainBackModal (`[D-163]`) is an app-wide Modal overlay, never a workspace " +
          'tab — see the overlay below the stage for the real screen, and the inspector for the ' +
          '[D-171] "See in registry" hand-off this state has recorded, if any.',
      });

      const scenario = buildExplainBackScenario(stateId);
      if (run !== generation) return;

      mountedModal = scenario.modal;
      scenario.modal.open();
      await settle();
      if (run !== generation) return;

      const state = findExplainBackState(stateId);
      inspector.empty();
      inspector.createDiv({ cls: 'wb-inspector-note', text: activeSet.note });
      inspector.createDiv({ cls: 'wb-inspector-note', text: state?.note ?? '' });
      const handoffNoteEl = inspector.createDiv({ cls: 'wb-inspector-note' });
      handoffNoteEl.setText(
        scenario.registryHandoffCount() === 0
          ? 'No "See in registry" click yet this state.'
          : `Registry hand-off recorded: ${String(scenario.registryHandoffCount())} time(s).`,
      );
      // Re-rendered on demand rather than once: a "See in registry" click
      // inside the overlay mutates `scenario`'s own `app.workspace`, which
      // this closure re-reads each time it runs.
      scenario.modal.contentEl.addEventListener('click', () => {
        window.setTimeout(() => {
          handoffNoteEl.setText(
            scenario.registryHandoffCount() === 0
              ? 'No "See in registry" click yet this state.'
              : `Registry hand-off recorded: ${String(scenario.registryHandoffCount())} time(s).`,
          );
        }, 0);
      });

      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    // Walkthrough-only mounters. Neither draws a new PRODUCT screen (rule 1 —
    // see `walkthrough.ts`'s module doc for the argument in full): `mountNote`
    // shows her fixture note's own markdown, the same thing Obsidian's stock
    // reading view does with no plugin code involved; `mountFixtureOracle`
    // mounts the SAME real `GapView` `mountOracle` above does, over the real
    // fixture vault instead of a synthetic world (D-041, `ol-st9i`).

    async function mountNote(notePath: string): Promise<void> {
      const text = await vault.read(notePath);
      if (run !== generation) return;
      renderNoteView(host, notePath, text);
      inspector.empty();
      inspector.createDiv({
        cls: 'wb-inspector-note',
        text: `Her fixture note, read verbatim from ${notePath} — no product code between the vault and the screen.`,
      });
      inspector.createDiv({
        cls: 'wb-inspector-note wb-inspector-note--dim',
        text: activeSet.note,
      });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    async function mountFixtureOracle(stateId: string): Promise<void> {
      // WBF-3 (`ol-akla`): `stateId` used to be accepted and never read, so
      // steps 7 and 8 mounted the identical screen. `fixtureOracleFocus`
      // throws on anything it does not know, same discipline as every other
      // `find*State` in this package — see its module doc for what it does
      // and, just as importantly, does not invent.
      const focus = fixtureOracleFocus(stateId);
      const result = await ensureFixtureOracle();
      if (run !== generation) return;

      host.createDiv({ cls: 'wb-illustrative-label', text: FIXTURE_ORACLE_ILLUSTRATIVE_LABEL });
      renderSyntheticProvisionalBadge(host);
      host.createDiv({
        cls: 'wb-fixture-oracle-focus-note',
        text: fixtureOracleFocusNote(focus),
      });
      host.setAttr('data-wb-fixture-oracle-focus', focus);
      const view = new GapView(makeLeaf(), {
        load: () => Promise.resolve({ kind: 'model', model: result.gap }),
      });
      host.appendChild(view.containerEl);
      mounted = { view };

      void view.onOpen();
      await settle();
      if (run !== generation) return;

      // Same real screen, same real computation, both times (D-041's whole
      // argument) — what differs is which part of it a viewer lands on.
      // Step 8 ("where the holes are") opens scrolled to the coverage
      // section rather than at the top of the ranking.
      if (focus === 'coverage') {
        const coverageEl = host.querySelector<HTMLElement>('.olea-gap-coverage');
        coverageEl?.scrollIntoView({ block: 'start' });
      }

      renderFixtureOracleInspector(inspector, { setNote: activeSet.note, result, stateId });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    function mountGapCard(step: WalkStep): void {
      const gap = step.gap;
      if (gap === undefined) {
        throw new Error(`workbench: walk step ${String(step.n)} is a gap with no gap info`);
      }
      renderGapCard(host, gap);
      inspector.empty();
      inspector.createDiv({ cls: 'wb-inspector-note', text: step.copy });
      inspector.createDiv({
        cls: 'wb-inspector-note wb-inspector-note--dim',
        text: activeSet.note,
      });
      document.documentElement.setAttribute('data-wb-ready', 'true');
    }

    const isWalk = route.surface === 'walk';
    flatNav.hidden = isWalk;
    walkNav.hidden = !isWalk;
    walkChrome.hidden = !isWalk;

    if (isWalk && walkStep !== undefined) {
      const step = walkStep;
      walkCounter.textContent = `Step ${String(step.n)} of ${String(WALKTHROUGH_STEPS.length)}`;
      walkStatusBadge.textContent = step.status;
      walkStatusBadge.className = `wb-walk-status wb-walk-status--${step.status}`;
      walkTitle.textContent = step.title;
      walkCopy.textContent = step.copy;
      walkPrev.toggleAttribute('disabled', step.n <= 1);
      walkNext.toggleAttribute('disabled', step.n >= WALKTHROUGH_STEPS.length);
      for (const button of walkStepList.querySelectorAll<HTMLElement>('[data-wb-walk-step-link]')) {
        button.classList.toggle('is-active', button.dataset.wbWalkStepLink === String(step.n));
      }
      for (const button of modeSwitchList.querySelectorAll<HTMLElement>('[data-wb-mode-link]')) {
        button.classList.toggle('is-active', button.dataset.wbModeLink === 'walk');
      }

      if (step.status === 'gap' || step.surface === null || step.stateId === null) {
        mountGapCard(step);
        return;
      }
      switch (step.surface) {
        case 'note':
          await mountNote(step.stateId);
          return;
        case 'oracle-fixture':
          await mountFixtureOracle(step.stateId);
          return;
        case 'oracle':
          await mountOracle(step.stateId);
          return;
        case 'timeline':
          await mountTimeline(step.stateId, route.day);
          return;
        case 'retrieve':
          await mountRetrieve(step.stateId);
          return;
        case 'generate':
          await mountGenerate(step.stateId);
          return;
        case 'today':
          await mountToday(step.stateId);
          return;
        case 'review':
          await mountReview(step.stateId);
          return;
        case 'explain':
          await mountExplain(step.stateId);
          return;
        case 'session':
          await mountSession(step.stateId);
          return;
        case 'trends':
          await mountTrends(step.stateId);
          return;
      }
    }
    // Unreachable in practice: `state` above only resolves for `route.surface
    // === 'walk'` when `findWalkStep` also resolves, so `walkStep` is always
    // defined here. Guarded anyway rather than falling into the flat dispatch
    // below with a stepId that means nothing to any of the six surfaces.
    if (isWalk) return;

    for (const button of modeSwitchList.querySelectorAll<HTMLElement>('[data-wb-mode-link]')) {
      button.classList.toggle('is-active', button.dataset.wbModeLink === 'flat' && !isWalk);
    }

    if (route.surface === 'oracle') {
      await mountOracle(route.stateId);
      return;
    }
    if (route.surface === 'timeline') {
      await mountTimeline(route.stateId, route.day);
      return;
    }
    if (route.surface === 'retrieve') {
      await mountRetrieve(route.stateId);
      return;
    }
    if (route.surface === 'generate') {
      await mountGenerate(route.stateId);
      return;
    }
    if (route.surface === 'explain') {
      await mountExplain(route.stateId);
      return;
    }
    if (route.surface === 'explain-back') {
      await mountExplainBack(route.stateId);
      return;
    }
    if (route.surface === 'session') {
      await mountSession(route.stateId, route.focus);
      return;
    }
    if (route.surface === 'trends') {
      await mountTrends(route.stateId);
      return;
    }
    if (route.surface === 'rhythm') {
      await mountRhythm(route.stateId);
      return;
    }
    if (route.surface === 'bulk-review') {
      await mountBulkReview(route.stateId);
      return;
    }
    if (route.surface === 'registry') {
      await mountRegistry(route.stateId);
      return;
    }
    if (route.surface === 'plugin-surface') {
      await mountPluginSurface(route.stateId);
      return;
    }
    if (route.surface === 'today') {
      await mountToday(route.stateId);
      return;
    }
    if (route.surface === 'review') {
      await mountReview(route.stateId);
      return;
    }
  }

  window.addEventListener('hashchange', () => {
    void render();
  });
  // Left/right arrow steps the walkthrough — bound on THIS document, never
  // the host frame's, so the review surface's own real keystrokes (dispatched
  // into the frame by `sendKey`) can never be intercepted by this listener,
  // and this listener can never reach into the frame either: the two realms
  // stay disjoint, same as `host-frame.ts`'s whole argument for why the
  // iframe boundary exists at all. Guarded off whenever an input in THIS
  // document has focus (the timeline day-scrubber's number input lives in
  // the inspector, in this document) so an arrow key still edits the number
  // rather than jumping steps out from under it.
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (readRoute().surface !== 'walk') return;
    const active = document.activeElement;
    const tag = active instanceof HTMLElement ? active.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const current = findWalkStep(readRoute().stateId);
    if (current === undefined) return;
    const nextN = event.key === 'ArrowLeft' ? current.n - 1 : current.n + 1;
    if (nextN < 1 || nextN > WALKTHROUGH_STEPS.length) return;
    event.preventDefault();
    writeRoute({ ...readRoute(), surface: 'walk', stateId: String(nextN) });
  });
  walkPrev.addEventListener('click', () => {
    const current = findWalkStep(readRoute().stateId);
    if (current === undefined || current.n <= 1) return;
    writeRoute({ ...readRoute(), surface: 'walk', stateId: String(current.n - 1) });
  });
  walkNext.addEventListener('click', () => {
    const current = findWalkStep(readRoute().stateId);
    if (current === undefined || current.n >= WALKTHROUGH_STEPS.length) return;
    writeRoute({ ...readRoute(), surface: 'walk', stateId: String(current.n + 1) });
  });
  writeRoute(readRoute());
  await render();
}

interface InspectorInput {
  readonly stateNote: string;
  readonly setNote: string;
  readonly persona: (typeof PERSONA_OPTIONS)[number];
  readonly history: PersonaHistory;
  readonly boundary: Awaited<ReturnType<typeof checkVaultBoundary>>;
  readonly scenario: Scenario;
}

function renderInspector(inspector: HTMLElement, input: InspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: input.stateNote });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: input.persona.note,
  });

  const history = inspector.createDiv({ cls: 'wb-inspector-row' });
  history.createSpan({ cls: 'wb-inspector-label', text: 'persona history' });
  history.createSpan({ cls: 'wb-inspector-value', text: input.history.summary });

  // The boundary, re-checked in the assembled vault rather than asserted. The
  // persona's stream is written through olea-synthetic's guarded writer, which
  // refuses the whole `.olea/` namespace; the session's own records go through
  // core's real appendReviewLogRecord to `.olea/reviews/`. If the two ever met,
  // this line would say so.
  const { boundary } = input;
  const boundaryRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  boundaryRow.createSpan({ cls: 'wb-inspector-label', text: 'log namespaces' });
  boundaryRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `.olea/reviews: ${String(boundary.realLogFiles)} file(s), ${String(boundary.realLogRecords)} record(s) — ` +
      `.olea-synthetic/reviews: ${String(boundary.syntheticLogFiles)} file(s), ${String(boundary.syntheticLogRecords)} record(s). ` +
      (boundary.syntheticRecordsInRealLog.length === 0
        ? 'No synthetic-stamped record is in the real log path.'
        : `LEAK — ${String(boundary.syntheticRecordsInRealLog.length)} synthetic record(s) in the real log path, first ${JSON.stringify(boundary.syntheticRecordsInRealLog[0])}.`),
  });
  if (boundary.syntheticRecordsInRealLog.length > 0) {
    inspector.setAttr('data-wb-log-boundary', 'broken');
  } else {
    inspector.setAttr('data-wb-log-boundary', 'held');
  }

  if (input.history.id !== 'none') {
    inspector.createDiv({
      cls: 'wb-inspector-note wb-inspector-note--dim',
      text: PERSONA_PROVISIONAL_NOTE,
    });
  }

  const keys = inspector.createDiv({ cls: 'wb-inspector-row' });
  keys.createSpan({ cls: 'wb-inspector-label', text: 'keys sent' });
  keys.createSpan({
    cls: 'wb-inspector-value',
    text:
      scenario.keys.length === 0
        ? 'none — this is the state the view opens in'
        : scenario.keys.map((key) => (key === ' ' ? 'Space' : key)).join(' → '),
  });

  const log = inspector.createDiv({ cls: 'wb-inspector-row' });
  log.createSpan({ cls: 'wb-inspector-label', text: 'review log written' });
  if (scenario.logged.length === 0) {
    log.createSpan({ cls: 'wb-inspector-value', text: 'nothing — no rating happened' });
    return;
  }
  const list = log.createDiv({ cls: 'wb-inspector-log' });
  for (const event of scenario.logged) {
    list.createDiv({ cls: 'wb-inspector-log-path', text: event.path });
    list.createEl('pre', { cls: 'wb-inspector-log-json', text: event.json });
  }
}

/** One line: what a `TodayViewModel` says, for the inspector. */
function formatTodayViewModel(vm: TodayViewModel): string {
  const due =
    vm.due === null
      ? "can't count (null)"
      : `${String(vm.due.total)} due, ${String(vm.due.newCount)} new, courses: ` +
        (vm.due.courses.length === 0
          ? 'none'
          : vm.due.courses.map((c) => `${c.courseCode} ×${String(c.count)}`).join(', '));
  const streak =
    `streak ${String(vm.streak.currentDays)}${vm.streak.atWindowEdge ? '+' : ''} day(s), ` +
    `studied today: ${String(vm.streak.studiedToday)}`;
  return `${due} — ${streak}`;
}

interface TodayInspectorInput {
  readonly stateNote: string;
  readonly setNote: string;
  readonly persona: (typeof PERSONA_OPTIONS)[number];
  readonly history: PersonaHistory;
  readonly boundary: Awaited<ReturnType<typeof checkVaultBoundary>>;
  readonly scenario: TodayScenario;
  /** `scenario.deps.load()`, called fresh right before this render — the vault's current truth. */
  readonly recomputed: TodayViewModel;
}

function renderTodayInspector(inspector: HTMLElement, input: TodayInspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: input.stateNote });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: input.persona.note,
  });

  const history = inspector.createDiv({ cls: 'wb-inspector-row' });
  history.createSpan({ cls: 'wb-inspector-label', text: 'persona history' });
  history.createSpan({ cls: 'wb-inspector-value', text: input.history.summary });

  const { boundary } = input;
  const boundaryRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  boundaryRow.createSpan({ cls: 'wb-inspector-label', text: 'log namespaces' });
  boundaryRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `.olea/reviews: ${String(boundary.realLogFiles)} file(s), ${String(boundary.realLogRecords)} record(s) — ` +
      `.olea-synthetic/reviews: ${String(boundary.syntheticLogFiles)} file(s), ${String(boundary.syntheticLogRecords)} record(s). ` +
      (boundary.syntheticRecordsInRealLog.length === 0
        ? 'No synthetic-stamped record is in the real log path.'
        : `LEAK — ${String(boundary.syntheticRecordsInRealLog.length)} synthetic record(s) in the real log path, first ${JSON.stringify(boundary.syntheticRecordsInRealLog[0])}.`),
  });
  if (boundary.syntheticRecordsInRealLog.length > 0) {
    inspector.setAttr('data-wb-log-boundary', 'broken');
  } else {
    inspector.setAttr('data-wb-log-boundary', 'held');
  }

  // The pane's own on-screen state was already committed to the DOM by
  // `TodayView.render` before this runs. `recomputed` is a SEPARATE, freshly
  // computed read of the same vault, taken right now — for `today-stale` the
  // two disagree on purpose (ol-h3wy's mechanism), and this row is where that
  // disagreement is visible rather than merely asserted.
  const vmRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  vmRow.createSpan({ cls: 'wb-inspector-label', text: 'vault, recomputed now' });
  vmRow.createSpan({ cls: 'wb-inspector-value', text: formatTodayViewModel(input.recomputed) });

  const refreshRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  refreshRow.createSpan({ cls: 'wb-inspector-label', text: 'view.refresh() called' });
  refreshRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      scenario.afterOpen === undefined
        ? 'n/a — nothing changed after open'
        : String(scenario.refreshedAfterWrite),
  });

  const log = inspector.createDiv({ cls: 'wb-inspector-row' });
  log.createSpan({ cls: 'wb-inspector-label', text: 'review log written' });
  if (scenario.logged.length === 0) {
    log.createSpan({ cls: 'wb-inspector-value', text: 'nothing — no session ran' });
    return;
  }
  const list = log.createDiv({ cls: 'wb-inspector-log' });
  for (const event of scenario.logged) {
    list.createDiv({ cls: 'wb-inspector-log-path', text: event.path });
    list.createEl('pre', { cls: 'wb-inspector-log-json', text: event.json });
  }
}

/** N-015 layer 4: every numeric panel derived from a synthetic world badges itself, same wording as `PERSONA_PROVISIONAL_NOTE`. */
const ORACLE_PROVISIONAL_NOTE =
  'synthetic-provisional: mastery, ranking, plan and gap numbers below are all computed from a ' +
  'fabricated olea-synthetic world (curriculum + corpus + review stream). This is a wiring-and-' +
  'invariant demonstration, not a quality measurement — the corpus is coined nonsense tokens, an ' +
  'embedding model has no real geometry over them, and no threshold may ever be tuned on any of ' +
  'this (N-015). See eval/CLAUDE.md.';

interface OracleInspectorInput {
  readonly stateNote: string;
  readonly setNote: string;
  readonly scenario: OracleScenario;
}

function renderOracleInspector(inspector: HTMLElement, input: OracleInspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: input.stateNote });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: ORACLE_PROVISIONAL_NOTE,
  });
  renderSyntheticProvisionalBadge(inspector);

  const planRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  planRow.createSpan({ cls: 'wb-inspector-label', text: 'plan' });
  planRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${scenario.plan.policyVersion} — asOf ${scenario.plan.body.asOf}, computedAt ${scenario.plan.computedAt}, ${String(scenario.plan.body.courses.length)} course(s)`,
  });

  if (scenario.refresh) {
    const { refresh } = scenario;
    const refreshRow = inspector.createDiv({ cls: 'wb-inspector-row' });
    refreshRow.createSpan({ cls: 'wb-inspector-label', text: 'refreshStudyPlan' });
    refreshRow.createSpan({
      cls: 'wb-inspector-value',
      text:
        `source: ${refresh.source}, offline: ${String(refresh.offline)}` +
        (refresh.reason === undefined ? '' : `, reason: ${refresh.reason}`) +
        (refresh.plan === null ? '' : `, planVersion: ${refresh.plan.policyVersion}`),
    });
  }

  const traceHeading = inspector.createDiv({ cls: 'wb-inspector-note', text: 'pipeline trace' });
  void traceHeading;
  const traceList = inspector.createDiv({ cls: 'wb-inspector-log' });
  for (const stage of scenario.trace.stages) {
    const row = traceList.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: stage.stage });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${stage.status} · ${stage.durationMs.toFixed(2)}ms · ` +
        `in: ${JSON.stringify(stage.inputSummary)} · out: ${JSON.stringify(stage.outputSummary)}` +
        (stage.couldHaveSucceeded
          ? ''
          : ` · couldHaveSucceeded: false, attributedTo: ${String(stage.attributedTo)}`),
    });
  }
}

/** N-015 layer 4, same wording family as `ORACLE_PROVISIONAL_NOTE` — plus the timeline's own caveat: this is many instants of the SAME wiring-and-invariant demonstration, never a claim about how she actually studies. */
const TIMELINE_PROVISIONAL_NOTE =
  'synthetic-provisional: every day below replays the SAME fabricated olea-synthetic world at a ' +
  "growing prefix of one persona's stream — mechanism over time, never a quality measurement or " +
  'evidence about how she actually studies. No threshold is tuned from any of this (N-015). See ' +
  'eval/CLAUDE.md.';

interface TimelineInspectorInput {
  readonly setNote: string;
  readonly scenario: TimelineScenario;
  readonly onScrub: (day: number) => void;
}

/**
 * The day scrubber (`ol-opmb.5` [TB-4]): "a day scrubber over a derived
 * series... so a viewer can see WHERE the plan changed and WHY" (the bead's
 * own framing). Prev/next buttons and a number input, all driving the SAME
 * `onScrub` -> `writeRoute` -> `hashchange` -> `render` loop every other nav
 * control in this file already uses — no separate re-render path to drift
 * from the URL's own story.
 */
function renderTimelineInspector(inspector: HTMLElement, input: TimelineInspectorInput): void {
  const { scenario, onScrub } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: TIMELINE_PROVISIONAL_NOTE,
  });

  const scrubber = inspector.createDiv({
    cls: 'wb-inspector-row',
    attr: { 'data-wb-timeline-scrubber': 'true' },
  });
  const prev = scrubber.createEl('button', { text: '← day', attr: { type: 'button' } });
  prev.setAttr('data-wb-timeline-prev', 'true');
  prev.disabled = scenario.dayIndex <= 0;
  prev.addEventListener('click', () => onScrub(scenario.dayIndex - 1));

  const dayInput = scrubber.createEl('input', {
    attr: {
      type: 'number',
      min: '0',
      max: String(scenario.totalDays - 1),
      'data-wb-timeline-day-input': 'true',
    },
  });
  dayInput.value = String(scenario.dayIndex);
  dayInput.addEventListener('change', () => {
    const parsed = Number(dayInput.value);
    if (Number.isFinite(parsed)) onScrub(parsed);
  });

  const next = scrubber.createEl('button', { text: 'day →', attr: { type: 'button' } });
  next.setAttr('data-wb-timeline-next', 'true');
  next.disabled = scenario.dayIndex >= scenario.totalDays - 1;
  next.addEventListener('click', () => onScrub(scenario.dayIndex + 1));

  const dayRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  dayRow.createSpan({ cls: 'wb-inspector-label', text: 'day' });
  dayRow.createSpan({
    cls: 'wb-inspector-value',
    attr: { 'data-wb-timeline-day-value': 'true' },
    text:
      `${String(scenario.dayIndex)} of ${String(scenario.totalDays - 1)} — asOf ${scenario.day.asOf}, ` +
      `${String(scenario.day.entriesCounted)} event(s) counted`,
  });

  const planRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  planRow.createSpan({ cls: 'wb-inspector-label', text: 'plan' });
  planRow.createSpan({
    cls: 'wb-inspector-value',
    attr: { 'data-wb-timeline-plan-version': 'true' },
    text: `${scenario.day.result.plan.policyVersion} — ${String(scenario.day.result.plan.body.courses.length)} course(s)`,
  });

  const changedRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  changedRow.createSpan({ cls: 'wb-inspector-label', text: 'changed since yesterday' });
  changedRow.createSpan({
    cls: 'wb-inspector-value',
    attr: { 'data-wb-timeline-changed': 'true' },
    text:
      scenario.dayIndex === 0
        ? 'n/a — day 0'
        : scenario.changedStages.length === 0
          ? 'nothing'
          : scenario.changedStages.join(', '),
  });

  const seriesRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  seriesRow.createSpan({ cls: 'wb-inspector-label', text: 'plan versions this semester' });
  seriesRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${String(scenario.planVersionSeries.length)} distinct version(s) across the whole timeline`,
  });

  const degeneracyRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  degeneracyRow.createSpan({ cls: 'wb-inspector-label', text: 'anti-degeneracy (whole timeline)' });
  degeneracyRow.createSpan({
    cls: 'wb-inspector-value',
    attr: { 'data-wb-timeline-anti-degeneracy': 'true' },
    text:
      `queue composition varies: ${String(scenario.antiDegeneracy.queueVaries)} · ` +
      `mastery rose: ${String(scenario.antiDegeneracy.masteryRose)}`,
  });

  const nextEventsRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  nextEventsRow.createSpan({
    cls: 'wb-inspector-label',
    text: "next day's events, under this plan",
  });
  nextEventsRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      scenario.day.nextDayEvents.length === 0
        ? 'none'
        : `${String(scenario.day.nextDayEvents.length)} event(s) on ${scenario.day.asOf}, would carry planVersion ${scenario.day.result.plan.policyVersion}`,
  });

  const traceHeading = inspector.createDiv({
    cls: 'wb-inspector-note',
    text: 'pipeline trace, this day',
  });
  void traceHeading;
  const traceList = inspector.createDiv({ cls: 'wb-inspector-log' });
  for (const stage of scenario.day.result.trace.stages) {
    const row = traceList.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: stage.stage });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${stage.status} · ${stage.durationMs.toFixed(2)}ms · ` +
        `in: ${JSON.stringify(stage.inputSummary)} · out: ${JSON.stringify(stage.outputSummary)}` +
        (stage.couldHaveSucceeded
          ? ''
          : ` · couldHaveSucceeded: false, attributedTo: ${String(stage.attributedTo)}`),
    });
  }
}

/** N-015 layer 4, same wording family as `ORACLE_PROVISIONAL_NOTE`. */
const RETRIEVE_PROVISIONAL_NOTE =
  'synthetic-provisional: the query, the corpus and the result below are all fabricated over ' +
  'coined vocabulary tokens (olea-synthetic retrieval-corpus.ts + queries.ts). Retrieval ranking ' +
  'quality over this corpus is uninterpretable by construction — nothing here is evidence about ' +
  'recall, precision or the composite thresholds themselves. What IS real: this is the shipped ' +
  'retrieval/grounding code, run against real (once-embedded, now replayed) vectors. See ' +
  'eval/CLAUDE.md and the ol-opmb parent bead.';

interface RetrieveInspectorInput {
  readonly setNote: string;
  readonly scenario: RetrieveScenario;
}

function renderRetrieveInspector(inspector: HTMLElement, input: RetrieveInspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: RETRIEVE_PROVISIONAL_NOTE,
  });

  const queryRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  queryRow.createSpan({ cls: 'wb-inspector-label', text: 'query' });
  queryRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${scenario.result.query.id} (${scenario.result.query.label}) — requireComposite: ${String(scenario.result.requireComposite)}, corpus chunks: ${String(scenario.result.corpusChunkCount)}`,
  });

  const resultRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  resultRow.createSpan({ cls: 'wb-inspector-label', text: 'result' });
  const { result } = scenario.result;
  resultRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      result.status === 'grounded'
        ? `grounded — ${String(result.chunks.length)} cited chunk(s), first: ${result.chunks[0]?.path ?? ''}#${result.chunks[0]?.blockIndex ?? ''}`
        : `refused — ${result.reason}`,
  });

  const traceHeading = inspector.createDiv({ cls: 'wb-inspector-note', text: 'pipeline trace' });
  void traceHeading;
  const traceList = inspector.createDiv({ cls: 'wb-inspector-log' });
  for (const stage of scenario.result.trace.stages) {
    const row = traceList.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: stage.stage });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${stage.status} · ${stage.durationMs.toFixed(2)}ms · ` +
        `in: ${JSON.stringify(stage.inputSummary)} · out: ${JSON.stringify(stage.outputSummary)}` +
        (stage.couldHaveSucceeded
          ? ''
          : ` · couldHaveSucceeded: false, attributedTo: ${String(stage.attributedTo)}`),
    });
  }
}

/** N-015 layer 4, same wording family as `ORACLE_PROVISIONAL_NOTE`/`RETRIEVE_PROVISIONAL_NOTE`. */
const GENERATE_PROVISIONAL_NOTE =
  'synthetic-provisional: the course/concept names and every question below come from a fabricated ' +
  'olea-synthetic corpus over coined vocabulary tokens. This is a MECHANISM demonstration — does ' +
  'generation refuse on an inherited empty context, does the accept gate genuinely withhold ' +
  'McqFields until clicked, is the run deterministic — never a claim about card quality. See ' +
  'eval/CLAUDE.md and the ol-opmb parent bead.';

function renderTraceRows(
  traceList: HTMLElement,
  stages: GenerateScenario['generation']['trace']['stages'],
): void {
  for (const stage of stages) {
    const row = traceList.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: stage.stage });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${stage.status} · ${stage.durationMs.toFixed(2)}ms · ` +
        `in: ${JSON.stringify(stage.inputSummary)} · out: ${JSON.stringify(stage.outputSummary)}` +
        (stage.couldHaveSucceeded
          ? ''
          : ` · couldHaveSucceeded: false, attributedTo: ${String(stage.attributedTo)}`),
    });
  }
}

interface GenerateInspectorInput {
  readonly setNote: string;
  readonly scenario: GenerateScenario;
}

function renderGenerateInspector(inspector: HTMLElement, input: GenerateInspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: GENERATE_PROVISIONAL_NOTE,
  });

  const requestRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  requestRow.createSpan({ cls: 'wb-inspector-label', text: 'request' });
  requestRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${scenario.generation.request.courseCode} / ${scenario.generation.request.conceptName} — ` +
      `${String(scenario.generation.request.sourceChunks.length)} source chunk(s)`,
  });

  const resultRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  resultRow.createSpan({ cls: 'wb-inspector-label', text: 'generation result' });
  resultRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${String(scenario.generation.candidates.length)} candidate(s) — response.ok: ${String(scenario.generation.call.response.ok)}`,
  });

  const acceptRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  acceptRow.createSpan({ cls: 'wb-inspector-label', text: 'accept gate' });
  acceptRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      scenario.accepted === null
        ? 'not passed through yet'
        : `${String(scenario.accepted.accepted.length)} accepted, ${String(scenario.accepted.rejected)} rejected`,
  });

  const traceHeading = inspector.createDiv({ cls: 'wb-inspector-note', text: 'pipeline trace' });
  void traceHeading;
  const traceList = inspector.createDiv({ cls: 'wb-inspector-log' });
  renderTraceRows(traceList, scenario.retrieval.trace.stages);
  renderTraceRows(traceList, scenario.generation.trace.stages);
  if (scenario.accepted !== null) {
    renderTraceRows(traceList, scenario.accepted.trace.stages);
  }
}

/**
 * The live INV-6 accept gate. `generation-refused-upstream` has nothing to
 * accept — that is stated, not hidden. `generation-pending-accept` renders a
 * real `<button>` whose click handler calls the SAME `acceptCandidates`
 * `generate-scenarios.ts`'s `generation-accepted` build script calls, so a
 * URL and a click reach the identical place. `generation-accepted` opens
 * already past the gate; the note there says so.
 */
function renderAcceptGate(
  host: HTMLElement,
  inspector: HTMLElement,
  setNote: string,
  scenario: GenerateScenario,
): void {
  const gateHost = host.createDiv({ cls: 'wb-detached' });

  if (scenario.generation.candidates.length === 0) {
    gateHost.setAttr('data-wb-accept-state', 'nothing-to-accept');
    gateHost.createEl('p', {
      text: 'Generation refused (inherited from the retrieve stage) — nothing to accept.',
    });
    return;
  }

  if (scenario.accepted !== null) {
    gateHost.setAttr('data-wb-accept-state', 'accepted');
    gateHost.setAttr('data-wb-accept-count', String(scenario.accepted.accepted.length));
    gateHost.createEl('p', {
      text: `${String(scenario.accepted.accepted.length)} accepted, ${String(scenario.accepted.rejected)} rejected — vault-ready McqFields.`,
    });
    return;
  }

  gateHost.setAttr('data-wb-accept-state', 'pending');
  gateHost.createEl('p', {
    text: `${String(scenario.generation.candidates.length)} candidate(s) generated. NOT yet accepted — nothing here is vault-ready (INV-6).`,
  });
  const button = gateHost.createEl('button', { text: 'Accept' });
  button.setAttr('data-wb-accept-button', 'true');
  button.type = 'button';
  button.addEventListener('click', () => {
    const gate = acceptCandidates(scenario.generation.candidates as GeneratedMcqCandidate[]);
    const accepted = {
      note: scenario.note,
      retrieval: scenario.retrieval,
      generation: scenario.generation,
      accepted: { accepted: gate.accepted, rejected: gate.rejected.length, trace: gate.trace },
    };
    renderGenerateInspector(inspector, { setNote, scenario: accepted });
    gateHost.empty();
    gateHost.setAttr('data-wb-accept-state', 'accepted');
    gateHost.setAttr('data-wb-accept-count', String(gate.accepted.length));
    gateHost.createEl('p', {
      text: `${String(gate.accepted.length)} accepted, ${String(gate.rejected.length)} rejected — vault-ready McqFields.`,
    });
  });
}

interface ExplainInspectorInput {
  readonly setNote: string;
  readonly scenario: ExplainScenario;
}

/** F2.7's grounding half — inspector-only, same shape as `renderRetrieveInspector`, over the real fixture vault instead of the synthetic corpus. */
function renderExplainInspector(inspector: HTMLElement, input: ExplainInspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });

  const queryRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  queryRow.createSpan({ cls: 'wb-inspector-label', text: 'query' });
  queryRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${scenario.result.query} — requireComposite: ${String(scenario.result.requireComposite)}, ` +
      `corpus documents: ${String(scenario.result.corpusDocumentCount)}, chunks: ${String(scenario.result.corpusChunkCount)}`,
  });

  const resultRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  resultRow.createSpan({ cls: 'wb-inspector-label', text: 'result' });
  const { result } = scenario.result;
  resultRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      result.status === 'grounded'
        ? `grounded — ${String(result.chunks.length)} cited chunk(s), first: ${result.chunks[0]?.path ?? ''}#${result.chunks[0]?.blockIndex ?? ''}`
        : `refused — ${result.reason}`,
  });

  if (result.status === 'grounded') {
    const quotesRow = inspector.createDiv({ cls: 'wb-inspector-row' });
    quotesRow.createSpan({ cls: 'wb-inspector-label', text: 'cited passages' });
    const list = quotesRow.createDiv({ cls: 'wb-inspector-log' });
    for (const chunk of result.chunks) {
      list.createDiv({
        cls: 'wb-inspector-log-path',
        text: `${chunk.path}#${String(chunk.blockIndex)}`,
      });
      list.createEl('pre', { cls: 'wb-inspector-log-json', text: chunk.text });
    }
  }

  // The prose half (`ol-4k45` [XWY-2]) — `null` for `explanation-refused-no-grounding`, which
  // never calls the generative task (see `explain-scenarios.ts`'s module doc).
  if (scenario.prose !== null) {
    const { prose } = scenario;
    const proseRow = inspector.createDiv({ cls: 'wb-inspector-row' });
    proseRow.createSpan({ cls: 'wb-inspector-label', text: 'explanation' });
    proseRow.createSpan({
      cls: 'wb-inspector-value',
      text: prose.refused
        ? 'refused — explain-why.generate.v1 returned zero explanations'
        : `cites source #${String(prose.citedChunkIndex)}`,
    });
    if (!prose.refused && prose.text !== null) {
      inspector.createEl('pre', { cls: 'wb-inspector-log-json', text: prose.text });
    }
  }

  const traceHeading = inspector.createDiv({ cls: 'wb-inspector-note', text: 'pipeline trace' });
  void traceHeading;
  const traceList = inspector.createDiv({ cls: 'wb-inspector-log' });
  const stages =
    scenario.prose === null
      ? scenario.result.trace.stages
      : [...scenario.result.trace.stages, ...scenario.prose.trace.stages];
  for (const stage of stages) {
    const row = traceList.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: stage.stage });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${stage.status} · ${stage.durationMs.toFixed(2)}ms · ` +
        `in: ${JSON.stringify(stage.inputSummary)} · out: ${JSON.stringify(stage.outputSummary)}` +
        (stage.couldHaveSucceeded
          ? ''
          : ` · couldHaveSucceeded: false, attributedTo: ${String(stage.attributedTo)}`),
    });
  }
}

interface SessionInspectorInput {
  readonly setNote: string;
  readonly scenario: SessionScenario;
}

/** The session builder's own numbers, alongside the real `SessionBuilderView` — never a second source of truth for what the screen shows, only a read of the same model. */
function renderSessionInspector(inspector: HTMLElement, input: SessionInspectorInput): void {
  const { scenario } = input;
  const { model } = scenario;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });

  if (model === null) {
    // `state.simulateVaultFailure` (session-scenarios.ts): no world was
    // composed, so there is nothing to read independently of the view — the
    // honest counterpart of the `.olea-session-unavailable` box it rendered.
    const row = inspector.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: 'session' });
    row.createSpan({
      cls: 'wb-inspector-value',
      text: "unavailable — deps.load resolves { kind: 'unavailable' } with no world composed.",
    });
    return;
  }

  const budgetRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  budgetRow.createSpan({ cls: 'wb-inspector-label', text: 'budget' });
  budgetRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${String(model.budgetMinutes)} min, asOf ${model.asOf} — planned ${String(model.plannedSeconds)}s ` +
      `of ${String(model.budgetSeconds)}s, durationBasis: ${model.durationBasis}`,
  });

  const itemsRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  itemsRow.createSpan({ cls: 'wb-inspector-label', text: 'items' });
  itemsRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${String(model.items.length)} item(s), ${String(model.leftOut.length)} left out ` +
      `(${String(model.leftOutInstrumentCount)} instrument(s)), considered ${String(model.consideredRowCount)} row(s), ` +
      `formatPreference: ${model.formatPreference}`,
  });

  const assessmentRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  assessmentRow.createSpan({ cls: 'wb-inspector-label', text: 'next assessment' });
  assessmentRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      model.nextAssessment === null
        ? 'none'
        : `${model.nextAssessment.type ?? 'untyped'} — due ${model.nextAssessment.due ?? 'unknown'}, ` +
          `${model.nextAssessment.daysUntil === null ? 'unknown days' : `${String(model.nextAssessment.daysUntil)} day(s)`} away`,
  });

  const worldRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  worldRow.createSpan({ cls: 'wb-inspector-label', text: 'fixture vault' });
  worldRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${String(scenario.instrumentCount)} instrument(s), ${String(scenario.conceptCount)} concept(s), ` +
      `${String(scenario.gapRowCount)} ranked row(s), ${String(scenario.borrowedInstrumentCount)} re-bound`,
  });
}

/** N-015 layer 4, same wording family as `ORACLE_PROVISIONAL_NOTE`. */
const TRENDS_PROVISIONAL_NOTE =
  'synthetic-provisional: every number below is computed from a fabricated olea-synthetic ' +
  'persona stream — mechanism over a planted pattern, never a measurement of how she actually ' +
  'studies. No threshold here is tuned from any of this (N-015). See eval/CLAUDE.md.';

interface TrendsInspectorInput {
  readonly setNote: string;
  readonly scenario: TrendsScenario;
}

/** F6.2/F6.5's mastery overview and insights, over the real `TodayView` — the inspector re-states the same `viewModel` the pane rendered from, never a second computation. */
function renderTrendsInspector(inspector: HTMLElement, input: TrendsInspectorInput): void {
  const { scenario } = input;
  const { viewModel } = scenario;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: TRENDS_PROVISIONAL_NOTE,
  });

  const personaRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  personaRow.createSpan({ cls: 'wb-inspector-label', text: 'persona' });
  personaRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${scenario.persona} — neutralised: ${String(scenario.neutralised)}`,
  });

  const masteryRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  masteryRow.createSpan({ cls: 'wb-inspector-label', text: 'mastery' });
  masteryRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      viewModel.mastery === null
        ? "can't count (null)"
        : `${String(viewModel.mastery.courses.length)} course(s)`,
  });

  const spacingRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  spacingRow.createSpan({ cls: 'wb-inspector-label', text: 'spacing insight (F6.5a)' });
  spacingRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      viewModel.insights === null
        ? "can't count (null)"
        : `${viewModel.insights.spacing.status}` +
          (viewModel.insights.spacing.measured === null
            ? ''
            : ` — concentration ${viewModel.insights.spacing.measured.concentration.toFixed(2)}, ` +
              `attendanceRatio ${viewModel.insights.spacing.measured.attendanceRatio.toFixed(2)}, ` +
              `earlyShare ${viewModel.insights.spacing.measured.earlyShare.toFixed(2)}`),
  });

  const effortRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  effortRow.createSpan({ cls: 'wb-inspector-label', text: 'effort insight (F6.5b)' });
  effortRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      viewModel.insights === null
        ? "can't count (null)"
        : `${viewModel.insights.effort.status}` +
          (viewModel.insights.effort.measured === null
            ? ''
            : ` — widestGap ${viewModel.insights.effort.measured.widestGap.toFixed(2)} on ` +
              `${viewModel.insights.effort.measured.widestGapCourse}`),
  });
}

/**
 * A per-course row inside the rhythm panel — marker, course code, a status
 * line, and (§4.3) a per-row action and contest gesture, since a dispute or
 * an "open the folder" action is about ONE course's claim, never the panel
 * as a whole. Both are inert here (Notices), the same posture `scenarios.ts`'s
 * `editPort` and `mountGenerate`'s pre-accept controls already take for an
 * affordance this workbench has no real backing for — see the module doc.
 */
function renderRhythmRow(parent: HTMLElement, row: RhythmComposedPanel['rows'][number]): void {
  const el = parent.createDiv({ cls: 'wb-rhythm-row' });
  el.createSpan({ cls: 'wb-rhythm-row-marker' });
  el.createSpan({ cls: 'wb-rhythm-row-course', text: row.courseCode });

  const statusText =
    row.reading.status === 'not-arrived-with-yardstick'
      ? "hasn't arrived since it was expected."
      : row.lastArrivalDay === null
        ? 'no arrival has been observed for this course yet.'
        : `last arrived ${row.lastArrivalDay}. Nothing to say whether that is late or exactly right.`;
  el.createSpan({ cls: 'wb-rhythm-row-status', text: statusText });
  el.createSpan({ cls: 'wb-rhythm-row-badge', text: 'not yet' });

  const actions = el.createDiv({ cls: 'wb-rhythm-row-actions' });
  const openButton = actions.createEl('button', { text: `Open ${row.courseCode} folder` });
  openButton.type = 'button';
  openButton.addEventListener('click', () => {
    new Notice(
      `Workbench: the product would open 01 Courses/${row.courseCode} in the file explorer. ` +
        'There is no file explorer here.',
    );
  });
  const contestButton = actions.createEl('button', { text: CONTEST_GESTURE_LABEL });
  contestButton.type = 'button';
  contestButton.addEventListener('click', () => {
    new Notice(
      'Workbench: this composition has no product renderer yet, so no real dispute sheet is ' +
        'wired to this gesture — see the inspector note.',
    );
  });
}

/**
 * RHY-3-multicourse-composition.md §4, drawn directly — see `rhythm-
 * scenarios.ts`'s module doc for why this is workbench-only DOM rather than
 * a product view. `nothing-to-report` (§4.5) renders NOTHING, on purpose:
 * the family stays silent rather than asserting a positive "all clear".
 */
function renderRhythmPanel(host: HTMLElement, panel: RhythmComposedPanel): void {
  if (panel.kind === 'nothing-to-report') return;

  const root = host.createDiv({ cls: 'wb-rhythm-panel' });
  root.setAttr('data-wb-rhythm-panel-kind', panel.kind);
  if (panel.factLine !== null) {
    root.createDiv({ cls: 'wb-rhythm-fact', text: panel.factLine });
  }
  if (panel.consequenceLine !== null) {
    root.createDiv({ cls: 'wb-rhythm-consequence', text: panel.consequenceLine });
  }
  if (panel.mitigationLine !== null) {
    root.createDiv({ cls: 'wb-rhythm-mitigation', text: panel.mitigationLine });
  }

  const rows = root.createDiv({ cls: 'wb-rhythm-rows' });
  for (const row of panel.rows) {
    renderRhythmRow(rows, row);
  }

  if (panel.footerLine !== null) {
    root.createDiv({ cls: 'wb-rhythm-footer', text: panel.footerLine });
  }
}

const RHYTHM_PROVISIONAL_NOTE =
  'workbench-only: this composition rule (RHY-3-multicourse-composition.md §4) has no product ' +
  'renderer yet. The per-course freshness readings below ARE real — computed by ' +
  "olea-core's own discoverScheduleEvents -> associateScheduleEvents -> computeScheduleFreshness " +
  'over the fixture vault plus one synthetic calendar note this workbench adds. What is NOT real: ' +
  "the panel copy is this workbench drawing the design doc's own §4.3/§6 lines against real " +
  'course codes, and the "Open folder"/contest controls are inert Notices, not wired affordances.';

interface RhythmInspectorInput {
  readonly setNote: string;
  readonly scenario: RhythmScenario;
}

function renderRhythmInspector(inspector: HTMLElement, input: RhythmInspectorInput): void {
  const { scenario } = input;
  inspector.empty();
  inspector.createDiv({ cls: 'wb-inspector-note', text: scenario.state.note });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: RHYTHM_PROVISIONAL_NOTE,
  });

  const discoveryRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  discoveryRow.createSpan({ cls: 'wb-inspector-label', text: 'discovery' });
  discoveryRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${String(scenario.discovery.notesScanned.length)} note(s) scanned, ` +
      `${String(scenario.discovery.events.length)} event(s) matched across ` +
      `${String(scenario.discovery.candidateNotes.length)} candidate note(s), ` +
      `${String(scenario.discovery.totalUnparseableLines)} unparseable line(s)`,
  });

  const associationRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  associationRow.createSpan({ cls: 'wb-inspector-label', text: 'association' });
  associationRow.createSpan({
    cls: 'wb-inspector-value',
    text:
      `${String(scenario.association.matched.length)} matched, ` +
      `${String(scenario.association.unmatched.length)} unmatched`,
  });

  for (const reading of scenario.readings) {
    const row = inspector.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: `freshness — ${reading.courseCode}` });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${reading.status}` +
        (reading.expectedSessionDate === undefined
          ? ''
          : ` — expected ${reading.expectedSessionDate} (${reading.basis ?? 'unknown'})`) +
        ` — ${reading.reason}`,
    });
  }

  const panelRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  panelRow.createSpan({ cls: 'wb-inspector-label', text: 'panel' });
  panelRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${scenario.panel.kind} — ${String(scenario.panel.rows.length)} row(s)`,
  });
}

/** `# `/`## `/`### ` -> `h1`/`h2`/`h3`, never past `h3` (nothing her fixture notes use goes deeper). */
function noteHeadingTag(level: number): 'h1' | 'h2' | 'h3' {
  if (level <= 1) return 'h1';
  if (level === 2) return 'h2';
  return 'h3';
}

/**
 * `**bold**` and `[[wikilink]]`, the two inline marks the fixture vault's
 * notes actually use — not a general inline-markdown parser, just enough of
 * one to show her own words as she wrote them rather than as raw syntax.
 * Every node is created through `doc` (the host frame's OWN document, never
 * the ambient top-level `document`) — same realm discipline `host-frame.ts`
 * and `obsidian-shim/dom.ts` already hold everywhere else in this package.
 */
function renderNoteInline(doc: Document, el: HTMLElement, text: string): void {
  const pattern = /\*\*(.+?)\*\*|\[\[(.+?)\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    if (match.index > last) el.appendChild(doc.createTextNode(text.slice(last, match.index)));
    if (match[1] !== undefined) {
      const strong = doc.createElement('strong');
      strong.textContent = match[1];
      el.appendChild(strong);
    } else if (match[2] !== undefined) {
      const link = doc.createElement('span');
      link.className = 'wb-note-link';
      link.textContent = match[2];
      el.appendChild(link);
    }
    last = pattern.lastIndex;
    match = pattern.exec(text);
  }
  if (last < text.length) el.appendChild(doc.createTextNode(text.slice(last)));
}

/**
 * Walkthrough step 1's screen: her fixture note, rendered as markdown —
 * never an Olea view. There is no plugin code between the vault and this;
 * it is the same thing Obsidian's own stock reading view does with the note
 * she already wrote (`walkthrough.ts`'s module doc has the fuller argument
 * for why this is not "a second place product screens are drawn"). The
 * frontmatter block becomes one compact properties line; the body gets
 * headings, bullets, checkboxes and the two inline marks above — the exact
 * subset her fixture notes use, not a general renderer.
 */
function renderNoteView(host: HTMLElement, path: string, text: string): void {
  const doc = host.ownerDocument;
  const note = host.createDiv({ cls: 'wb-note' });
  note.setAttr('data-wb-note-path', path);

  const lines = text.split(/\r\n|\n/);
  let i = 0;
  if (lines[0] === '---') {
    const props: string[] = [];
    i = 1;
    while (i < lines.length && lines[i] !== '---') {
      const line = (lines[i] ?? '').trim();
      if (line.length > 0) props.push(line);
      i += 1;
    }
    i += 1; // past the closing '---'
    if (props.length > 0) {
      note.createDiv({ cls: 'wb-note-frontmatter', text: props.join('   ·   ') });
    }
  }

  let list: HTMLElement | null = null;
  for (; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line.length === 0) {
      list = null;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      list = null;
      note.createEl(noteHeadingTag((heading[1] ?? '#').length), {
        cls: 'wb-note-heading',
        text: heading[2] ?? '',
      });
      continue;
    }

    const checkbox = /^-\s+\[([ x])\]\s+(.*)$/.exec(line);
    const bullet = checkbox === null ? /^-\s+(.*)$/.exec(line) : null;
    if (checkbox !== null || bullet !== null) {
      if (list === null) list = note.createEl('ul', { cls: 'wb-note-list' });
      const item = list.createEl('li');
      if (checkbox !== null) {
        const box = item.createEl('input', {
          cls: 'wb-note-checkbox',
          attr: { type: 'checkbox' },
        });
        (box as HTMLInputElement).checked = checkbox[1] === 'x';
        (box as HTMLInputElement).disabled = true;
        renderNoteInline(doc, item, checkbox[2] ?? '');
      } else if (bullet !== null) {
        renderNoteInline(doc, item, bullet[1] ?? '');
      }
      continue;
    }

    list = null;
    const p = note.createEl('p', { cls: 'wb-note-paragraph' });
    renderNoteInline(doc, p, line);
  }
}

/**
 * The gap card (rule 2): renders where a product screen would have — inside
 * the host pane — instead of one, naming what's missing in product language
 * and the bead that tracks it, small, underneath. Never a mock: there is no
 * fabricated approximation of the missing screen here, only the honest
 * statement that it does not exist yet.
 */
function renderGapCard(host: HTMLElement, gap: WalkGap): void {
  const card = host.createDiv({ cls: 'wb-gap-card' });
  card.setAttr('data-wb-gap-card', 'true');
  card.createEl('h2', { cls: 'wb-gap-card-heading', text: 'Not built yet' });
  card.createEl('p', { cls: 'wb-gap-card-what', text: gap.what });
  card.createEl('p', { cls: 'wb-gap-card-bead', text: gap.bead });
}

interface FixtureOracleInspectorInput {
  readonly setNote: string;
  readonly result: FixtureOracleResult;
  readonly stateId: string;
}

/** Same shape as `renderOracleInspector`, over the fixture-vault result instead of a synthetic `OracleScenario` — see `oracle/fixture-oracle.ts`. */
function renderFixtureOracleInspector(
  inspector: HTMLElement,
  input: FixtureOracleInspectorInput,
): void {
  const { result } = input;
  inspector.empty();
  inspector.createDiv({
    cls: 'wb-inspector-note',
    text: `Fixture-vault oracle (D-041, ol-st9i) — ${input.stateId}. Real ranking over her real (invented) material: ${String(result.instrumentCount)} instrument(s) across ${String(result.conceptCount)} concept(s).`,
  });
  inspector.createDiv({ cls: 'wb-inspector-note wb-inspector-note--dim', text: input.setNote });
  inspector.createDiv({
    cls: 'wb-inspector-note wb-inspector-note--dim',
    text: FIXTURE_ORACLE_ILLUSTRATIVE_LABEL,
  });

  const asOfRow = inspector.createDiv({ cls: 'wb-inspector-row' });
  asOfRow.createSpan({ cls: 'wb-inspector-label', text: 'plan' });
  asOfRow.createSpan({
    cls: 'wb-inspector-value',
    text: `${result.plan.policyVersion} — asOf ${result.plan.body.asOf}, computedAt ${result.plan.computedAt}, ${String(result.plan.body.courses.length)} course(s)`,
  });

  const traceHeading = inspector.createDiv({ cls: 'wb-inspector-note', text: 'pipeline trace' });
  void traceHeading;
  const traceList = inspector.createDiv({ cls: 'wb-inspector-log' });
  for (const stage of result.trace.stages) {
    const row = traceList.createDiv({ cls: 'wb-inspector-row' });
    row.createSpan({ cls: 'wb-inspector-label', text: stage.stage });
    row.createSpan({
      cls: 'wb-inspector-value',
      text:
        `${stage.status} · ${stage.durationMs.toFixed(2)}ms · ` +
        `in: ${JSON.stringify(stage.inputSummary)} · out: ${JSON.stringify(stage.outputSummary)}` +
        (stage.couldHaveSucceeded
          ? ''
          : ` · couldHaveSucceeded: false, attributedTo: ${String(stage.attributedTo)}`),
    });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.body.setAttribute('data-wb-error', 'true');
  const banner = document.createElement('pre');
  banner.className = 'wb-fatal';
  banner.textContent = `workbench failed to start:\n${message}`;
  document.body.prepend(banner);
});
