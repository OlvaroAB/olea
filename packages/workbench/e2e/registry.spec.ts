/**
 * `@auto-web` — F8.4's concept-and-instrument registry (`olea-service/features/F8-concepts-scope.md`,
 * `[D-171]` source provenance), driven in a real browser against the REAL
 * `RegistryView` from `packages/plugin`, fed by the REAL `buildRegistryModel`
 * (`olea-core`) over fixture records (`registry-scenarios.ts`'s module doc).
 *
 * Reachability: proves the SCREEN and its rename/withdraw/restore/open-source
 * machinery against the real projection, not `packages/plugin/src/main.ts`'s
 * own production `createLocalRegistryProvider` vault-walk wiring — same
 * posture `bulk-review.spec.ts`'s own doc states for its surface.
 *
 * Scenarios asserted (F8.4, `[D-171]`, F8.5):
 *   - browse: every concept lists with its course associations and instrument mix
 *   - Sources list per concept, and per instrument, with an Open source action
 *   - rename mutates the displayed name
 *   - prune withdraws, never deletes — no "Delete" string anywhere on this surface
 *   - the honest empty state
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

function rows(page: Page) {
  return frame(page).locator('.olea-registry-row');
}

test('registry-populated: browse lists every concept with course associations and instrument mix', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-populated', 'obsidian-dark');
  await expect(rows(page)).toHaveCount(2);

  const first = rows(page).nth(0);
  await expect(first.locator('h3')).toHaveText('syn:concept:alpha');
  await expect(first.locator('.olea-registry-courses')).toContainText('syn:course:vantrel');
  await expect(first.locator('.olea-registry-instruments li')).toHaveCount(1);
});

test('registry-populated: Sources list is shown per concept, with Open source per instrument', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-populated', 'obsidian-dark');
  const first = rows(page).nth(0);

  // The concept's own Sources section (`[D-171]`) lists both its note paths.
  const conceptSources = first.locator('.olea-registry-source-locations');
  await expect(conceptSources.locator('h4')).toHaveText('Sources');
  await expect(conceptSources.locator('li')).toHaveCount(2);

  // The instrument's own Open source action.
  const instrumentRow = first.locator('.olea-registry-instrument-row').first();
  await instrumentRow.getByRole('button', { name: 'Open source' }).click();
  await expect(page.locator('[data-wb-inspector]')).toContainText('Source location opened');
});

test('registry-populated: editing an instrument hands off, rather than opening an in-plugin editor', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-populated', 'obsidian-dark');
  const first = rows(page).nth(0);
  await first.getByRole('button', { name: 'Edit in Obsidian' }).click();
  await expect(page.locator('[data-wb-inspector]')).toContainText('Edit hand-off recorded');
});

test('registry-populated: renaming a concept changes the displayed name', async ({ page }) => {
  await gotoState(page, 'registry', 'registry-populated', 'obsidian-dark');
  const first = rows(page).nth(0);
  const input = first.locator('.olea-registry-rename-input');
  await input.fill('syn:concept:alpha-renamed');
  await first.getByRole('button', { name: 'Rename' }).click();

  await expect(rows(page).nth(0).locator('h3')).toHaveText('syn:concept:alpha-renamed');
});

test('registry-withdrawn-shown: withdrawn concept is hidden by default and reappears under the toggle — never deleted', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-withdrawn-shown', 'obsidian-dark');

  // Hidden by default: only the non-withdrawn concept shows.
  await expect(rows(page)).toHaveCount(1);

  await frame(page).locator('.olea-registry-toggle-row input[type="checkbox"]').check();
  await expect(rows(page)).toHaveCount(2);

  const withdrawnRow = rows(page).filter({ hasText: 'syn:concept:beta' });
  await expect(withdrawnRow.locator('.olea-registry-withdrawn-badge')).toHaveText('Withdrawn');
  await expect(withdrawnRow.getByRole('button', { name: 'Restore this concept' })).toBeVisible();
});

test('registry-populated: withdrawing a concept and restoring it round-trips through the same row', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-populated', 'obsidian-dark');
  const first = rows(page).nth(0);
  await first.getByRole('button', { name: 'Withdraw this concept' }).click();

  await frame(page).locator('.olea-registry-toggle-row input[type="checkbox"]').check();
  await expect(rows(page)).toHaveCount(2);
  const withdrawn = rows(page).filter({ hasText: 'syn:concept:alpha' });
  await expect(withdrawn.locator('.olea-registry-withdrawn-badge')).toBeVisible();

  await withdrawn.getByRole('button', { name: 'Restore this concept' }).click();
  await expect(withdrawn.locator('.olea-registry-withdrawn-badge')).toHaveCount(0);
});

test('registry-empty: the honest empty state, never a bare unexplained blank grid', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-empty', 'obsidian-dark');
  await expect(rows(page)).toHaveCount(0);
  await expect(frame(page).locator('.olea-registry-empty')).toContainText(
    'Olea has not found any concepts',
  );
});

test('registry: no "Delete" AFFORDANCE (button/action) appears anywhere on this surface — F8.5\'s hard clamp', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-withdrawn-shown', 'obsidian-dark');
  await frame(page).locator('.olea-registry-toggle-row input[type="checkbox"]').check();
  // The copy DOES say "Nothing is deleted" (reassurance prose) — the clamp bans a Delete
  // AFFORDANCE, not the word in prose explaining that nothing is deleted. So this checks every
  // clickable control's own label, never the whole panel's text.
  const controlLabels = await frame(page)
    .locator('.olea-registry-root button, .olea-registry-root [role="button"]')
    .allInnerTexts();
  for (const label of controlLabels) expect(label).not.toMatch(/delete/i);
});
