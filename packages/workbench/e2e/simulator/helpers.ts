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
 * asynchronously. `SimulatorController` sets its own notice text and the
 * badge date/world/transport spans synchronously, but a text notice is set
 * *before* the awaited remount starts (see `controller.ts`'s `rateNextDue`/
 * `reset`), so it is necessary-but-not-sufficient evidence that the click
 * "landed" — it is never sufficient evidence the pane finished re-rendering.
 * The actual settle signal used throughout is `waitForTodayRendered`:
 * Playwright's `toBeVisible`/`toHaveText`/`toHaveAttribute` retry against the
 * live DOM, so asserting the FINAL expected state (rather than waiting for an
 * intermediate "done" flag that does not exist) is what absorbs the async gap.
 *
 * HOOK GAP (report this, do not route around it silently): there is no
 * `[data-sim-busy]` / "remount complete" attribute anywhere in `simulator/`.
 * Every helper below works around that with a content-based wait
 * (`.olea-today-count`/`.olea-today-note` becoming visible, or a badge value
 * changing) rather than a purpose-built hook. A cheap follow-up: have
 * `SimulatorController` toggle one attribute (e.g. `[data-sim-busy="true"]`
 * on `elements.pane`) for the duration of `remountPane()`.
 *
 * SECOND HOOK GAP, found by running this suite rather than by reading the
 * design doc: every `remountPane()` constructs a BRAND NEW `OleaPlugin`
 * (`mountPlugin(OleaPlugin, ...)` in `controller.ts`), so `main.ts`'s
 * in-memory, never-persisted `courseSetupSeenCodes` is empty again on every
 * single reset/advance/rate — not just at first mount. The real plugin's
 * cold-start course-detection scan (`checkForCourseSetupProposals`,
 * `main.ts:1544`) therefore reopens `CourseSetupModal` (`.olea-course-setup-
 * confirm`, rendered into the TOP document's `[data-wb-modal-host]` — NEVER
 * inside `[data-wb-surface]`, see `obsidian-shim/index.ts`'s `Modal.open()`
 * doc — so it visually covers, and intercepts clicks into, the iframe) for
 * EVERY course-shaped folder the fixture vault has (two, today:
 * `01 Courses/GEOL204` and `01 Courses/MUSTH104`) after every single control
 * click. `onConfirm` writes nothing to the vault (`course-setup/confirmation-
 * view.ts`'s own doc: "persistence... is not this module's decision to
 * make"), so clicking through it is a safe no-op for every assertion in this
 * suite — but every helper that can trigger a remount calls
 * {@link dismissCourseSetupModals} first, or its screenshot/click would hang
 * against an intercepting overlay. A real fix belongs to whichever bead owns
 * `controller.ts` (WBX-1/WBX-6): either persist `courseSetupSeenCodes`
 * across remounts the way the device id and clock offset already are, or
 * suppress the cold-start scan for the simulator's own mount path.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { frame, hostFrameElement, waitForSettled } from '../helpers.js';

export { frame, hostFrameElement };

/** The simulator's one addressable route/state — see `main.ts`'s `DEFAULT_SIMULATOR_STATE`. */
export const SIMULATOR_STATE_ID = 'simulator-live';

/** `commands/ids.ts` — hardcoded here rather than imported, matching this suite's existing convention of addressing the app by its own stable ids without pulling plugin source into a Playwright spec. */
export const COMMAND_TODAY_OPEN = 'olea-today-open';
export const COMMAND_SESSION_BUILD = 'olea-session-build';

/** `today/view.ts` / `session-builder/view.ts` — the two view types this suite's goldens open. */
export const VIEW_TYPE_TODAY = 'olea-today';
export const VIEW_TYPE_SESSION_BUILDER = 'olea-session-builder';

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
}

/**
 * Clicks through any `CourseSetupModal` confirmation(s) the real plugin's
 * cold-start course-detection scan opened on this mount — see this module's
 * doc header's second hook gap. Bounded (5 rounds, 150ms apart) rather than
 * polled to a stable "definitely none left" state: the fixture vault has a
 * small, fixed number of course-shaped folders, so this is generous headroom
 * over the real chain length, not a tight fit. In the top document
 * (`[data-wb-modal-host]`), never inside `[data-wb-surface]`.
 */
export async function dismissCourseSetupModals(page: Page): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await page.waitForTimeout(150);
    const confirmButton = page.locator('.olea-course-setup-confirm');
    if ((await confirmButton.count()) > 0) await confirmButton.first().click();
  }
}

/** Navigates to `#/simulator` and waits for the initial mount's `data-wb-ready`. */
export async function gotoSimulator(page: Page, options: GotoSimulatorOptions = {}): Promise<void> {
  const world = options.world ?? process.env.WB_SIM_WORLD ?? 'fixture';
  const persona = options.persona ?? 'none';
  await page.goto(`/#/simulator?world=${world}&persona=${persona}`);
  await waitForSettled(page, SIMULATOR_STATE_ID);
  await dismissCourseSetupModals(page);
}

/**
 * Waits until the Today panel has finished a render pass: `.olea-today-count`
 * (a due total) or `.olea-today-note` (nothing due / unavailable / too early —
 * `today/view.ts`) becomes visible. Both selectors are mutually exclusive and
 * one is always present once `TodayView` has actually rendered its due
 * section, so waiting on their union survives the empty-pane gap every
 * `remountPane()` call opens (see this module's doc).
 */
export async function waitForTodayRendered(page: Page): Promise<void> {
  await expect(frame(page).locator('.olea-today-count, .olea-today-note').first()).toBeVisible();
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

/** Reads `.olea-today-count`'s number, or `'none'` when `.olea-today-note` is showing instead (nothing due / unavailable). Call only after {@link waitForTodayRendered}. */
export async function readDueCount(page: Page): Promise<number | 'none'> {
  await waitForTodayRendered(page);
  const countEl = frame(page).locator('.olea-today-count');
  if ((await countEl.count()) === 0) return 'none';
  const text = (await countEl.first().textContent()) ?? '';
  const n = Number(text.trim());
  if (Number.isNaN(n))
    throw new Error(`readDueCount: unparseable .olea-today-count text "${text}"`);
  return n;
}

/** `[data-sim-reset]` — clears the overlay, plugin data and clock offset together (`SimulatorStore.resetAll`). */
export async function resetSimulator(page: Page): Promise<void> {
  await frame(page).locator('[data-sim-reset]').click();
  await expect(noticeLocator(page)).toHaveText('Reset to the fixture snapshot.');
  await dismissCourseSetupModals(page);
  await waitForTodayRendered(page);
}

/** `[data-sim-advance]`, clicked `days` times in sequence, waiting for the badge date to move on each click before the next (a real user cannot advance faster than the previous remount settles, and clicking through an in-flight remount is unspecified behaviour this suite does not want to exercise). */
export async function advanceDays(page: Page, days: number): Promise<void> {
  for (let i = 0; i < days; i += 1) {
    const before = (await badgeDate(page).textContent()) ?? '';
    await frame(page).locator('[data-sim-advance]').click();
    await expect(badgeDate(page)).not.toHaveText(before);
    await dismissCourseSetupModals(page);
    await waitForTodayRendered(page);
  }
}

/** `[data-sim-rate]` — writes exactly one review-log record for the first due item, or rates nothing if none is due. */
export async function rateNextDue(page: Page): Promise<void> {
  await frame(page).locator('[data-sim-rate]').click();
  await expect(noticeLocator(page)).toHaveText(/^Rated 1 item|^Nothing is due right now/);
  await dismissCourseSetupModals(page);
  await waitForTodayRendered(page);
}

/**
 * Opens the whole plugin's command palette (`[data-wb-palette-toggle]`),
 * invokes `commandId` by clicking its `[data-wb-command-id]` button, and
 * waits for the workspace's active leaf to report `expectedViewType`
 * (`[data-wb-pane]`'s `data-wb-active-view-type` — `obsidian-shim/index.ts`).
 * This is F9.S3's "commands are registered and reachable through the
 * palette... choosing one runs its callback" and "a registered view opens in
 * a leaf through the workspace", exercised together rather than as two
 * separate DOM interactions, since the palette click IS the callback
 * invocation this suite can observe from outside the plugin.
 */
export async function openCommandViaPalette(
  page: Page,
  commandId: string,
  expectedViewType: string,
): Promise<void> {
  await frame(page).locator('[data-wb-palette-toggle]').click();
  await expect(frame(page).locator('[data-wb-palette]')).toBeVisible();
  await frame(page).locator(`[data-wb-command-id="${commandId}"]`).click();
  await expect(frame(page).locator('[data-wb-pane]')).toHaveAttribute(
    'data-wb-active-view-type',
    expectedViewType,
  );
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
