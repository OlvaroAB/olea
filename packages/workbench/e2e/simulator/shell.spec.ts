/**
 * F9.S3/F9.S6 — the Obsidian-shaped shell (`ol-3ux7.64.14` [WBX-12],
 * `features/F9-simulator.md`, `@auto-web:simulator/shell`,
 * `docs/dev/simulator-design.md`).
 *
 * David, opening the deployed simulator: the route showed the public
 * workbench's own dev chrome (left rail prose, a mode list, a bottom
 * scenario caption) around a bare, unstyled Today panel. This file asserts
 * the replacement: no workbench chrome on this route, a ribbon that lists
 * the plugin's own registered views, Home landing in the main pane with
 * Today revealed in the right sidebar at the same time, the badge reading a
 * fetched world descriptor rather than a hard-coded label, and the
 * simulated clock starting at that descriptor's `asOf` rather than real
 * wall-clock today.
 */
import { expect, test } from '@playwright/test';
import { frame } from '../helpers.js';
import { badgeDate, badgeWorld, gotoSimulator, resetSimulator } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

/**
 * The plugin's own registered view types, as of this writing (`grep -rn
 * "^export const VIEW_TYPE_OLEA" packages/plugin/src`). A DELIBERATE, small
 * hand list at the TEST level only — the production ribbon itself never has
 * one (`obsidian-shim/index.ts`'s `Workspace.registeredViewTypes`'s own
 * doc). A ninth view registered by the plugin without a matching entry here
 * fails this test loudly, which is the point: it is evidence the mechanism
 * really does track the registry rather than a number nobody re-checks.
 */
const KNOWN_VIEW_TYPES = [
  'olea-review',
  'olea-today',
  'olea-gap',
  'olea-bulk-review',
  'olea-home',
  'olea-grove',
  'olea-registry',
  'olea-retrospective',
  'olea-session-builder',
] as const;

test('@auto-web:simulator/shell — no workbench prose or mode list on this route', async ({
  page,
}) => {
  await gotoSimulator(page);
  await expect(page.locator('.wb-sidebar')).toBeHidden();
  await expect(page.locator('[data-wb-inspector]')).toBeHidden();
});

test("@auto-web:simulator/shell — the ribbon lists exactly the plugin's registered views, plus a palette button", async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const ribbon = frame(page).locator('[data-wb-sim-ribbon]');
  await expect(ribbon).toBeVisible();

  const viewButtons = ribbon.locator('[data-wb-sim-ribbon-view]');
  await expect(viewButtons).toHaveCount(KNOWN_VIEW_TYPES.length);
  for (const viewType of KNOWN_VIEW_TYPES) {
    await expect(ribbon.locator(`[data-wb-sim-ribbon-view="${viewType}"]`)).toHaveCount(1);
  }

  // The real palette toggle, relocated here — not a second, invented button.
  await expect(ribbon.locator('[data-wb-palette-toggle]')).toHaveCount(1);
});

test('@auto-web:simulator/shell — Home lands in the main pane and Today reveals in the right sidebar, together', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  await expect(frame(page).locator('[data-wb-pane]')).toHaveAttribute(
    'data-wb-active-view-type',
    'olea-home',
  );
  await expect(frame(page).locator('[data-wb-right-pane]')).toHaveAttribute(
    'data-wb-active-view-type',
    'olea-today',
  );
  // Both on screen at once — not a tab switch away from one to reach the other.
  await expect(frame(page).locator('[data-wb-pane]')).toBeVisible();
  await expect(frame(page).locator('[data-wb-right-pane]')).toBeVisible();
});

test('@auto-web:simulator/shell — the ribbon opens/reveals a view without duplicating an already-open one', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  // Today already has a leaf in the right sidebar (the default landing) —
  // clicking its ribbon button must reveal that SAME leaf, not open a
  // second one in the main pane displacing Home.
  await frame(page).locator('[data-wb-sim-ribbon-view="olea-today"]').click();
  await expect(frame(page).locator('[data-wb-pane]')).toHaveAttribute(
    'data-wb-active-view-type',
    'olea-home',
  );
  await expect(frame(page).locator('[data-wb-right-pane]')).toHaveAttribute(
    'data-wb-active-view-type',
    'olea-today',
  );

  // A view with no leaf yet (e.g. the registry) opens into the main pane.
  await frame(page).locator('[data-wb-sim-ribbon-view="olea-registry"]').click();
  await expect(frame(page).locator('[data-wb-pane]')).toHaveAttribute(
    'data-wb-active-view-type',
    'olea-registry',
  );
});

test('@auto-web:simulator/shell — the badge reads the fetched world descriptor, not a hard-coded label', async ({
  page,
}) => {
  await gotoSimulator(page);
  const response = await page.request.get('/simulator-world.json');
  expect(response.ok()).toBe(true);
  const descriptor = (await response.json()) as { label: string; asOf: string };

  await resetSimulator(page);
  await expect(badgeWorld(page)).toHaveText(descriptor.label);
});

test("@auto-web:simulator/shell — the simulated clock starts at the world descriptor's asOf on first mount, never real today", async ({
  page,
}) => {
  const response = await page.request.get('/simulator-world.json');
  const descriptor = (await response.json()) as { asOf: string };

  // A fresh Playwright context per test means a fresh IndexedDB — no
  // `resetSimulator` here on purpose: this is the "first open, no persisted
  // offset" case the scenario names, not the reset one (`reset` also lands
  // on `asOf`, but through a different code path — see `controller.ts`'s
  // `reset()`).
  await gotoSimulator(page);
  await expect(badgeDate(page)).toHaveText(descriptor.asOf);
});
