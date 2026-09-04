/**
 * F9.S5 — journey "week2-review": advance a week and review again (F6.1's due set recomputes on
 * the new day; F2.2 is the same real four-way rating gesture `today-review` uses).
 * `ol-3ux7.64.18` [WBX-16].
 *
 * Advances the clock by one week via `window.__oleaSimulatorDriver.advanceOneDay()` ×7 (the same
 * driver method the view tour itself uses for week advancement, `tour-helpers.ts`'s
 * `advanceWeeksViaDriver` — a TIME control, never a stand-in for the rating gesture itself), then
 * repeats `today-review`'s own steps at week 1: open-today, revealed, rated, empty — named
 * `1--journey-week2-review--<step>.png`.
 *
 * **WBX-18 (`ol-qm6u`) / ol-yng7:** against a real-shaped vault, `advanceWeeksViaDriver`'s
 * repeated `advanceOneDay()` remounts used to be able to re-surface `CourseSetupModal` proposals
 * that were already confirmed on an earlier mount (`helpers.ts#dismissCourseSetupModals`'s own
 * doc names the underlying persistence gap `course-setup-bridge.ts` has since closed — a
 * cross-mount repeat is now dismissed by node identity the instant it opens, not by a click-
 * through budget sized to the day-advance count). `dismissCourseSetupModals` still runs again
 * here, at its plain default, as the same small safety margin `gotoSimulator`'s own cold-start
 * call already relies on — never a stand-in for anything the journey itself needs to click
 * through.
 */
import { test } from '@playwright/test';
import { dismissCourseSetupModals, gotoSimulator, resetSimulator } from '../helpers.js';
import { advanceWeeksViaDriver, ribbonViewTypes } from '../tour-helpers.js';
import {
  captureJourneyStep,
  clickRatingGood,
  firstRatableScreenKind,
  frame,
  PERSONA,
  rateRemainingQueue,
  revealCard,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'week2-review';
const WEEK = 1;

test(`@auto-web:simulator/journeys/week2-review ${WORLD}/${PERSONA} — advance a week and review again`, async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);
  await advanceWeeksViaDriver(page, WEEK);
  await dismissCourseSetupModals(page);

  await captureJourneyStep(page, JOURNEY, WEEK, 'open-today');

  const viewTypes = await ribbonViewTypes(page);
  if (!viewTypes.includes('olea-review')) {
    throw new Error(
      "week2-review journey: the ribbon does not list a registered 'olea-review' view.",
    );
  }
  await frame(page).locator('[data-wb-sim-ribbon-view="olea-review"]').click();
  await frame(page)
    .locator(
      '[data-wb-pane][data-wb-active-view-type="olea-review"], [data-wb-right-pane][data-wb-active-view-type="olea-review"]',
    )
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });

  const kind = await firstRatableScreenKind(page);
  if (kind === 'empty' || kind === 'complete') {
    await captureJourneyStep(page, JOURNEY, WEEK, 'revealed');
    await captureJourneyStep(page, JOURNEY, WEEK, 'rated');
    await captureJourneyStep(page, JOURNEY, WEEK, 'empty');
    return;
  }

  if (kind === 'mcq') {
    await frame(page).locator('.olea-review-mcq-option').first().click();
    await captureJourneyStep(page, JOURNEY, WEEK, 'revealed');
    await frame(page).locator('.olea-review-mcq-footer .olea-review-primary-action').click();
  } else {
    await revealCard(page);
    await captureJourneyStep(page, JOURNEY, WEEK, 'revealed');
    await clickRatingGood(page);
  }
  await captureJourneyStep(page, JOURNEY, WEEK, 'rated');

  await rateRemainingQueue(page);
  await captureJourneyStep(page, JOURNEY, WEEK, 'empty');
});
