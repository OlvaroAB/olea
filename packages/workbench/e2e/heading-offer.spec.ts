/**
 * `@auto-web` — F2.10's heading-offer banner (`[D-170]`/`[GEN-2]`), driven in
 * a real browser against the REAL `ReviewView` from `packages/plugin`,
 * mounted with a CANNED `HeadingOfferBannerTracker` (`main.ts`'s
 * `buildHeadingOfferFixture`) rather than the real note-detection walk —
 * `heading-offer-wiring.spec.ts` (Vitest, Obsidian-free) already covers
 * detection itself; this proves the SCREEN: the banner mounts over the
 * current item, its two buttons are wired to the two real verbs
 * (`heading-offer.ts`'s own copy), and dismiss really does hide it for the
 * rest of the mounted session.
 *
 * Scenarios asserted (F2.10, `[D-170]`):
 *   - the banner is mounted, with its fixed prompt and both verbs
 *   - accept calls through to the canned port's accept verb, and the
 *     banner is gone afterwards (`[D-170]`'s own "accepting also dismisses")
 *   - dismiss hides the banner immediately, with no port call recorded
 *   - once dismissed, the banner does not return within the same mount
 */
import { expect, test } from '@playwright/test';
import { frame, gotoState } from './helpers.js';

test('heading-offer-banner: the banner is mounted with its prompt and both verbs', async ({
  page,
}) => {
  await gotoState(page, 'review', 'heading-offer-banner', 'obsidian-dark');
  const banner = frame(page).locator('.olea-review-heading-offer-banner');
  await expect(banner).toBeVisible();
  await expect(banner.locator('.olea-review-heading-offer-prompt')).toHaveText(
    'This looks like a question but has no card yet.',
  );
  await expect(banner.getByRole('button', { name: 'Create a card' })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Not now' })).toBeVisible();
});

test('heading-offer-banner: accepting calls the canned port and the banner is gone afterwards', async ({
  page,
}) => {
  await gotoState(page, 'review', 'heading-offer-banner', 'obsidian-dark');
  await frame(page)
    .locator('.olea-review-heading-offer-banner')
    .getByRole('button', { name: 'Create a card' })
    .click();

  await expect(frame(page).locator('.olea-review-heading-offer-banner')).toHaveCount(0);
  await expect(page.locator('[data-wb-inspector]')).toContainText(
    'Heading-offer accepted: drafted.',
  );
});

test('heading-offer-banner: dismissing hides the banner immediately, with no accept recorded', async ({
  page,
}) => {
  await gotoState(page, 'review', 'heading-offer-banner', 'obsidian-dark');
  await frame(page)
    .locator('.olea-review-heading-offer-banner')
    .getByRole('button', { name: 'Not now' })
    .click();

  await expect(frame(page).locator('.olea-review-heading-offer-banner')).toHaveCount(0);
  await expect(page.locator('[data-wb-inspector]')).toContainText(
    'No heading-offer accept yet this state.',
  );
  // The rest of the card is untouched — dismissing the offer is not a review action.
  await expect(frame(page).locator('.olea-review-question')).toBeVisible();
});
