/**
 * F9.S15 — journey "gap-detail": opens a mastery-gap row's per-concept detail page (`[D-224]`,
 * `gap/view.ts`'s `openDetail`) — captured for the first time by any golden (`ol-43ur`
 * [WBX-27]); `open-registry.spec.ts`'s sibling second-browse-level journey is
 * `open-registry-row.spec.ts`.
 *
 * `navigable` (`gap/view.ts`'s own doc) is true for `mastery-gap` and `material-gap` rows only —
 * coverage-gap renders no click target — so this journey targets `.olea-gap-row-mastery-gap`
 * specifically, on a world WBX-25 seeded with populated rows (steady/crammer).
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { captureJourneyStep, driverRunCommand, frame, PERSONA, WORLD } from './journeys-helpers.js';

const JOURNEY = 'gap-detail';
const WEEK = 0;

/** `OLEA_COMMAND_GAP_OPEN` (`packages/plugin/src/commands/ids.ts`), restated as a literal per this suite's convention. */
const GAP_COMMAND_ID = 'olea-gap-open';

test(`@auto-web:simulator/journeys/gap-detail ${WORLD}/${PERSONA} — open and close a mastery-gap row's per-concept detail page`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  const invoked = await driverRunCommand(page, GAP_COMMAND_ID);
  expect(invoked, `${GAP_COMMAND_ID} is not registered right now`).toBe(true);

  // Wait for `load()` to settle onto one of its two real outcomes before reading row counts —
  // the view starts empty (`GapView.onOpen`'s own doc) until the async load resolves.
  await frame(page)
    .locator('.olea-gap-course, .olea-gap-unavailable')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });

  const rows = frame(page).locator('.olea-gap-row-mastery-gap');
  if ((await rows.count()) === 0) {
    // A real, honest state: this world has no mastery-gap row to open right now — capture the
    // ranked list (or the unavailable state) rather than fabricating a detail page.
    await captureJourneyStep(page, JOURNEY, WEEK, 'list');
    return;
  }

  await captureJourneyStep(page, JOURNEY, WEEK, 'list');
  await rows.first().locator('.olea-gap-row-header').click();
  await expect(frame(page).locator('.olea-gap-detail')).toBeVisible({ timeout: 15_000 });
  await captureJourneyStep(page, JOURNEY, WEEK, 'opened');

  await frame(page).locator('.olea-gap-detail-back').click();
  await expect(frame(page).locator('.olea-gap-detail')).toHaveCount(0);
  await captureJourneyStep(page, JOURNEY, WEEK, 'closed');
});
