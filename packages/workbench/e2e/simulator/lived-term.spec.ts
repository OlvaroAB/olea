/**
 * F9.S2 — "The lived term: what she does today changes tomorrow"
 * (`features/F9-simulator.md`, `@auto-web:simulator/lived-term`).
 *
 * Drives `#/simulator` over the public fixture world through
 * `SimulatorController`'s real controls (`[data-sim-rate]`,
 * `[data-sim-advance]`, `[data-sim-reset]`) — never a URL parameter, since
 * this route has exactly one addressable state (`main.ts`'s
 * `DEFAULT_SIMULATOR_STATE`) and the whole point is that what changes lives
 * in the persisted vault and clock, not in the route.
 *
 * WHAT THIS DOES NOT COVER: the scenario "the clock override moves every
 * wall-time read the plugin makes" (scope source, misconception store,
 * materiality clock) would need hooks into those modules' own inspector
 * output that do not exist yet from outside the plugin; only the Today
 * panel's due count and the badge's own date span are asserted here as the
 * two externally-observable wall-time reads. Left for a follow-up rather
 * than asserted on faith.
 */
import { expect, test } from '@playwright/test';
import { waitForSettled } from '../helpers.js';
import {
  advanceDays,
  badgeDate,
  gotoSimulator,
  overlayEntryCount,
  rateNextDue,
  readDueCount,
  resetSimulator,
  SIMULATOR_STATE_ID,
} from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('@auto-web:simulator/lived-term — a review written today is there after a reload', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const before = await readDueCount(page);
  if (before === 'none' || before === 0) {
    throw new Error(
      'fixture world has nothing due at its snapshot instant — this test needs a due item to rate; see today-scenarios.ts / the fixture vault',
    );
  }

  await rateNextDue(page);
  const afterRate = await readDueCount(page);
  expect(afterRate).toBe(before === 1 ? 'none' : before - 1);

  // Reload is a full page load — a fresh module evaluation, a fresh
  // SimulatorController.create(), and (per `SimulatorController.create`)
  // a fresh read of the SAME persisted IndexedDB store. If the rating only
  // lived in page memory, this would bounce back to `before`.
  await page.reload();
  await waitForSettled(page, SIMULATOR_STATE_ID);
  const afterReload = await readDueCount(page);
  expect(afterReload).toBe(afterRate);
});

test('@auto-web:simulator/lived-term — reset returns the world to its snapshot in one step', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const originalDate = (await badgeDate(page).textContent()) ?? '';
  const before = await readDueCount(page);
  if (before === 'none' || before === 0) {
    throw new Error('fixture world has nothing due at its snapshot instant — see the sibling test');
  }
  // Every fresh mount's own cold-start ingestion writes a deterministic,
  // stable set of `.olea/concepts/*.json` provenance rows into the overlay —
  // NOT a per-user event, and not zero even on an untouched snapshot (see
  // this file's module doc / the sibling "no fabrication" test, which relies
  // on the same fact). Reset's actual claim is "back to what a fresh mount
  // of the snapshot writes", not "back to nothing" — so the baseline read
  // right after this test's own first reset is what "reset" is compared
  // against below, not a literal 0.
  const baselineOverlay = await overlayEntryCount(page);

  await rateNextDue(page);
  await advanceDays(page, 2);
  expect(await overlayEntryCount(page)).toBeGreaterThan(baselineOverlay);

  await resetSimulator(page);
  expect(await overlayEntryCount(page)).toBe(baselineOverlay);
  await expect(badgeDate(page)).toHaveText(originalDate);
  expect(await readDueCount(page)).toBe(before);
});

test('@auto-web:simulator/lived-term — a day with no session records no events', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const overlayBefore = await overlayEntryCount(page);
  await advanceDays(page, 7);
  const overlayAfter = await overlayEntryCount(page);

  // The overlay (`simulator/store.ts`) is the only place a vault write can
  // land — advancing the clock never calls `vault.write`/`vault.delete`, so
  // an unchanged row count is direct evidence nothing was fabricated for the
  // seven skipped days, not merely that one particular file stayed empty.
  expect(overlayAfter).toBe(overlayBefore);
});

test('@auto-web:simulator/lived-term — advancing a day re-mounts the plugin and moves the badge date', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const day0 = (await badgeDate(page).textContent()) ?? '';
  await advanceDays(page, 1);
  const day1 = (await badgeDate(page).textContent()) ?? '';
  expect(day1).not.toBe(day0);

  const expectedNext = new Date(`${day0}T00:00:00Z`);
  expectedNext.setUTCDate(expectedNext.getUTCDate() + 1);
  expect(day1).toBe(expectedNext.toISOString().slice(0, 10));
});

test('@auto-web:simulator/lived-term — a second day-advance shows no course-setup modal', async ({
  page,
}) => {
  // `ol-3ux7.64.11` [WBX-9]: every `remountPane()` used to construct a
  // BRAND NEW `OleaPlugin` whose in-memory `courseSetupSeenCodes` started
  // empty, so `CourseSetupModal` reopened for every course-shaped fixture
  // folder after every single control click — `[data-sim-advance]` included.
  // `resetSimulator` legitimately reopens the proposals once (it clears the
  // SAME shared plugin-data blob the seen-set now lives in — the one
  // legitimate reopen this bead's brief names) and its own guarded dismiss
  // resolves them; the assertion below is on the mount AFTER that, and the
  // one after THAT, so neither can be passing only because the reset's own
  // dismiss loop happened to still be draining.
  await gotoSimulator(page);
  await resetSimulator(page);

  await advanceDays(page, 1);
  await advanceDays(page, 1);

  // `[data-wb-modal-open]` is set on `[data-wb-modal-host]` in the TOP
  // document, never inside `[data-wb-surface]` (`obsidian-shim`'s
  // `Modal.open()` doc) — matching `dismissCourseSetupModals`' own query.
  await expect(page.locator('[data-wb-modal-open]')).toHaveCount(0);
});
