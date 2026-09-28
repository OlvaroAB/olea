/**
 * Navigation and control helpers for the `simulator` Playwright project
 * (WBX-5, `ol-3ux7.64.6`, `docs/dev/simulator-design.md` §6).
 *
 * Scoped to `e2e/simulator/` on purpose — this bead owns only that directory
 * plus `playwright.config.ts`, and `../helpers.ts` (the flat-surface rig) is
 * shared with every other spec in this package. Reuses that file's
 * `frame`/`hostFrameElement`/`waitForSettled` (generic Page helpers, not tied
 * to the `Surface` union) rather than duplicating them.
 *
 * SETTLING, NOT SLEEPING: every control here (`[data-sim-advance]`,
 * `[data-sim-rate]`, `[data-sim-reset]`, a palette command) triggers
 * `SimulatorController.remountPane()`, which empties and rebuilds the pane
 * asynchronously. **`ol-3ux7.64.11` [WBX-9] closed the hook gap this doc used
 * to name here**: `SimulatorShellElements.root` now carries
 * `[data-wb-remount]`, bumped once `remountPane()`'s mount (and, for the
 * whole-plugin path, the default Today view) has fully resolved
 * (`controller.ts`'s own doc). {@link waitForRemount} is the settle signal
 * every control helper below waits on, in place of the necessarily
 * approximate content waits (a badge date changing, a notice appearing) this
 * file used before. `waitForTodayRendered` stays, but now purely as a
 * PRODUCT assertion — "the Today panel actually rendered" — not as a stand-in
 * settle mechanism.
 *
 * COURSE-SETUP MODALS: `main.ts`'s in-memory-only `courseSetupSeenCodes`
 * used to reset on every single `remountPane()` (a brand new `OleaPlugin`
 * every time), reopening `CourseSetupModal` for every course-shaped fixture
 * folder (`01 Courses/GEOL204`, `01 Courses/MUSTH104`) after every control
 * click. WBX-9 fixed this from the simulator side
 * (`simulator/course-setup-bridge.ts` — `packages/plugin` is out of scope for
 * that bead): the seen set now survives a remount, so {@link advanceDays} and
 * {@link rateNextDue} no longer need to click through anything. Two cases
 * still legitimately show fresh proposals and still call
 * {@link dismissCourseSetupModals}: the real cold start ({@link
 * gotoSimulator}) and immediately after `[data-sim-reset]`
 * ({@link resetSimulator}) — a reset clears the SAME shared plugin-data blob
 * the seen set lives in (`course-setup-bridge.ts`'s own doc explains why that
 * is the right behaviour, not a residual bug). `CourseSetupModal` renders
 * into the TOP document's `[data-wb-modal-host]` — never inside
 * `[data-wb-surface]` (`obsidian-shim/index.ts`'s `Modal.open()` doc) — which
 * is why {@link dismissCourseSetupModals} queries `page`, not `frame(page)`.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { frame, hostFrameElement, waitForSettled } from '../helpers.js';

export { frame, hostFrameElement };

/** The simulator's one addressable route/state — see `main.ts`'s `DEFAULT_SIMULATOR_STATE`. */
export const SIMULATOR_STATE_ID = 'simulator-live';

/** `commands/ids.ts` — hardcoded here rather than imported, matching this suite's existing convention of addressing the app by its own stable ids without pulling plugin source into a Playwright spec. */
export const COMMAND_TODAY_OPEN = 'olea-today-open';
export const COMMAND_SESSION_BUILD = 'olea-session-build';
export const COMMAND_GAP_OPEN = 'olea-gap-open';

/**
 * `today/view.ts` / `home/view.ts` / `gap/view.ts` — the view types this
 * suite's goldens and `whole-plugin.spec.ts` open.
 *
 * **`VIEW_TYPE_SESSION_BUILDER` is retired, not merely renamed** (`ol-f7ao`,
 * `[D-243]`/`[HOME-4]`, `ol-egov.135`: "the session builder is a panel, not a
 * destination"). `COMMAND_SESSION_BUILD`'s callback has opened `HomeView` in
 * the MAIN pane since SESS-8.7 (`packages/plugin/src/main.ts`'s
 * `buildSession` handler, `void this.revealHomeView()` — see
 * `test/session-builder/wiring.spec.ts` in `packages/plugin`, which asserts
 * exactly this and was green throughout). `'olea-session-builder'` is still
 * a real, registered view type (a saved layout referencing it must not
 * error), but nothing in the product opens one any more — asserting it here
 * would assert dead code path, not product behaviour.
 */
export const VIEW_TYPE_TODAY = 'olea-today';
export const VIEW_TYPE_HOME = 'olea-home';
export const VIEW_TYPE_GAP = 'olea-gap';

export interface GotoSimulatorOptions {
  /**
   * Forward-compatible only: `main.ts`'s `readRoute` parses a generic
   * `persona` query param, but `SimulatorController`/`mountSimulator` does
   * not yet read it (single fixture world, `ol-3ux7.64.10` [WBX-1b]) — see
   * this suite's `goldens.spec.ts` module doc. Passing one today is a no-op,
   * not an error.
   */
  readonly world?: string;
  readonly persona?: string;
  /**
   * The carried world to select inside a multi-world dist
   * (`ol-3ux7.5.57.13` [MOM-9b], `ol-r5ur` [MOM-9c];
   * `docs/dev/simulator-design.md` §2a/§4b). `main.ts`'s router
   * (`writeRoute`) only ever rewrites the HASH on every render — a world
   * named there would be dropped on the very first remount — so this goes
   * in the SEARCH instead (`?world=<id>`, before the `#`), which
   * `SimulatorController`'s `requestedWorldId(location.search)`
   * (`packages/workbench/src/simulator/world.ts`) is what actually reads a
   * world choice from. Falls back to `WB_SIM_SELECT_WORLD` when not passed
   * explicitly (the seam `scripts/simulator-tour.mjs` in the private repo
   * sets for the shared journey specs, which construct their own URL and
   * cannot take this option directly). Omitted entirely — no search
   * parameter at all — when neither is set, so a caller that never asks for
   * a world gets the exact URL this helper always built.
   */
  readonly selectWorld?: string;
}

/**
 * Clicks through every `CourseSetupModal` confirmation the real plugin's
 * course-detection chain opens, until the chain has nothing left to propose.
 * Needed only right after a genuine "fresh device" moment — the real cold
 * start ({@link gotoSimulator}) and right after `[data-sim-reset]` clears the
 * shared plugin-data blob WBX-9's seen-set lives in ({@link resetSimulator});
 * after an ordinary remount `course-setup-bridge.ts` confirms already-seen
 * codes itself. `CourseSetupModal` renders into the TOP document's
 * `[data-wb-modal-host]`, never inside `[data-wb-surface]`, which is why the
 * confirm button is queried on `page`, not `frame(page)`.
 *
 * **Signal-driven, not a fixed number of sleeps (`ol-egov.141.89.51`).** This
 * used to be five rounds 150ms apart, bounded rather than polled to a stable
 * state — so on a slow enough machine a proposal still being prepared when
 * the rounds ran out (each step lists the vault and reads the review log
 * before it opens its modal) was left open, or left unconfirmed, and the
 * captures after it differed from a fast machine's. The plugin's own
 * proposal step (`openNextCourseSetupProposal`) is now counted by the
 * simulator's plugin-work tracker (`src/simulator/plugin-work.ts`), so this
 * waits for that work to settle, clicks the one modal the chain has opened
 * (it opens one at a time and chains to the next from `onConfirm`), waits for
 * the next step to settle, and stops when a settled chain has left no modal
 * open. `maxRounds` only guards against a chain that never ends; running
 * into it throws rather than leaving the page in an unknown state.
 *
 * **WBX-18 finding (`ol-qm6u`), fixed by ol-yng7**, kept for its history:
 * `course-setup-bridge.ts`'s watcher once compared a modal's code by VALUE
 * rather than by INSTANCE, so a repeat proposal across a remount stacked
 * several deep over several `advanceOneDay()` calls. Tracking modal
 * instances with a `WeakSet` fixed it; no caller needs a wider bound.
 */
export async function dismissCourseSetupModals(page: Page, maxRounds = 20): Promise<void> {
  await waitForPluginIdle(page);
  for (let round = 0; round < maxRounds; round += 1) {
    const confirmButton = page.locator('.olea-course-setup-confirm');
    if ((await confirmButton.count()) === 0) return;
    const before = await pluginSettledGeneration(page);
    await confirmButton.first().click();
    await waitForPluginSettled(page, before);
  }
  throw new Error(
    `dismissCourseSetupModals: still proposing courses after ${String(maxRounds)} confirmations`,
  );
}

/** Navigates to `#/simulator` and waits for the initial mount's `data-wb-ready`. */
export async function gotoSimulator(page: Page, options: GotoSimulatorOptions = {}): Promise<void> {
  const world = options.world ?? process.env.WB_SIM_WORLD ?? 'fixture';
  const persona = options.persona ?? 'none';
  // `WB_SIM_TRANSPORT` (`ol-3ux7.64.18`): unset means the route's default (`replay`, the
  // bundled cassette — what a Pages visitor gets). `record` points the SAME journeys at
  // `olea-service`'s `simulator-serve.mjs --spend-authorized` proxy, so the cassette is filled
  // by the exact gestures, answer texts and day-0 state the journeys replay afterwards — a fill
  // walked by a different script diverges in payload and never replays (the first attempt did).
  const transport = process.env.WB_SIM_TRANSPORT;
  const transportParam = transport === undefined ? '' : `&transport=${transport}`;
  // `?world=<id>` in the SEARCH (before the `#`) — see this file's own `GotoSimulatorOptions.
  // selectWorld` doc for why it has to live there and not in the hash query above. Left out
  // entirely when no selection is requested, so a caller that never asks for a world (the default,
  // every existing call site) gets the byte-identical URL this helper always built.
  const selectWorld = options.selectWorld ?? process.env.WB_SIM_SELECT_WORLD;
  const searchParam =
    selectWorld === undefined || selectWorld === ''
      ? ''
      : `?world=${encodeURIComponent(selectWorld)}`;
  await page.goto(`/${searchParam}#/simulator?world=${world}&persona=${persona}${transportParam}`);
  await waitForSettled(page, SIMULATOR_STATE_ID);
  await dismissCourseSetupModals(page);
}

/**
 * Waits until the Today panel has finished a render pass: the due section
 * (`.olea-today-due`, `today/view.ts`'s `renderDue`) always draws its label
 * plus exactly one `.olea-today-note` child — the sentence, "nothing due", or
 * "can't count" — once `TodayView` has actually rendered, so waiting on that
 * note survives the empty-pane gap every `remountPane()` call opens (see this
 * module's doc). **Scoped to `.olea-today-due`, not a bare `.olea-today-note`
 * selector**, because HOME-3 (`[D-223]`, `ol-l5og.22`) moved the due count off
 * its own `.olea-today-count` numeral onto the same `.olea-today-note` class
 * the insights section below it also uses for its "too early" line — an
 * unscoped selector can resolve to that section's note before the due
 * section has rendered its own.
 */
export async function waitForTodayRendered(page: Page): Promise<void> {
  await expect(frame(page).locator('.olea-today-due .olea-today-note').first()).toBeVisible();
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

export function badgeWorld(page: Page): Locator {
  return frame(page).locator('[data-wb-sim-badge-world]');
}

export function badgeDate(page: Page): Locator {
  return frame(page).locator('[data-wb-sim-badge-date]');
}

export function badgeTransport(page: Page): Locator {
  return frame(page).locator('[data-wb-sim-badge-transport]');
}

export function noticeLocator(page: Page): Locator {
  return frame(page).locator('.wb-sim-notice');
}

/** `[data-wb-remount]` on the simulator root (`SimulatorShellElements.root`, `ol-3ux7.64.11` [WBX-9]) — see this module's own doc. */
export function remountLocator(page: Page): Locator {
  return frame(page).locator('[data-wb-remount]');
}

/**
 * `[data-wb-remount]`'s settle budget. Playwright's own `expect` default
 * (5000ms) is enough for the fixture world's handful of files, but
 * `ol-8jnh` [WBX-24] measured a real-vault (514 files) reset consistently at
 * ~6.5-7s wall clock (three `resetSimulator` runs against a freshly-built
 * `dist-real`, driven directly with console/pageerror capture — no thrown
 * error anywhere in the sequence, so the 5s timeout was firing on a slow
 * settle, not masking a crash), spiking past 10s under concurrent CPU load
 * in the same run. This is a single documented larger bound rather than a
 * per-vault-size calculation: `[data-wb-remount]` carries no vault-size
 * signal a caller could read, and the fixture/steady worlds settle in well
 * under a second regardless, so a generous ceiling costs them nothing while
 * giving the real world's heavier reset (a full re-ingest, not an
 * incremental day-advance) comfortable margin above the worst observed.
 */
const REMOUNT_TIMEOUT_MS = 20_000;

/**
 * Waits for `[data-wb-remount]` to move past `before` — the precise
 * "the remount this click triggered has finished" signal, replacing the
 * badge-date/notice-text content waits every control helper used before
 * WBX-9 (see this module's own doc: those were necessary-but-not-sufficient,
 * never a purpose-built hook). `before` is `null` only if the element was
 * somehow missing when read — treated as `'0'`, the attribute's own initial
 * value (`main.ts`'s `mountSimulator`), so a first-ever wait still works.
 * See {@link REMOUNT_TIMEOUT_MS} for why the timeout is explicit here.
 */
export async function waitForRemount(page: Page, before: string | null): Promise<void> {
  await expect(remountLocator(page)).not.toHaveAttribute('data-wb-remount', before ?? '0', {
    timeout: REMOUNT_TIMEOUT_MS,
  });
}

/**
 * `[data-wb-plugin-busy]`/`[data-wb-plugin-settled]` on the simulator root
 * (`src/simulator/plugin-work.ts`, `ol-egov.141.89.51`): how many of the
 * plugin's own tracked async calls (Today's and Home's `onOpen`/`refresh`,
 * the course-proposal step) are in flight, and a generation bumped each time
 * that count returns to zero and stays there across a macrotask.
 */
function pluginWorkLocator(page: Page): Locator {
  return frame(page).locator('[data-wb-plugin-settled]');
}

/** Reads `[data-wb-plugin-settled]` — pass it to {@link waitForPluginSettled} after the action. */
export async function pluginSettledGeneration(page: Page): Promise<string | null> {
  return pluginWorkLocator(page).getAttribute('data-wb-plugin-settled');
}

/**
 * Fails when the tracker could not find a method it was told to wait on (a
 * rename in `packages/plugin`) — the settle signal would otherwise quietly
 * stop covering that work.
 */
async function expectPluginWorkTracked(page: Page): Promise<void> {
  await expect(frame(page).locator('[data-wb-plugin-untracked]')).toHaveCount(0);
}

/** Waits until none of the plugin's tracked work is in flight. */
export async function waitForPluginIdle(page: Page): Promise<void> {
  await expectPluginWorkTracked(page);
  await expect(pluginWorkLocator(page)).toHaveAttribute('data-wb-plugin-busy', '0', {
    timeout: REMOUNT_TIMEOUT_MS,
  });
}

/**
 * Waits for the plugin's tracked work to settle AFTER an action that started
 * some: the settled generation must move past `before` (read before the
 * action) and nothing may be in flight. A click that starts tracked work
 * starts it synchronously or on a microtask of its own event, so the
 * generation cannot move for an earlier, unrelated settle while this
 * action's work is still running — the busy count would not be zero.
 */
export async function waitForPluginSettled(page: Page, before: string | null): Promise<void> {
  await expectPluginWorkTracked(page);
  await expect(pluginWorkLocator(page)).not.toHaveAttribute(
    'data-wb-plugin-settled',
    before ?? '0',
    {
      timeout: REMOUNT_TIMEOUT_MS,
    },
  );
  await waitForPluginIdle(page);
}

/**
 * Waits until every transient toast (`obsidian-shim/index.ts`'s `Notice`)
 * has been removed from `[data-wb-notices]`. That host sits in the TOP page
 * (`main.ts`'s `noticeHost`), a `position: fixed` SIBLING of
 * `[data-wb-surface]`, not inside the iframe — but `hostFrameElement`'s
 * screenshot clips the rendered page pixels at the iframe's bounding box, so
 * a toast overlapping that box lands in the capture. `Notice`'s lifetime is
 * REAL wall-clock 4000ms (`window.setTimeout`, not the simulator's calendar
 * clock), so how many toasts are still visible when a screenshot is taken
 * depends only on how long this particular run took to get there. Measured
 * (`ol-egov.141.89.51`): two runs of the same build on the same machine
 * differed ONLY in toast count on two goldens. Moved here from
 * `tour-helpers.ts` (`ol-egov.141.89.45`, where it was first found) so every
 * capture path shares it. Bounded at 10s — above the 4000ms a toast can live,
 * with margin for several created moments apart. This is a condition wait,
 * never a sleep: it returns the moment the last toast is gone.
 */
export async function waitForNoticesToClear(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-wb-notices] [data-wb-notice]').length === 0,
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * Everything a golden capture waits for first (`ol-egov.141.89.51`): no
 * fatal error, none of the plugin's tracked work in flight, and no transient
 * toast left over the frame. `goldens.spec.ts`, the journeys'
 * `captureJourneyStep` and the tour's `captureAndCheck` all call this
 * immediately before `toHaveScreenshot`.
 */
export async function waitForCaptureReady(page: Page): Promise<void> {
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
  await waitForPluginIdle(page);
  await waitForNoticesToClear(page);
  await waitForPluginIdle(page);
  await repaintEverything(page);
}

/**
 * Makes the next capture a full repaint of both documents, never a patchwork
 * of partial repaints (`ol-egov.141.89.51`).
 *
 * Chromium re-rasters only the invalidated rectangle of a tile when a small
 * region changes ("partial raster"), and an anti-aliased edge that crosses
 * the boundary of such a rectangle comes out one level different from the
 * same edge rastered whole. WHICH small regions were invalidated before a
 * capture depends on timing — a toast removed here, a hover state there — so
 * two runs of the same build on the same machine produced captures that
 * differed by one level on a few edge pixels (rounded corners, the term
 * slider's thumb, a pane border). Measured: 33 of 76 captures differed that
 * way between two identical runs; with partial raster disabled, 0 of 76 did.
 * Changing the zoom of both documents and changing it back relays out and
 * repaints everything, so every tile is rastered whole before the capture.
 * Waits are animation frames, never a duration.
 */
async function repaintEverything(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frameDocument =
      document.querySelector<HTMLIFrameElement>('[data-wb-surface]')?.contentDocument ?? null;
    const roots = [document.documentElement, frameDocument?.documentElement].filter(
      (root): root is HTMLElement => root !== undefined && root !== null,
    );
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    const previous = roots.map((root) => root.style.getPropertyValue('zoom'));
    for (const root of roots) root.style.setProperty('zoom', '1.25');
    await nextFrame();
    roots.forEach((root, index) => {
      const value = previous[index] ?? '';
      if (value === '') root.style.removeProperty('zoom');
      else root.style.setProperty('zoom', value);
    });
    await nextFrame();
  });
}

/**
 * `[data-wb-content-gen]` on `elements.main`/`elements.right`
 * (`controller.ts`'s `installContentGenerationCounter`, `ol-egov.141.89.10.38`)
 * — bumped by a `MutationObserver` once per synchronous render pass on that
 * pane, whether the pane's content changed because of a full `remountPane()`
 * or because a palette command re-revealed a view that was already open (see
 * that function's own doc for why `[data-wb-remount]` alone is the wrong
 * signal for the second case). `pane` matches {@link openCommandViaPalette}'s
 * own parameter: `'right'` is `elements.right` (Today's pool), `'main'` is
 * `elements.main` (Home's).
 */
function contentGenerationLocator(page: Page, pane: 'main' | 'right'): Locator {
  const selector = pane === 'main' ? '[data-wb-sim-main]' : '[data-wb-sim-right]';
  return frame(page).locator(selector);
}

/**
 * Waits for the given pane's content-generation counter to move past
 * `before` — the same before/after shape {@link waitForRemount} uses one
 * level up. Shares that function's timeout: a command-triggered re-render is
 * never slower than a full remount's own worst case, and giving it the
 * identical bound keeps this file's one settle budget in one place
 * ({@link REMOUNT_TIMEOUT_MS}).
 */
async function waitForContentGeneration(
  page: Page,
  pane: 'main' | 'right',
  before: string | null,
): Promise<void> {
  await expect(contentGenerationLocator(page, pane)).not.toHaveAttribute(
    'data-wb-content-gen',
    before ?? '0',
    { timeout: REMOUNT_TIMEOUT_MS },
  );
}

/**
 * Reads the due section's `.olea-today-note` sentence and returns its count,
 * or `'none'` when the sentence reads "nothing due" or "can't count" instead
 * of a real total. Call only after {@link waitForTodayRendered}.
 *
 * **Parses a sentence, not a numeral, since HOME-3** (`[D-223]`,
 * `ol-l5og.22`) — the due total used to be its own `.olea-today-count` node;
 * it is now folded into `today/copy.ts`'s `dueTodaySentence`, `"N due
 * today"`, drawn at the same weight as the other two due-section states. This
 * matches a leading integer rather than importing `dueTodaySentence` itself,
 * so a copy change alone (not a structural one) still exercises the real
 * rendered string end-to-end.
 */
export async function readDueCount(page: Page): Promise<number | 'none'> {
  await waitForTodayRendered(page);
  const note = frame(page).locator('.olea-today-due .olea-today-note').first();
  const text = ((await note.textContent()) ?? '').trim();
  const match = /^(\d+)\s+due today$/.exec(text);
  return match === null ? 'none' : Number(match[1]);
}

/**
 * `[D-373]` (`ol-egov.141.89.10.38`): the SECOND `.olea-today-note` line in
 * the due section — `today/view.ts`'s `renderDue`, drawn only when
 * `vm.sessionComposition?.composed === false` (the composed-session path
 * ranked no concepts, so {@link readDueCount} above is already reading the
 * KNOWN due count from what she has already scheduled, never a suppressed
 * zero). `null` when the composition succeeded and this line was never
 * rendered — a caller checking "was a reason given" reads `null` as no,
 * never as an empty string.
 *
 * Call only after {@link readDueCount} — same ordering rule that function's
 * own doc states, and for the same reason: both read the same rendered
 * section after `waitForTodayRendered` has already resolved.
 */
export async function sessionNotComposedNote(page: Page): Promise<string | null> {
  const note = frame(page).locator('.olea-today-due .olea-today-note').nth(1);
  if ((await note.count()) === 0) return null;
  return ((await note.textContent()) ?? '').trim();
}

/**
 * `[data-sim-reset]` — clears the overlay, plugin data and clock offset
 * together (`SimulatorStore.resetAll`). That same plugin-data blob is where
 * WBX-9's course-setup seen-set lives, so a reset is a genuine "fresh
 * device" moment — {@link dismissCourseSetupModals} here is the guarded
 * dismiss this module's doc says is still legitimate, not a leftover.
 */
export async function resetSimulator(page: Page): Promise<void> {
  const before = await remountLocator(page).getAttribute('data-wb-remount');
  await frame(page).locator('[data-sim-reset]').click();
  await waitForRemount(page, before);
  await expect(noticeLocator(page)).toHaveText('Reset to the fixture snapshot.');
  await dismissCourseSetupModals(page);
  await waitForTodayRendered(page);
}

/** `[data-sim-advance]`, clicked `days` times in sequence, waiting for the remount each click triggers to finish before the next (a real user cannot advance faster than the previous remount settles, and clicking through an in-flight remount is unspecified behaviour this suite does not want to exercise). */
export async function advanceDays(page: Page, days: number): Promise<void> {
  for (let i = 0; i < days; i += 1) {
    const before = await remountLocator(page).getAttribute('data-wb-remount');
    await frame(page).locator('[data-sim-advance]').click();
    await waitForRemount(page, before);
    await waitForTodayRendered(page);
  }
}

/**
 * The term scrubber (`ol-3ux7.64.16` [WBX-13], `term-scrubber.ts`) — a
 * native `<input type="range">`. Playwright's `locator.fill()` refuses a
 * range input, and dragging a real pointer across one is not a stable
 * automation primitive, so {@link scrubTo} sets `.value` directly and
 * dispatches the same `input`/`change` events a real drag-then-release (or a
 * keyboard step) would raise — the same "drive the real control's own event,
 * don't invent a shortcut" discipline every other helper in this file uses
 * (`[data-sim-advance]`, `[data-sim-reset]`).
 */
export function scrubberLocator(page: Page): Locator {
  return frame(page).locator('[data-sim-scrub]');
}

export function scrubberDateLocator(page: Page): Locator {
  return frame(page).locator('[data-sim-scrub-date]');
}

/**
 * Moves the scrubber to `days` past the world's `asOf` and waits for the
 * remount it commits (`controller.ts`'s `scrubTo`, wired to the range
 * input's `change` event) to finish. `days` is clamped by the control's own
 * `min`/`max` exactly as a real drag would be — this helper does not
 * pre-clamp, so a value outside the declared window is a deliberate way to
 * exercise that clamping from a test.
 */
export async function scrubTo(page: Page, days: number): Promise<void> {
  const before = await remountLocator(page).getAttribute('data-wb-remount');
  await scrubberLocator(page).evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, days);
  await waitForRemount(page, before);
  await waitForTodayRendered(page);
}

/**
 * `[data-sim-rate]` — writes exactly one review-log record for the first due
 * item, or rates nothing if none is due. Only the "rated" outcome remounts
 * (`controller.ts`'s `rateNextDue` returns early, before `remountPane()`,
 * when nothing is due) — waiting on `[data-wb-remount]` unconditionally would
 * hang on the "nothing due" path, so this only waits on it when the notice
 * says a rating actually happened.
 */
export async function rateNextDue(page: Page): Promise<void> {
  const before = await remountLocator(page).getAttribute('data-wb-remount');
  await frame(page).locator('[data-sim-rate]').click();
  await expect(noticeLocator(page)).toHaveText(/^Rated 1 item|^Nothing is due right now/);
  const noticeText = (await noticeLocator(page).textContent()) ?? '';
  if (noticeText.startsWith('Rated 1 item')) await waitForRemount(page, before);
  await waitForTodayRendered(page);
}

/**
 * Opens the whole plugin's command palette (`[data-wb-palette-toggle]`,
 * relocated into the ribbon by `controller.ts`'s `populateRibbon` since
 * `ol-3ux7.64.14` [WBX-12] — still the SAME real button, so this locator is
 * unaffected by where in the DOM it sits), invokes `commandId` by clicking
 * its `[data-wb-command-id]` button, and waits for `pane`'s active leaf to
 * report `expectedViewType` (`[data-wb-pane]`/`[data-wb-right-pane]`'s
 * `data-wb-active-view-type` — `obsidian-shim/index.ts`'s `Workspace`).
 * This is F9.S3's "commands are registered and reachable through the
 * palette... choosing one runs its callback" and "a registered view opens in
 * a leaf through the workspace", exercised together rather than as two
 * separate DOM interactions, since the palette click IS the callback
 * invocation this suite can observe from outside the plugin.
 *
 * `pane` defaults to `'right'`, the pool `COMMAND_TODAY_OPEN`'s
 * `revealTodayView` targets via `workspace.getRightLeaf` (WBX-12 gave the
 * right sidebar a REAL pool of its own — before that bead it aliased the
 * main pool, so `[data-wb-pane]` was the only pane there was). Pass
 * `'main'` for a command whose destination lives in the main working-area
 * pool instead — `COMMAND_SESSION_BUILD` (`buildSession` →
 * `revealHomeView`, `getLeaf('tab')`) and `COMMAND_GAP_OPEN`
 * (`revealGapView`, same pool) since `[D-243]`/`[HOME-4]` (`ol-f7ao`): "the
 * session builder is a panel, not a destination" moved that command's real
 * destination off the right-sidebar `SessionBuilderView` it used to open.
 * The main pane shows `HomeView` from the moment of mount
 * (`controller.ts`'s `remountPane`), so a caller proving
 * `COMMAND_SESSION_BUILD` actually does something must first move the main
 * pane AWAY from Home (e.g. via `COMMAND_GAP_OPEN`) — otherwise the
 * assertion would pass even if the command's callback silently did nothing,
 * since Home was already the active main-pane view either way.
 *
 * **`ol-egov.141.89.10.38`: also waits for `pane`'s content-generation
 * counter to move past its own pre-click value.** The command's callback in
 * `packages/plugin/src/main.ts` is fire-and-forget (`() => { void this.
 * revealXView(); }`) by that file's own design, and on a leaf that is
 * already open (the ordinary case here — `remountPane` opened both Home and
 * Today once already), the reveal's real work is a re-render, not the
 * `data-wb-active-view-type` flip this function already waited on — that
 * attribute is already correct before the click, so waiting on it again
 * proves nothing about whether the re-render has happened. A caller that
 * screenshots right after this function returned used to be racing that
 * fire-and-forget refresh; see `installContentGenerationCounter`'s own doc
 * (`controller.ts`) for why `[data-wb-remount]` cannot stand in for it and
 * why a `MutationObserver`-backed counter can.
 */
export async function openCommandViaPalette(
  page: Page,
  commandId: string,
  expectedViewType: string,
  pane: 'main' | 'right' = 'right',
): Promise<void> {
  const paneSelector = pane === 'main' ? '[data-wb-pane]' : '[data-wb-right-pane]';
  const beforeContentGeneration = await contentGenerationLocator(page, pane).getAttribute(
    'data-wb-content-gen',
  );
  await waitForPluginIdle(page);
  await frame(page).locator('[data-wb-palette-toggle]').click();
  await expect(frame(page).locator('[data-wb-palette]')).toBeVisible();
  await frame(page).locator(`[data-wb-command-id="${commandId}"]`).click();
  await expect(frame(page).locator(paneSelector)).toHaveAttribute(
    'data-wb-active-view-type',
    expectedViewType,
  );
  await waitForContentGeneration(page, pane, beforeContentGeneration);
  // `ol-egov.141.89.51`: the content-generation bump above fires on the
  // FIRST render pass the command causes; a reveal can run more than one
  // (`revealTodayView` refreshes again after `onOpen` already did). The next
  // pass starts on a microtask of the first, so by the time this separate
  // read runs it is either in flight (busy > 0) or done — wait for none of
  // the plugin's tracked work to be in flight. Not a wait for the settled
  // generation to move: a command whose view is not tracked (the gap panel)
  // starts no tracked work, and that generation would never move for it.
  await waitForPluginIdle(page);
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
}

/**
 * Counts rows in the persisted vault overlay's IndexedDB object store —
 * `simulator/store.ts`'s `openIndexedDbStore`, `DEFAULT_SIMULATOR_DB_NAME`
 * ('olea-simulator') and its private `OVERLAY_STORE_NAME` ('overlay',
 * duplicated here as a literal because that constant is not exported — see
 * this module's doc header for the hook gap this stands in for). Used by
 * `lived-term.spec.ts`'s "a day with no session records no events": the
 * overlay is the ONLY place a write lands (`docs/dev/simulator-design.md`
 * §3), so a day-advance that leaves its row count unchanged is direct
 * evidence nothing was written, independent of which file a write would have
 * touched.
 */
export async function overlayEntryCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const DB_NAME = 'olea-simulator';
    const STORE_NAME = 'overlay';
    return new Promise<number>((resolve, reject) => {
      const openRequest = indexedDB.open(DB_NAME);
      openRequest.onerror = () => reject(openRequest.error ?? new Error('indexedDB.open failed'));
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          resolve(0);
          return;
        }
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const countRequest = transaction.objectStore(STORE_NAME).count();
        countRequest.onsuccess = () => {
          resolve(countRequest.result);
          db.close();
        };
        countRequest.onerror = () => {
          reject(countRequest.error ?? new Error('overlay count failed'));
          db.close();
        };
      };
    });
  });
}

/**
 * Sums the byte length of every overlay row's stored content — same store as
 * {@link overlayEntryCount}, but a total over `bytes.byteLength` rather than
 * a row count. Needed because `appendReviewLogRecord` (and the
 * `retrospective-offered` writer sharing its append path, `[D-134]` Q5) is a
 * ONE-FILE-PER-DAY-PER-DEVICE append (C5.2): a second write dated on a day
 * whose file the overlay already holds lands as MORE BYTES in the SAME row,
 * not a new row. `[ol-3ux7.64.22]` (WBX-19, `retrospective/provider.ts`'s
 * try/catch fix) made the fixture world's cold-start mount actually render
 * Home's standing retrospective offers, which means every fresh mount now
 * writes one `retrospective-offered` line per outstanding assessment into
 * `asOf`'s own review-log file BEFORE `lived-term.spec.ts`'s "reset returns
 * the world to its snapshot" test ever calls `rateNextDue` — so that file
 * already exists at the reset baseline, and `overlayEntryCount` can no
 * longer tell "rated, on the same day the baseline was taken" apart from "no
 * write happened at all". Byte-total still can, and — since the daily-file
 * writes are the only ones this suite ever finds and the concept-provenance
 * rows `overlayEntryCount`'s own doc names are deterministic, stable content
 * rewritten identically on every remount — it does not spuriously drift
 * across a plain day-advance either.
 */
export async function overlayTotalBytes(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const DB_NAME = 'olea-simulator';
    const STORE_NAME = 'overlay';
    return new Promise<number>((resolve, reject) => {
      const openRequest = indexedDB.open(DB_NAME);
      openRequest.onerror = () => reject(openRequest.error ?? new Error('indexedDB.open failed'));
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          resolve(0);
          return;
        }
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const getAllRequest = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<
          Array<{ readonly bytes?: Uint8Array | null }>
        >;
        getAllRequest.onsuccess = () => {
          const total = getAllRequest.result.reduce(
            (sum, row) => sum + (row.bytes?.byteLength ?? 0),
            0,
          );
          resolve(total);
          db.close();
        };
        getAllRequest.onerror = () => {
          reject(getAllRequest.error ?? new Error('overlay getAll failed'));
          db.close();
        };
      };
    });
  });
}
