/**
 * Shared navigation and assertion helpers for WB-2's Playwright suite.
 *
 * The state / today-state / variable-set id lists below are hardcoded rather
 * than read live off the app on every run, for a mundane reason: Playwright
 * generates its test list by statically evaluating each spec file, before
 * any browser exists to ask. Hardcoding a second copy of a list the app
 * already owns (`scenarios.ts`, `today-scenarios.ts`, `themes/index.ts`) is
 * exactly the drift risk this codebase's own README warns about elsewhere —
 * so `drift-guard.spec.ts` loads the real page once and asserts these lists
 * are byte-for-byte what `[data-wb-state-link]` / `[data-wb-today-state-link]`
 * / `[data-wb-set-link]` actually render. If a state or set is ever added,
 * renamed or removed in the app, that test goes red and names the mismatch
 * instead of every other spec silently testing a stale list.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export const REVIEW_STATES = [
  'loading',
  'empty',
  'qa-front',
  'heading-offer-banner',
  'qa-reveal',
  'cloze-front',
  'cloze-reveal',
  'mcq-open',
  'mcq-answered-correct',
  'mcq-answered-wrong',
  'mcq-answered-guessed',
  'note-missing',
  'session-complete',
] as const;

export const TODAY_STATES = [
  'today-nothing-due',
  'today-due',
  'today-after-writing',
  'today-stale',
  'today-unavailable',
  'today-scope-not-declared',
  'today-rhythm-quiet',
  'today-rhythm-fresh',
  'today-after-reentry',
  'today-encouragement-off',
  'today-term-dates-pointer',
] as const;

// `ol-opmb.1` [TB-1] — see `oracle-scenarios.ts` for the source of truth.
export const ORACLE_STATES = [
  'oracle-ranked',
  'oracle-abstained',
  'gap-mastery',
  'gap-coverage',
  'gap-material',
  'coverage-unreadable-source',
  'plan-fresh',
  'plan-stale-offline',
  'plan-expired-offline',
  'oracle-struggling',
] as const;

// `ol-opmb.2` [TB-2] — see `retrieve-scenarios.ts` for the source of truth.
export const RETRIEVE_STATES = [
  'grounding-refused-no-hits',
  'grounding-refused-below-threshold',
  'grounding-refused-composite',
  'grounded-with-citations',
] as const;

// `ol-opmb.3` [TB-3] — see `generate-scenarios.ts` for the source of truth.
export const GENERATE_STATES = [
  'generation-refused-upstream',
  'generation-pending-accept',
  'generation-accepted',
] as const;

// `ol-opmb.5` [TB-4] — see `timeline-scenarios.ts` for the source of truth.
export const TIMELINE_STATES = [
  'timeline-steady',
  'timeline-struggler',
  'timeline-lapsed-returner',
  'timeline-crammer',
] as const;

// F2.7 — see `explain-scenarios.ts` for the source of truth.
export const EXPLAIN_STATES = ['explanation-grounded', 'explanation-refused-no-grounding'] as const;

// F4.6-F4.9, `ol-p5t06b` [P5-T06b] — see `session-scenarios.ts` for the source of truth.
export const SESSION_STATES = [
  'session-exam-eve-90',
  'session-short-20',
  'session-tight-5',
  'session-measured-45',
  'session-no-cards-yet',
  'session-nothing-to-build',
  'session-vault-unreadable',
] as const;

// F6.2, F6.5, `ol-lohq`/`ol-p6t04` — see `trends-scenarios.ts` for the source of truth.
export const TRENDS_STATES = [
  'trends-healthy',
  'trends-course-behind',
  'trends-course-behind-neutralised',
  'trends-cramming',
  'trends-cramming-neutralised',
  'trends-too-early',
] as const;

// RHY-3's multicourse composition (`ol-i0zw`) — see `rhythm-scenarios.ts` for the source of truth.
export const RHYTHM_STATES = ['rhythm-two-flagged', 'rhythm-one-flagged'] as const;

// F3.3's bulk-review triage (`ol-jie3`) — see `bulk-review-scenarios.ts` for the source of truth.
export const BULK_REVIEW_STATES = ['bulk-review-two-groups', 'bulk-review-empty'] as const;

// F8.4's registry (`ol-4v2l`, `[D-171]`) — see `registry-scenarios.ts` for the source of truth.
export const REGISTRY_STATES = [
  'registry-populated',
  'registry-empty',
  'registry-withdrawn-shown',
  'registry-explain-back-history',
  'registry-note-offer',
  'registry-rename-proposal',
] as const;

// F7's plugin surface (`ol-z6x2`) — see `plugin-surface-scenarios.ts` for the source of truth.
export const PLUGIN_SURFACE_STATES = [
  'plugin-surface-fresh',
  'plugin-surface-gate-set',
  'plugin-surface-usage-recorded',
  'plugin-surface-offline',
  'plugin-surface-connected',
] as const;

// F1.5/F8.1's grove (`ol-z6x2`) — see `grove-scenarios.ts` for the source of truth.
export const GROVE_STATES = ['grove-no-source', 'grove-declared'] as const;

export const VARIABLE_SETS = [
  'obsidian-dark',
  'obsidian-light',
  'things-dark',
  'things-light',
  'things-dark-no-baseline',
  'things-light-no-baseline',
] as const;

export type ReviewStateId = (typeof REVIEW_STATES)[number];
export type TodayStateId = (typeof TODAY_STATES)[number];
export type OracleStateId = (typeof ORACLE_STATES)[number];
export type RetrieveStateId = (typeof RETRIEVE_STATES)[number];
export type GenerateStateId = (typeof GENERATE_STATES)[number];
export type TimelineStateId = (typeof TIMELINE_STATES)[number];
export type ExplainStateId = (typeof EXPLAIN_STATES)[number];
export type SessionStateId = (typeof SESSION_STATES)[number];
export type TrendsStateId = (typeof TRENDS_STATES)[number];
export type RhythmStateId = (typeof RHYTHM_STATES)[number];
export type BulkReviewStateId = (typeof BULK_REVIEW_STATES)[number];
export type RegistryStateId = (typeof REGISTRY_STATES)[number];
export type PluginSurfaceStateId = (typeof PLUGIN_SURFACE_STATES)[number];
export type GroveStateId = (typeof GROVE_STATES)[number];
export type VariableSetId = (typeof VARIABLE_SETS)[number];
export type Surface =
  | 'review'
  | 'today'
  | 'oracle'
  | 'retrieve'
  | 'generate'
  | 'timeline'
  | 'explain'
  | 'session'
  | 'trends'
  | 'rhythm'
  | 'bulk-review'
  | 'registry'
  | 'plugin-surface'
  | 'grove';

/**
 * WBF-4 (`ol-opjq`) — per-STATE viewport overrides for the golden suite.
 *
 * `playwright.config.ts`'s 1280x900 default was tuned for review/today's
 * tallest state (542px of pane) and is out of this bead's ownership
 * (`e2e/` only) to change — raising it globally would also invalidate every
 * existing review/today baseline. Keyed by state id rather than surface
 * (verified collision-free across all nine state lists) because the need is
 * NOT uniform within trends or session: `.wb-host` is a `flex:1` box that
 * stretches to fill whatever viewport it is given regardless of how tall its
 * actual content is, so overriding an entire surface's viewport for the sake
 * of its one tallest state would leave every OTHER state in that surface
 * screenshotted with a wall of blank space below genuinely short content —
 * a real defect in its own right, found by looking at
 * `session-no-cards-yet`'s first golden (2812px tall, ~85% blank) before
 * this was keyed per-state. Oracle and timeline happen to be uniform across
 * every one of their states (measured, not assumed) so every id in those two
 * lists shares one entry. Values are `measured need (pane-fit.spec.ts's
 * `measure()`, at the default viewport) + 288px chrome + ~40-60px margin`,
 * rounded up. Retrieve, generate, explain, and the two short session/trends
 * states left out below all fit the default pane unaided.
 */
export const TALL_STATE_VIEWPORTS: Partial<Record<string, { width: number; height: number }>> = {
  // Oracle — all 10 states measure the same (779px real content): the host
  // pane renders the identical real GapView/world per persona regardless of
  // which plan-refresh regime the inspector (outside the pane) is reporting.
  'oracle-ranked': { width: 1280, height: 1120 },
  'oracle-abstained': { width: 1280, height: 1120 },
  'gap-mastery': { width: 1280, height: 1120 },
  'gap-coverage': { width: 1280, height: 1120 },
  'gap-material': { width: 1280, height: 1120 },
  'coverage-unreadable-source': { width: 1280, height: 1120 },
  'plan-fresh': { width: 1280, height: 1120 },
  'plan-stale-offline': { width: 1280, height: 1120 },
  'plan-expired-offline': { width: 1280, height: 1120 },
  'oracle-struggling': { width: 1280, height: 1120 },
  // Timeline — all 4 states measure the same (761px real content).
  'timeline-steady': { width: 1280, height: 1120 },
  'timeline-struggler': { width: 1280, height: 1120 },
  'timeline-lapsed-returner': { width: 1280, height: 1120 },
  'timeline-crammer': { width: 1280, height: 1120 },
  // Trends — 908/1310/705px real content; `trends-healthy`,
  // `trends-course-behind-neutralised` and `trends-cramming-neutralised` fit
  // the default pane unaided and are deliberately absent.
  'trends-course-behind': { width: 1280, height: 1240 },
  'trends-cramming': { width: 1280, height: 1640 },
  'trends-too-early': { width: 1280, height: 1040 },
  // Session — 2744/2596/2209/2506px real content; `session-no-cards-yet` and
  // `session-nothing-to-build` fit the default pane unaided and are
  // deliberately absent.
  'session-exam-eve-90': { width: 1280, height: 3100 },
  'session-short-20': { width: 1280, height: 2960 },
  'session-tight-5': { width: 1280, height: 2570 },
  'session-measured-45': { width: 1280, height: 2870 },
};

/**
 * WBF-4 (`ol-opjq`) — per-STEP viewport overrides for the twelve walkthrough
 * screenshots (`walkthrough-visual.spec.ts`).
 *
 * Walk mode is not the same layout as a flat surface: the walk chrome
 * (title, copy, counter, prev/next, the 12-item step list) eats roughly
 * 164px more of the stage than the flat sidebar+inspector do, so even a step
 * whose content fits comfortably as a flat surface needs a taller viewport to
 * fit again inside walk mode's smaller pane. Measured the same way as
 * `TALL_SURFACE_VIEWPORTS` (`pane-fit`'s `measure()`, at `playwright.config.ts`'s
 * 1280x900 default): steps 2-6 and 9 need no override (content fits the
 * ~448px walk-mode pane unaided). Steps 7 and 8 mount the FIXTURE oracle
 * (`oracle-fixture`, D-041) over the real fixture vault rather than the
 * synthetic corpus the flat `oracle` surface uses, and need far more room
 * than flat oracle does — 3086px, not 779px. Step 10 (timeline, 761px), step
 * 11 (session, 2744px — session-exam-eve-90, the tallest screen in the app)
 * and step 12 (trends, 1310px) match their flat-surface equivalents. Each
 * entry is `measured need + walk-mode overhead + margin`, rounded up and
 * verified by `pane-fit.spec.ts`'s own walk-step loop.
 *
 * Step 1 (ol-7kyo, WBF-5): the note view's own content needs ~474px and the
 * default-viewport pane only offers ~448px — a PRE-EXISTING 26px overflow
 * that predates this bead and is unrelated to its width-collapse defect.
 * `host-frame.ts`'s `body` was `display: flex` with no `flex-direction`
 * (defaulting to row) before WBF-5, which put `.wb-note`'s height on the
 * CROSS axis; the default `align-items: stretch` there silently squashed it
 * to the pane's exact height, so the true overflow painted past the box
 * without `body.scrollHeight`/`documentElement.scrollHeight` ever reporting
 * it — the same "scrolled view nothing can notice" failure mode this file's
 * own module doc describes, just met on a walk step instead of a flat
 * surface. WBF-5 put `body` on `flex-direction: column`, which puts height on
 * the MAIN axis instead; a flex item's main size floors at its own
 * (here, unshrinkable) content size, so the pre-existing overflow becomes a
 * real, measured, newly-visible one instead of a silently-clipped one. This
 * override is the honest fix `pane-fit.spec.ts`'s own failure message asks
 * for ("the viewport override needs raising") — not a width fix, and not
 * part of the same defect family as the session/trends collapse.
 */
export const WALK_STEP_VIEWPORTS: Partial<Record<number, { width: number; height: number }>> = {
  1: { width: 1280, height: 950 },
  7: { width: 1280, height: 3650 },
  8: { width: 1280, height: 3650 },
  10: { width: 1280, height: 1250 },
  11: { width: 1280, height: 3300 },
  12: { width: 1280, height: 1820 },
};

export interface DiscoveredMatrix {
  readonly reviewStates: readonly string[];
  readonly todayStates: readonly string[];
  readonly oracleStates: readonly string[];
  readonly retrieveStates: readonly string[];
  readonly generateStates: readonly string[];
  readonly timelineStates: readonly string[];
  readonly explainStates: readonly string[];
  readonly sessionStates: readonly string[];
  readonly trendsStates: readonly string[];
  readonly rhythmStates: readonly string[];
  readonly bulkReviewStates: readonly string[];
  readonly registryStates: readonly string[];
  readonly pluginSurfaceStates: readonly string[];
  readonly groveStates: readonly string[];
  readonly variableSets: readonly string[];
}

/** Reads the real state/set lists off the loaded page's own nav DOM. */
export async function discoverMatrix(page: Page): Promise<DiscoveredMatrix> {
  const reviewStates = await page
    .locator('[data-wb-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-state-link') ?? ''));
  const todayStates = await page
    .locator('[data-wb-today-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-today-state-link') ?? ''));
  const oracleStates = await page
    .locator('[data-wb-oracle-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-oracle-state-link') ?? ''));
  const retrieveStates = await page
    .locator('[data-wb-retrieve-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-retrieve-state-link') ?? ''));
  const generateStates = await page
    .locator('[data-wb-generate-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-generate-state-link') ?? ''));
  const timelineStates = await page
    .locator('[data-wb-timeline-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-timeline-state-link') ?? ''));
  const explainStates = await page
    .locator('[data-wb-explain-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-explain-state-link') ?? ''));
  const sessionStates = await page
    .locator('[data-wb-session-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-session-state-link') ?? ''));
  const trendsStates = await page
    .locator('[data-wb-trends-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-trends-state-link') ?? ''));
  const rhythmStates = await page
    .locator('[data-wb-rhythm-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-rhythm-state-link') ?? ''));
  const bulkReviewStates = await page
    .locator('[data-wb-bulk-review-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-bulk-review-state-link') ?? ''));
  const registryStates = await page
    .locator('[data-wb-registry-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-registry-state-link') ?? ''));
  const pluginSurfaceStates = await page
    .locator('[data-wb-plugin-surface-state-link]')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-wb-plugin-surface-state-link') ?? ''),
    );
  const groveStates = await page
    .locator('[data-wb-grove-state-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-grove-state-link') ?? ''));
  const variableSets = await page
    .locator('[data-wb-set-link]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wb-set-link') ?? ''));
  return {
    reviewStates,
    todayStates,
    oracleStates,
    retrieveStates,
    generateStates,
    timelineStates,
    explainStates,
    sessionStates,
    trendsStates,
    rhythmStates,
    bulkReviewStates,
    registryStates,
    pluginSurfaceStates,
    groveStates,
    variableSets,
  };
}

export function stateUrl(
  surface: Surface,
  stateId: string,
  setId: string,
  personaId = 'none',
  day?: number,
): string {
  const base = `/#/${surface}/${stateId}?set=${setId}&persona=${personaId}`;
  return day === undefined ? base : `${base}&day=${String(day)}`;
}

/**
 * Navigates to one addressable workbench URL and waits for it to settle.
 *
 * Uses `page.goto` (a full navigation) rather than clicking the in-app nav,
 * so every test starts from the same cold-load state the URL promises —
 * "reloadable and order-independent" per the package README, and it means
 * no state leaks between tests sharing a worker.
 */
export async function gotoState(
  page: Page,
  surface: Surface,
  stateId: string,
  setId: string,
  personaId = 'none',
  day?: number,
): Promise<void> {
  await page.goto(stateUrl(surface, stateId, setId, personaId, day));
  await waitForSettled(page, stateId);
}

/**
 * `loading` is the one state that deliberately never sets
 * `[data-wb-ready="true"]` (its whole definition is a note-existence check
 * that never settles), so it needs its own wait condition. Every other state
 * is done exactly when `data-wb-ready` flips.
 */
export async function waitForSettled(page: Page, stateId: string): Promise<void> {
  if (stateId === 'loading') {
    await expect(page.locator('html')).toHaveAttribute('data-wb-state', 'loading');
    await expect(frame(page).locator('.olea-review-loading')).toBeVisible();
  } else {
    await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', {
      timeout: 10_000,
    });
  }
  // The fatal-error banner (main.ts's catch handler) means the app failed to
  // start at all — a state that "settled" onto an error is not a pass.
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

/**
 * Navigates to one walkthrough step (`#/walk/<n>`), a URL shape `stateUrl`'s
 * `Surface` union does not cover — see `walkthrough.spec.ts`'s module doc for
 * why walk mode is addressed by hand rather than through `gotoState`.
 * WBF-4 (`ol-opjq`) promoted this here from a private copy in
 * `walkthrough.spec.ts` so `pane-fit.spec.ts` and `walkthrough-visual.spec.ts`
 * share one definition instead of a third hand-copy drifting from the other
 * two.
 */
export async function gotoWalkStep(page: Page, step: number): Promise<void> {
  await page.goto(`/#/walk/${String(step)}?set=obsidian-dark&persona=none`);
  await expect(page.locator('html')).toHaveAttribute('data-wb-ready', 'true', { timeout: 10_000 });
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

/** The screenshot target: the host iframe element itself, as an on-page Locator. */
export function hostFrameElement(page: Page): Locator {
  return page.locator('[data-wb-surface]');
}

/** The same element, as a `FrameLocator` for reaching inside it. */
export function frame(page: Page) {
  return page.frameLocator('[data-wb-surface]');
}

/** `"present"` or `"stripped"` — ol-itiu's baseline-load-model attribute. */
export async function baselineOf(page: Page): Promise<string | null> {
  return hostFrameElement(page).getAttribute('data-wb-baseline');
}

/**
 * `"held"` or `"broken"` — the synthetic/real review-log namespace check.
 * `main.ts` sets this attribute directly on the `[data-wb-inspector]`
 * element itself (`inspector.setAttr(...)`) in the TOP document (queried via
 * the ambient `document`), not inside the host iframe.
 */
export async function logBoundaryOf(page: Page): Promise<string | null> {
  return page.locator('[data-wb-inspector]').getAttribute('data-wb-log-boundary');
}
