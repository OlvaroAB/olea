/**
 * F9.S15 — journey "review-qa": reveals a non-MCQ Q&A/cloze card inside review, on whichever
 * world serves one within a bounded number of week-advances. WBX-22's second kit-versus-build
 * judgement found every sampled world MCQ-only at week 0; this journey widens the search rather
 * than fabricating a card (`ol-43ur` [WBX-27]).
 *
 * Bounded at `MAX_WEEKS` week-advances (`window.__oleaSimulatorDriver.advanceOneDay()`, via
 * `tour-helpers.ts`'s `advanceWeeksViaDriver` — the same driver primitive `week2-review.spec.ts`
 * already uses) — a real defect (no world ever serving one within the bound) fails loudly via
 * the honest "not-found" step rather than hanging the suite or fabricating a state.
 *
 * `test.setTimeout` below, not the project default: the real world's day-advance measured
 * ~6.5-7s per day (F9.S14, `ol-8jnh` [WBX-24], `docs/dev/...` — `helpers.ts`'s own
 * `REMOUNT_TIMEOUT_MS` doc), so `MAX_WEEKS` week-advances alone can run past the 90s
 * `SIMULATOR_TIMEOUT_MS` project default well before this journey's own review-opening and
 * card-reveal work even starts — measured hitting that wall on `--world real`.
 */
import { expect, type Page, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import { advanceWeeksViaDriver, ribbonViewTypes } from '../tour-helpers.js';
import {
  captureJourneyStep,
  firstRatableScreenKind,
  frame,
  PERSONA,
  revealCard,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'review-qa';
const MAX_WEEKS = 4;

/** The same ribbon-click-then-wait gesture `today-review.spec.ts` uses to open Review — restated here rather than imported (`journeys-helpers.ts`'s own "READ-ONLY IMPORTS" doc: nothing here edits `today-review.spec.ts`, and factoring a shared export into it is out of this lane's scope). */
async function openReview(page: Page): Promise<void> {
  const viewTypes = await ribbonViewTypes(page);
  if (!viewTypes.includes('olea-review')) {
    throw new Error("review-qa journey: the ribbon does not list a registered 'olea-review' view.");
  }
  await frame(page).locator('[data-wb-sim-ribbon-view="olea-review"]').click();
  await frame(page)
    .locator(
      '[data-wb-pane][data-wb-active-view-type="olea-review"], [data-wb-right-pane][data-wb-active-view-type="olea-review"]',
    )
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 });
}

test(`@auto-web:simulator/journeys/review-qa ${WORLD}/${PERSONA} — reveal a non-MCQ Q&A/cloze card, searching forward by week if week 0 is MCQ-only`, async ({
  page,
}, testInfo) => {
  // Generous over even the real world's own measured worst case (MAX_WEEKS * 7 day-advances at
  // ~7s each, plus MAX_WEEKS+1 review-opens and one reveal) — see this file's own module doc.
  testInfo.setTimeout(300_000);
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  for (let week = 0; week <= MAX_WEEKS; week += 1) {
    if (week > 0) {
      // eslint-disable-next-line no-await-in-loop -- each week's remount must settle before the next is requested.
      await advanceWeeksViaDriver(page, 1);
    }
    // eslint-disable-next-line no-await-in-loop -- see above.
    await openReview(page);
    // eslint-disable-next-line no-await-in-loop -- see above.
    const kind = await firstRatableScreenKind(page);
    if (kind === 'card') {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await revealCard(page);
      // eslint-disable-next-line no-await-in-loop -- see above.
      await captureJourneyStep(page, JOURNEY, week, 'revealed');
      return;
    }
  }

  // Honest, not fabricated: no week within the bound served a non-MCQ card on this world —
  // recorded via a "not-found" golden (never a real-vault detail) so the sheet shows which
  // world this is true of, rather than silently skipping the journey.
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
  await captureJourneyStep(page, JOURNEY, MAX_WEEKS, 'not-found');
});
