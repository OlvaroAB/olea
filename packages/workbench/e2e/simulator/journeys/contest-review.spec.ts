/**
 * F9.S5 — journey "contest-review": contest a graded MCQ answer inside a review session
 * (`[D-046]` clause 4, mechanised by `[D-095]`; a contested GRADE quarantines, and the review
 * view renders that effect in place — `review/contest.ts`'s `quarantineBadgeFor`).
 * `ol-l5og.18.7` [STY-0g] top fix 3: before this journey, no golden anywhere captured the
 * review-side grade-contest badge — `contest-today.spec.ts` only ever exercised the Today
 * panel's reading case.
 *
 * Driven through the real MCQ-answer click, then `window.__oleaSimulatorDriver.contest('review')`
 * — the same `.olea-review-contest` click a real tap takes (`controller.ts`'s `driverContest`).
 * `driverContest('review')` fires only from the `mcq-answered` phase (that function's own doc:
 * "review/session.ts contestGrade() only fires in the mcq-answered phase"), so this journey
 * answers an MCQ item first when one is due; a world/week with no MCQ due captures the honest
 * `'unavailable'` outcome (a real walkable state) rather than fabricating one.
 *
 * Steps captured: before, after — same shape as `contest-today.spec.ts`.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { ribbonViewTypes } from '../tour-helpers.js';
import {
  captureJourneyStep,
  driverContest,
  firstRatableScreenKind,
  frame,
  PERSONA,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'contest-review';
const WEEK = 0;

test(`@auto-web:simulator/journeys/contest-review ${WORLD}/${PERSONA} — contest a graded MCQ answer`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  const viewTypes = await ribbonViewTypes(page);
  if (!viewTypes.includes('olea-review')) {
    throw new Error(
      "contest-review journey: the ribbon does not list a registered 'olea-review' view.",
    );
  }
  await frame(page).locator('[data-wb-sim-ribbon-view="olea-review"]').click();
  await frame(page)
    .locator(
      '[data-wb-pane][data-wb-active-view-type="olea-review"], [data-wb-right-pane][data-wb-active-view-type="olea-review"]',
    )
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });

  // Answer the MCQ, if one is due, so the session is in `mcq-answered` — the only phase the
  // grade-contest gesture renders in (see this file's own module doc).
  const kind = await firstRatableScreenKind(page);
  if (kind === 'mcq') {
    await frame(page).locator('.olea-review-mcq-option').first().click();
    await frame(page)
      .locator('.olea-review-mcq-feedback')
      .waitFor({ state: 'visible', timeout: 10_000 });
  }

  await captureJourneyStep(page, JOURNEY, WEEK, 'before');

  // Same "still captures, still fails loudly on a real defect" shape as contest-today.spec.ts —
  // see that file's own comment for the argument.
  let outcome: { outcome: string; reason?: string } | null = null;
  let driverError: string | null = null;
  try {
    outcome = await driverContest(page, 'review');
  } catch (error) {
    driverError = error instanceof Error ? error.message : String(error);
  }
  await captureJourneyStep(page, JOURNEY, WEEK, 'after');
  expect(driverError, 'driverContest threw').toBeNull();
  expect(['recorded', 'unavailable']).toContain(outcome?.outcome);
});
