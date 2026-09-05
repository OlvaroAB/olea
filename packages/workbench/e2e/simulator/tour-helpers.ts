/**
 * Helpers for `tour.spec.ts` (WBX-15, `ol-3ux7.64.17`,
 * `docs/dev/simulator-design.md` §6, `features/F9-simulator.md` F9.S5) — the
 * "view tour": for a declared set of weeks, open EVERY view the plugin
 * registers, plus settings and the palette, capture a golden, and run a
 * cheap structural pass beside it.
 *
 * SCOPE. This file only ever reads `./helpers.ts` (this suite's existing
 * navigation/control rig) and `../helpers.ts` (the flat-surface rig) —
 * nothing here duplicates `gotoSimulator`/`resetSimulator`/`frame`/
 * `hostFrameElement`, which stay owned by whichever lane owns `helpers.ts`.
 *
 * WEEKS = [0, 1, 2, 4, 8]. Sparse rather than every week of a ~17-week term:
 * each week-test does its own fresh reset-then-advance (matching
 * `goldens.spec.ts`'s own "independent test per row" convention, so a
 * failure at week 8 never hides whether week 0 is clean), and every
 * day-advance is a full plugin unload/reload
 * (`SimulatorController.remountPane`) — not cheap. Five points spanning
 * "cold start", "one week in", "settling in", "past midterm-shaped pacing"
 * and "deep into the term" catch the shapes a due-heavy vs. caught-up
 * persona actually diverge on (per-review scheduling drift compounds with
 * time) without paying for all ~17 weekly resets. This is a declared
 * sampling choice, not a derived one — widen it if a specific week's
 * behaviour ever needs its own golden.
 *
 * SERIAL, NOT PARALLEL, ON PURPOSE — the one deliberate deviation from
 * `goldens.spec.ts`'s `mode: 'parallel'`. Findings for one (world, persona)
 * accumulate in a single in-memory array and are flushed ONCE, in
 * `test.afterAll`, to keep `structural-findings.json` a plain
 * read-modify-write with no cross-process file lock to build — serial mode
 * guarantees exactly one worker ever holds that array. The cost is wall
 * time, not correctness: `tour.spec.ts` itself sets a long per-test timeout
 * (see its own module doc) because week 8 alone is 56 sequential
 * day-advances.
 *
 * THE DRIVER LIVES ON THE TOP-LEVEL `window`, NOT THE IFRAME'S. `[data-wb-
 * surface]` is a real host `<iframe>` and the plugin's RENDERED DOM (ribbon,
 * views, badge) really is inside its content document — `frame(page)`
 * (a `FrameLocator`) is right to scope every DOM query there, and this file
 * still does for the ribbon/settings/palette locators. But
 * `SimulatorController`'s own JS (`controller.ts`, bundled into the one
 * `app.js` the TOP page loads) executes in the TOP page's realm — it builds
 * DOM nodes and appends them into the iframe's document, but a bare
 * `window.__oleaSimulatorDriver = {...}` (`installSimulatorWalkDriver`)
 * still resolves against the TOP page's `window`. Verified empirically
 * while writing this suite (a console.log placed right after that
 * assignment confirmed the object exists; reading it back through the
 * iframe's OWN `contentWindow` from outside came back `undefined` every
 * time, while a plain top-level `page.evaluate` saw it immediately) — this
 * matches `scripts/simulator-walk.mjs`'s own convention (`page.evaluate(() =>
 * window.__oleaSimulatorDriver...)`, no frame-scoping at all), which is the
 * SAME driver seam this file uses, just reached through Playwright's `page`
 * fixture instead of a raw CDP session. There is no separate "standalone
 * dist has no iframe" story here — both serving contexts share one `window`
 * for this seam.
 *
 * THE STRUCTURAL PASS — four mechanical checks, deliberately cheap and
 * content-blind (INV-3: findings are counts and surface ids, never page
 * text):
 *   - `empty-pane-no-explanation` — the just-opened surface's own content
 *     root has zero trimmed text. A real "nothing here" state always renders
 *     SOME explanatory copy (Today's `.olea-today-note`, the settings pane's
 *     own sections, etc.) — literally empty is the bug this catches.
 *   - `console-error×N` — any `console.error`/uncaught page error emitted
 *     while this surface was open. Counted since the last checkpoint (a
 *     per-surface baseline `mark()` on {@link ConsoleWatcher}), not
 *     cumulative.
 *   - `possible-worker-miss-without-degradation-statement` — a heuristic,
 *     not a real transport hook: the plugin's own `console.error('Olea: ...
 *     failed'|'could not ...', ...)` call sites (`main.ts`, `registry/
 *     provider.ts`, etc.) are the only externally-observable signal that a
 *     Worker call missed, because `installTransportBridge`
 *     (`controller.ts`'s own doc) resolves hits/misses inside the page with
 *     no network request Playwright can see and no public hook this lane may
 *     add (`src/` is out of scope). So: an `Olea: ...` failure-shaped console
 *     line with no F7.8-shaped degradation text anywhere in the frame is
 *     flagged; this UNDER-counts real misses a view swallows silently with
 *     no console line at all, and that gap is named here rather than
 *     papered over with a false-confidence green check.
 *   - `real-wallclock-date-leak` — the frame's text contains today's REAL
 *     `toISOString().slice(0, 10)` date. Guarded against the one coincidence
 *     this term's `asOf` (2026-08-28) produces: `asOf + 7 days` lands on
 *     2026-09-04, which — on the day this suite was authored — IS real
 *     today. {@link expectedSimulatedDateISO} computes what the badge SHOULD
 *     read for a given week; when that equals real-today, the check is
 *     skipped for that (world, week) and a `date-check-skipped-coincident`
 *     note is recorded instead of a false positive.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ConsoleMessage, Page } from '@playwright/test';
import { frame, hostFrameElement } from '../helpers.js';

export { frame, hostFrameElement };

/** See this module's own doc for why these five and not every week of the term. */
export const TOUR_WEEKS = [0, 1, 2, 4, 8] as const;

/** Non-view surfaces the tour also captures, alongside every registered view type. */
export const NON_VIEW_SURFACES = ['settings', 'palette'] as const;

export interface WorldDescriptor {
  readonly world: string;
  readonly label: string;
  readonly asOf: string;
  readonly persona?: string;
  readonly fallback?: boolean;
}

export interface TourFinding {
  readonly world: string;
  readonly persona: string;
  readonly week: number;
  readonly surface: string;
  readonly finding: string;
}

/** `GET /simulator-world.json` — the same fetch the badge itself makes (`simulator/world.ts`). */
export async function fetchWorldDescriptor(page: Page): Promise<WorldDescriptor> {
  const response = await page.request.get('/simulator-world.json');
  if (!response.ok()) {
    throw new Error(
      `fetchWorldDescriptor: GET /simulator-world.json -> ${String(response.status())}`,
    );
  }
  return (await response.json()) as WorldDescriptor;
}

type DriverWindow = { __oleaSimulatorDriver?: { advanceOneDay(): Promise<void> } };

/**
 * `window.__oleaSimulatorDriver.advanceOneDay()`, called `weeks * 7` times —
 * ONE round trip per day (`page.evaluate`, top-level — see this module's own
 * doc on why NOT frame-scoped), each RE-READING `window.__oleaSimulatorDriver`
 * fresh rather than a reference captured once outside the loop:
 * `advanceOneDay` triggers a full plugin unload/reload
 * (`controller.ts`'s own doc — `installSimulatorWalkDriver` runs again on
 * every remount, replacing the previous driver object), and a `waitForFunction`
 * before each call absorbs the brief gap between one mount's teardown and
 * the next mount's driver install, rather than guessing at a fixed delay.
 */
export async function advanceWeeksViaDriver(page: Page, weeks: number): Promise<void> {
  const days = weeks * 7;
  for (let i = 0; i < days; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- each day's remount must settle before the next is requested.
    await page.waitForFunction(
      () => (window as unknown as DriverWindow).__oleaSimulatorDriver !== undefined,
      undefined,
      { timeout: 15_000 },
    );
    // eslint-disable-next-line no-await-in-loop -- see above.
    await page.evaluate(async () => {
      const driver = (window as unknown as DriverWindow).__oleaSimulatorDriver;
      if (driver === undefined) {
        throw new Error('advanceWeeksViaDriver: window.__oleaSimulatorDriver is not installed.');
      }
      await driver.advanceOneDay();
    });
  }
}

/**
 * Every view type the ribbon currently lists (`shell.ts`'s
 * `renderRibbonViews`, fed by `Workspace.registeredViewTypes()` —
 * `controller.ts`'s `populateRibbon` doc). Reading it off `[data-wb-sim-
 * ribbon-view]` rather than calling `registeredViewTypes()` directly keeps
 * this lane off `src/` entirely while still tracking the real registry: the
 * ribbon IS that registry, rendered (`shell.spec.ts`'s own "the ribbon lists
 * exactly the plugin's registered views" test already proves the two never
 * diverge).
 */
export async function ribbonViewTypes(page: Page): Promise<string[]> {
  const buttons = frame(page).locator('[data-wb-sim-ribbon-view]');
  const count = await buttons.count();
  const types: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const viewType = await buttons.nth(i).getAttribute('data-wb-sim-ribbon-view');
    if (viewType !== null) types.push(viewType);
  }
  return types;
}

/**
 * View-mount wait budget for {@link openViewSurface}. Deliberately its OWN constant, separate
 * from `REMOUNT_TIMEOUT_MS` (`./helpers.ts`, 20_000ms) — that one covers the simulator PANE's
 * own remount signal (`[data-wb-remount]`, bumped by day-advance/reset/rate), a different DOM
 * lifecycle event than "this specific view type finished becoming the active view after a ribbon
 * click", which is what this wait is actually for.
 *
 * Measured 2026-09-05 (ol-shjr, discovered off a stale real-world tour run): a temporary
 * per-view timing pass against a freshly built `--world real` dist (514-file vault) found the
 * retrospective view's mount taking 149-348ms at weeks 0/1 and 177ms at week 8, but 23,454ms at
 * week 2 and 7,610ms at week 4 — every other view stayed under ~2.1s at every week sampled. No
 * console error and no `body[data-wb-error]` accompanied any of the slow mounts in any run: the
 * view mounts successfully, just very slowly at some weeks. That correlates with the same day's
 * mastery-fold rewrite ([WBX-15]'s retrospective provider, `packages/plugin/src/retrospective/`,
 * is the view's only caller of `packages/core/src/mastery`'s fold on the view-open path) scanning
 * the whole review log rather than a bounded window — filed separately as a plugin/core
 * performance finding (ol-shjr's own notes), not fixed here: this file owns the tour, not the
 * views it opens. 60s gives ~2.5x margin over the worst run observed above without eating
 * meaningfully into the per-test 600s budget (`tour.spec.ts`'s own module doc) — only one view in
 * nine is ever near this ceiling, so a single generous constant costs the other eight nothing.
 */
const VIEW_MOUNT_TIMEOUT_MS = 60_000;

/**
 * Clicks the ribbon button for `viewType` and waits for it to become the active view in whichever
 * pane it landed in. A genuinely slow (but non-crashing) mount is waited out — see
 * {@link VIEW_MOUNT_TIMEOUT_MS}'s own doc. If the wait still times out, this checks for the
 * app's fatal-error banner (`main.ts`'s `void main().catch(...)`, `body[data-wb-error]` — same
 * locator `tour.spec.ts`'s `captureAndCheck` already asserts against) so a real crash reads as
 * "the app raised a fatal error", not as an opaque, unexplained timeout (ol-shjr: "fail loudly,
 * not hang").
 */
export async function openViewSurface(page: Page, viewType: string): Promise<void> {
  await frame(page).locator(`[data-wb-sim-ribbon-view="${viewType}"]`).click();
  const pane = frame(page)
    .locator(
      `[data-wb-pane][data-wb-active-view-type="${viewType}"], [data-wb-right-pane][data-wb-active-view-type="${viewType}"]`,
    )
    .first();
  try {
    await pane.waitFor({ state: 'attached', timeout: VIEW_MOUNT_TIMEOUT_MS });
  } catch (waitError) {
    const crashed = (await page.locator('body[data-wb-error]').count()) > 0;
    if (crashed) {
      throw new Error(
        `openViewSurface(${viewType}): the app raised a fatal error while this view was mounting ` +
          `(body[data-wb-error] is set — see main.ts's ".wb-fatal" banner in a screenshot/trace ` +
          'for the message).',
      );
    }
    throw new Error(
      `openViewSurface(${viewType}): did not become the active view within ` +
        `${String(VIEW_MOUNT_TIMEOUT_MS)}ms and no crash was detected (no body[data-wb-error]) — ` +
        "a genuinely slow render, not a hang. See VIEW_MOUNT_TIMEOUT_MS's own doc (ol-shjr) for " +
        'the measurements this budget is sized against.',
      { cause: waitError },
    );
  }
}

/**
 * The text content of whichever pane currently shows `viewType` — used only
 * in-memory for the structural pass (never written to disk; INV-3).
 */
export async function activeViewText(page: Page, viewType: string): Promise<string> {
  const locator = frame(page)
    .locator(
      `[data-wb-pane][data-wb-active-view-type="${viewType}"], [data-wb-right-pane][data-wb-active-view-type="${viewType}"]`,
    )
    .first();
  return (await locator.innerText()).trim();
}

/**
 * Un-hides `[data-wb-settings-route]` directly, rather than clicking a
 * button — there IS no button (`whole-plugin.spec.ts`'s own module doc: "no
 * palette command opens Settings ... Obsidian's own settings modal is
 * outside the shim"). `addSettingTab` already rendered the real tab's DOM
 * into this element at mount (`obsidian-shim/index.ts`'s `ensureDom`), so
 * this only ever toggles visibility of content that is already there — it
 * does not fabricate or duplicate the pane, and it is not a new
 * student-visible affordance (nothing renders a button for it).
 */
export async function openSettingsSurface(page: Page): Promise<void> {
  const route = frame(page).locator('[data-wb-settings-route]');
  await route.evaluate((el) => {
    (el as HTMLElement).hidden = false;
  });
}

/** Re-hides the settings route so it does not bleed into the next surface's screenshot. */
export async function closeSettingsSurface(page: Page): Promise<void> {
  const route = frame(page).locator('[data-wb-settings-route]');
  await route.evaluate((el) => {
    (el as HTMLElement).hidden = true;
  });
}

export async function settingsText(page: Page): Promise<string> {
  return (await frame(page).locator('[data-wb-settings-route]').innerText()).trim();
}

/** The real `[data-wb-palette-toggle]` button (relocated into the ribbon — `controller.ts`'s `populateRibbon`). */
export async function openPaletteSurface(page: Page): Promise<void> {
  await frame(page).locator('[data-wb-palette-toggle]').click();
  await frame(page).locator('[data-wb-palette]').waitFor({ state: 'visible' });
}

/** Clicking the toggle again closes it (`obsidian-shim/index.ts`'s `togglePalette`: `hidden = !hidden`). */
export async function closePaletteSurface(page: Page): Promise<void> {
  await frame(page).locator('[data-wb-palette-toggle]').click();
  await frame(page).locator('[data-wb-palette]').waitFor({ state: 'hidden' });
}

export async function paletteText(page: Page): Promise<string> {
  return (await frame(page).locator('[data-wb-palette]').innerText()).trim();
}

/** Today's real wall-clock date, `YYYY-MM-DD` — same format `formatSimulatedDate` (`controller.ts`) uses for the badge, so a leak reads identically to the simulated value it would be confused with. */
export function realWallClockDateISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `asOf + week * 7 days`, in UTC — what the badge SHOULD read at this week, for the real-date-leak guard. */
export function expectedSimulatedDateISO(asOfISO: string, week: number): string {
  const asOf = new Date(`${asOfISO}T00:00:00.000Z`);
  const advanced = new Date(asOf.getTime() + week * 7 * 24 * 60 * 60 * 1000);
  return advanced.toISOString().slice(0, 10);
}

/** Every `Olea: ...` console line shaped like this lane's failure-logging convention (`main.ts`, `registry/provider.ts`, etc. — see this module's own doc on the miss heuristic). */
function isOleaFailureLog(text: string): boolean {
  return /^Olea: /.test(text) && /(failed|could not|error)/i.test(text);
}

/** Phrasing this build actually uses when the AI half is off or unreachable (`degradation-statement.ts`, `worker/transport.ts`) — public UI copy, not private content. */
const DEGRADATION_PATTERN =
  /could not reach the worker|olea works without ai|could not reach on this pass|olea: could not/i;

/** Collects `console`/`pageerror` events for the whole test, with cheap "since this mark" slicing per surface. */
export class ConsoleWatcher {
  private readonly messages: string[] = [];

  constructor(page: Page) {
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') this.messages.push(message.text());
    });
    page.on('pageerror', (error: Error) => {
      this.messages.push(error.message);
    });
  }

  /** A snapshot index to diff against later — see {@link ConsoleWatcher.since}. */
  mark(): number {
    return this.messages.length;
  }

  /** Every message recorded since `mark`. */
  since(mark: number): readonly string[] {
    return this.messages.slice(mark);
  }
}

export interface StructuralPassArgs {
  readonly world: string;
  readonly persona: string;
  readonly week: number;
  readonly surface: string;
  readonly surfaceText: string;
  readonly frameText: string;
  readonly consoleSince: readonly string[];
  readonly expectedSimulatedDate: string;
  readonly realWallClockDate: string;
}

/** The four mechanical checks described in this module's own doc. Pure — no I/O, no page access. */
export function structuralPass(args: StructuralPassArgs): TourFinding[] {
  const { world, persona, week, surface } = args;
  const findings: TourFinding[] = [];
  const push = (finding: string): void => {
    findings.push({ world, persona, week, surface, finding });
  };

  if (args.surfaceText.length === 0) push('empty-pane-no-explanation');

  if (args.consoleSince.length > 0) push(`console-error×${String(args.consoleSince.length)}`);

  const failureLogCount = args.consoleSince.filter(isOleaFailureLog).length;
  if (failureLogCount > 0 && !DEGRADATION_PATTERN.test(args.frameText)) {
    push('possible-worker-miss-without-degradation-statement');
  }

  if (args.expectedSimulatedDate === args.realWallClockDate) {
    push('date-check-skipped-coincident');
  } else if (args.frameText.includes(args.realWallClockDate)) {
    push('real-wallclock-date-leak');
  }

  return findings;
}

/**
 * Merges `entries` (all for one `world`) into `outFile`'s existing array,
 * replacing only that world's own rows — a second, later run for a
 * DIFFERENT world (or the fixture spec's own re-run) never destroys another
 * world's findings. `entries` may be empty (still writes/updates the file,
 * recording "this run found nothing" rather than leaving a stale file from
 * a previous, dirtier run).
 */
export function mergeAndWriteFindings(
  outFile: string,
  world: string,
  entries: TourFinding[],
): void {
  let existing: TourFinding[] = [];
  if (existsSync(outFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(outFile, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed as TourFinding[];
    } catch {
      existing = [];
    }
  }
  const kept = existing.filter((entry) => entry.world !== world);
  const merged = [...kept, ...entries].sort((a, b) => {
    if (a.world !== b.world) return a.world.localeCompare(b.world);
    if (a.persona !== b.persona) return a.persona.localeCompare(b.persona);
    if (a.week !== b.week) return a.week - b.week;
    return a.surface.localeCompare(b.surface);
  });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}
