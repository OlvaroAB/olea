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
 *
 * F8.4b (`[D-175]`) and F4.2a (`[D-176]`), added this tranche (`ol-z6x2` [WB-2]):
 *   - an instrument's explain-back history: two attempts oldest-first, the current one
 *     marked "under re-review" while `[D-095]`-quarantined; a sibling instrument with no
 *     history renders no section at all
 *   - the standing note-offer: an eligible tier-2 concept shows both verbs; a tier-1
 *     concept with the same instrument/review/ranking evidence never shows it; accept
 *     calls through to `RegistryViewDeps.acceptNoteOffer`, decline removes it locally
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

// ---------------------------------------------------------------------------
// F8.4b (`[D-175]`) — per-instrument explain-back history.
// ---------------------------------------------------------------------------

test('registry-explain-back-history: an instrument with two graded attempts shows both, oldest first, the current one marked under re-review', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-explain-back-history', 'obsidian-dark');
  const withHistory = frame(page).locator(
    '[data-olea-instrument-id="qa:syn:concept-key:brivane:2"]',
  );
  const historyRows = withHistory.locator('.olea-registry-explain-back-history li');
  await expect(historyRows).toHaveCount(2);

  // Oldest first: the earlier, shallower attempt is never marked contested.
  await expect(historyRows.nth(0)).toContainText('with one point made');
  await expect(historyRows.nth(0)).not.toContainText('under re-review');

  // The later, current attempt is presently `[D-095]`-quarantined.
  await expect(historyRows.nth(1)).toContainText('with the points tied together');
  await expect(historyRows.nth(1)).toContainText('under re-review');
  await expect(withHistory.locator('.olea-registry-explain-back-contested')).toHaveCount(1);
});

test('registry-explain-back-history: an instrument that has never been explained back shows no history section at all', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-explain-back-history', 'obsidian-dark');
  const bare = frame(page).locator('[data-olea-instrument-id="qa:syn:concept-key:brivane:1"]');
  await expect(bare.locator('.olea-registry-explain-back-history')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// F4.2a (`[D-176]`) — the standing note-offer affordance, gated by tier.
// ---------------------------------------------------------------------------

test('registry-note-offer: an eligible tier-2 concept shows the offer with both verbs', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-note-offer', 'obsidian-dark');
  const eligible = rows(page).filter({ hasText: 'syn:concept:worvenn' });
  const offer = eligible.locator('.olea-registry-note-offer');
  await expect(offer).toContainText('This concept is carrying real weight');
  await expect(offer.getByRole('button', { name: 'Create the note' })).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Not now' })).toBeVisible();
});

test('registry-note-offer: a tier-1 concept never shows the offer, even given the same instrument/review/ranking evidence', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-note-offer', 'obsidian-dark');
  const tierOne = rows(page).filter({ hasText: 'syn:concept:caprist' });
  await expect(tierOne.locator('.olea-registry-note-offer')).toHaveCount(0);
});

test('registry-note-offer: accepting the offer calls through to RegistryViewDeps.acceptNoteOffer', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-note-offer', 'obsidian-dark');
  const eligible = rows(page).filter({ hasText: 'syn:concept:worvenn' });
  await eligible
    .locator('.olea-registry-note-offer')
    .getByRole('button', { name: 'Create the note' })
    .click();
  await expect(page.locator('[data-wb-inspector]')).toContainText(
    'Note-offer accepted for: syn:concept:worvenn',
  );
});

test('registry-note-offer: declining removes the offer locally, and calls no port at all', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-note-offer', 'obsidian-dark');
  const eligible = rows(page).filter({ hasText: 'syn:concept:worvenn' });
  const offer = eligible.locator('.olea-registry-note-offer');
  await offer.getByRole('button', { name: 'Not now' }).click();
  await expect(offer).toHaveCount(0);
  // The row itself, and its evidence, are untouched — only the offer section is gone.
  await expect(eligible.locator('h3')).toHaveText('syn:concept:worvenn');
  await expect(page.locator('[data-wb-inspector]')).toContainText(
    'No note-offer accept yet this state.',
  );
});
