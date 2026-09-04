/**
 * F9.S15 — journey "retrospective-offer": opens the retrospective offer from Home (F8.8, C7.8)
 * and reads whatever real state the retrospective view reaches, without accepting anything —
 * the first golden of a populated reading, if the world has one (`ol-43ur` [WBX-27]).
 *
 * `home/view.ts`'s per-course `retrospective-offer` quiet line renders its own real "Open"
 * button (`OPEN_RETROSPECTIVE_ACTION`, `.olea-home-quiet-actions`) calling
 * `deps.openRetrospective()` — the same click a tap on Home would make; this journey never
 * invents a shortcut, and it never clicks "Keep this scope" or types into the honesty-clamp
 * input, so nothing is ever accepted.
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import {
  captureJourneyStep,
  frame,
  PERSONA,
  WORLD,
  waitForActiveView,
} from './journeys-helpers.js';

const JOURNEY = 'retrospective-offer';
const WEEK = 0;

/** `home/copy.ts`'s `OPEN_RETROSPECTIVE_ACTION`, restated as a literal per this suite's convention. */
const OPEN_RETROSPECTIVE_ACTION = 'Open';

test(`@auto-web:simulator/journeys/retrospective-offer ${WORLD}/${PERSONA} — open the retrospective offer from Home and read it without accepting`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  // `.olea-home-quiet-actions` exists ONLY for a `retrospective-offer` quiet line
  // (`home/view.ts`'s `renderQuiet`: `if (quiet.kind !== 'retrospective-offer') return;`) — a
  // more precise target than filtering every quiet line by its button text.
  const offerActions = frame(page).locator('.olea-home-quiet-actions').first();
  if ((await offerActions.count()) === 0) {
    // A real, honest state: this world's Home renders no retrospective-offer quiet line right
    // now (C7.8's own offer conditions did not fire) — nothing to open.
    await captureJourneyStep(page, JOURNEY, WEEK, 'no-offer');
    return;
  }

  await offerActions.getByRole('button', { name: OPEN_RETROSPECTIVE_ACTION, exact: true }).click();
  await waitForActiveView(page, 'olea-retrospective');
  await expect(page.locator('body[data-wb-error]')).toHaveCount(0);
  await captureJourneyStep(page, JOURNEY, WEEK, 'opened');
});
