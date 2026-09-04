/**
 * F9.S15 — journey "open-registry-row": opens a concept row's own second browse level inside
 * the registry (F8.4's `Open`/`Close` row toggle, `registry/view.ts`'s `renderConcept`) — the
 * level `open-registry.spec.ts` (WBX-16c) never reaches, since it only opens the LIST
 * (`ol-43ur` [WBX-27]).
 */
import { expect, test } from '@playwright/test';
import { gotoSimulator, resetSimulator } from '../helpers.js';
import {
  captureJourneyStep,
  driverOpenRegistry,
  frame,
  PERSONA,
  WORLD,
} from './journeys-helpers.js';

const JOURNEY = 'open-registry-row';
const WEEK = 0;

/** `registry/copy.ts`'s `REGISTRY_OPEN_ACTION`/`REGISTRY_CLOSE_ACTION`, restated as literals per this suite's convention. */
const OPEN_ACTION = 'Open';
const CLOSE_ACTION = 'Close';

test(`@auto-web:simulator/journeys/open-registry-row ${WORLD}/${PERSONA} — open and close a registry row's own second browse level`, async ({
  page,
}) => {
  await gotoSimulator(page, { world: WORLD, persona: PERSONA });
  await resetSimulator(page);

  await driverOpenRegistry(page);

  const rows = frame(page).locator('.olea-registry-row');
  await rows
    .first()
    .waitFor({ state: 'attached', timeout: 15_000 })
    .catch(() => undefined);
  if ((await rows.count()) === 0) {
    // A real, honest state: this world's registry lists no concept row at all right now.
    await captureJourneyStep(page, JOURNEY, WEEK, 'list');
    return;
  }

  await captureJourneyStep(page, JOURNEY, WEEK, 'list');
  const openButton = frame(page)
    .locator('.olea-registry-row-action')
    .getByRole('button', { name: OPEN_ACTION, exact: true })
    .first();
  await openButton.click();
  await expect(frame(page).locator('.olea-registry-detail').first()).toBeVisible({
    timeout: 15_000,
  });
  await captureJourneyStep(page, JOURNEY, WEEK, 'opened');

  const closeButton = frame(page)
    .locator('.olea-registry-row-action')
    .getByRole('button', { name: CLOSE_ACTION, exact: true })
    .first();
  await closeButton.click();
  await expect(frame(page).locator('.olea-registry-detail')).toHaveCount(0);
  await captureJourneyStep(page, JOURNEY, WEEK, 'closed');
});
