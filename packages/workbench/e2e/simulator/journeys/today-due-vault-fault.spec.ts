/**
 * `ol-egov.141.89.10.72` — journey "today-due-vault-fault": a vault-read failure on the
 * composed-session path (`[SESS-8.5]`, the production default — the real plugin the simulator
 * mounts wires `studySessionHolder`/`composeDefaultStudySession`, same as `main.ts`'s own
 * `registerView` call site) must read as Today's own "cannot count" sentence, never an
 * uncaught page error.
 *
 * WBX-27's STICKY vault-read fault-axis trigger (`forceNextVaultReadFailure`) is armed, then
 * the real `[data-sim-advance]` gesture (`driver.advanceOneDay()`, a full plugin unload/reload
 * — `tour-helpers.ts`'s own doc) remounts the plugin, which auto-reveals Today in the right
 * sidebar fresh (F9.S3) — the exact sequence the discovered-work note on this bead's parent
 * (`ol-egov.141.89.10.38`) used to first find this gap. Every other view this remount composes
 * a preview for (Home's front door, the grove) already catches its own composer failure and
 * degrades gracefully; before this bead's fix, Today's `TodayView.onOpen` was the one still-bare
 * path, and a vault-read failure surfaced as an uncaught page error with the due section (and
 * the whole Today tab) never rendering at all.
 *
 * After the fix it renders the SAME `.olea-today-note` sentence the legacy (pre-composed)
 * route already uses for an unreadable vault — restated here as a literal (no new wording),
 * matching `today-panel.spec.ts`'s `today-unavailable` case, which asserts the identical text
 * for that other route.
 */
import { expect, type Page, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { driverForceNextVaultReadFailure, frame, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'today-due-vault-fault';

/**
 * `DUE_UNAVAILABLE` (`packages/plugin/src/today/copy.ts`) — the existing cannot-count
 * sentence, reused unchanged. Restated as a literal rather than imported, matching this
 * suite's existing convention of addressing product copy by its own text instead of pulling
 * plugin source into a Playwright spec (`journeys-helpers.ts`'s own header note on the same
 * convention for command ids and other copy).
 */
const DUE_UNAVAILABLE_TEXT = "Olea can't count what's due — it couldn't read your vault just now.";

type DriverWindow = { __oleaSimulatorDriver?: { advanceOneDay(): Promise<void> } };

/**
 * `[data-sim-advance]`'s own action (`controller.ts`'s `advanceOneDay`, `tour-helpers.ts`'s
 * `advanceWeeksViaDriver` doc) — a full plugin unload/reload. Used here (rather than a
 * command-driven re-reveal of an already-open leaf) because Today's own vulnerable path is
 * `TodayView.onOpen`, reached only by a FRESH leaf construction — `refreshOpenTodayViews`
 * (`today/refresh.ts`), the mechanism behind re-revealing an already-open Today, already
 * catches a reload failure and keeps the leaf's last-good render, so it cannot exercise
 * `onOpen`'s own gap. A full remount is what the discovered-work note that filed this bug
 * used to find it.
 */
async function driverAdvanceOneDay(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const driver = (window as unknown as DriverWindow).__oleaSimulatorDriver;
    if (driver === undefined) {
      throw new Error('driverAdvanceOneDay: window.__oleaSimulatorDriver is not installed.');
    }
    await driver.advanceOneDay();
  });
}

test(`@auto-web:simulator/journeys/${JOURNEY} ${WORLD}/${PERSONA} — a forced vault-read fault on the composed-session path reads as Today's own cannot-count sentence, never an uncaught error`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // Armed after reset, immediately before the one gesture whose vault reads must fail —
  // sticky from here on, so the remount's fresh `TodayView.onOpen` call fails too, never a
  // second, silently-succeeding read (same discipline `gap-refusal.spec.ts` documents for its
  // own two-load-per-open case).
  await driverForceNextVaultReadFailure(page);
  await driverAdvanceOneDay(page);

  // The page must never crash into the harness's own error banner — that IS the bug this
  // test guards against; before the fix this assertion is what actually fails (an uncaught
  // page error, surfaced by Playwright's own unhandled-exception listener, fails the test on
  // its own regardless of this assertion).
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);

  const due = frame(page).locator('.olea-today-due');
  await expect(due.locator('.olea-today-note')).toHaveText(DUE_UNAVAILABLE_TEXT, {
    timeout: 30_000,
  });
  // Never the front door either — nothing composed to start a session from
  // (`today-panel.spec.ts`'s `today-unavailable` case takes the same rule for the legacy
  // route's identical due-state).
  await expect(due.locator('.olea-today-primary-action')).toHaveCount(0);
});
