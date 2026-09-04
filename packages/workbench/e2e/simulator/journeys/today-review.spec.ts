/**
 * F9.S5 — journey "today-review": start today's review and rate through it (F6.1's due
 * summary opens Today; F2.2 is the real four-way review gesture that rates each item).
 * `ol-3ux7.64.18` [WBX-16], `docs/dev/simulator-design.md` §7.
 *
 * Steps captured: open-today, revealed, rated, empty — matching `features/F9-simulator.md`
 * F9.S5's own scenario. `[data-sim-rate]`/`rateNextDue()` is never used (a simulator shortcut,
 * per `journeys-helpers.ts`'s own doc) — every rating is the real reveal-then-click (or
 * click-then-advance, for MCQ) gesture.
 */
import { test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { ribbonViewTypes } from '../tour-helpers.js';
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

const JOURNEY = 'today-review';
const WEEK = 0;

test(`@auto-web:simulator/journeys/today-review ${WORLD}/${PERSONA} — start today's review and rate through it`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // F6.1: the Today panel's due summary — already revealed in the right sidebar on mount (F9.S3).
  await captureJourneyStep(page, JOURNEY, WEEK, 'open-today');

  // Opening Review is the real ribbon gesture the tour itself uses to open a registered view —
  // "start today's review" from the due summary.
  const viewTypes = await ribbonViewTypes(page);
  if (!viewTypes.includes('olea-review')) {
    throw new Error("today-review journey: the ribbon does not list a registered 'olea-review' view.");
  }
  await frame(page).locator('[data-wb-sim-ribbon-view="olea-review"]').click();
  await frame(page)
    .locator('[data-wb-pane][data-wb-active-view-type="olea-review"], [data-wb-right-pane][data-wb-active-view-type="olea-review"]')
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });

  const kind = await firstRatableScreenKind(page);
  if (kind === 'empty' || kind === 'complete') {
    // A real, walkable state (nothing due right now) — capture it honestly rather than fabricating a reveal.
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
