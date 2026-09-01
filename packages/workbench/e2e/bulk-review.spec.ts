/**
 * `@auto-web` — F3.3's bulk-review triage path (`ol-jie3`,
 * `olea-service/features/F3-learn-from-anything.md`), driven in a real
 * browser against the REAL `BulkReviewView`/`BulkReviewController` and the
 * REAL `DraftAcceptPort`/`DraftCacheStore` from `packages/plugin` — over an
 * in-memory synthetic vault this surface seeds itself
 * (`bulk-review-scenarios.ts`'s module doc). Every accept/edit/reject click
 * below is a genuine vault write and a genuine verdict-record append, the
 * same "second density, same verdict machinery" claim F3.3's own scenario
 * makes.
 *
 * Reachability: this mounts the real `BulkReviewView`, but through a
 * workbench-built controller wiring, not `packages/plugin/src/main.ts`'s own
 * production assembly of `BulkReviewControllerProvider` — so, like
 * `session.spec.ts`'s build-session click-through, this proves the SCREEN
 * and its VERDICT MACHINERY, not the production wiring path (`[D-072]`'s
 * caller-naming clause is a separate, already-shipped concern for `ol-jie3`
 * itself, not this bead).
 */
import { expect, type Page, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

function groups(page: Page) {
  return frame(page).locator('.olea-bulk-review-group');
}

function itemsIn(group: import('@playwright/test').Locator) {
  return group.locator('.olea-bulk-review-item');
}

test('bulk-review-two-groups: drafts group by source document, oldest first', async ({ page }) => {
  await gotoState(page, 'bulk-review', 'bulk-review-two-groups', 'obsidian-dark');
  await expect(groups(page)).toHaveCount(2);

  const first = groups(page).nth(0);
  await expect(first.locator('.olea-bulk-review-group-course')).toHaveText('syn:course:vantrel');
  await expect(itemsIn(first)).toHaveCount(2);

  const second = groups(page).nth(1);
  await expect(second.locator('.olea-bulk-review-group-course')).toHaveText('syn:course:melspar');
  await expect(itemsIn(second)).toHaveCount(1);
});

test('bulk-review-two-groups: Accept on one item resolves only that item (same verdict machinery as first presentation)', async ({
  page,
}) => {
  await gotoState(page, 'bulk-review', 'bulk-review-two-groups', 'obsidian-dark');
  const first = groups(page).nth(0);
  await expect(itemsIn(first)).toHaveCount(2);

  await itemsIn(first).nth(0).getByRole('button', { name: 'Accept' }).click();

  // Removed from the list; the sibling in the same group is untouched.
  await expect(itemsIn(first)).toHaveCount(1);
  await expect(groups(page)).toHaveCount(2);
});

test('bulk-review-two-groups: Reject prunes without touching the sibling group', async ({
  page,
}) => {
  await gotoState(page, 'bulk-review', 'bulk-review-two-groups', 'obsidian-dark');
  const second = groups(page).nth(1);
  await itemsIn(second).nth(0).getByRole('button', { name: 'Reject' }).click();

  // The whole group disappears once its only item resolves.
  await expect(groups(page)).toHaveCount(1);
});

test('bulk-review-two-groups: "Edit before saving" hand-off is recorded (F3.3\'s edit-before-saving path)', async ({
  page,
}) => {
  await gotoState(page, 'bulk-review', 'bulk-review-two-groups', 'obsidian-dark');
  const first = groups(page).nth(0);
  await itemsIn(first).nth(0).getByRole('button', { name: 'Edit before saving' }).click();

  await expect(itemsIn(first)).toHaveCount(1);
  await expect(page.locator('[data-wb-inspector]')).toContainText('Edit hand-off recorded for');
});

test("bulk-review-two-groups: Accept remainder resolves every still-pending item in one group (ol-p3t07a's batch action)", async ({
  page,
}) => {
  await gotoState(page, 'bulk-review', 'bulk-review-two-groups', 'obsidian-dark');
  const first = groups(page).nth(0);
  await expect(itemsIn(first)).toHaveCount(2);

  await first.getByRole('button', { name: /Accept remainder/ }).click();

  // The whole group is gone; the other group, untouched.
  await expect(groups(page)).toHaveCount(1);
});

test('bulk-review-empty: the honest empty state, never a bare unexplained blank list', async ({
  page,
}) => {
  await gotoState(page, 'bulk-review', 'bulk-review-empty', 'obsidian-dark');
  await expect(groups(page)).toHaveCount(0);
  await expect(frame(page).locator('.olea-bulk-review-empty')).toContainText(
    'No drafts waiting for review.',
  );
});
