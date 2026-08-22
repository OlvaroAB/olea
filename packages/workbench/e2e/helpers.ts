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
  | 'trends';

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
