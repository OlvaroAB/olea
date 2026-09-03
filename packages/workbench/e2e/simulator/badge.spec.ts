/**
 * F9.S6 — "Provenance is always on screen" (`features/F9-simulator.md`,
 * `@auto-web:simulator/badge`). The public repo's simulator only ever
 * constructs a `'FIXTURE'` world (`provenance-badge.ts`'s own module doc) —
 * `REAL (private)` / `PERSONA <id>` are exercised by the private build
 * (WBX-3/6), never here (INV-3).
 */
import { expect, test } from '@playwright/test';
import { frame } from '../helpers.js';
import { badgeDate, badgeTransport, badgeWorld, gotoSimulator, resetSimulator } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

test('@auto-web:simulator/badge — the badge names the loaded world, the simulated date and the transport', async ({
  page,
}) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  await expect(badgeWorld(page)).toHaveText('FIXTURE');
  await expect(badgeDate(page)).toHaveText(/^\d{4}-\d{2}-\d{2}$/);
  await expect(badgeTransport(page)).toHaveText('replay');
});

test('@auto-web:simulator/badge — the badge cannot be dismissed', async ({ page }) => {
  await gotoSimulator(page);
  await resetSimulator(page);

  const badge = frame(page).locator('[data-wb-sim-badge]');
  await expect(badge).toBeVisible();
  // No close/dismiss affordance anywhere inside it.
  await expect(badge.locator('button')).toHaveCount(0);

  // Surviving a full lived-term action (a day-advance re-mount) is the
  // actual claim — "always on screen" through the pane it sits beside being
  // torn down and rebuilt, not just present once at first paint.
  await frame(page).locator('[data-sim-advance]').click();
  await expect(badge).toBeVisible();
});
