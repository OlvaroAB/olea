/**
 * `@auto-web` — the Today panel's five states (F6.1, `[P2-T09]`), driven in a
 * real browser against the real `TodayView` and `loadTodayPanel`/
 * `buildTodayPanel`.
 *
 * The last two tests are the important ones: `today-stale` and
 * `today-after-writing` **reproduce** `ol-h3wy` rather than describe it (see
 * the package README). Both write an identical review-log record to the
 * vault after the pane has opened; only `today-after-writing` then calls
 * `view.refresh()`. The inspector's "vault, recomputed now" row re-reads the
 * vault fresh at render time regardless of which branch ran, so for
 * `today-stale` the on-screen count and that fresh read are SUPPOSED to
 * disagree — that disagreement is the bug, not an illustration of it, and
 * this file asserts the disagreement is present exactly where it should be
 * and absent everywhere else.
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

/** The workbench's own fresh-vault-read row, from the top-document inspector. */
async function recomputedRowText(page: Page): Promise<string> {
  const row = page.locator('[data-wb-inspector] .wb-inspector-row', {
    has: page.locator('.wb-inspector-label', { hasText: 'vault, recomputed now' }),
  });
  return ((await row.locator('.wb-inspector-value').textContent()) ?? '').trim();
}

test('today-nothing-due: a real computed zero states itself as a note, not a "0" headline — and the front door stays open (ol-h3wy)', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-nothing-due', 'obsidian-dark');
  // Zero due renders `.olea-today-note`, the same element `due === null`
  // uses — the two are told apart below by whether "Start review" survives.
  await expect(frame(page).locator('.olea-today-note')).toBeVisible();
  await expect(frame(page).locator('.olea-today-count')).toHaveCount(0);
  // `showsStartReviewAction`: the front door does not disappear just because
  // nothing is waiting behind it (this state's own note in today-scenarios.ts).
  await expect(frame(page).locator('.olea-today-primary-action')).toBeVisible();
});

test('today-unavailable: an unenumerable vault says it cannot count, never a silent zero — and offers no session to start', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-unavailable', 'obsidian-dark');
  await expect(frame(page).locator('.olea-today-note')).toBeVisible();
  await expect(frame(page).locator('.olea-today-count')).toHaveCount(0);
  // Unlike nothing-due, `showsStartReviewAction` does NOT extend to `due ===
  // null` — there is nothing composed to start a session from.
  await expect(frame(page).locator('.olea-today-primary-action')).toHaveCount(0);
});

test('today-due: the panel counts a real composed session, not a stand-in', async ({ page }) => {
  await gotoState(page, 'today', 'today-due', 'obsidian-dark');
  const countText = await frame(page).locator('.olea-today-count').textContent();
  expect(Number(countText)).toBeGreaterThan(0);
});

test('today-after-writing: view.refresh() was called, so the screen agrees with a fresh vault read (ol-h3wy, fixed path)', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-after-writing', 'obsidian-dark');
  const onScreen = (await frame(page).locator('.olea-today-count').textContent())?.trim();
  const recomputed = await recomputedRowText(page);
  expect(
    recomputed.startsWith(`${onScreen} due`),
    `expected agreement — on-screen "${onScreen}", inspector recomputed "${recomputed}"`,
  ).toBe(true);
});

test('today-stale: view.refresh() was NOT called, so the screen visibly disagrees with a fresh vault read — this is ol-h3wy reproduced, not described', async ({
  page,
}) => {
  await gotoState(page, 'today', 'today-stale', 'obsidian-dark');
  const onScreen = (await frame(page).locator('.olea-today-count').textContent())?.trim();
  const recomputed = await recomputedRowText(page);
  expect(
    recomputed.startsWith(`${onScreen} due`),
    `expected a disagreement (that is the point of this state) — on-screen "${onScreen}", ` +
      `inspector recomputed "${recomputed}"`,
  ).toBe(false);
});
