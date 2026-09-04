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
 * doc header. Originally documented as only ever needed right after a
 * genuine "fresh device" moment (the real cold start, or right after
 * `[data-sim-reset]` clears the shared plugin-data blob WBX-9's seen-set
 * lives in), because {@link advanceDays} and {@link rateNextDue} — the OLD
 * `SimulatorWalkDriver`'s own day-advance/rating methods — no longer need
 * to call this.
 *
 * **WBX-18 finding (`ol-qm6u`), fixed by ol-yng7:** that claim briefly did
 * NOT extend to the newer, raw driver path `advanceWeeksViaDriver`
 * (`tour-helpers.ts`) drives via `window.__oleaSimulatorDriver.advanceOneDay()`
 * — against the real world, once course attribution actually works (WBX-18's
 * fix), a real vault's course-shaped folders could re-surface a "This looks
 * like a course" proposal across a remount even after an earlier confirm,
 * stacking several deep across several day-advances (observed: 7 stacked
 * proposals for 2 distinct courses over 7 `advanceOneDay()` calls). This was
 * invisible before WBX-18 because the real world had zero course-shaped
 * folders reachable by path, so zero proposals ever fired. The cause was
 * `course-setup-bridge.ts`'s watcher comparing the CURRENT modal's code by
 * VALUE (a `querySelector` first-match against one scalar) rather than by
 * INSTANCE: `Modal.open()` only ever appends a new `.modal-container`, never
 * removing an earlier unresolved one, so a repeat proposal's input read the
 * same value as the still-present earlier instance and the watcher never
 * re-ran its seen-code check. Fixed by tracking modal instances with a
 * `WeakSet` keyed on the DOM node itself — every caller driving a real-shaped
 * vault across several day-advances now needs no more round budget than the
 * plain default below; the widened, week-scaled bound this comment used to
 * ask for is gone from every caller (`tour.spec.ts`, `week2-review.spec.ts`).
 *
 * Bounded (`rounds`, 150ms apart) rather than polled to a stable "definitely
 * none left" state — a real vault's course count needs no more headroom than
 * the fixture vault's did now that a cross-mount repeat can never
 * accumulate a round of its own. In the top document (`[data-wb-modal-host]`),
 * never inside `[data-wb-surface]`.
 */
export async function dismissCourseSetupModals(page: Page, rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await page.waitForTimeout(150);
    const confirmButton = page.locator('.olea-course-setup-confirm');
    if ((await confirmButton.count()) > 0) await confirmButton.first().click();
  }
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
  await page.goto(`/#/simulator?world=${world}&persona=${persona}${transportParam}`);
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

/** `[data-wb-remount]` on the simulator root (`SimulatorShellElements.root`, `ol-3ux7.64.11` [WBX-9]) — see this module's own doc. */
export function remountLocator(page: Page): Locator {
  return frame(page).locator('[data-wb-remount]');
}

/**
 * Waits for `[data-wb-remount]` to move past `before` — the precise
 * "the remount this click triggered has finished" signal, replacing the
 * badge-date/notice-text content waits every control helper used before
 * WBX-9 (see this module's own doc: those were necessary-but-not-sufficient,
 * never a purpose-built hook). `before` is `null` only if the element was
 * somehow missing when read — treated as `'0'`, the attribute's own initial
 * value (`main.ts`'s `mountSimulator`), so a first-ever wait still works.
 */
export async function waitForRemount(page: Page, before: string | null): Promise<void> {
  await expect(remountLocator(page)).not.toHaveAttribute('data-wb-remount', before ?? '0');
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
 * its `[data-wb-command-id]` button, and waits for the RIGHT sidebar's
 * active leaf to report `expectedViewType` (`[data-wb-right-pane]`'s
 * `data-wb-active-view-type` — `obsidian-shim/index.ts`'s `Workspace`).
 * This is F9.S3's "commands are registered and reachable through the
 * palette... choosing one runs its callback" and "a registered view opens in
 * a leaf through the workspace", exercised together rather than as two
 * separate DOM interactions, since the palette click IS the callback
 * invocation this suite can observe from outside the plugin.
 *
 * `[data-wb-right-pane]`, not `[data-wb-pane]` (WBX-12): every command this
 * suite invokes through this helper (`COMMAND_TODAY_OPEN`,
 * `COMMAND_SESSION_BUILD`) drives a `revealXxxView` that calls
 * `workspace.getRightLeaf`, which WBX-12 gave a REAL right-sidebar pool of
 * its own — before that bead it aliased the main pool, so `[data-wb-pane]`
 * was the only pane there was. The main pane now shows Home from the moment
 * of mount (`controller.ts`'s `remountPane`), so asserting against
 * `[data-wb-pane]` here would be asserting Home never left, not that the
 * command opened its view.
 */
export async function openCommandViaPalette(
  page: Page,
  commandId: string,
  expectedViewType: string,
): Promise<void> {
  await frame(page).locator('[data-wb-palette-toggle]').click();
  await expect(frame(page).locator('[data-wb-palette]')).toBeVisible();
  await frame(page).locator(`[data-wb-command-id="${commandId}"]`).click();
  await expect(frame(page).locator('[data-wb-right-pane]')).toHaveAttribute(
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
