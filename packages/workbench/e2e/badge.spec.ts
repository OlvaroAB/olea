/**
 * `@auto-web` — TB-0's cheap second half (`ol-opmb.6`): every workbench panel
 * that renders a number derived from a synthetic run carries a small
 * "synthetic — provisional" badge (`../src/badge.ts`), and a panel that
 * shows only fixture TEXT (no derived number) carries none.
 */
import { expect, test } from '@playwright/test';
import { gotoState } from './helpers.js';

const BADGE_SELECTOR = '[data-wb-synthetic-badge]';

test('oracle-ranked: a panel showing ranked, synthetic-run numbers carries the badge', async ({
  page,
}) => {
  await gotoState(page, 'oracle', 'oracle-ranked', 'obsidian-dark');
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(1);
  await expect(page.locator(BADGE_SELECTOR).first()).toHaveText('synthetic — provisional');
});

test('registry-populated: a panel showing synthetic mastery/vitality numbers carries the badge', async ({
  page,
}) => {
  await gotoState(page, 'registry', 'registry-populated', 'obsidian-dark');
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(1);
});

test('registry-empty: no concept row, no number, no badge', async ({ page }) => {
  await gotoState(page, 'registry', 'registry-empty', 'obsidian-dark');
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(0);
});

test('bulk-review-empty: a text-only honest-empty panel carries no badge', async ({ page }) => {
  await gotoState(page, 'bulk-review', 'bulk-review-empty', 'obsidian-dark');
  await expect(page.locator(BADGE_SELECTOR)).toHaveCount(0);
});
